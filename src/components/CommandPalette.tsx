import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ModuleDescriptor } from "@/lib/caseApi";
import { CATEGORY_LABELS, MULTI_CASE_DESCRIPTOR, STATUS_LABELS, moduleMeta } from "@/app/moduleRegistry";
import { ModuleGlyph, PlayCheckIcon, SaveIcon, SearchIcon, ToolboxIcon, UploadIcon, XIcon } from "@/components/Icons";

interface CommandPaletteProps {
  open: boolean;
  modules: ModuleDescriptor[];
  activeId: string;
  openIds: string[];
  onClose: () => void;
  onSelectModule: (id: string) => void;
  onCloseModule?: (id: string) => void;
  onValidate?: () => void;
  onImportTemplate?: () => void;
  onExportTemplate?: () => void;
}

interface PaletteItem {
  key: string;
  label: string;
  sub: string;
  badge?: string;
  badgeTone?: string;
  icon: ReactNode;
  action: () => void;
}

export default function CommandPalette({
  open,
  modules,
  activeId,
  openIds,
  onClose,
  onSelectModule,
  onCloseModule,
  onValidate,
  onImportTemplate,
  onExportTemplate,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [
      {
        key: "home",
        label: "返回工具箱主页",
        sub: "按求解器与学科浏览全部工具、管理置顶常用工具",
        icon: <ToolboxIcon size={16} />,
        action: () => { onSelectModule("home"); onClose(); },
      },
      {
        key: MULTI_CASE_DESCRIPTOR.id,
        label: MULTI_CASE_DESCRIPTOR.title,
        sub: `联合建模 · ${moduleMeta(MULTI_CASE_DESCRIPTOR.id).solTag} · 多工况协同编辑与完整 FEM 生成${openIds.includes("multi-case") ? " · 已打开" : ""}`,
        badge: "联合 FEM",
        badgeTone: "beta",
        icon: <ModuleGlyph id="multi-case" size={16} />,
        action: () => { onSelectModule("multi-case"); onClose(); },
      },
      ...modules.map((m) => {
        const meta = moduleMeta(m.id);
        const isOpen = openIds.includes(m.id);
        return {
          key: m.id,
          label: m.title,
          sub: `${CATEGORY_LABELS[m.category] ?? m.category} · ${meta.solTag} · ${m.capabilityFlags.join(" / ")}${isOpen ? " · 已打开" : ""}`,
          badge: STATUS_LABELS[m.status] ?? m.status,
          badgeTone: m.status,
          icon: <ModuleGlyph id={m.id} size={16} />,
          action: () => { onSelectModule(m.id); onClose(); },
        };
      }),
    ];
    if (onValidate && activeId !== "home" && activeId !== "tabular-load") {
      list.push({
        key: "cmd-validate",
        label: "校验参数并预览 Deck",
        sub: "快捷键 Ctrl+Enter",
        icon: <PlayCheckIcon size={16} />,
        action: () => { onClose(); onValidate(); },
      });
    }
    if (onImportTemplate) {
      list.push({
        key: "cmd-import-template",
        label: "导入参数模板 (XML / JSON)",
        sub: "从模板文件恢复所有模块的填写值与选择项",
        icon: <UploadIcon size={16} />,
        action: () => { onClose(); onImportTemplate(); },
      });
    }
    if (onExportTemplate) {
      list.push({
        key: "cmd-export-template",
        label: "导出参数模板 (XML / JSON)",
        sub: "保存当前所有模块的填写值与选择项到模板文件",
        icon: <SaveIcon size={16} />,
        action: () => { onClose(); onExportTemplate(); },
      });
    }
    if (onCloseModule && activeId !== "home") {
      list.push({
        key: "cmd-close-tab",
        label: "关闭当前工具标签",
        sub: "草稿参数会自动保留在本地缓存中",
        icon: <XIcon size={16} />,
        action: () => { onCloseModule(activeId); onClose(); },
      });
    }

    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((it) => `${it.label} ${it.sub} ${it.key}`.toLowerCase().includes(q));
  }, [modules, activeId, openIds, query, onSelectModule, onCloseModule, onClose, onValidate, onImportTemplate, onExportTemplate]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (items.length ? (c + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (items.length ? (c - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter" && items[cursor]) {
      e.preventDefault();
      items[cursor].action();
    }
  };

  return (
    <div className="paletteBackdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="快速跳转">
      <div className="paletteBox" onClick={(e) => e.stopPropagation()}>
        <div className="paletteSearch">
          <SearchIcon size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索工况模块、卡片关键字（如 FORCE / EIGRA / PSD / ROPS）或操作…"
          />
          <button type="button" className="paletteClose" onClick={onClose} aria-label="关闭"><XIcon size={15} /></button>
        </div>
        <div className="paletteList">
          {items.length === 0 ? (
            <div className="paletteEmpty">没有匹配的模块或命令</div>
          ) : (
            items.map((item, idx) => (
              <button
                key={item.key}
                type="button"
                className={"paletteItem" + (idx === cursor ? " selected" : "") + (item.key === activeId ? " current" : "")}
                onMouseEnter={() => setCursor(idx)}
                onClick={item.action}
              >
                <span className="paletteIcon">{item.icon}</span>
                <span className="paletteText">
                  <b>{item.label}</b>
                  <small>{item.sub}</small>
                </span>
                {item.badge && <span className={"statusPill " + (item.badgeTone ?? "")}>{item.badge}</span>}
              </button>
            ))
          )}
        </div>
        <div className="paletteFoot">
          <span><kbd>↑↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  );
}
