import type { PointJsonEntry } from "@/types/loadDeck";

/**
 * 与 Rust 端 serde_json::to_string_pretty 保持一致的输出：
 * f64 用最短往返表示且整数值带 `.0`（1550 会写成 1550.0），u64 节点号写成整数。
 */
function formatFloat(value: number) {
  if (!Number.isFinite(value)) return "0.0";
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function formatInteger(value: number) {
  return String(Number.isFinite(value) ? Math.trunc(value) : 0);
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parsePointsJson(json: string): PointJsonEntry[] {
  try {
    const data = JSON.parse(json) as Record<string, Record<string, unknown>> | null;
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    return Object.entries(data).map(([key, value]) => ({
      key,
      nodeId: Math.trunc(toNumber(value?.nodeId)),
      label: value?.label == null ? "" : String(value.label),
      x: toNumber(value?.x),
      y: toNumber(value?.y),
      z: toNumber(value?.z),
    }));
  } catch {
    return [];
  }
}

export function serializePointsJson(entries: PointJsonEntry[]) {
  if (entries.length === 0) return "{}";
  const body = entries.map((entry) => [
    `  ${JSON.stringify(entry.key)}: {`,
    `    "nodeId": ${formatInteger(entry.nodeId)},`,
    `    "label": ${JSON.stringify(entry.label)},`,
    `    "x": ${formatFloat(entry.x)},`,
    `    "y": ${formatFloat(entry.y)},`,
    `    "z": ${formatFloat(entry.z)}`,
    "  }",
  ].join("\n"));
  return `{\n${body.join(",\n")}\n}`;
}

export function duplicateJsonKeys(entries: PointJsonEntry[]) {
  const counts = new Map<string, number>();
  entries.forEach((entry) => counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}
