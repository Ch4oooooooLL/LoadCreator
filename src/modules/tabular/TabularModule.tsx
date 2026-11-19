import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { buildLoadDeck, exportLoadBundle, exportOutputFile, isDesktop, parseClipboardTable, validateLoadRows } from "@/lib/loadDeckApi";
import { normalizeWarnings, parseRowErrorTarget, validateLoadRowsLocal, warningStableKey } from "@/lib/loadDeckValidation";
import { duplicateJsonKeys, parsePointsJson, serializePointsJson } from "@/lib/pointsJson";
import {
  DEFAULT_MAPPING_RULES,
  aliasConflictItems,
  mappingIssueItems,
  suggestCaseAlias,
  type AliasConflictItem,
  type MappingIssueItem,
  type MappingRule,
} from "@/lib/caseMapping";
import {
  TABULAR_DEFAULT_EXPORT_PREFIX,
  TABULAR_MAPPING_STORAGE_KEY,
  TABULAR_STORAGE_KEY,
  persistTabularWorkspaceSnapshot,
  readTabularWorkspaceSnapshot,
  setLiveTabularSnapshot,
  subscribeTabularTemplateApply,
  type TabularWorkspaceSnapshot,
} from "@/lib/tabularWorkspaceStore";
import NumericInput from "@/components/NumericInput";
import {
  ArrowRightIcon,
  CheckIcon,
  ClipboardIcon,
  CopyIcon,
  DownloadIcon,
  FolderOpenIcon,
  HashIcon,
  LayersIcon,
  NodeIcon,
  PlusIcon,
  ResetIcon,
  SaveIcon,
  SearchIcon,
  SpinnerIcon,
  TableIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from "@/components/Icons";
import type { BuildResult, LoadDeckWarning, LoadRow, PointJsonEntry, WarningSeverity, WarningTarget } from "@/types/loadDeck";

type View = "data" | "points" | "export";
type PointLayout = "cards" | "table";
type ToastTone = "success" | "info" | "error";
interface Toast { id: number; tone: ToastTone; text: string; }
type NumericKey = "x" | "y" | "z" | "fx" | "fy" | "fz" | "tx" | "ty" | "tz";

interface DataJumpHighlight {
  warningKey: string;
  message: string;
  severity: WarningSeverity;
  targets: WarningTarget[];
  activeTargetIndex: number;
  nonce: number;
}

interface SourceJumpHighlight {
  warningKey: string;
  message: string;
  lines: Array<{ lineNumber: number; label: string }>;
  activeLine: number;
  nonce: number;
}

interface AliasJumpHighlight {
  alias: string;
  caseNames: string[];
  activeCaseName: string;
  message: string;
  nonce: number;
}

interface JsonJumpHighlight {
  key: string;
  indices: number[];
  activeIndex: number;
  nonce: number;
}

interface RuleJumpHighlight {
  issueId: string;
  message: string;
  targets: MappingIssueItem["targets"];
  activeTargetIndex: number;
  nonce: number;
}

export interface TabularSnapshot {
  source: string;
  rows: LoadRow[];
  caseAliases: Record<string, string>;
  mappingRules: MappingRule[];
}

const SAMPLE = "case1_braking\nGroup\tX\tY\tZ\tEnglish Name\t中文名称\tTime\tFX\tFY\tFZ\tTX\tTY\tTZ\nfront\t1550\t0\t-210\tfrontsusp_a\t前悬架连接点\t7\t-385\t-4150\t35600\t0\t0\t0\nfront\t0\t-800\t200\tfront_bumper_left\t前保险杠左侧\t7\t0\t0\t0\t0\t0\t0\nrear\t4882\t-475\t90\tmid_yrod\t中横推杆连接点\t7\t26100\t-175000\t14900\t0\t0\t0";
const STORAGE_KEY = TABULAR_STORAGE_KEY;
const MAPPING_STORAGE_KEY = TABULAR_MAPPING_STORAGE_KEY;
const DEFAULT_EXPORT_PREFIX = TABULAR_DEFAULT_EXPORT_PREFIX;
const NUMERIC_KEYS: NumericKey[] = ["x", "y", "z", "fx", "fy", "fz", "tx", "ty", "tz"];
const TABLE_HEADERS = ["工况 / Load Step", "中文点位名（归并索引）", "英文点位名（JSON）", "X", "Y", "Z", "FX", "FY", "FZ", "TX", "TY", "TZ"];
const PASTE_LINE_HEIGHT = 20;
const PASTE_PADDING_TOP = 10;
const SOURCE_CHIP_COLLAPSE_LIMIT = 8;

const VIEWS: Array<{ id: View; num: string; label: string; hint: string }> = [
  { id: "data", num: "01", label: "数据导入与校对", hint: "粘贴 / 命名映射 / 编辑" },
  { id: "points", num: "02", label: "点位与节点归并", hint: "坐标、JSON 与节点号" },
  { id: "export", num: "03", label: "生成与导出", hint: "增量 FEM 与点位 JSON" },
];

function messageOf(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to legacy textarea copy.
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("系统剪贴板不可用");
}

export function loadInitialMappingRules(): MappingRule[] {
  try {
    const stored = localStorage.getItem(MAPPING_STORAGE_KEY);
    const data = stored ? (JSON.parse(stored) as MappingRule[]) : null;
    if (Array.isArray(data)) return data;
  } catch {
    localStorage.removeItem(MAPPING_STORAGE_KEY);
  }
  return DEFAULT_MAPPING_RULES.map((rule) => ({ ...rule }));
}

export default function TabularModule({
  onToast,
}: {
  onToast?: (tone: ToastTone, text: string) => void;
}) {
  const initialSnapshotRef = useRef<TabularWorkspaceSnapshot | null>(null);
  if (!initialSnapshotRef.current) {
    initialSnapshotRef.current = readTabularWorkspaceSnapshot();
  }
  const initSnap = initialSnapshotRef.current;

  const [exportPrefix, setExportPrefix] = useState(initSnap.exportPrefix);
  const [view, setView] = useState<View>(initSnap.view === "points" ? "data" : initSnap.view);
  const [showSource, setShowSource] = useState(initSnap.rows.length > 0 ? initSnap.showSource : true);
  const [source, setSource] = useState(initSnap.source);
  const [rows, setRows] = useState<LoadRow[]>(initSnap.rows);
  const [caseAliases, setCaseAliases] = useState<Record<string, string>>(initSnap.caseAliases);
  const [mappingRules, setMappingRules] = useState<MappingRule[]>(initSnap.mappingRules);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [jsonEntries, setJsonEntries] = useState<PointJsonEntry[]>([]);
  const [buildSeq, setBuildSeq] = useState(0);
  const [parseWarnings, setParseWarnings] = useState<LoadDeckWarning[]>([]);
  const [rowWarnings, setRowWarnings] = useState<LoadDeckWarning[]>([]);
  const [parsedSourceSnapshot, setParsedSourceSnapshot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [rowQuery, setRowQuery] = useState("");
  const [pointQuery, setPointQuery] = useState("");
  const [pointLayout, setPointLayout] = useState<PointLayout>(initSnap.pointLayout);
  const [rulesDrawerOpen, setRulesDrawerOpen] = useState(false);
  const [showFemText, setShowFemText] = useState(initSnap.showFemText);
  const [warningsExpanded, setWarningsExpanded] = useState(true);
  const [expandedChipKeys, setExpandedChipKeys] = useState<Record<string, boolean>>({});
  const [dataHighlight, setDataHighlight] = useState<DataJumpHighlight | null>(null);
  const [sourceHighlight, setSourceHighlight] = useState<SourceJumpHighlight | null>(null);
  const [aliasHighlight, setAliasHighlight] = useState<AliasJumpHighlight | null>(null);
  const [jsonHighlight, setJsonHighlight] = useState<JsonJumpHighlight | null>(null);
  const [ruleHighlight, setRuleHighlight] = useState<RuleJumpHighlight | null>(null);
  const [pasteScrollTop, setPasteScrollTop] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dataTableWrapRef = useRef<HTMLDivElement>(null);
  const aliasGridRef = useRef<HTMLDivElement>(null);
  const jsonTableWrapRef = useRef<HTMLDivElement>(null);
  const drawerBodyRef = useRef<HTMLDivElement>(null);
  const warningsBoxRef = useRef<HTMLElement>(null);
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const jumpNonceRef = useRef(0);
  const pendingDataScrollRef = useRef(0);
  const pendingSourceScrollRef = useRef(0);
  const pendingAliasScrollRef = useRef(0);
  const pendingJsonScrollRef = useRef(0);
  const pendingRuleScrollRef = useRef(0);
  const validationSeqRef = useRef(0);

  const toast = useCallback((tone: ToastTone, text: string) => {
    if (onToast) {
      onToast(tone, text);
      return;
    }
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, tone, text }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 4200);
  }, [onToast]);

  useEffect(() => {
    return subscribeTabularTemplateApply((snapshot) => {
      setExportPrefix(snapshot.exportPrefix);
      setSource(snapshot.source);
      setRows(snapshot.rows);
      setCaseAliases(snapshot.caseAliases);
      setMappingRules(snapshot.mappingRules);
      setView(snapshot.view === "points" ? "data" : snapshot.view);
      setShowSource(snapshot.rows.length > 0 ? snapshot.showSource : true);
      setPointLayout(snapshot.pointLayout);
      setShowFemText(snapshot.showFemText);
      setResult(null);
      setJsonEntries([]);
      setParseWarnings([]);
      setParsedSourceSnapshot("");
      setDataHighlight(null);
      setSourceHighlight(null);
      setAliasHighlight(null);
      setJsonHighlight(null);
      setRuleHighlight(null);
      setError("");
    });
  }, []);

  useEffect(() => {
    const snapshot: TabularWorkspaceSnapshot = {
      exportPrefix,
      source,
      rows,
      caseAliases,
      mappingRules,
      view,
      showSource,
      pointLayout,
      showFemText,
    };
    setLiveTabularSnapshot(snapshot);
    const timer = window.setTimeout(() => {
      persistTabularWorkspaceSnapshot(snapshot);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [exportPrefix, source, rows, caseAliases, mappingRules, view, showSource, pointLayout, showFemText]);

  const caseNames = useMemo(() => [...new Set(rows.map((row) => row.caseName.trim() || "Load Case 1"))], [rows]);
  const caseCount = caseNames.length;
  const resolvedCaseAliases = useMemo(
    () => Object.fromEntries(caseNames.map((name, index) => [name, caseAliases[name]?.trim() || suggestCaseAlias(name, index, mappingRules)])),
    [caseAliases, caseNames, mappingRules],
  );
  const mappingIssueList = useMemo(() => mappingIssueItems(mappingRules, caseNames), [caseNames, mappingRules]);
  const aliasConflictsList = useMemo(() => aliasConflictItems(resolvedCaseAliases), [resolvedCaseAliases]);
  const estimatedPoints = useMemo(
    () => new Set(rows.map((row, index) => row.displayName.trim() || row.pointName.trim() || "point_" + (index + 1))).size,
    [rows],
  );
  const allWarnings = useMemo(() => [...parseWarnings, ...rowWarnings], [parseWarnings, rowWarnings]);
  const errorWarningCount = useMemo(() => allWarnings.filter((w) => w.severity === "error").length, [allWarnings]);
  const rowWarningsByIndex = useMemo(() => {
    const byRow = new Map<number, LoadDeckWarning[]>();
    rowWarnings.forEach((warning) => {
      const seenRows = new Set<number>();
      warning.targets.forEach((target) => {
        if (target.kind !== "dataCell" || target.rowIndex === undefined || seenRows.has(target.rowIndex)) return;
        seenRows.add(target.rowIndex);
        byRow.set(target.rowIndex, [...(byRow.get(target.rowIndex) ?? []), warning]);
      });
    });
    return byRow;
  }, [rowWarnings]);
  const sourceLines = useMemo(() => source.split(/\r?\n/), [source]);
  const ignoredSourceLineSet = useMemo(() => {
    const set = new Set<number>();
    parseWarnings.forEach((w) => {
      w.targets.forEach((t) => {
        if (t.kind === "sourceLine" && t.sourceLine !== undefined) set.add(t.sourceLine);
      });
    });
    return set;
  }, [parseWarnings]);
  const sourceModifiedSinceParse = parseWarnings.length > 0 && source !== parsedSourceSnapshot;
  const errorJumpTarget = useMemo(() => (error ? parseRowErrorTarget(error) : null), [error]);

  const femText = result?.fem ?? "";
  const femStats = useMemo(
    () => ({
      force: femText.match(/^FORCE,/gm)?.length ?? 0,
      moment: femText.match(/^MOMENT,/gm)?.length ?? 0,
      lines: femText.match(/\n/g)?.length ?? 0,
      kilobytes: (femText.length / 1024).toFixed(1),
    }),
    [femText],
  );
  const pointNameByNode = useMemo(
    () => new Map<number, string>((result?.points ?? []).map((point) => [point.nodeId, point.name] as const)),
    [result?.points],
  );
  const duplicateKeys = useMemo(() => duplicateJsonKeys(jsonEntries), [jsonEntries]);

  const filteredRows = useMemo(() => {
    const query = rowQuery.trim().toLowerCase();
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) =>
        !query || [row.caseName, row.groupName, row.displayName, row.pointName].some((value) => value.toLowerCase().includes(query)),
      );
  }, [rows, rowQuery]);

  const filteredPoints = useMemo(() => {
    const query = pointQuery.trim().toLowerCase();
    const points = result?.points ?? [];
    return points.filter(
      (point) => !query || [point.name, point.englishName, point.text].some((value) => value.toLowerCase().includes(query)),
    );
  }, [result, pointQuery]);

  const currentIndex = Math.max(0, VIEWS.findIndex((item) => item.id === view));

  useEffect(() => {
    const seq = ++validationSeqRef.current;
    if (rows.length === 0) {
      setRowWarnings([]);
      return;
    }
    const timer = window.setTimeout(() => {
      if (isDesktop()) {
        validateLoadRows(rows)
          .then((res) => {
            if (validationSeqRef.current === seq) {
              setRowWarnings(normalizeWarnings(res.warningItems, res.warnings));
            }
          })
          .catch(() => {
            if (validationSeqRef.current === seq) {
              setRowWarnings(validateLoadRowsLocal(rows));
            }
          });
      } else {
        setRowWarnings(validateLoadRowsLocal(rows));
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [rows]);

  useEffect(() => {
    if (!dataHighlight || dataHighlight.warningKey.startsWith("ERROR::")) return;
    const matched = rowWarnings.find((w) => warningStableKey(w) === dataHighlight.warningKey);
    if (!matched) {
      setDataHighlight(null);
      return;
    }
    const nextTargets = matched.targets.filter((t) => t.kind === "dataCell" && t.rowIndex !== undefined);
    if (nextTargets.length === 0) {
      setDataHighlight(null);
      return;
    }
    const targetsChanged =
      nextTargets.length !== dataHighlight.targets.length ||
      nextTargets.some((t, idx) => {
        const prev = dataHighlight.targets[idx];
        return (
          !prev ||
          t.rowIndex !== prev.rowIndex ||
          t.label !== prev.label ||
          (t.fields ?? []).join(",") !== (prev.fields ?? []).join(",")
        );
      });
    if (matched.message !== dataHighlight.message || matched.severity !== dataHighlight.severity || targetsChanged) {
      setDataHighlight((prev) =>
        prev
          ? {
              ...prev,
              message: matched.message,
              severity: matched.severity,
              targets: nextTargets,
              activeTargetIndex: Math.min(prev.activeTargetIndex, nextTargets.length - 1),
            }
          : null,
      );
    }
  }, [rowWarnings, dataHighlight]);

  useEffect(() => {
    if (!aliasHighlight) return;
    const matched = aliasConflictsList.find((item) => item.alias === aliasHighlight.alias);
    if (!matched) {
      setAliasHighlight(null);
      return;
    }
    if (matched.message !== aliasHighlight.message) {
      setAliasHighlight((prev) =>
        prev
          ? {
              ...prev,
              caseNames: matched.caseNames,
              message: matched.message,
              activeCaseName: matched.caseNames.includes(prev.activeCaseName) ? prev.activeCaseName : matched.caseNames[0],
            }
          : null,
      );
    }
  }, [aliasConflictsList, aliasHighlight]);

  useEffect(() => {
    if (!jsonHighlight) return;
    if (!duplicateKeys.includes(jsonHighlight.key)) {
      setJsonHighlight(null);
      return;
    }
    const indices = jsonEntries.reduce<number[]>((acc, entry, idx) => (entry.key === jsonHighlight.key ? [...acc, idx] : acc), []);
    if (indices.length < 2) {
      setJsonHighlight(null);
      return;
    }
    if (indices.length !== jsonHighlight.indices.length || indices.some((v, i) => v !== jsonHighlight.indices[i])) {
      setJsonHighlight((prev) =>
        prev
          ? {
              ...prev,
              indices,
              activeIndex: indices.includes(prev.activeIndex) ? prev.activeIndex : indices[0],
            }
          : null,
      );
    }
  }, [duplicateKeys, jsonEntries, jsonHighlight]);

  useEffect(() => {
    if (!ruleHighlight) return;
    const matched = mappingIssueList.find((item) => item.id === ruleHighlight.issueId);
    if (!matched) {
      setRuleHighlight(null);
      return;
    }
    const targetsChanged =
      matched.targets.length !== ruleHighlight.targets.length ||
      matched.targets.some((t, idx) => {
        const prev = ruleHighlight.targets[idx];
        return !prev || t.ruleIndex !== prev.ruleIndex || t.field !== prev.field || t.label !== prev.label;
      });
    if (matched.message !== ruleHighlight.message || targetsChanged) {
      setRuleHighlight((prev) =>
        prev
          ? {
              ...prev,
              message: matched.message,
              targets: matched.targets,
              activeTargetIndex: Math.min(prev.activeTargetIndex, Math.max(0, matched.targets.length - 1)),
            }
          : null,
      );
    }
  }, [mappingIssueList, ruleHighlight]);

  useEffect(() => {
    if (!dataHighlight || view !== "data" || showSource) return;
    if (pendingDataScrollRef.current !== dataHighlight.nonce) return;
    const target = dataHighlight.targets[dataHighlight.activeTargetIndex] ?? dataHighlight.targets[0];
    if (!target || target.rowIndex === undefined) return;
    const container = dataTableWrapRef.current;
    if (!container) return;
    const rowEl = container.querySelector<HTMLTableRowElement>(`tr[data-row-index="${target.rowIndex}"]`);
    if (!rowEl) return;
    pendingDataScrollRef.current = 0;
    const primaryField = target.fields?.[0];
    const rafId = window.requestAnimationFrame(() => {
      const inputEl = primaryField
        ? rowEl.querySelector<HTMLInputElement>(`input[data-cell-field="${primaryField}"]`)
        : rowEl.querySelector<HTMLInputElement>("input");
      (inputEl ?? rowEl).scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      if (inputEl) {
        inputEl.focus({ preventScroll: true });
        inputEl.select?.();
      }
      rowEl.animate?.(
        [
          { boxShadow: "inset 0 0 0 2px rgba(217, 119, 6, 0.95)" },
          { boxShadow: "inset 0 0 0 0 rgba(217, 119, 6, 0)" },
        ],
        { duration: 1100, easing: "ease-out" },
      );
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [dataHighlight, view, showSource, filteredRows.length]);

  useEffect(() => {
    if (!sourceHighlight || view !== "data" || !showSource) return;
    if (pendingSourceScrollRef.current !== sourceHighlight.nonce) return;
    const textarea = pasteTextareaRef.current;
    if (!textarea) return;
    pendingSourceScrollRef.current = 0;
    const lines = textarea.value.split("\n");
    const lineIdx = Math.max(0, Math.min(lines.length - 1, sourceHighlight.activeLine - 1));
    let start = 0;
    for (let i = 0; i < lineIdx; i += 1) {
      start += lines[i].length + 1;
    }
    const end = start + (lines[lineIdx]?.length ?? 0);
    const targetScrollTop = Math.max(0, PASTE_PADDING_TOP + lineIdx * PASTE_LINE_HEIGHT - textarea.clientHeight / 2 + PASTE_LINE_HEIGHT / 2);
    const rafId = window.requestAnimationFrame(() => {
      textarea.scrollIntoView({ behavior: "smooth", block: "center" });
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(start, end);
      textarea.scrollTop = targetScrollTop;
      textarea.scrollLeft = 0;
      setPasteScrollTop(textarea.scrollTop);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [sourceHighlight, view, showSource]);

  useEffect(() => {
    if (!aliasHighlight || view !== "data" || showSource) return;
    if (pendingAliasScrollRef.current !== aliasHighlight.nonce) return;
    const grid = aliasGridRef.current;
    if (!grid) return;
    const caseIdx = caseNames.indexOf(aliasHighlight.activeCaseName);
    if (caseIdx < 0) return;
    const itemEl = grid.querySelector<HTMLElement>(`[data-case-index="${caseIdx}"]`);
    if (!itemEl) return;
    pendingAliasScrollRef.current = 0;
    const rafId = window.requestAnimationFrame(() => {
      itemEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      const inputEl = itemEl.querySelector<HTMLInputElement>("input");
      if (inputEl) {
        inputEl.focus({ preventScroll: true });
        inputEl.select?.();
      }
      itemEl.animate?.(
        [
          { boxShadow: "0 0 0 3px rgba(217, 119, 6, 0.55)" },
          { boxShadow: "0 0 0 0 rgba(217, 119, 6, 0)" },
        ],
        { duration: 1000, easing: "ease-out" },
      );
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [aliasHighlight, view, showSource, caseNames]);

  useEffect(() => {
    if (!jsonHighlight || view !== "export") return;
    if (pendingJsonScrollRef.current !== jsonHighlight.nonce) return;
    const container = jsonTableWrapRef.current;
    if (!container) return;
    const rowEl = container.querySelector<HTMLTableRowElement>(`tr[data-json-index="${jsonHighlight.activeIndex}"]`);
    if (!rowEl) return;
    pendingJsonScrollRef.current = 0;
    const rafId = window.requestAnimationFrame(() => {
      const inputEl = rowEl.querySelector<HTMLInputElement>('input[data-json-field="key"]');
      (inputEl ?? rowEl).scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      if (inputEl) {
        inputEl.focus({ preventScroll: true });
        inputEl.select?.();
      }
      rowEl.animate?.(
        [
          { boxShadow: "inset 0 0 0 2px rgba(217, 119, 6, 0.95)" },
          { boxShadow: "inset 0 0 0 0 rgba(217, 119, 6, 0)" },
        ],
        { duration: 1000, easing: "ease-out" },
      );
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [jsonHighlight, view]);

  useEffect(() => {
    if (!ruleHighlight || !rulesDrawerOpen) return;
    if (pendingRuleScrollRef.current !== ruleHighlight.nonce) return;
    const body = drawerBodyRef.current;
    if (!body) return;
    const target = ruleHighlight.targets[ruleHighlight.activeTargetIndex] ?? ruleHighlight.targets[0];
    if (!target) return;
    const rowEl = body.querySelector<HTMLTableRowElement>(`tr[data-rule-index="${target.ruleIndex}"]`);
    if (!rowEl) return;
    pendingRuleScrollRef.current = 0;
    const rafId = window.requestAnimationFrame(() => {
      const inputEl = rowEl.querySelector<HTMLInputElement>(`input[data-rule-field="${target.field}"]`);
      (inputEl ?? rowEl).scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      if (inputEl) {
        inputEl.focus({ preventScroll: true });
        inputEl.select?.();
      }
      rowEl.animate?.(
        [
          { boxShadow: "inset 0 0 0 2px rgba(217, 119, 6, 0.95)" },
          { boxShadow: "inset 0 0 0 0 rgba(217, 119, 6, 0)" },
        ],
        { duration: 1000, easing: "ease-out" },
      );
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [ruleHighlight, rulesDrawerOpen]);

  function nextNonce() {
    jumpNonceRef.current += 1;
    return jumpNonceRef.current;
  }

  function jumpToWarning(warning: LoadDeckWarning, explicitTargetIndex?: number) {
    const sourceTargets = warning.targets.filter((t) => t.kind === "sourceLine" && t.sourceLine !== undefined);
    if (sourceTargets.length > 0 && warning.targets[0]?.kind === "sourceLine") {
      const lines = sourceTargets.map((t) => ({
        lineNumber: t.sourceLine!,
        label: t.label ?? `第 ${t.sourceLine} 行`,
      }));
      const key = warningStableKey(warning);
      let activeLine = lines[0].lineNumber;
      if (explicitTargetIndex !== undefined && lines[explicitTargetIndex]) {
        activeLine = lines[explicitTargetIndex].lineNumber;
      } else if (sourceHighlight?.warningKey === key) {
        const currentIdx = lines.findIndex((l) => l.lineNumber === sourceHighlight.activeLine);
        activeLine = lines[(currentIdx + 1) % lines.length].lineNumber;
      }
      const nonce = nextNonce();
      pendingSourceScrollRef.current = nonce;
      setDataHighlight(null);
      setView("data");
      setShowSource(true);
      setSourceHighlight({
        warningKey: key,
        message: warning.message,
        lines,
        activeLine,
        nonce,
      });
      return;
    }

    const dataTargets = warning.targets.filter((t) => t.kind === "dataCell" && t.rowIndex !== undefined);
    if (dataTargets.length === 0) return;
    const key = warningStableKey(warning);
    let activeTargetIndex = 0;
    if (explicitTargetIndex !== undefined && dataTargets[explicitTargetIndex]) {
      activeTargetIndex = explicitTargetIndex;
    } else if (dataHighlight?.warningKey === key) {
      activeTargetIndex = (dataHighlight.activeTargetIndex + 1) % dataTargets.length;
    }
    const visibleIndices = new Set(filteredRows.map(({ index }) => index));
    if (rowQuery.trim() && dataTargets.some((t) => t.rowIndex !== undefined && !visibleIndices.has(t.rowIndex))) {
      setRowQuery("");
      toast("info", "已清除表格搜索筛选以定位目标行");
    }
    const nonce = nextNonce();
    pendingDataScrollRef.current = nonce;
    setSourceHighlight(null);
    setView("data");
    setShowSource(false);
    setDataHighlight({
      warningKey: key,
      message: warning.message,
      severity: warning.severity,
      targets: dataTargets,
      activeTargetIndex,
      nonce,
    });
  }

  function jumpToRowTarget(target: WarningTarget, message: string) {
    if (target.kind !== "dataCell" || target.rowIndex === undefined) return;
    if (rowQuery.trim() && !filteredRows.some(({ index }) => index === target.rowIndex)) {
      setRowQuery("");
      toast("info", "已清除表格搜索筛选以定位目标行");
    }
    const nonce = nextNonce();
    pendingDataScrollRef.current = nonce;
    setSourceHighlight(null);
    setView("data");
    setShowSource(false);
    setDataHighlight({
      warningKey: `ERROR::${target.rowIndex}:${target.fields?.join(",") ?? ""}`,
      message,
      severity: "error",
      targets: [target],
      activeTargetIndex: 0,
      nonce,
    });
  }

  function jumpToAliasConflict(item: AliasConflictItem, explicitCaseName?: string) {
    let targetCase = item.caseNames[0];
    if (explicitCaseName && item.caseNames.includes(explicitCaseName)) {
      targetCase = explicitCaseName;
    } else if (aliasHighlight?.alias === item.alias) {
      const idx = item.caseNames.indexOf(aliasHighlight.activeCaseName);
      targetCase = item.caseNames[(idx + 1) % item.caseNames.length];
    }
    const nonce = nextNonce();
    pendingAliasScrollRef.current = nonce;
    setView("data");
    setShowSource(false);
    setAliasHighlight({
      alias: item.alias,
      caseNames: item.caseNames,
      activeCaseName: targetCase,
      message: item.message,
      nonce,
    });
  }

  function jumpToDuplicateJsonKey(key: string, explicitIndex?: number) {
    const indices = jsonEntries.reduce<number[]>((acc, entry, idx) => (entry.key === key ? [...acc, idx] : acc), []);
    if (indices.length === 0) return;
    let activeIndex = indices[0];
    if (explicitIndex !== undefined && indices.includes(explicitIndex)) {
      activeIndex = explicitIndex;
    } else if (jsonHighlight?.key === key) {
      const pos = indices.indexOf(jsonHighlight.activeIndex);
      activeIndex = indices[(pos + 1) % indices.length];
    }
    const nonce = nextNonce();
    pendingJsonScrollRef.current = nonce;
    setView("export");
    setJsonHighlight({ key, indices, activeIndex, nonce });
  }

  function jumpToMappingIssue(issue: MappingIssueItem, explicitTargetIndex?: number) {
    if (issue.targets.length === 0) return;
    let activeTargetIndex = 0;
    if (explicitTargetIndex !== undefined && issue.targets[explicitTargetIndex]) {
      activeTargetIndex = explicitTargetIndex;
    } else if (ruleHighlight?.issueId === issue.id) {
      activeTargetIndex = (ruleHighlight.activeTargetIndex + 1) % issue.targets.length;
    }
    const nonce = nextNonce();
    pendingRuleScrollRef.current = nonce;
    setRulesDrawerOpen(true);
    setRuleHighlight({
      issueId: issue.id,
      message: issue.message,
      targets: issue.targets,
      activeTargetIndex,
      nonce,
    });
  }

  function markDirty() {
    setResult(null);
    setJsonEntries([]);
  }

  function go(next: View) {
    if (busy) return;
    if (next !== "data" && rows.length === 0) return;
    setError("");
    if ((next === "points" || next === "export") && !result) {
      void generate(next);
      return;
    }
    setView(next);
  }

  async function parse() {
    setBusy(true);
    setError("");
    try {
      if (!isDesktop()) throw new Error("解析由 Rust 桌面端完成，请使用 npm run tauri:dev 或已安装程序运行。");
      const parsed = await parseClipboardTable(source);
      const validated = await validateLoadRows(parsed.rows);
      setRows(parsed.rows);
      setParseWarnings(normalizeWarnings(parsed.warningItems, parsed.warnings));
      setRowWarnings(normalizeWarnings(validated.warningItems, validated.warnings));
      setParsedSourceSnapshot(source);
      setSourceHighlight(null);
      setDataHighlight(null);
      setAliasHighlight(null);
      setJsonHighlight(null);
      setResult(null);
      setJsonEntries([]);
      setCaseAliases({});
      setRowQuery("");
      setShowSource(false);
      setView("data");
      setWarningsExpanded(true);
      toast("success", "已解析 " + parsed.rows.length + " 条载荷记录");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function generate(nextView: View = "export"): Promise<BuildResult | null> {
    if (rows.length === 0) return null;
    setBusy(true);
    setError("");
    try {
      if (!isDesktop()) throw new Error("FEM 由 Rust 桌面端生成，请在 Tauri 应用中运行。");
      const prefix = exportPrefix.trim() || DEFAULT_EXPORT_PREFIX;
      const built = await buildLoadDeck(prefix, rows, resolvedCaseAliases);
      setResult(built);
      setRowWarnings(normalizeWarnings(built.warningItems, built.warnings));
      setJsonEntries(parsePointsJson(built.json));
      setBuildSeq((seq) => seq + 1);
      setView(nextView);
      toast("success", "已生成 " + built.cases.length + " 个 load step · " + built.points.length + " 个节点");
      return built;
    } catch (e) {
      setError(messageOf(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function exportFiles() {
    const built = result ?? (await generate("export"));
    if (!built) return;
    const prefix = exportPrefix.trim() || DEFAULT_EXPORT_PREFIX;
    setBusy(true);
    try {
      if (isDesktop()) {
        const directory = await open({ directory: true, multiple: false, title: "选择 FEM 与 JSON 导出目录" });
        if (!directory) return;
        const exported = await exportLoadBundle(directory, prefix, built.fem, built.json);
        toast("success", "已导出：" + exported.femPath + " · " + exported.jsonPath);
      } else {
        download(prefix + ".fem", built.fem, "text/plain;charset=utf-8");
        download(prefix + "_points.json", built.json, "application/json;charset=utf-8");
        toast("success", "已开始下载 FEM 与 JSON");
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveSingleFile(kind: "fem" | "json") {
    if (!result) return;
    const prefix = exportPrefix.trim() || DEFAULT_EXPORT_PREFIX;
    const isFem = kind === "fem";
    const fileName = isFem ? prefix + ".fem" : prefix + "_points.json";
    const content = isFem ? result.fem : result.json;
    try {
      if (isDesktop()) {
        const path = await save({
          title: isFem ? "保存 FEM 文件" : "保存点位 JSON",
          defaultPath: fileName,
          filters: [{ name: isFem ? "FEM" : "JSON", extensions: [kind] }],
        });
        if (!path) return;
        const savedPath = await exportOutputFile(path, content);
        toast("success", "已保存：" + savedPath);
      } else {
        download(fileName, content, isFem ? "text/plain;charset=utf-8" : "application/json;charset=utf-8");
        toast("success", "已开始下载 " + fileName);
      }
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function copyContent(text: string, label: string) {
    try {
      await copyText(text);
      toast("success", label + " 已复制到剪贴板");
    } catch (e) {
      toast("error", "复制失败：" + messageOf(e));
    }
  }

  function updateRow(index: number, key: "caseName" | "groupName" | "displayName" | "pointName", value: string) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
    markDirty();
  }

  function updateRowNumber(index: number, key: NumericKey, value: number) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
    markDirty();
  }

  function addRow() {
    const previous = rows.at(-1);
    setRows((current) => [
      ...current,
      {
        sourceLine: 0,
        caseName: previous?.caseName ?? "Load Case 1",
        groupName: previous?.groupName ?? "",
        pointName: "point_" + (current.length + 1),
        displayName: "",
        x: 0,
        y: 0,
        z: 0,
        time: null,
        fx: 0,
        fy: 0,
        fz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
      },
    ]);
    markDirty();
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
    setDataHighlight(null);
    markDirty();
  }

  function patchJsonEntry(index: number, patch: Partial<PointJsonEntry>) {
    const next = jsonEntries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    setJsonEntries(next);
    setResult((current) => (current ? { ...current, json: serializePointsJson(next) } : current));
  }

  function commitJsonCoordinate(index: number, axis: "x" | "y" | "z", value: number) {
    if (!Number.isFinite(value)) return;
    patchJsonEntry(index, axis === "x" ? { x: value } : axis === "y" ? { y: value } : { z: value });
  }

  function reset() {
    if (rows.length > 0 && !window.confirm("确定要清空当前整车表格工作区吗？已填入的数据将全部丢失，此操作不可撤销。")) return;
    setSource("");
    setRows([]);
    setCaseAliases({});
    setResult(null);
    setJsonEntries([]);
    setParseWarnings([]);
    setRowWarnings([]);
    setParsedSourceSnapshot("");
    setDataHighlight(null);
    setSourceHighlight(null);
    setAliasHighlight(null);
    setJsonHighlight(null);
    setRuleHighlight(null);
    setError("");
    setRowQuery("");
    setPointQuery("");
    setShowSource(true);
    setView("data");
    localStorage.removeItem(STORAGE_KEY);
    toast("info", "已重置表格工作区");
  }

  const handleLocalFileChange = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setSource(text);
    toast("info", `已载入 ${file.name} (${text.split(/\r?\n/).length} 行)，请点击“解析表格”`);
  };

  const busyOrEmpty = busy || rows.length === 0;

  return (
    <div className="tabShell">
      <header className="wbActionBar">
        <div className="wbActionBarTitle">
          <h1>整车工况生成</h1>
          <span className="wbSubTag">Excel/WPS 批量载荷表 → 归并节点 + 增量 FEM</span>
        </div>

        <div className="tabPipeline" role="tablist" aria-label="整车载荷流程步骤">
          {VIEWS.map((item, index) => {
            const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "todo";
            const disabled = item.id !== "data" && rows.length === 0;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === view}
                className={"tabPipeStep " + state + (disabled ? " disabled" : "")}
                disabled={disabled}
                onClick={() => go(item.id)}
              >
                <span className="tabPipeNum">{state === "done" ? <CheckIcon size={12} /> : item.num}</span>
                <span className="tabPipeText">
                  <b>{item.label}</b>
                  <small>{item.hint}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="wbActionBarButtons">
          <button type="button" className="btnSecondary" onClick={reset}>
            <ResetIcon size={14} /> 清空工作区
          </button>
        </div>
      </header>

      <div className="tabKpiStrip">
        <div className="tabKpi"><TableIcon size={15} /><span>载荷记录</span><b>{rows.length}</b></div>
        <div className="tabKpi"><LayersIcon size={15} /><span>Load Steps</span><b>{caseCount}</b></div>
        <div className="tabKpi"><NodeIcon size={15} /><span>命名节点</span><b>{result?.points.length ?? estimatedPoints}</b></div>
        <div className="tabKpi"><HashIcon size={15} /><span>起始节点号</span><b>1001</b></div>
        <label className="tabKpi tabKpiEditable" title="导出的 .fem 与 _points.json 文件名前缀">
          <span className="tabKpiProjLabel">导出前缀</span>
          <input
            className="tabKpiInput mono"
            value={exportPrefix}
            placeholder={DEFAULT_EXPORT_PREFIX}
            spellCheck={false}
            onChange={(e) => setExportPrefix(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <div className="inlineNotice error" role="alert">
          <div className="noticeActionText">
            <span><b>操作失败：</b>{error}</span>
            {errorJumpTarget && (
              <button
                type="button"
                className="tabWarnChip error"
                onClick={() => jumpToRowTarget(errorJumpTarget, error)}
              >
                定位到 {errorJumpTarget.label} →
              </button>
            )}
          </div>
          <button type="button" className="iconTrashBtn" onClick={() => setError("")} aria-label="关闭"><XIcon size={14} /></button>
        </div>
      )}

      {view === "data" && (rows.length === 0 || showSource) && (
        <section className="tabCard">
          <div className="tabCardHead">
            <div>
              <h2>STEP 01 · 粘贴或载入原始载荷表</h2>
              <p>直接从 Excel / WPS 复制粘贴制表符表格，支持多工况标题行、合并坐标表头与中英文列名。</p>
            </div>
            <div className="btnCluster">
              {rows.length > 0 && (
                <button type="button" className="btnSecondary" onClick={() => setShowSource(false)}>← 返回校对表格</button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".tsv,.csv,.txt"
                style={{ display: "none" }}
                onChange={(e) => { void handleLocalFileChange(e.target.files?.[0]); e.target.value = ""; }}
              />
              <button type="button" className="btnSecondary" onClick={() => fileInputRef.current?.click()}>
                <FolderOpenIcon size={14} /> 读取 TSV/CSV/TXT
              </button>
              <button type="button" className="btnSecondary" onClick={() => setSource(SAMPLE)}>
                <ClipboardIcon size={14} /> 载入格式示例
              </button>
            </div>
          </div>

          <div className="tabFormatChips">
            <span className="capChip"><CheckIcon size={11} /> X / Y / Z 坐标</span>
            <span className="capChip"><CheckIcon size={11} /> 中文点位名（归并索引）</span>
            <span className="capChip"><CheckIcon size={11} /> FX / FY / FZ</span>
            <span className="capChip">TX / TY / TZ 可选</span>
          </div>

          <div className="tabPasteBox">
            <div className="tabPasteMeta">
              <span>load_table.tsv</span>
              <div className="tabPasteMetaRight">
                {ignoredSourceLineSet.size > 0 && (
                  <button
                    type="button"
                    className="tabPasteWarnTag"
                    onClick={() => parseWarnings[0] && jumpToWarning(parseWarnings[0])}
                  >
                    {ignoredSourceLineSet.size} 行解析忽略{sourceModifiedSinceParse ? "（原文本已修改）" : ""}
                  </button>
                )}
                <span>{source ? `${sourceLines.length} 行 · ${source.length} 字符` : "等待粘贴表格内容"}</span>
              </div>
            </div>
            {sourceHighlight && (
              <div className="tabSourceLocatorBar" role="status">
                <div className="tabLocatorMain">
                  <span className="tabWarnBadge warning">已定位源文本</span>
                  <span className="tabLocatorMsg">
                    第 {sourceHighlight.activeLine} 行{sourceModifiedSinceParse ? "（原文本已修改，重新解析后刷新）" : ""}
                  </span>
                </div>
                <div className="tabLocatorActions">
                  {(() => {
                    const lines = sourceHighlight.lines;
                    const activeIdx = Math.max(0, lines.findIndex((l) => l.lineNumber === sourceHighlight.activeLine));
                    const windowStart = Math.max(0, Math.min(Math.max(0, lines.length - 6), activeIdx - 2));
                    const windowLines = lines.slice(windowStart, windowStart + 6);
                    const jumpToIndex = (nextIdx: number) => {
                      const warning = parseWarnings.find((w) => warningStableKey(w) === sourceHighlight.warningKey);
                      if (warning) jumpToWarning(warning, (nextIdx + lines.length) % lines.length);
                    };
                    return (
                      <>
                        {lines.length > 1 && (
                          <>
                            <button type="button" className="tabJumpChip dark" onClick={() => jumpToIndex(activeIdx - 1)}>
                              上一处
                            </button>
                            <button type="button" className="tabJumpChip dark" onClick={() => jumpToIndex(activeIdx + 1)}>
                              下一处
                            </button>
                          </>
                        )}
                        {windowLines.map((item) => (
                          <button
                            key={item.lineNumber}
                            type="button"
                            className={"tabJumpChip dark" + (item.lineNumber === sourceHighlight.activeLine ? " active" : "")}
                            title={item.label}
                            onClick={() => {
                              const idx = lines.findIndex((l) => l.lineNumber === item.lineNumber);
                              jumpToIndex(Math.max(0, idx));
                            }}
                          >
                            第 {item.lineNumber} 行
                          </button>
                        ))}
                        {lines.length > 6 && (
                          <span className="tabPasteOverflowNote">
                            {activeIdx + 1} / {lines.length}
                          </span>
                        )}
                      </>
                    );
                  })()}
                  <button type="button" className="iconTrashBtn" title="清除源文本定位" onClick={() => setSourceHighlight(null)}>
                    <XIcon size={13} />
                  </button>
                </div>
              </div>
            )}
            {(() => {
              const total = sourceLines.length;
              const startIdx = Math.max(0, Math.floor((pasteScrollTop - PASTE_PADDING_TOP) / PASTE_LINE_HEIGHT) - 2);
              const visibleCount = Math.max(60, Math.ceil((pasteTextareaRef.current?.clientHeight ?? 360) / PASTE_LINE_HEIGHT) + 6);
              const endIdx = Math.min(total, startIdx + visibleCount);
              const gutterItems = [];
              const backdropItems = [];
              for (let idx = startIdx; idx < endIdx; idx += 1) {
                const lineNo = idx + 1;
                const isActive = sourceHighlight?.activeLine === lineNo;
                const isIgnored = ignoredSourceLineSet.has(lineNo);
                const top = PASTE_PADDING_TOP + idx * PASTE_LINE_HEIGHT - pasteScrollTop;
                gutterItems.push(
                  <div
                    key={lineNo}
                    className={"tabPasteLn" + (isIgnored ? " isIgnored" : "") + (isActive ? " isActive" : "")}
                    style={{ top }}
                  >
                    {lineNo}
                  </div>,
                );
                if (isIgnored || isActive) {
                  backdropItems.push(
                    <div
                      key={lineNo}
                      className={"tabPasteLineMark" + (isActive ? " isActive" : "")}
                      style={{ top, height: PASTE_LINE_HEIGHT }}
                    />,
                  );
                }
              }
              return (
                <div className="tabPasteEditorWrap">
                  <div className="tabPasteGutter" aria-hidden="true">
                    {gutterItems}
                  </div>
                  <div className="tabPasteBackdrop" aria-hidden="true">
                    {backdropItems}
                  </div>
                  <textarea
                ref={pasteTextareaRef}
                wrap="off"
                value={source}
                onScroll={(e) => setPasteScrollTop(e.currentTarget.scrollTop)}
                onChange={(e) => setSource(e.target.value)}
                placeholder={"在此处粘贴 Excel / WPS 载荷表…\n\n每个 case / 工况标题会自动建立对应的 Load Collector 和 Load Step。"}
                spellCheck={false}
                  />
                </div>
              );
            })()}
          </div>

          <div className="tabCardFoot">
            <span className="emptyMuted"><CheckIcon size={13} /> 全部解析与生成仅在本机离线执行。</span>
            <div className="btnCluster">
              {source && (
                <button type="button" className="btnSecondary" onClick={() => setSource("")}>
                  <TrashIcon size={14} /> 清空内容
                </button>
              )}
              <button type="button" className="btnPrimary" disabled={busy || !source.trim()} onClick={() => void parse()}>
                {busy ? <><SpinnerIcon /> 解析中…</> : <>解析表格 <ArrowRightIcon size={15} /></>}
              </button>
            </div>
          </div>
        </section>
      )}

      {view === "data" && rows.length > 0 && !showSource && (
        <section className="tabCard">
          <div className="tabCardHead">
            <div>
              <h2>STEP 01 · 工况命名与载荷表校对</h2>
              <p>所有单元格均可直接编辑；空力矩按 0 处理，可随时调整模型内工况英文名称。</p>
            </div>
            <div className="btnCluster">
              <button type="button" className="btnSecondary" onClick={() => setShowSource(true)}><ClipboardIcon size={14} /> 重新粘贴</button>
              <button type="button" className="btnSecondary" onClick={() => setRulesDrawerOpen(true)}>
                映射规则 ({mappingRules.length}) {mappingIssueList.length > 0 ? `· ${mappingIssueList.length} 提示` : ""}
              </button>
              <button type="button" className="btnSecondary" onClick={addRow}><PlusIcon size={14} /> 添加行</button>
              <button type="button" className="btnPrimary" disabled={busyOrEmpty} onClick={() => void generate("points")}>
                {busy ? <><SpinnerIcon /> 生成中…</> : <>生成节点映射 <ArrowRightIcon size={15} /></>}
              </button>
            </div>
          </div>

          <div className="tabCaseAliasStrip">
            <div className="tabCaseAliasTitle">
              <b>模型内工况名称映射</b>
              <span>支持自动关键词规则 + 手工微调</span>
            </div>
            <div className="tabCaseAliasGrid" ref={aliasGridRef}>
              {caseNames.map((name, index) => {
                const isAliasHighlighted = aliasHighlight?.caseNames.includes(name) ?? false;
                const isAliasPrimary = aliasHighlight?.activeCaseName === name;
                return (
                  <label
                    className={
                      "tabAliasItem" +
                      (isAliasHighlighted ? " isJumpHighlight" : "") +
                      (isAliasPrimary ? " isJumpPrimary" : "")
                    }
                    key={name}
                    data-case-index={index}
                  >
                    <span title={name}>{name}</span>
                    <input
                      value={resolvedCaseAliases[name]}
                      placeholder={suggestCaseAlias(name, index, mappingRules)}
                      spellCheck={false}
                      onChange={(e) => {
                        const value = e.target.value;
                        setCaseAliases((current) => ({ ...current, [name]: value }));
                        markDirty();
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          {aliasConflictsList.length > 0 && (
            <div className="inlineNotice amber">
              <ul className="tabJumpNoticeList">
                {aliasConflictsList.map((item) => (
                  <li key={item.alias} className="tabJumpNoticeItem">
                    <button
                      type="button"
                      className="tabJumpNoticeBtn"
                      onClick={() => jumpToAliasConflict(item)}
                    >
                      <span>{item.message}</span>
                      <span className="tabWarnActionHint">定位 →</span>
                    </button>
                    <span className="tabWarnChips">
                      {item.caseNames.map((caseName) => (
                        <button
                          key={caseName}
                          type="button"
                          className={
                            "tabWarnChip" +
                            (aliasHighlight?.alias === item.alias && aliasHighlight.activeCaseName === caseName ? " active" : "")
                          }
                          onClick={() => jumpToAliasConflict(item, caseName)}
                        >
                          定位 “{caseName}”
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="tabTableBar">
            <div className="tabTableStats">
              <span className="capChip">{rows.length} 条记录</span>
              <span>{caseCount} 个工况 · 预计 {estimatedPoints} 个命名节点</span>
              {allWarnings.length > 0 && (
                <button
                  type="button"
                  className={"tabWarnSummaryChip" + (errorWarningCount > 0 ? " error" : "")}
                  onClick={() => {
                    setWarningsExpanded(true);
                    warningsBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  <WarningIcon size={13} /> {allWarnings.length} 项检查提示 ↓
                </button>
              )}
            </div>
            <label className="hubSearch compact">
              <SearchIcon size={14} />
              <input value={rowQuery} onChange={(e) => setRowQuery(e.target.value)} placeholder="搜索工况 / 点位名称…" spellCheck={false} />
              {rowQuery && <button type="button" className="hubSearchClear" onClick={() => setRowQuery("")} aria-label="清除搜索">×</button>}
            </label>
          </div>

          {dataHighlight && (
            <div className={"tabLocatorBar " + dataHighlight.severity} role="status">
              <div className="tabLocatorMain">
                <span className={"tabWarnBadge " + dataHighlight.severity}>
                  {dataHighlight.severity === "error" ? "错误定位" : "检查定位"}
                </span>
                <span className="tabLocatorMsg">{dataHighlight.message}</span>
              </div>
              <div className="tabLocatorActions">
                {dataHighlight.targets.map((target, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={"tabJumpChip" + (idx === dataHighlight.activeTargetIndex ? " active" : "")}
                    onClick={() => {
                      const matched = rowWarnings.find((w) => warningStableKey(w) === dataHighlight.warningKey);
                      if (matched) {
                        jumpToWarning(matched, idx);
                      } else {
                        jumpToRowTarget(target, dataHighlight.message);
                      }
                    }}
                  >
                    {target.label ?? `第 ${(target.rowIndex ?? 0) + 1} 条`}
                  </button>
                ))}
                <button type="button" className="iconTrashBtn" title="清除定位高亮" onClick={() => setDataHighlight(null)}>
                  <XIcon size={13} />
                </button>
              </div>
            </div>
          )}

          <div className="tabDataTableWrap" ref={dataTableWrapRef}>
            <table className="tabDataTable">
              <thead>
                <tr>
                  <th className="colNum">#</th>
                  {TABLE_HEADERS.map((header) => <th key={header}>{header}</th>)}
                  <th className="colOp" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr><td colSpan={TABLE_HEADERS.length + 2} className="emptyMuted" style={{ padding: 28, textAlign: "center" }}>没有匹配的载荷记录</td></tr>
                )}
                {filteredRows.map(({ row, index }) => {
                  const rowMatchingTargets = dataHighlight?.targets.filter((t) => t.rowIndex === index) ?? [];
                  const isRowHighlighted = rowMatchingTargets.length > 0;
                  const focusedTarget = dataHighlight?.targets[dataHighlight.activeTargetIndex];
                  const isRowPrimary = focusedTarget?.rowIndex === index;
                  const highlightedFields = new Set(rowMatchingTargets.flatMap((t) => t.fields ?? []));
                  const rowIssues = rowWarningsByIndex.get(index) ?? [];
                  const rowHasError = rowIssues.some((w) => w.severity === "error");
                  const cellHighlightClass = (field: string) =>
                    highlightedFields.has(field)
                      ? "cellJumpHighlight" + (isRowPrimary ? " isPrimary" : "") + (dataHighlight?.severity === "error" ? " isError" : "")
                      : "";

                  return (
                    <tr
                      key={index + "-" + row.sourceLine}
                      data-row-index={index}
                      className={
                        (isRowHighlighted ? "rowJumpHighlight " : "") +
                        (isRowPrimary ? "rowJumpPrimary " : "") +
                        (isRowPrimary && dataHighlight?.severity === "error" ? "isError" : "")
                      }
                    >
                      <td
                        className={"colNum" + (rowIssues.length > 0 ? (rowHasError ? " hasRowError" : " hasRowWarn") : "")}
                        title={rowIssues.map((w) => w.message).join("\n")}
                      >
                        {index + 1}
                      </td>
                      <td className={cellHighlightClass("caseName")}>
                        <input
                          className="cellInput"
                          data-cell-field="caseName"
                          value={row.caseName}
                          onChange={(e) => updateRow(index, "caseName", e.target.value)}
                        />
                      </td>
                      <td className={cellHighlightClass("displayName")}>
                        <input
                          className="cellInput"
                          data-cell-field="displayName"
                          value={row.displayName}
                          onChange={(e) => updateRow(index, "displayName", e.target.value)}
                        />
                      </td>
                      <td className={cellHighlightClass("pointName")}>
                        <input
                          className="cellInput mono"
                          data-cell-field="pointName"
                          value={row.pointName}
                          onChange={(e) => updateRow(index, "pointName", e.target.value)}
                        />
                      </td>
                      {NUMERIC_KEYS.map((key) => (
                        <td key={key} className={cellHighlightClass(key)}>
                          <NumericInput
                            value={row[key]}
                            onCommit={(value) => updateRowNumber(index, key, value)}
                            className="cellNumInput"
                            dataCellField={key}
                          />
                        </td>
                      ))}
                      <td className="colOp">
                        <button type="button" className="iconTrashBtn" title="删除行" onClick={() => removeRow(index)}><TrashIcon size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === "points" && result && (
        <section className="tabCard">
          <div className="tabCardHead">
            <div>
              <h2>STEP 02 · 点位与节点编号清单</h2>
              <p>{rows.length} 条记录按中文点位名归并为 {result.points.length} 个独立节点；FEM 仅引用节点号（不含 GRID 卡）。</p>
            </div>
            <div className="btnCluster">
              <div className="segControl">
                <button type="button" className={"segBtn" + (pointLayout === "table" ? " active" : "")} onClick={() => setPointLayout("table")}>列表视图</button>
                <button type="button" className={"segBtn" + (pointLayout === "cards" ? " active" : "")} onClick={() => setPointLayout("cards")}>卡片视图</button>
              </div>
              <button
                type="button"
                className="btnSecondary"
                onClick={() => void copyContent(result.points.map((point) => [point.nodeId, point.name, point.englishName, point.x, point.y, point.z].join("\t")).join("\n"), "节点清单")}
              >
                <CopyIcon size={14} /> 复制 TSV
              </button>
              <button type="button" className="btnPrimary" onClick={() => setView("export")}>
                前往导出 <ArrowRightIcon size={15} />
              </button>
            </div>
          </div>

          <div className="tabTableBar">
            <span className="capChip">{result.points.length} 个归并节点</span>
            <label className="hubSearch compact">
              <SearchIcon size={14} />
              <input value={pointQuery} onChange={(e) => setPointQuery(e.target.value)} placeholder="搜索节点号 / 中英文名称…" spellCheck={false} />
              {pointQuery && <button type="button" className="hubSearchClear" onClick={() => setPointQuery("")} aria-label="清除搜索">×</button>}
            </label>
          </div>

          {pointLayout === "table" ? (
            <div className="tabDataTableWrap">
              <table className="tabDataTable">
                <thead>
                  <tr>
                    <th className="colNum">Node ID</th>
                    <th>中文点位名</th>
                    <th>英文点位名 (JSON 键)</th>
                    <th>坐标 X</th>
                    <th>坐标 Y</th>
                    <th>坐标 Z</th>
                    <th>Label</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPoints.map((p) => (
                    <tr key={p.nodeId}>
                      <td className="colNum boldId">{p.nodeId}</td>
                      <td>{p.name}</td>
                      <td className="mono">{p.englishName}</td>
                      <td className="mono numCell">{p.x}</td>
                      <td className="mono numCell">{p.y}</td>
                      <td className="mono numCell">{p.z}</td>
                      <td className="mono muted">{p.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="tabPointGrid">
              {filteredPoints.map((point) => (
                <article className="tabPointCard" key={point.nodeId}>
                  <div className="tabPointHead">
                    <strong>{point.name}</strong>
                    <span className="nodeTag">NODE {point.nodeId}</span>
                  </div>
                  <code className="tabPointCoords">{point.x}, {point.y}, {point.z}</code>
                  <div className="tabPointTags">
                    <span className="capChip">EN: {point.englishName}</span>
                    <span className="capChip">{point.text}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {view === "export" && (
        <section className="tabCard">
          <div className="tabCardHead">
            <div>
              <h2>STEP 03 · 增量 FEM 与点位 JSON 导出</h2>
              <p>先按 JSON 在 HyperMesh 中创建节点，再将增量 FEM 导入模型。</p>
            </div>
            <div className="btnCluster">
              <button type="button" className="btnPrimary" disabled={busyOrEmpty} onClick={() => void exportFiles()}>
                {busy ? <><SpinnerIcon /> 导出中…</> : <><DownloadIcon size={15} /> 一键导出双文件 (.fem + .json)</>}
              </button>
            </div>
          </div>

          {result ? (
            <div className="tabExportGrid">
              <div className="tabExportCol">
                <div className="tabFileHeader">
                  <div>
                    <span className="fileExtBadge fem">FEM</span>
                    <b>{exportPrefix.trim() || DEFAULT_EXPORT_PREFIX}.fem</b>
                    <small>{result.cases.length} Load Steps · 不含 GRID</small>
                  </div>
                  <div className="btnCluster">
                    <button type="button" className="btnMini" onClick={() => void copyContent(result.fem, "FEM")}><CopyIcon size={13} /> 复制</button>
                    <button type="button" className="btnMini" onClick={() => void saveSingleFile("fem")}><SaveIcon size={13} /> 另存为</button>
                  </div>
                </div>

                <div className="kpiStrip4" style={{ marginTop: 12 }}>
                  <div><span>FORCE</span><b>{femStats.force}</b></div>
                  <div><span>MOMENT</span><b>{femStats.moment}</b></div>
                  <div><span>行数</span><b>{femStats.lines}</b></div>
                  <div><span>体积</span><b>{femStats.kilobytes} KB</b></div>
                </div>

                <div className="tabCaseMappingBox">
                  <h4>模型内工况映射（LC / LS）</h4>
                  <div className="tabCaseMapList">
                    {result.cases.map((item) => (
                      <div className="tabCaseMapRow" key={item.loadId + "-" + item.femName}>
                        <span>{item.name}</span>
                        <code>{item.collectorName} / {item.loadStepName}</code>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="tabFemPreviewToggle">
                  <button type="button" className="btnMini" onClick={() => setShowFemText((v) => !v)}>
                    {showFemText ? "隐藏 FEM 文本预览" : "展开 FEM 文本预览"}
                  </button>
                  {showFemText && (
                    <pre className="tabCodeBlock">{result.fem}</pre>
                  )}
                </div>
              </div>

              <div className="tabExportCol">
                <div className="tabFileHeader">
                  <div>
                    <span className="fileExtBadge json">JSON</span>
                    <b>{exportPrefix.trim() || DEFAULT_EXPORT_PREFIX}_points.json</b>
                    <small>{jsonEntries.length} 个点位 · 可直接微调键与标签</small>
                  </div>
                  <div className="btnCluster">
                    <button type="button" className="btnMini" onClick={() => void copyContent(result.json, "JSON")}><CopyIcon size={13} /> 复制</button>
                    <button type="button" className="btnMini" onClick={() => void saveSingleFile("json")}><SaveIcon size={13} /> 另存为</button>
                  </div>
                </div>

                {duplicateKeys.length > 0 && (
                  <div className="inlineNotice amber" style={{ marginTop: 10 }}>
                    <ul className="tabJumpNoticeList">
                      {duplicateKeys.map((key) => {
                        const dupIndices = jsonEntries.reduce<number[]>((acc, entry, idx) => (entry.key === key ? [...acc, idx] : acc), []);
                        return (
                          <li key={key} className="tabJumpNoticeItem">
                            <button
                              type="button"
                              className="tabJumpNoticeBtn"
                              onClick={() => jumpToDuplicateJsonKey(key)}
                            >
                              <span>英文点位名“{key}”重复：JSON 键将互相覆盖，请修改其中一项。</span>
                              <span className="tabWarnActionHint">定位 →</span>
                            </button>
                            <span className="tabWarnChips">
                              {dupIndices.map((idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  className={
                                    "tabWarnChip" +
                                    (jsonHighlight?.key === key && jsonHighlight.activeIndex === idx ? " active" : "")
                                  }
                                  onClick={() => jumpToDuplicateJsonKey(key, idx)}
                                >
                                  第 {idx + 1} 项 (Node {jsonEntries[idx]?.nodeId})
                                </button>
                              ))}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <div className="tabJsonTableWrap" ref={jsonTableWrapRef}>
                  <table className="tabDataTable">
                    <thead>
                      <tr>
                        <th className="colNum">#</th>
                        <th className="colNum">Node</th>
                        <th>中文名</th>
                        <th>英文键 (JSON Key)</th>
                        <th>label</th>
                        <th>X</th>
                        <th>Y</th>
                        <th>Z</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jsonEntries.map((entry, index) => {
                        const isDup = duplicateKeys.includes(entry.key);
                        const isJsonHighlighted = jsonHighlight?.indices.includes(index) ?? false;
                        const isJsonPrimary = jsonHighlight?.activeIndex === index;
                        return (
                          <tr
                            key={buildSeq + "-" + index}
                            data-json-index={index}
                            className={
                              (isDup ? "rowWarn " : "") +
                              (isJsonHighlighted ? "rowJumpHighlight " : "") +
                              (isJsonPrimary ? "rowJumpPrimary" : "")
                            }
                          >
                            <td className="colNum">{index + 1}</td>
                            <td className="colNum boldId">{entry.nodeId}</td>
                            <td className="muted" title={pointNameByNode.get(entry.nodeId) ?? ""}>{pointNameByNode.get(entry.nodeId) ?? "—"}</td>
                            <td className={isJsonHighlighted ? "cellJumpHighlight" + (isJsonPrimary ? " isPrimary" : "") : ""}>
                              <input
                                className="cellInput mono"
                                data-json-field="key"
                                value={entry.key}
                                spellCheck={false}
                                onChange={(e) => patchJsonEntry(index, { key: e.target.value })}
                              />
                            </td>
                            <td><input className="cellInput mono" value={entry.label} spellCheck={false} onChange={(e) => patchJsonEntry(index, { label: e.target.value })} /></td>
                            {(["x", "y", "z"] as const).map((axis) => (
                              <td key={axis}>
                                <NumericInput value={entry[axis]} onCommit={(value) => commitJsonCoordinate(index, axis, value)} className="cellNumInput" />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <details className="tabRawJsonDetails">
                  <summary>查看完整 JSON 文本（只读）</summary>
                  <pre className="tabCodeBlock">{result.json}</pre>
                </details>
              </div>
            </div>
          ) : (
            <div className="inspectorEmpty" style={{ padding: 48 }}>
              <DownloadIcon size={28} />
              <h4>尚未生成输出文件</h4>
              <p>先完成表格数据校对，然后生成增量 FEM 与点位 JSON。</p>
              <button type="button" className="btnPrimary" disabled={busyOrEmpty} onClick={() => void generate("export")}>
                {busy ? <><SpinnerIcon /> 生成中…</> : "立即生成"}
              </button>
            </div>
          )}
        </section>
      )}

      {allWarnings.length > 0 && (
        <section className={"tabWarningsBox" + (errorWarningCount > 0 ? " hasError" : "")} ref={warningsBoxRef}>
          <button type="button" className="tabWarningsHead" onClick={() => setWarningsExpanded((v) => !v)}>
            <span>
              <WarningIcon size={15} /> 解析与坐标检查提示 · <b>{allWarnings.length}</b> 项
              <small className="tabWarningsHintNote">点击任意提示可跳转并高亮定位</small>
            </span>
            <span>{warningsExpanded ? "收起" : "展开"}</span>
          </button>
          {warningsExpanded && (
            <ul className="tabWarningsList">
              {allWarnings.map((w, i) => {
                const wKey = warningStableKey(w);
                const isActive = dataHighlight?.warningKey === wKey || sourceHighlight?.warningKey === wKey;
                const hasTargets = w.targets.length > 0;
                const isSourceWarning = w.targets[0]?.kind === "sourceLine";
                const chipsExpanded = Boolean(expandedChipKeys[wKey]);
                const visibleTargets =
                  isSourceWarning && !chipsExpanded && w.targets.length > SOURCE_CHIP_COLLAPSE_LIMIT
                    ? w.targets.slice(0, SOURCE_CHIP_COLLAPSE_LIMIT)
                    : w.targets;

                return (
                  <li
                    key={wKey + "-" + i}
                    className={
                      "tabWarningItem " +
                      w.severity +
                      (isActive ? " isActive" : "") +
                      (hasTargets ? " isClickable" : "")
                    }
                  >
                    <button
                      type="button"
                      className="tabWarningMainBtn"
                      disabled={!hasTargets}
                      onClick={() => jumpToWarning(w)}
                    >
                      <span className={"tabWarnBadge " + w.severity}>{w.category}</span>
                      <span className="tabWarningText">{w.message}</span>
                      {hasTargets && <span className="tabWarnActionHint">跳转定位 →</span>}
                    </button>
                    {visibleTargets.length > 0 && (
                      <div className="tabWarnChips">
                        {visibleTargets.map((target, tIdx) => {
                          const isChipActive =
                            (target.kind === "dataCell" &&
                              dataHighlight?.warningKey === wKey &&
                              dataHighlight.activeTargetIndex === tIdx) ||
                            (target.kind === "sourceLine" &&
                              sourceHighlight?.warningKey === wKey &&
                              sourceHighlight.activeLine === target.sourceLine);
                          return (
                            <button
                              key={tIdx}
                              type="button"
                              className={"tabWarnChip" + (isChipActive ? " active" : "") + (w.severity === "error" ? " error" : "")}
                              onClick={() => jumpToWarning(w, tIdx)}
                            >
                              {target.label ?? (target.sourceLine !== undefined ? `第 ${target.sourceLine} 行` : `第 ${(target.rowIndex ?? 0) + 1} 条`)}
                            </button>
                          );
                        })}
                        {isSourceWarning && w.targets.length > SOURCE_CHIP_COLLAPSE_LIMIT && (
                          <button
                            type="button"
                            className="tabWarnChip subtle"
                            onClick={() =>
                              setExpandedChipKeys((prev) => ({ ...prev, [wKey]: !chipsExpanded }))
                            }
                          >
                            {chipsExpanded ? "收起行号" : `展开全部 ${w.targets.length} 行`}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {rulesDrawerOpen && (
        <div className="drawerBackdrop" onClick={() => { setRulesDrawerOpen(false); setRuleHighlight(null); }} role="dialog" aria-modal="true" aria-label="工况关键词映射规则">
          <div className="drawerPanel" onClick={(e) => e.stopPropagation()}>
            <div className="drawerHead">
              <div>
                <h3>工况关键词映射规则</h3>
                <p>必含词用 “+” 连接，备选词组用 “|” 连接；英文名支持 <code>{"{g}"}</code> 自动提取载荷系数。</p>
              </div>
              <button type="button" className="iconTrashBtn" onClick={() => { setRulesDrawerOpen(false); setRuleHighlight(null); }} aria-label="关闭"><XIcon size={16} /></button>
            </div>

            <div className="drawerToolbar">
              <button
                type="button"
                className="btnSecondary"
                onClick={() => { setMappingRules(DEFAULT_MAPPING_RULES.map((rule) => ({ ...rule }))); markDirty(); }}
              >
                <ResetIcon size={13} /> 恢复默认规则
              </button>
              <button
                type="button"
                className="btnPrimary"
                onClick={() => setMappingRules((current) => [...current, { id: "rule-" + Date.now(), keywords: "", englishName: "" }])}
              >
                <PlusIcon size={13} /> 新增规则
              </button>
            </div>

            {mappingIssueList.length > 0 && (
              <div className="inlineNotice amber" style={{ margin: "0 18px 10px" }}>
                <ul className="tabJumpNoticeList">
                  {mappingIssueList.map((issue) => (
                    <li key={issue.id} className="tabJumpNoticeItem">
                      <button
                        type="button"
                        className="tabJumpNoticeBtn"
                        onClick={() => jumpToMappingIssue(issue)}
                      >
                        <span>{issue.message}</span>
                        <span className="tabWarnActionHint">定位 →</span>
                      </button>
                      <span className="tabWarnChips">
                        {issue.targets.map((target, tIdx) => (
                          <button
                            key={tIdx}
                            type="button"
                            className={
                              "tabWarnChip" +
                              (ruleHighlight?.issueId === issue.id && ruleHighlight.activeTargetIndex === tIdx ? " active" : "")
                            }
                            onClick={() => jumpToMappingIssue(issue, tIdx)}
                          >
                            {target.label}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="drawerBody" ref={drawerBodyRef}>
              <table className="compactTable">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>#</th>
                    <th>必含关键词</th>
                    <th>英文名称 / 模板</th>
                    <th style={{ width: 36 }} />
                  </tr>
                </thead>
                <tbody>
                  {mappingRules.map((rule, index) => {
                    const matchingRuleTargets = ruleHighlight?.targets.filter((t) => t.ruleIndex === index) ?? [];
                    const isRuleHighlighted = matchingRuleTargets.length > 0;
                    const activeRuleTarget = ruleHighlight?.targets[ruleHighlight.activeTargetIndex];
                    const isRulePrimary = activeRuleTarget?.ruleIndex === index;
                    const kwHighlighted = matchingRuleTargets.some((t) => t.field === "keywords");
                    const enHighlighted = matchingRuleTargets.some((t) => t.field === "englishName");
                    return (
                      <tr
                        key={rule.id}
                        data-rule-index={index}
                        className={
                          (isRuleHighlighted ? "rowJumpHighlight " : "") +
                          (isRulePrimary ? "rowJumpPrimary" : "")
                        }
                      >
                        <td className="rowNum">{index + 1}</td>
                        <td className={kwHighlighted ? "cellJumpHighlight" + (isRulePrimary ? " isPrimary" : "") : ""}>
                          <input
                            className="wbInput mono"
                            data-rule-field="keywords"
                            value={rule.keywords}
                            placeholder="例如：转弯 + 左转"
                            spellCheck={false}
                            onChange={(e) => {
                              const keywords = e.target.value;
                              setMappingRules((current) => current.map((item) => (item.id === rule.id ? { ...item, keywords } : item)));
                              markDirty();
                            }}
                          />
                        </td>
                        <td className={enHighlighted ? "cellJumpHighlight" + (isRulePrimary ? " isPrimary" : "") : ""}>
                          <input
                            className="wbInput mono"
                            data-rule-field="englishName"
                            value={rule.englishName}
                            placeholder="例如：Left_Turn"
                            spellCheck={false}
                            onChange={(e) => {
                              const englishName = e.target.value;
                              setMappingRules((current) => current.map((item) => (item.id === rule.id ? { ...item, englishName } : item)));
                              markDirty();
                            }}
                          />
                        </td>
                        <td className="rowOp">
                          <button
                            type="button"
                            className="iconTrashBtn"
                            onClick={() => { setMappingRules((current) => current.filter((item) => item.id !== rule.id)); markDirty(); }}
                          >
                            <TrashIcon size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!onToast && toasts.length > 0 && (
        <div className="toastStack" aria-live="polite">
          {toasts.map((item) => (
            <div key={item.id} className={"toastItem " + item.tone}>
              <span className="toastMsg">{item.text}</span>
              <button type="button" className="iconTrashBtn" onClick={() => setToasts((list) => list.filter((t) => t.id !== item.id))} aria-label="关闭"><XIcon size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
