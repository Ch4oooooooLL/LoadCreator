import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ModuleDescriptor } from "@/lib/caseApi";
import { MODULE_GROUPS, STATUS_LABELS, moduleMeta } from "@/app/moduleRegistry";

const RECENT_KEY = "loadcreator.recentModules.v1";
const MAX_RECENT = 3;

/** "all" or a MODULE_GROUPS id — filtering is by function, not by maturity. */
type CategoryFilter = string;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Lower-cased haystack so one query can match title, copy, group or capability. */
function searchText(m: ModuleDescriptor, groupLabel: string): string {
  const meta = moduleMeta(m.id);
  return [m.title, meta.description, groupLabel, m.solver, m.status, ...m.capabilityFlags]
    .join(" ")
    .toLowerCase();
}

export default function ModuleGallery({
  modules,
  onOpen,
}: {
  modules: ModuleDescriptor[];
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [recent, setRecent] = useState<string[]>(readRecent);
  const inputRef = useRef<HTMLInputElement>(null);

  const groupLabel = useCallback(
    (category: string) => MODULE_GROUPS.find((g) => g.id === category)?.label ?? category,
    [],
  );

  // Ctrl/Cmd+K focuses search from anywhere; "/" does it when not already typing.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Persist before handing control to the parent: onOpen unmounts this view, and a
  // state updater queued on an unmounting component never runs, so the write must
  // not live inside setRecent().
  const openModule = useCallback(
    (id: string) => {
      const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage full / disabled */ }
      setRecent(next);
      onOpen(id);
    },
    [onOpen],
  );

  // Only offer groups that actually have modules, so the bar never shows a
  // filter that would come up empty.
  const categoryOptions = useMemo(
    () => MODULE_GROUPS.filter((g) => modules.some((m) => m.category === g.id)),
    [modules],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return modules.filter((m) => {
      if (category !== "all" && m.category !== category) return false;
      if (!q) return true;
      return searchText(m, groupLabel(m.category)).includes(q);
    });
  }, [modules, query, category, groupLabel]);

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

  // Recent strip is a shortcut, not a duplicate listing: hide it while narrowing.
  const showRecent = recentModules.length > 0 && !query.trim() && category === "all";
  const firstMatch = filtered[0];

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && firstMatch) openModule(firstMatch.id);
    if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); }
  };

  return (
    <div className="gallery">
      <header className="galleryHero">
        <p className="wbEyebrow">MODULAR CAE TOOLBOX</p>
        <h1>工况创建工具箱</h1>
        <p className="gallerySub">
          选择一个工况模板开始。每个模块独立生成<strong>可增量导入 HyperMesh 的 FEM</strong>，
          整车工况载荷表与新工况共用同一项目与导出管线；后续新模块会持续出现在这里。
        </p>
        <div className="galleryStats">
          <span><b>{modules.length}</b> 个模块</span>
          <span><b>{categoryOptions.length}</b> 个功能分类</span>
          <span><b>{new Set(modules.map((m) => m.solver)).size}</b> 种求解器</span>
        </div>
      </header>

      <div className="galleryToolbar">
        <div className="gallerySearch">
          <svg className="gallerySearchIcon" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="gallerySearchInput"
            type="search"
            value={query}
            placeholder="搜索模块、能力标记或求解器…"
            aria-label="搜索模块"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          {query ? (
            <button type="button" className="gallerySearchClear" aria-label="清空搜索" onClick={() => setQuery("")}>×</button>
          ) : (
            <kbd className="gallerySearchKbd">Ctrl K</kbd>
          )}
        </div>

        {categoryOptions.length > 1 && (
          <div className="galleryFilters" role="group" aria-label="按功能分类筛选">
            {[{ id: "all", label: "全部" }, ...categoryOptions].map((g) => (
              <button
                key={g.id}
                type="button"
                className={"galleryFilter" + (category === g.id ? " active" : "")}
                aria-pressed={category === g.id}
                onClick={() => setCategory(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {showRecent && (
        <section className="galleryRecent" aria-label="最近使用">
          <div className="galleryRecentHead">
            <h2>最近使用</h2>
            <button type="button" className="galleryRecentClear" onClick={() => { setRecent([]); try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } }}>
              清空
            </button>
          </div>
          <div className="galleryRecentList">
            {recentModules.map((m) => (
              <button key={m.id} type="button" className="galleryRecentItem" onClick={() => openModule(m.id)}>
                <span className="galleryRecentIcon">{moduleMeta(m.id).icon}</span>
                <span className="galleryRecentTitle">{m.title}</span>
                <span className="galleryRecentGo" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(query.trim() || category !== "all") && (
        <p className="galleryCount">
          匹配 <b>{filtered.length}</b> 个模块
          {firstMatch && <span className="galleryCountHint">· 回车打开「{firstMatch.title}」· Esc 清空</span>}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.id} className="galleryGroup">
          <div className="galleryGroupHead">
            <h2>{group.label}</h2>
            <span>{group.hint}</span>
          </div>
          <div className="galleryGrid">
            {group.list.map((m) => {
              const meta = moduleMeta(m.id);
              return (
                <button key={m.id} type="button" className="moduleCard" onClick={() => openModule(m.id)}>
                  <div className="moduleCardTop">
                    <span className="moduleIcon">{meta.icon}</span>
                    <span className={"wbBadge " + m.status}>{STATUS_LABELS[m.status] ?? m.status}</span>
                  </div>
                  <h3>{m.title}</h3>
                  <p>{meta.description}</p>
                  <div className="moduleCardTags">
                    {m.capabilityFlags.slice(0, 3).map((flag) => <span key={flag} className="wbChip muted">{flag}</span>)}
                  </div>
                  <span className="moduleCardOpen">打开模块 →</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {groups.length === 0 && (
        <div className="galleryEmpty">
          <p>没有匹配的模块</p>
          <button type="button" onClick={() => { setQuery(""); setCategory("all"); }}>清除筛选条件</button>
        </div>
      )}
    </div>
  );
}
