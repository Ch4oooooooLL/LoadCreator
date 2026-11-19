import { DEFAULT_MAPPING_RULES, type MappingRule } from "@/lib/caseMapping";
import { registerTemplateModule } from "@/lib/templateRegistry";
import type { LoadRow } from "@/types/loadDeck";

export type TabularView = "data" | "points" | "export";
export type TabularPointLayout = "table" | "cards";

export const TABULAR_STORAGE_KEY = "loaddeck.workspace.v1";
export const TABULAR_MAPPING_STORAGE_KEY = "loaddeck.case-mappings.v1";
export const TABULAR_DEFAULT_EXPORT_PREFIX = "LoadCreator_LoadDeck";

export interface TabularWorkspaceSnapshot {
  exportPrefix: string;
  source: string;
  rows: LoadRow[];
  caseAliases: Record<string, string>;
  mappingRules: MappingRule[];
  view: TabularView;
  showSource: boolean;
  pointLayout: TabularPointLayout;
  showFemText: boolean;
  [key: string]: unknown;
}

type TemplateApplyListener = (snapshot: TabularWorkspaceSnapshot) => void;
const listeners = new Set<TemplateApplyListener>();
let liveSnapshot: TabularWorkspaceSnapshot | null = null;

export function defaultMappingRulesCopy(): MappingRule[] {
  return DEFAULT_MAPPING_RULES.map((rule) => ({ ...rule }));
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRows(raw: unknown): LoadRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      sourceLine: Math.max(0, Math.trunc(asNumber(item.sourceLine, 0))),
      caseName: String(item.caseName ?? ""),
      groupName: String(item.groupName ?? ""),
      pointName: String(item.pointName ?? ""),
      displayName: String(item.displayName ?? ""),
      x: asNumber(item.x, 0),
      y: asNumber(item.y, 0),
      z: asNumber(item.z, 0),
      time: item.time === null || item.time === undefined || item.time === "" ? null : asNumber(item.time, 0),
      fx: asNumber(item.fx, 0),
      fy: asNumber(item.fy, 0),
      fz: asNumber(item.fz, 0),
      tx: asNumber(item.tx, 0),
      ty: asNumber(item.ty, 0),
      tz: asNumber(item.tz, 0),
    }));
}

function normalizeAliases(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === "string") out[key] = val;
    else if (val !== undefined && val !== null) out[key] = String(val);
  }
  return out;
}

function normalizeMappingRules(raw: unknown): MappingRule[] {
  if (!Array.isArray(raw)) return defaultMappingRulesCopy();
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item, idx) => ({
      id: typeof item.id === "string" && item.id.trim() ? item.id : `rule-imported-${idx + 1}`,
      keywords: String(item.keywords ?? ""),
      englishName: String(item.englishName ?? ""),
    }));
}

export function createDefaultTabularSnapshot(): TabularWorkspaceSnapshot {
  return {
    exportPrefix: TABULAR_DEFAULT_EXPORT_PREFIX,
    source: "",
    rows: [],
    caseAliases: {},
    mappingRules: defaultMappingRulesCopy(),
    view: "data",
    showSource: true,
    pointLayout: "table",
    showFemText: false,
  };
}

export function normalizeTabularSnapshot(
  rawWorkspace: unknown,
  rawRules?: unknown,
): TabularWorkspaceSnapshot {
  const defaults = createDefaultTabularSnapshot();
  const obj =
    rawWorkspace && typeof rawWorkspace === "object" && !Array.isArray(rawWorkspace)
      ? (rawWorkspace as Record<string, unknown>)
      : {};

  const prefixCandidate =
    typeof obj.exportPrefix === "string"
      ? obj.exportPrefix
      : typeof obj.projectName === "string"
        ? obj.projectName
        : "";

  const rows = normalizeRows(obj.rows);
  const rawView = obj.view;
  const view: TabularView =
    rows.length === 0
      ? "data"
      : rawView === "points" || rawView === "export" || rawView === "data"
        ? rawView
        : "data";

  const showSource =
    typeof obj.showSource === "boolean"
      ? rows.length === 0
        ? true
        : obj.showSource
      : rows.length === 0;

  const pointLayout: TabularPointLayout = obj.pointLayout === "cards" ? "cards" : "table";
  const showFemText = Boolean(obj.showFemText);
  const rulesSource = rawRules !== undefined ? rawRules : obj.mappingRules;

  return {
    exportPrefix: prefixCandidate.trim() ? prefixCandidate : defaults.exportPrefix,
    source: typeof obj.source === "string" ? obj.source : defaults.source,
    rows,
    caseAliases: normalizeAliases(obj.caseAliases),
    mappingRules: normalizeMappingRules(rulesSource),
    view,
    showSource,
    pointLayout,
    showFemText,
  };
}

export function readTabularWorkspaceSnapshot(): TabularWorkspaceSnapshot {
  if (liveSnapshot) {
    return JSON.parse(JSON.stringify(liveSnapshot)) as TabularWorkspaceSnapshot;
  }
  let workspaceRaw: unknown = null;
  let rulesRaw: unknown = undefined;
  try {
    const stored = localStorage.getItem(TABULAR_STORAGE_KEY);
    if (stored) workspaceRaw = JSON.parse(stored);
  } catch {
    localStorage.removeItem(TABULAR_STORAGE_KEY);
  }
  try {
    const storedRules = localStorage.getItem(TABULAR_MAPPING_STORAGE_KEY);
    if (storedRules) rulesRaw = JSON.parse(storedRules);
  } catch {
    localStorage.removeItem(TABULAR_MAPPING_STORAGE_KEY);
  }
  const normalized = normalizeTabularSnapshot(workspaceRaw, rulesRaw);
  liveSnapshot = normalized;
  return JSON.parse(JSON.stringify(normalized)) as TabularWorkspaceSnapshot;
}

export function setLiveTabularSnapshot(snapshot: TabularWorkspaceSnapshot): void {
  liveSnapshot = snapshot;
}

export function clearLiveTabularSnapshot(): void {
  liveSnapshot = createDefaultTabularSnapshot();
}

export function persistTabularWorkspaceSnapshot(snapshot: TabularWorkspaceSnapshot): void {
  liveSnapshot = snapshot;
  try {
    localStorage.setItem(
      TABULAR_STORAGE_KEY,
      JSON.stringify({
        exportPrefix: snapshot.exportPrefix,
        source: snapshot.source,
        rows: snapshot.rows,
        caseAliases: snapshot.caseAliases,
        view: snapshot.view,
        showSource: snapshot.showSource,
        pointLayout: snapshot.pointLayout,
        showFemText: snapshot.showFemText,
      }),
    );
    localStorage.setItem(TABULAR_MAPPING_STORAGE_KEY, JSON.stringify(snapshot.mappingRules));
  } catch {
    // Ignore storage quota issues.
  }
}

export function applyTabularTemplateSnapshot(incoming: unknown): TabularWorkspaceSnapshot {
  const normalized = normalizeTabularSnapshot(incoming);
  persistTabularWorkspaceSnapshot(normalized);
  for (const listener of listeners) {
    listener(normalized);
  }
  return normalized;
}

export function subscribeTabularTemplateApply(listener: TemplateApplyListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

registerTemplateModule({
  moduleId: "tabular-load",
  readState: () => readTabularWorkspaceSnapshot(),
  writeState: (state) => {
    applyTabularTemplateSnapshot(state);
  },
});
