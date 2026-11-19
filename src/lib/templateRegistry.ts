import { INITIAL_DRAFTS, mergeDraftValues, type Draft } from "@/lib/caseDrafts";

export interface TemplateModuleAdapter {
  moduleId: string;
  readState: () => Record<string, unknown>;
  writeState: (state: Record<string, unknown>) => void;
}

const adapters = new Map<string, TemplateModuleAdapter>();

/**
 * Register a standalone module (outside Workbench's `drafts` state) so it
 * automatically participates in global template import/export even when unmounted.
 */
export function registerTemplateModule(adapter: TemplateModuleAdapter): () => void {
  adapters.set(adapter.moduleId, adapter);
  return () => {
    if (adapters.get(adapter.moduleId) === adapter) {
      adapters.delete(adapter.moduleId);
    }
  };
}

export function getRegisteredTemplateAdapter(moduleId: string): TemplateModuleAdapter | undefined {
  return adapters.get(moduleId);
}

export function listRegisteredTemplateAdapterIds(): string[] {
  return [...adapters.keys()];
}

export function createStorageTemplateAdapter<T extends Record<string, unknown>>(options: {
  moduleId: string;
  storageKey: string;
  getDefaults: () => T;
  normalize?: (raw: unknown) => T;
  onWrite?: (next: T) => void;
}): TemplateModuleAdapter {
  const { moduleId, storageKey, getDefaults, normalize, onWrite } = options;
  return {
    moduleId,
    readState: () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          return normalize ? normalize(parsed) : mergeDraftValues(getDefaults(), parsed);
        }
      } catch {
        // Fall back to defaults on corrupted storage.
      }
      return getDefaults();
    },
    writeState: (state) => {
      const next = normalize ? normalize(state) : mergeDraftValues(getDefaults(), state);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors; memory listener still receives `next`.
      }
      onWrite?.(next);
    },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Collect current input values and selected options for ALL modules:
 * - Any standalone module registered via `registerTemplateModule`
 * - Every parametric module in `INITIAL_DRAFTS` or `parametricDrafts`
 */
export function collectTemplateModules(
  parametricDrafts: Record<string, Draft>,
  preferredOrder: string[] = [],
): Record<string, Record<string, unknown>> {
  const collected: Record<string, Record<string, unknown>> = {};
  const allIds = new Set<string>([
    ...preferredOrder,
    ...adapters.keys(),
    ...Object.keys(INITIAL_DRAFTS),
    ...Object.keys(parametricDrafts),
  ]);

  for (const id of allIds) {
    const adapter = adapters.get(id);
    if (adapter) {
      collected[id] = cloneJson(adapter.readState());
      continue;
    }
    const base = INITIAL_DRAFTS[id];
    const current = parametricDrafts[id];
    if (base && current) {
      collected[id] = cloneJson(mergeDraftValues(base, current));
    } else if (current) {
      collected[id] = cloneJson(current);
    } else if (base) {
      collected[id] = cloneJson(base);
    }
  }

  return collected;
}

export interface ApplyTemplateResult {
  nextParametricDrafts: Record<string, Draft>;
  appliedIds: string[];
  unknownIds: string[];
}

/**
 * Restore imported module states into standalone adapters and parametric drafts.
 * Unknown module IDs are preserved in `nextParametricDrafts` so round-trip
 * templates from newer versions do not lose data.
 */
export function applyTemplateModules(
  importedModules: Record<string, unknown>,
  currentParametricDrafts: Record<string, Draft>,
  knownModuleIds: string[] = [],
): ApplyTemplateResult {
  const knownSet = new Set<string>([
    ...knownModuleIds,
    ...Object.keys(INITIAL_DRAFTS),
    ...Object.keys(currentParametricDrafts),
  ]);
  const nextParametricDrafts: Record<string, Draft> = {};

  for (const id of new Set([...Object.keys(INITIAL_DRAFTS), ...Object.keys(currentParametricDrafts)])) {
    const base = INITIAL_DRAFTS[id];
    const cur = currentParametricDrafts[id];
    nextParametricDrafts[id] = base ? mergeDraftValues(base, cur) : cloneJson(cur ?? {});
  }

  const appliedIds: string[] = [];
  const unknownIds: string[] = [];

  for (const [id, rawState] of Object.entries(importedModules)) {
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) continue;
    const stateObj = rawState as Record<string, unknown>;

    const adapter = adapters.get(id);
    if (adapter) {
      adapter.writeState(stateObj);
      appliedIds.push(id);
      continue;
    }

    const base = INITIAL_DRAFTS[id];
    if (base) {
      nextParametricDrafts[id] = mergeDraftValues(base, stateObj);
      appliedIds.push(id);
    } else if (knownSet.has(id)) {
      nextParametricDrafts[id] = mergeDraftValues(nextParametricDrafts[id] ?? {}, stateObj);
      appliedIds.push(id);
    } else {
      nextParametricDrafts[id] = cloneJson(stateObj);
      unknownIds.push(id);
    }
  }

  return { nextParametricDrafts, appliedIds, unknownIds };
}
