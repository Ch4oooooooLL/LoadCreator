import type { ModuleDescriptor, PreviewResult } from "@/lib/caseApi";
import { MULTI_CASE_DESCRIPTOR, moduleMeta } from "@/app/moduleRegistry";
import { ModuleGlyph, PlusIcon, ToolboxIcon, XIcon } from "@/components/Icons";

interface ToolTabBarProps {
  modules: ModuleDescriptor[];
  openIds: string[];
  activeId: string;
  previewsById: Record<string, PreviewResult | null | undefined>;
  staleById: Record<string, boolean | undefined>;
  onSelectHome: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOthers: (keepId?: string) => void;
  onOpenLauncher: () => void;
}

export default function ToolTabBar({
  modules,
  openIds,
  activeId,
  previewsById,
  staleById,
  onSelectHome,
  onSelectTab,
  onCloseTab,
  onCloseOthers,
  onOpenLauncher,
}: ToolTabBarProps) {
  const showClear = activeId === "home" ? openIds.length > 0 : openIds.length > 1;

  return (
    <nav className="toolTabBar" aria-label="工具箱标签栏">
      <button
        type="button"
        className={"toolTabHome" + (activeId === "home" ? " active" : "")}
        onClick={onSelectHome}
        title="返回工具箱总览"
      >
        <ToolboxIcon size={14} />
        <span>工具箱</span>
        <span className="toolTabHomeCount">{modules.length}</span>
      </button>

      <span className="toolTabSep" aria-hidden="true" />

      <div className="toolTabScroll">
        {openIds.map((id) => {
          const mod = id === "multi-case" ? MULTI_CASE_DESCRIPTOR : modules.find((m) => m.id === id);
          if (!mod) return null;
          const active = activeId === id;
          const meta = moduleMeta(id);
          const preview = previewsById[id];
          const stale = Boolean(staleById[id]);
          let stateTone: "" | "pass" | "stale" | "error" = "";
          if (preview) {
            if (!preview.summary.canExport) stateTone = "error";
            else if (stale) stateTone = "stale";
            else stateTone = "pass";
          }
          return (
            <div
              key={id}
              className={"toolTab" + (active ? " active" : "")}
              title={`${mod.title} (${meta.solTag}) · 中键或点 × 关闭`}
            >
              <button
                type="button"
                className="toolTabBtn"
                aria-current={active ? "page" : undefined}
                onClick={() => onSelectTab(id)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onCloseTab(id);
                  }
                }}
              >
                <span className={"toolTabGlyph solver-" + mod.solver}>
                  <ModuleGlyph id={id} size={13} />
                </span>
                <span className="toolTabTitle">{mod.title}</span>
                {stateTone && <span className={"toolTabDot " + stateTone} />}
              </button>
              <button
                type="button"
                className="toolTabClose"
                aria-label={`关闭 ${mod.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(id);
                }}
              >
                <XIcon size={11} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="toolTabAddBtn"
          onClick={onOpenLauncher}
          title="快速打开或切换工具 (Ctrl+K)"
        >
          <PlusIcon size={13} />
          <span>{openIds.length === 0 ? "快速启动工具" : "打开工具"}</span>
        </button>
      </div>

      <div className="toolTabRight">
        {showClear && (
          <button
            type="button"
            className="toolTabClearBtn"
            onClick={() => onCloseOthers(activeId === "home" ? undefined : activeId)}
          >
            {activeId === "home" ? "关闭全部标签" : "关闭其他"}
          </button>
        )}
        <span className="toolTabEngine" title="仅生成增量 Deck，外部实体 ID 需导入后人工核对">
          OptiStruct 2022 · Radioss 2022
        </span>
      </div>
    </nav>
  );
}
