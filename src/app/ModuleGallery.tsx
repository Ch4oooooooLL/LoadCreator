import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ModuleDescriptor } from "@/lib/caseApi";
import { MODULE_GROUPS, STATUS_LABELS, moduleMeta } from "@/app/moduleRegistry";
import {
  CompactViewIcon,
  GridViewIcon,
  LayersIcon,
  ModuleGlyph,
  PinIcon,
  SaveIcon,
  SearchIcon,
  ShieldAlertIcon,
  UploadIcon,
} from "@/components/Icons";
import { MULTI_CASE_STORAGE_KEY } from "@/lib/multiCase";

const RECENT_KEY = "loadcreator.recentModules.v1";
const PINNED_KEY = "loadcreator.pinnedModules.v1";
const DENSITY_KEY = "loadcreator.hubDensity.v1";
const MAX_RECENT = 4;

type CategoryFilter = string;
type SolverFilter = "all" | "optistruct" | "radioss";
type HubDensity = "cards" | "compact";

function readIdList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function readDensity(): HubDensity {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "cards";
  } catch {
    return "cards";
  }
}

function searchText(m: ModuleDescriptor, groupLabel: string): string {
  const meta = moduleMeta(m.id);
  return [m.title, meta.description, meta.solTag, groupLabel, m.solver, m.status, ...m.capabilityFlags]
    .join(" ")
    .toLowerCase();
}

export default function ModuleGallery({
  modules,
  openIds,
  templateBusy,
  onOpen,
  onOpenPalette,
  onImportTemplate,
  onExportTemplate,
}: {
  modules: ModuleDescriptor[];
  openIds: string[];
  templateBusy?: boolean;
  onOpen: (id: string) => void;
  onOpenPalette: () => void;
  onImportTemplate: () => void;
  onExportTemplate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [solver, setSolver] = useState<SolverFilter>("all");
  const [recent, setRecent] = useState<string[]>(() => readIdList(RECENT_KEY));
  const [pinned, setPinned] = useState<string[]>(() => readIdList(PINNED_KEY));
  const [density, setDensity] = useState<HubDensity>(readDensity);
  const inputRef = useRef<HTMLInputElement>(null);

  const groupLabel = useCallback(
    (cat: string) => MODULE_GROUPS.find((g) => g.id === cat)?.label ?? cat,
    [],
  );

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openModule = useCallback(
    (id: string) => {
      const next = [id, ...readIdList(RECENT_KEY).filter((x) => x !== id)].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      setRecent(next);
      onOpen(id);
    },
    [onOpen],
  );

  const togglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { localStorage.setItem(PINNED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const changeDensity = useCallback((next: HubDensity) => {
    setDensity(next);
    try { localStorage.setItem(DENSITY_KEY, next); } catch { /* ignore */ }
  }, []);

  const categoryOptions = useMemo(
    () => MODULE_GROUPS
      .map((g) => ({ ...g, count: modules.filter((m) => m.category === g.id).length }))
      .filter((g) => g.count > 0),
    [modules],
  );

  const solverCounts = useMemo(() => ({
    all: modules.length,
    optistruct: modules.filter((m) => m.solver === "optistruct").length,
    radioss: modules.filter((m) => m.solver === "radioss").length,
  }), [modules]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return modules.filter((m) => {
      if (solver !== "all" && m.solver !== solver) return false;
      if (category !== "all" && m.category !== category) return false;
      if (!q) return true;
      return searchText(m, groupLabel(m.category)).includes(q);
    });
  }, [modules, query, category, solver, groupLabel]);

  const groups = useMemo(
    () => MODULE_GROUPS
      .map((g) => ({ ...g, list: filtered.filter((m) => m.category === g.id) }))
      .filter((g) => g.list.length > 0),
    [filtered],
  );

  const recentModules = useMemo(
    () => recent.map((id) => modules.find((m) => m.id === id)).filter((m): m is ModuleDescriptor => !!m),
    [recent, modules],
  );

  const pinnedModules = useMemo(
    () => pinned.map((id) => modules.find((m) => m.id === id)).filter((m): m is ModuleDescriptor => !!m),
    [pinned, modules],
  );

  const isUnfiltered = !query.trim() && category === "all" && solver === "all";
  const showPinned = pinnedModules.length > 0 && isUnfiltered;
  const showRecent = recentModules.length > 0 && isUnfiltered;
  const firstMatch = filtered[0];
  const multiCaseOpen = openIds.includes("multi-case");
  const multiCaseCount = useMemo(() => {
    try {
      const raw = localStorage.getItem(MULTI_CASE_STORAGE_KEY);
      if (!raw) return 2;
      const parsed = JSON.parse(raw) as { cases?: unknown[] };
      return Array.isArray(parsed?.cases) ? parsed.cases.length : 0;
    } catch {
      return 2;
    }
  }, []);

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && firstMatch) openModule(firstMatch.id);
    if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); }
  };

  return (
    <div className="hubWrap">
      <header className="hubHeader">
        <div className="hubHeaderLeft">
          <div className="hubEyebrow">CAE ENGINEERING TOOLBOX · OFFLINE INCREMENTAL DECK STUDIO</div>
          <h1>LoadCreator CAE 工况工具箱</h1>
          <p>
            已收录 <b>{modules.length}</b> 个独立求解器工具（OptiStruct 2022 / Radioss 2022），点击任意工具即在顶部打开独立标签页并生成增量 Deck。
          </p>
        </div>
        <div className="hubHeaderActions">
          <button
            type="button"
            className="btnSecondary"
            disabled={templateBusy}
            onClick={onImportTemplate}
            title="从 XML / JSON 模板文件导入全部模块的填写值与选择项"
          >
            <UploadIcon size={14} /> 导入模板
          </button>
          <button
            type="button"
            className="btnSecondary"
            disabled={templateBusy}
            onClick={onExportTemplate}
            title="将当前全部模块的填写值与选择项导出为 XML / JSON 模板"
          >
            <SaveIcon size={14} /> 导出模板
          </button>
          <button type="button" className="btnPrimary" onClick={onOpenPalette}>
            <SearchIcon size={14} /> 快速启动 <kbd className="hubKbd">Ctrl K</kbd>
          </button>
        </div>
      </header>

      <section className="hubMultiHero" aria-label="多工况联合建模入口">
        <div className="hubMultiHeroLeft">
          <div className="hubMultiHeroIcon">
            <LayersIcon size={22} />
          </div>
          <div className="hubMultiHeroCopy">
            <div className="hubMultiHeroEyebrow">
              <span>MULTI-CASE COMPOSER · OPTISTRUCT 2022</span>
              {multiCaseOpen && <span className="openBadge">标签已打开</span>}
            </div>
            <h2>多工况联合建模工作台 · 同求解器完整 FEM 组装</h2>
            <p>
              仅针对<strong>同一求解器（当前：OptiStruct 2022）</strong>协同编辑静力、位移约束、重力、模态、频响、PSD 随机振动与整车工况表，自动统一单位制、关联工程约束/载荷、全局避让 ID 冲突并导出单一完整 <code>.fem</code> 模型（Radioss <code>.rad</code> 为独立显式求解器，不混装）。
            </p>
            <div className="hubMultiHeroTags">
              <span className="capChip">限定同求解器 · OptiStruct 2022</span>
              <span className="capChip">跨工况 SPC/LOAD 联动</span>
              <span className="capChip">全局 ID 零冲突</span>
              <span className="capChip">多学科 SOL 101/103/111 兼容</span>
              <span className="capChip">工程存档 .lccase.json</span>
            </div>
          </div>
        </div>
        <div className="hubMultiHeroRight">
          <span className="hubMultiCount">当前工程 {multiCaseCount} 个工况</span>
          <button
            type="button"
            className="btnPrimary hubMultiBtn"
            onClick={() => onOpen("multi-case")}
          >
            <LayersIcon size={15} />
            <span>{multiCaseOpen ? "切换至联合建模工作台 →" : "进入多工况联合建模 →"}</span>
          </button>
        </div>
      </section>

      <div className="hubToolbar">
        <div className="hubSearch">
          <SearchIcon size={15} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="筛选工况模块、卡片名称（FORCE / EIGRA / TABRND1 / IMPDISP）…"
            aria-label="搜索模块"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          {query ? (
            <button type="button" className="hubSearchClear" onClick={() => setQuery("")} aria-label="清空搜索">×</button>
          ) : (
            <kbd className="hubKbd">/</kbd>
          )}
        </div>

        <div className="hubFilterGroups">
          <div className="segControl" role="group" aria-label="按求解器筛选">
            {[
              { id: "all", label: `全部 (${solverCounts.all})` },
              { id: "optistruct", label: `OptiStruct (${solverCounts.optistruct})` },
              { id: "radioss", label: `Radioss (${solverCounts.radioss})` },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                className={"segBtn" + (solver === s.id ? " active" : "")}
                onClick={() => setSolver(s.id as SolverFilter)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="hubPills" role="group" aria-label="按功能分类筛选">
            {[{ id: "all", label: "全部学科", count: modules.length }, ...categoryOptions].map((g) => (
              <button
                key={g.id}
                type="button"
                className={"hubPill" + (category === g.id ? " active" : "")}
                onClick={() => setCategory(g.id)}
              >
                <span>{g.label}</span>
                {g.id !== "all" && <em className="hubPillCount">{g.count}</em>}
              </button>
            ))}
          </div>

          <div className="segControl" role="group" aria-label="布局密度">
            <button
              type="button"
              className={"segBtn iconOnly" + (density === "cards" ? " active" : "")}
              onClick={() => changeDensity("cards")}
              title="标准卡片网格"
              aria-label="标准卡片网格"
            >
              <GridViewIcon size={14} />
            </button>
            <button
              type="button"
              className={"segBtn iconOnly" + (density === "compact" ? " active" : "")}
              onClick={() => changeDensity("compact")}
              title="高密度工具清单"
              aria-label="高密度工具清单"
            >
              <CompactViewIcon size={14} />
            </button>
          </div>
        </div>
      </div>

      {showPinned && (
        <section className="hubRecent" aria-label="已置顶常用工具">
          <div className="hubSectionHead">
            <h2>常用置顶工具 ({pinnedModules.length})</h2>
            <button
              type="button"
              className="textLinkBtn"
              onClick={() => { setPinned([]); try { localStorage.removeItem(PINNED_KEY); } catch { /* ignore */ } }}
            >
              取消全部置顶
            </button>
          </div>
          <div className="hubRecentGrid">
            {pinnedModules.map((m) => {
              const meta = moduleMeta(m.id);
              const isOpen = openIds.includes(m.id);
              return (
                <div key={m.id} className="recentChipCardWrap">
                  <button type="button" className="recentChipCard" onClick={() => openModule(m.id)}>
                    <span className={"recentChipIcon solver-" + m.solver}>
                      <ModuleGlyph id={m.id} size={16} />
                    </span>
                    <span className="recentChipText">
                      <b>{m.title}</b>
                      <small>{meta.solTag}{isOpen ? " · 打开中" : ""}</small>
                    </span>
                    <span className="recentChipGo">→</span>
                  </button>
                  <button
                    type="button"
                    className="recentUnpinBtn"
                    title="取消置顶"
                    aria-label={`取消置顶 ${m.title}`}
                    onClick={() => togglePin(m.id)}
                  >
                    <PinIcon size={12} filled />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {showRecent && (
        <section className="hubRecent" aria-label="最近使用">
          <div className="hubSectionHead">
            <h2>最近使用</h2>
            <button
              type="button"
              className="textLinkBtn"
              onClick={() => { setRecent([]); try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } }}
            >
              清除记录
            </button>
          </div>
          <div className="hubRecentGrid">
            {recentModules.map((m) => {
              const meta = moduleMeta(m.id);
              const isOpen = openIds.includes(m.id);
              return (
                <button key={m.id} type="button" className="recentChipCard" onClick={() => openModule(m.id)}>
                  <span className={"recentChipIcon solver-" + m.solver}>
                    <ModuleGlyph id={m.id} size={16} />
                  </span>
                  <span className="recentChipText">
                    <b>{m.title}</b>
                    <small>{meta.solTag} · {meta.outputExt}{isOpen ? " · 打开中" : ""}</small>
                  </span>
                  <span className="recentChipGo">→</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {(query.trim() || category !== "all" || solver !== "all") && (
        <p className="hubMatchCount">
          匹配 <b>{filtered.length}</b> 个工况模块
          {firstMatch && <span> · 按 Enter 打开「{firstMatch.title}」</span>}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.id} className="hubGroup">
          <div className="hubGroupHead">
            <h2>{group.label}</h2>
            <span>{group.hint}</span>
            <em className="hubGroupCount">{group.list.length} 项</em>
          </div>
          <div className={"hubCardGrid" + (density === "compact" ? " isCompact" : "")}>
            {group.list.map((m) => {
              const meta = moduleMeta(m.id);
              const isPinned = pinned.includes(m.id);
              const isOpen = openIds.includes(m.id);
              if (density === "compact") {
                return (
                  <div key={m.id} className={"moduleTile" + (isOpen ? " isOpen" : "")}>
                    <button
                      type="button"
                      className="moduleCardHit"
                      onClick={() => openModule(m.id)}
                      aria-label={`打开 ${m.title}`}
                    />
                    <span className={"moduleGlyphBox compact solver-" + m.solver}>
                      <ModuleGlyph id={m.id} size={16} />
                    </span>
                    <div className="moduleTileCopy">
                      <div className="moduleTileTitleRow">
                        <h3>{m.title}</h3>
                        {isOpen && <span className="openBadge">打开中</span>}
                      </div>
                      <div className="moduleTileMeta">
                        <span className={"solverPill " + m.solver}>{meta.solTag}</span>
                        <code>{meta.outputExt}</code>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={"modulePinBtn" + (isPinned ? " pinned" : "")}
                      title={isPinned ? "取消置顶" : "置顶到常用工具"}
                      aria-label={isPinned ? `取消置顶 ${m.title}` : `置顶 ${m.title}`}
                      onClick={() => togglePin(m.id)}
                    >
                      <PinIcon size={13} filled={isPinned} />
                    </button>
                  </div>
                );
              }
              return (
                <div key={m.id} className={"moduleCard" + (isOpen ? " isOpen" : "")}>
                  <button
                    type="button"
                    className="moduleCardHit"
                    onClick={() => openModule(m.id)}
                    aria-label={`打开 ${m.title}`}
                  />
                  <div className="moduleCardTop">
                    <span className={"moduleGlyphBox solver-" + m.solver}>
                      <ModuleGlyph id={m.id} size={19} />
                    </span>
                    <div className="moduleBadges">
                      {isOpen && <span className="openBadge">打开中</span>}
                      <span className={"solverPill " + m.solver}>{meta.solTag}</span>
                      <span className={"statusPill " + m.status}>{STATUS_LABELS[m.status] ?? m.status}</span>
                      <button
                        type="button"
                        className={"modulePinBtn" + (isPinned ? " pinned" : "")}
                        title={isPinned ? "取消置顶" : "置顶到常用工具"}
                        aria-label={isPinned ? `取消置顶 ${m.title}` : `置顶 ${m.title}`}
                        onClick={() => togglePin(m.id)}
                      >
                        <PinIcon size={13} filled={isPinned} />
                      </button>
                    </div>
                  </div>
                  <h3 className="moduleCardTitle">{m.title}</h3>
                  <p className="moduleCardDesc">{meta.description}</p>
                  <div className="moduleCardTags">
                    {m.capabilityFlags.slice(0, 4).map((flag) => <span key={flag} className="capChip">{flag}</span>)}
                  </div>
                  <div className="moduleCardFoot">
                    <code>输出 {meta.outputExt}</code>
                    <span className="moduleCardOpen">{isOpen ? "切换至标签 →" : "打开工具 →"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {groups.length === 0 && (
        <div className="hubEmpty">
          <p>没有匹配的模块</p>
          <button type="button" className="btnSecondary" onClick={() => { setQuery(""); setCategory("all"); setSolver("all"); }}>
            重置全部筛选条件
          </button>
        </div>
      )}

      <footer className="hubPolicyNote">
        <ShieldAlertIcon size={15} />
        <span>
          安全不变量：所有模块仅输出增量加载/边界卡片（不生成 GRID / /NODE / 材料 / 单元），外部实体 ID 均标为 <code>UNVERIFIED_EXTERNAL</code>；HyperMesh 导入与求解器实机验证需在使用侧确认。
        </span>
      </footer>
    </div>
  );
}
