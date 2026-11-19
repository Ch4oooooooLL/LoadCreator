import { INITIAL_DRAFTS, buildParameters, mergeDraftValues, parseDofs, type Draft } from "@/lib/caseDrafts";
import {
  TABULAR_MAPPING_STORAGE_KEY,
  TABULAR_STORAGE_KEY,
  normalizeTabularSnapshot,
  type TabularWorkspaceSnapshot,
} from "@/lib/tabularWorkspaceStore";
import type { LoadRow } from "@/types/loadDeck";

export type MultiCaseKind =
  | "constraint"
  | "nodal-static"
  | "gravity"
  | "normal-modes"
  | "frequency-response"
  | "random-psd"
  | "tabular-load";

export type EntityLink =
  | { kind: "none" }
  | { kind: "external"; id: number }
  | { kind: "case"; caseId: string };

export interface MultiCaseItem {
  caseId: string;
  enabled: boolean;
  kind: MultiCaseKind;
  spcSource?: EntityLink;
  loadSource?: EntityLink;
  draft: Draft;
}

export interface MultiCaseProject {
  projectName: string;
  solver: "optistruct";
  modelUnits: "N-mm-s" | "N-m-s";
  solverVersion: "2022";
  cases: MultiCaseItem[];
}

export interface MultiCaseKindMeta {
  kind: MultiCaseKind;
  title: string;
  badge: string;
  hint: string;
  needsSpc: "none" | "optional" | "required";
  supportsLoadLink?: boolean;
}

export const MULTI_CASE_KINDS: MultiCaseKindMeta[] = [
  {
    kind: "constraint",
    title: "位移约束 (SPC / SPC1 / SPCADD)",
    badge: "SPC",
    hint: "定义模型边界条件，可被工程内静力/模态/频响/随机振动工况直接引用",
    needsSpc: "none",
  },
  {
    kind: "nodal-static",
    title: "节点力 / 力矩 (FORCE / MOMENT)",
    badge: "STATICS",
    hint: "指定节点集中力与力矩，支持合并或逐行独立子工况",
    needsSpc: "optional",
  },
  {
    kind: "gravity",
    title: "重力载荷 (GRAV)",
    badge: "STATICS",
    hint: "单表配置多组重力方向与加速度（自动随工程单位制校核）",
    needsSpc: "optional",
  },
  {
    kind: "normal-modes",
    title: "模态分析 (EIGRL · SOL 103)",
    badge: "MODAL",
    hint: "提取固有频率与振型（支持约束模态或自由模态）",
    needsSpc: "optional",
  },
  {
    kind: "frequency-response",
    title: "频率响应 (MFREQ · SOL 108)",
    badge: "MFREQ",
    hint: "模态法频响扫频，支持绑定工程内约束与静力载荷集",
    needsSpc: "required",
    supportsLoadLink: true,
  },
  {
    kind: "random-psd",
    title: "PSD 随机振动 (MFREQ + RANDOM)",
    badge: "RANDOM",
    hint: "TABRND1 → RANDPS → MFREQ + RANDOM 全链路（支持 EIGRA / 顺序三轴）",
    needsSpc: "required",
  },
  {
    kind: "tabular-load",
    title: "整车工况表 (Excel / 点位归并)",
    badge: "TABULAR",
    hint: "导入或粘贴整车多点多工况载荷表，统一合并入同一 FEM 与 _points.json",
    needsSpc: "optional",
  },
];

export const MULTI_CASE_STORAGE_KEY = "loadcreator.multicase.v1";

export function multiCaseKindMeta(kind: MultiCaseKind): MultiCaseKindMeta {
  return MULTI_CASE_KINDS.find((k) => k.kind === kind) ?? MULTI_CASE_KINDS[0];
}

export function isOptiStructMultiKind(id: string): id is MultiCaseKind {
  return MULTI_CASE_KINDS.some((k) => k.kind === id);
}

export function getCaseDisplayName(item: MultiCaseItem): string {
  if (item.kind === "tabular-load") {
    return String(item.draft.projectName || "Tabular_Vehicle_Loads").trim() || "Tabular_Vehicle_Loads";
  }
  return String(item.draft.name || item.kind).trim() || item.kind;
}

function makeUniqueCaseId(existing: MultiCaseItem[]): string {
  const used = new Set(existing.map((c) => c.caseId));
  let idx = existing.length + 1;
  while (used.has(`case-${idx}`)) idx += 1;
  return `case-${idx}`;
}

function makeUniqueDraftName(baseName: string, existing: MultiCaseItem[]): string {
  const used = new Set(existing.map((c) => getCaseDisplayName(c)));
  if (!used.has(baseName)) return baseName;
  let idx = 2;
  while (used.has(`${baseName}_${idx}`)) idx += 1;
  return `${baseName}_${idx}`;
}

export function createTabularDraftFromRows(
  rows: LoadRow[] = [],
  caseAliases: Record<string, string> = {},
  source = "",
  projectName = "Vehicle_Tabular",
): Draft {
  return {
    projectName,
    source,
    rows: JSON.parse(JSON.stringify(rows)) as LoadRow[],
    caseAliases: { ...caseAliases },
    coordinateTolerance: 1e-6,
  };
}

export function readTabularWorkspaceFromStorage(): TabularWorkspaceSnapshot | null {
  try {
    const raw = localStorage.getItem(TABULAR_STORAGE_KEY);
    if (!raw) return null;
    const rawRules = localStorage.getItem(TABULAR_MAPPING_STORAGE_KEY);
    return normalizeTabularSnapshot(JSON.parse(raw), rawRules ? JSON.parse(rawRules) : undefined);
  } catch {
    return null;
  }
}

export function syncDraftUnits(kind: MultiCaseKind, draft: Draft, modelUnits: "N-mm-s" | "N-m-s"): Draft {
  if (kind === "tabular-load") return draft;
  const next: Draft = { ...draft, modelUnits };
  if (kind === "gravity" && Array.isArray(draft.cases)) {
    const oldUnits = String(draft.modelUnits || "N-mm-s");
    if (oldUnits !== modelUnits) {
      const prev1g = oldUnits === "N-m-s" ? "9.80665" : "9806.65";
      const next1g = modelUnits === "N-m-s" ? "9.80665" : "9806.65";
      next.cases = (draft.cases as Draft[]).map((row) =>
        String(row.acceleration ?? "").trim() === prev1g ? { ...row, acceleration: next1g } : row,
      );
    }
  }
  return next;
}

export function createMultiCaseItem(
  kind: MultiCaseKind,
  modelUnits: "N-mm-s" | "N-m-s",
  existing: MultiCaseItem[],
  overrideDraft?: Draft,
): MultiCaseItem {
  const caseId = makeUniqueCaseId(existing);
  const firstConstraint = existing.find((c) => c.enabled && c.kind === "constraint");
  const meta = multiCaseKindMeta(kind);

  let draft: Draft;
  if (kind === "tabular-load") {
    const base = createTabularDraftFromRows();
    draft = overrideDraft ? { ...base, ...JSON.parse(JSON.stringify(overrideDraft)) } : base;
    draft.projectName = makeUniqueDraftName(String(draft.projectName || "Vehicle_Tabular"), existing);
  } else {
    const defaults = INITIAL_DRAFTS[kind] ?? { name: kind, modelUnits };
    draft = overrideDraft
      ? mergeDraftValues(defaults, JSON.parse(JSON.stringify(overrideDraft)))
      : (JSON.parse(JSON.stringify(defaults)) as Draft);
    draft = syncDraftUnits(kind, draft, modelUnits);
    draft.name = makeUniqueDraftName(String(draft.name || kind), existing);
  }

  let spcSource: EntityLink | undefined;
  if (meta.needsSpc !== "none") {
    if (firstConstraint) {
      spcSource = { kind: "case", caseId: firstConstraint.caseId };
    } else {
      const rawSpc = parseInt(String(draft.existingSpcSetId ?? ""), 10);
      if (Number.isFinite(rawSpc) && rawSpc > 0) {
        spcSource = { kind: "external", id: rawSpc };
      } else {
        spcSource = meta.needsSpc === "required" ? { kind: "external", id: 900001 } : { kind: "none" };
      }
    }
  }

  let loadSource: EntityLink | undefined;
  if (meta.supportsLoadLink) {
    const rawLoad = parseInt(String(draft.loadId ?? ""), 10);
    loadSource = Number.isFinite(rawLoad) && rawLoad > 0 ? { kind: "external", id: rawLoad } : { kind: "none" };
  }

  return {
    caseId,
    enabled: true,
    kind,
    spcSource,
    loadSource,
    draft,
  };
}

export function createDefaultMultiCaseProject(): MultiCaseProject {
  const spcDraft = JSON.parse(JSON.stringify(INITIAL_DRAFTS.constraint)) as Draft;
  spcDraft.name = "Base_Constraints";
  const c1: MultiCaseItem = {
    caseId: "case-1",
    enabled: true,
    kind: "constraint",
    draft: spcDraft,
  };

  const gravDraft = JSON.parse(JSON.stringify(INITIAL_DRAFTS.gravity)) as Draft;
  gravDraft.name = "Gravity_Loads";
  const c2: MultiCaseItem = {
    caseId: "case-2",
    enabled: true,
    kind: "gravity",
    spcSource: { kind: "case", caseId: "case-1" },
    draft: gravDraft,
  };

  return {
    projectName: "Full_Vehicle_FEM",
    solver: "optistruct",
    modelUnits: "N-mm-s",
    solverVersion: "2022",
    cases: [c1, c2],
  };
}

export function buildMultiCaseParameters(project: MultiCaseProject): Record<string, unknown> {
  return {
    name: project.projectName || "Full_Vehicle_FEM",
    modelUnits: project.modelUnits,
    solver: project.solver || "optistruct",
    solverVersion: project.solverVersion,
    idPolicy: { kind: "project-managed" },
    cases: project.cases.map((item) => {
      let parameters: Record<string, unknown>;
      if (item.kind === "tabular-load") {
        parameters = {
          projectName: String(item.draft.projectName || "Vehicle_Tabular"),
          rows: Array.isArray(item.draft.rows) ? item.draft.rows : [],
          caseAliases: item.draft.caseAliases ?? {},
          coordinateTolerance:
            typeof item.draft.coordinateTolerance === "number" ? item.draft.coordinateTolerance : 1e-6,
        };
      } else {
        const synced = { ...item.draft, modelUnits: project.modelUnits, solverVersion: project.solverVersion };
        parameters = buildParameters(item.kind, synced);
      }

      return {
        caseId: item.caseId,
        enabled: item.enabled,
        spcSource: item.spcSource,
        loadSource: item.loadSource,
        spec: {
          kind: item.kind,
          parameters,
        },
      };
    }),
  };
}

export interface LocalCompatIssue {
  severity: "error" | "warning" | "info";
  caseId?: string;
  message: string;
}

export interface LocalCompatReport {
  expectedSol: number;
  enabledCount: number;
  constraintLinks: Array<{ fromId: string; fromName: string; targetLabel: string; ok: boolean }>;
  issues: LocalCompatIssue[];
}

export function analyzeMultiCaseLocal(project: MultiCaseProject): LocalCompatReport {
  const enabled = project.cases.filter((c) => c.enabled);
  const byId = new Map(project.cases.map((c) => [c.caseId, c]));
  const issues: LocalCompatIssue[] = [];
  const constraintLinks: LocalCompatReport["constraintLinks"] = [];

  if (enabled.length === 0) {
    issues.push({ severity: "error", message: "请至少启用一个工况才能生成 FEM 模型。" });
  }

  let hasRandom = false;
  let hasMfreq = false;
  let hasModal = false;
  const seenNames = new Map<string, number>();

  for (const item of enabled) {
    const name = getCaseDisplayName(item);
    seenNames.set(name, (seenNames.get(name) ?? 0) + 1);
    if (item.kind === "random-psd") hasRandom = true;
    if (item.kind === "frequency-response") hasMfreq = true;
    if (item.kind === "normal-modes") hasModal = true;

    if (item.spcSource?.kind === "case") {
      const target = byId.get(item.spcSource.caseId);
      if (!target || !target.enabled || target.kind !== "constraint") {
        const msg = !target
          ? `工况「${name}」引用的约束工况已不存在`
          : !target.enabled
            ? `工况「${name}」引用了已禁用的约束工况「${getCaseDisplayName(target)}」`
            : `工况「${name}」的 SPC 绑定目标不是约束工况`;
        issues.push({ severity: "error", caseId: item.caseId, message: msg });
        constraintLinks.push({
          fromId: item.caseId,
          fromName: name,
          targetLabel: target ? getCaseDisplayName(target) : "缺失",
          ok: false,
        });
      } else {
        constraintLinks.push({
          fromId: item.caseId,
          fromName: name,
          targetLabel: getCaseDisplayName(target),
          ok: true,
        });
        if (item.kind === "random-psd" && item.draft.excKind === "base-acceleration" && target.draft.mode !== "reference") {
          const excNode = parseInt(String(item.draft.nodeId ?? ""), 10);
          const reqDofs = item.draft.axisMode === "sequential-tri" ? [1, 2, 3] : [parseInt(String(item.draft.component ?? "3"), 10) || 3];
          const rows = Array.isArray(target.draft.rows) ? (target.draft.rows as Draft[]) : [];
          const covered = new Set<number>();
          for (const r of rows) {
            if (parseInt(String(r.nodeId ?? ""), 10) === excNode) {
              for (const d of parseDofs(r.dofs)) covered.add(d);
            }
          }
          const missing = reqDofs.filter((d) => !covered.has(d));
          if (missing.length > 0) {
            issues.push({
              severity: "error",
              caseId: item.caseId,
              message: `PSD「${name}」激励节点 ${excNode || "?"} 的自由度 [${missing.join(",")}] 未包含在关联约束「${getCaseDisplayName(target)}」中`,
            });
          }
        }
      }
    } else if (item.spcSource?.kind === "external") {
      constraintLinks.push({
        fromId: item.caseId,
        fromName: name,
        targetLabel: `外部 SPC ${item.spcSource.id}`,
        ok: item.spcSource.id > 0,
      });
    } else if (item.kind === "frequency-response" || item.kind === "random-psd") {
      issues.push({
        severity: "error",
        caseId: item.caseId,
        message: `工况「${name}」必须绑定约束集合（工程约束或外部 SPC Set ID）`,
      });
    }

    if (item.kind === "frequency-response" && item.loadSource?.kind === "case") {
      const target = byId.get(item.loadSource.caseId);
      if (!target || !target.enabled) {
        issues.push({
          severity: "error",
          caseId: item.caseId,
          message: `频响「${name}」引用的载荷工况不存在或已禁用`,
        });
      } else if (target.kind === "nodal-static" && target.draft.perRowSubcase) {
        issues.push({
          severity: "error",
          caseId: item.caseId,
          message: `频响「${name}」不能引用启用了逐行子工况的节点力工况「${getCaseDisplayName(target)}」`,
        });
      } else if (target.kind === "gravity" && Array.isArray(target.draft.cases) && target.draft.cases.length > 1) {
        issues.push({
          severity: "error",
          caseId: item.caseId,
          message: `频响「${name}」不能引用包含多条子工况的重力表「${getCaseDisplayName(target)}」`,
        });
      }
    }

    if (item.kind === "tabular-load") {
      const rows = Array.isArray(item.draft.rows) ? item.draft.rows : [];
      if (rows.length === 0) {
        issues.push({
          severity: "error",
          caseId: item.caseId,
          message: `整车工况表「${name}」尚未导入或解析载荷行`,
        });
      }
    }
  }

  for (const [n, cnt] of seenNames.entries()) {
    if (cnt > 1) {
      issues.push({
        severity: "warning",
        message: `存在 ${cnt} 个同名工况「${n}」，生成 FEM 时将自动追加后缀避免 HyperMesh 实体重名`,
      });
    }
  }

  const expectedSol = hasRandom || hasMfreq ? 111 : hasModal ? 103 : 101;
  return {
    expectedSol,
    enabledCount: enabled.length,
    constraintLinks,
    issues,
  };
}

export function toProjectDocument(project: MultiCaseProject): Record<string, unknown> {
  return {
    schemaVersion: 2,
    application: "LoadCreator",
    format: "multicase-project",
    projectName: project.projectName,
    solverTarget: { name: "optistruct", version: project.solverVersion },
    modelUnits: project.modelUnits,
    idPolicy: { kind: "project-managed" },
    cases: project.cases.map((item) => ({
      caseId: item.caseId,
      enabled: item.enabled,
      kind: item.kind,
      spcSource: item.spcSource,
      loadSource: item.loadSource,
      draft: item.draft,
    })),
    multiCaseSpec: buildMultiCaseParameters(project),
  };
}

export function fromProjectDocument(raw: unknown): MultiCaseProject | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;

  const solverTarget = doc.solverTarget as Record<string, unknown> | undefined;
  const targetSolver = typeof solverTarget?.name === "string" ? solverTarget.name.trim().toLowerCase() : "optistruct";
  if (targetSolver && targetSolver !== "optistruct") {
    throw new Error(`该工程的目标求解器为「${solverTarget?.name}」，多工况 FEM 组装仅支持同一求解器（OptiStruct 2022）`);
  }

  const modelUnits = doc.modelUnits === "N-m-s" ? "N-m-s" : "N-mm-s";
  const projectName =
    typeof doc.projectName === "string" && doc.projectName.trim()
      ? doc.projectName.trim()
      : "Imported_MultiCase";

  // Native multicase-project format (preserves raw UI drafts & links).
  if (doc.format === "multicase-project" && Array.isArray(doc.cases)) {
    const cases: MultiCaseItem[] = [];
    for (const entry of doc.cases) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const kind = String(e.kind ?? "");
      if (!isOptiStructMultiKind(kind)) continue;
      const draft = (e.draft && typeof e.draft === "object" ? e.draft : {}) as Draft;
      const item = createMultiCaseItem(kind, modelUnits, cases, draft);
      item.caseId = typeof e.caseId === "string" && e.caseId ? e.caseId : item.caseId;
      item.enabled = e.enabled !== false;
      if (e.spcSource && typeof e.spcSource === "object") {
        item.spcSource = e.spcSource as EntityLink;
      }
      if (e.loadSource && typeof e.loadSource === "object") {
        item.loadSource = e.loadSource as EntityLink;
      }
      cases.push(item);
    }
    return { projectName, solver: "optistruct", modelUnits, solverVersion: "2022", cases };
  }

  // Fallback: migrated legacy workspace (schemaVersion 2 with tabular-load spec).
  if (Array.isArray(doc.cases)) {
    const cases: MultiCaseItem[] = [];
    for (const entry of doc.cases) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const spec = e.spec as Record<string, unknown> | undefined;
      if (!spec || spec.kind !== "tabular-load") continue;
      const p = (spec.parameters ?? {}) as Record<string, unknown>;
      const draft = createTabularDraftFromRows(
        Array.isArray(p.rows) ? (p.rows as LoadRow[]) : [],
        (p.caseAliases as Record<string, string>) ?? {},
        typeof p.legacySource === "string" ? p.legacySource : "",
        typeof p.projectName === "string" ? p.projectName : projectName,
      );
      cases.push(createMultiCaseItem("tabular-load", modelUnits, cases, draft));
    }
    if (cases.length > 0) {
      return { projectName, solver: "optistruct", modelUnits, solverVersion: "2022", cases };
    }
  }

  return null;
}

export function readStoredMultiCaseProject(): MultiCaseProject {
  try {
    const raw = localStorage.getItem(MULTI_CASE_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const p = parsed as Record<string, unknown>;
        const units = p.modelUnits === "N-m-s" ? "N-m-s" : "N-mm-s";
        const name = typeof p.projectName === "string" && p.projectName.trim() ? p.projectName : "Full_Vehicle_FEM";
        if (Array.isArray(p.cases)) {
          const cases: MultiCaseItem[] = [];
          for (const item of p.cases) {
            if (!item || typeof item !== "object") continue;
            const rec = item as Record<string, unknown>;
            const kind = String(rec.kind ?? "");
            if (!isOptiStructMultiKind(kind)) continue;
            const draft = (rec.draft && typeof rec.draft === "object" ? rec.draft : {}) as Draft;
            const built = createMultiCaseItem(kind, units, cases, draft);
            built.caseId = typeof rec.caseId === "string" && rec.caseId ? rec.caseId : built.caseId;
            built.enabled = rec.enabled !== false;
            if (rec.spcSource && typeof rec.spcSource === "object") {
              built.spcSource = rec.spcSource as EntityLink;
            }
            if (rec.loadSource && typeof rec.loadSource === "object") {
              built.loadSource = rec.loadSource as EntityLink;
            }
            cases.push(built);
          }
          if (cases.length > 0) {
            return { projectName: name, solver: "optistruct", modelUnits: units, solverVersion: "2022", cases };
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return createDefaultMultiCaseProject();
}
