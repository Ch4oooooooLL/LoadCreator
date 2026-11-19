import type { LoadDeckWarning, LoadRow, WarningTarget } from "@/types/loadDeck";

const DEFAULT_TOLERANCE = 1e-6;

function safeName(value: string, fallback: string): string {
  let cleaned = "";
  let separator = false;
  for (const ch of value) {
    if (/^[a-zA-Z0-9.-]$/.test(ch)) {
      if (separator && cleaned.length > 0) cleaned += "_";
      cleaned += ch;
      separator = false;
    } else if (cleaned.length > 0) {
      separator = true;
    }
  }
  return cleaned ? cleaned.slice(0, 60) : fallback;
}

function effectiveTolerance(tolerance: number): number {
  return Number.isFinite(tolerance) && tolerance > 0 ? tolerance : DEFAULT_TOLERANCE;
}

function coordKey(x: number, y: number, z: number, tolerance: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return `nonfinite:${Number.isFinite(x)}:${Number.isFinite(y)}:${Number.isFinite(z)}`;
  }
  const t = effectiveTolerance(tolerance);
  return `${Math.round(x / t)}:${Math.round(y / t)}:${Math.round(z / t)}`;
}

function coordText(value: number): string {
  if (value === 0) return "0";
  return Number(value.toFixed(9)).toString();
}

function diffCoordinateFields(first: LoadRow, current: LoadRow, tolerance: number): string[] {
  const t = effectiveTolerance(tolerance);
  const fields: string[] = [];
  if (!Number.isFinite(first.x) || !Number.isFinite(current.x) || Math.abs(first.x - current.x) > t) fields.push("x");
  if (!Number.isFinite(first.y) || !Number.isFinite(current.y) || Math.abs(first.y - current.y) > t) fields.push("y");
  if (!Number.isFinite(first.z) || !Number.isFinite(current.z) || Math.abs(first.z - current.z) > t) fields.push("z");
  return fields.length > 0 ? fields : ["x", "y", "z"];
}

export function warningStableKey(warning: LoadDeckWarning): string {
  const locs = warning.targets.map((target) => {
    if (target.kind === "sourceLine") {
      return `L:${target.sourceLine ?? ""}`;
    }
    const base = `R:${target.rowIndex ?? ""}`;
    return warning.code === "NON_FINITE_VALUE"
      ? `${base}:${(target.fields ?? []).join(",")}`
      : base;
  });
  return `${warning.code}::${locs.join("|")}`;
}

export function parseRowErrorTarget(errorMessage: string): WarningTarget | null {
  const match = errorMessage.match(/^第\s*(\d+)\s*条数据的\s*(X|Y|Z|FX|FY|FZ|TX|TY|TZ)\s*不是有限数值/);
  if (!match) return null;
  const rowIndex = Number(match[1]) - 1;
  const field = match[2].toLowerCase();
  if (!Number.isInteger(rowIndex) || rowIndex < 0) return null;
  return {
    kind: "dataCell",
    label: `第 ${rowIndex + 1} 条 · ${match[2]}`,
    rowIndex,
    fields: [field],
  };
}

export function normalizeWarnings(
  warningItems: LoadDeckWarning[] | undefined,
  plainWarnings: string[],
): LoadDeckWarning[] {
  if (warningItems && warningItems.length > 0) return warningItems;
  return plainWarnings.map((message, index) => ({
    code: `TEXT_WARNING_${index}`,
    severity: "warning",
    category: "检查提示",
    message,
    targets: [],
  }));
}

export function validateLoadRowsLocal(rows: LoadRow[], coordinateTolerance = DEFAULT_TOLERANCE): LoadDeckWarning[] {
  if (rows.length === 0) return [];
  const points: Array<{ name: string; englishName: string; x: number; y: number; z: number }> = [];
  const pointByName = new Map<string, number>();
  const firstPointByEnglishName = new Map<string, number>();
  const firstPointByCoordinate = new Map<string, number>();
  const firstRowByPoint: number[] = [];
  const warnedNameCoordinates = new Set<string>();
  const warningItems: LoadDeckWarning[] = [];

  const numericChecks: Array<[string, keyof LoadRow]> = [
    ["X", "x"],
    ["Y", "y"],
    ["Z", "z"],
    ["FX", "fx"],
    ["FY", "fy"],
    ["FZ", "fz"],
    ["TX", "tx"],
    ["TY", "ty"],
    ["TZ", "tz"],
  ];

  rows.forEach((row, index) => {
    for (const [label, key] of numericChecks) {
      const val = Number(row[key]);
      if (!Number.isFinite(val)) {
        warningItems.push({
          code: "NON_FINITE_VALUE",
          severity: "error",
          category: "数值无效",
          message: `第 ${index + 1} 条数据的 ${label} 不是有限数值`,
          targets: [{
            kind: "dataCell",
            label: `第 ${index + 1} 条 · ${label}`,
            rowIndex: index,
            fields: [key],
          }],
        });
      }
    }

    const coordinateKey = coordKey(row.x, row.y, row.z, coordinateTolerance);
    const fallbackEnglishName = `point_${index + 1}`;
    const rawEnglishName = row.pointName.trim();
    const englishName = safeName(rawEnglishName, fallbackEnglishName);
    const displayName = row.displayName.trim() || englishName;

    if (!row.displayName.trim()) {
      warningItems.push({
        code: "MISSING_DISPLAY_NAME",
        severity: "warning",
        category: "缺少中文名",
        message: `第 ${index + 1} 条数据的点位“${englishName}”缺少中文名称，暂以英文名作为归并索引；请补充中文点位名`,
        targets: [{
          kind: "dataCell",
          label: `第 ${index + 1} 条 · 中文点位名`,
          rowIndex: index,
          fields: ["displayName"],
        }],
      });
    }

    if (!rawEnglishName) {
      warningItems.push({
        code: "MISSING_POINT_NAME",
        severity: "warning",
        category: "缺少英文名",
        message: `第 ${index + 1} 条数据的点位“${displayName}”缺少英文名称，JSON 暂使用自动名称“${englishName}”；请补充英文点位名`,
        targets: [{
          kind: "dataCell",
          label: `第 ${index + 1} 条 · 英文点位名`,
          rowIndex: index,
          fields: ["pointName"],
        }],
      });
    } else if (englishName !== rawEnglishName) {
      warningItems.push({
        code: "INVALID_POINT_NAME",
        severity: "warning",
        category: "英文名不规范",
        message: `第 ${index + 1} 条数据的点位“${displayName}”的英文名“${rawEnglishName}”包含中文、空格或不兼容字符，JSON/FEM 暂使用“${englishName}”；请修改英文名`,
        targets: [{
          kind: "dataCell",
          label: `第 ${index + 1} 条 · 英文点位名`,
          rowIndex: index,
          fields: ["pointName"],
        }],
      });
    }

    const existing = pointByName.get(displayName);
    if (existing !== undefined) {
      const existingCoordinate = coordKey(points[existing].x, points[existing].y, points[existing].z, coordinateTolerance);
      const firstRow = firstRowByPoint[existing];
      if (points[existing].englishName !== englishName) {
        warningItems.push({
          code: "CONFLICTING_POINT_NAME",
          severity: "warning",
          category: "英文名不一致",
          message: `中文点位“${displayName}”对应了不同英文名：第 ${firstRow + 1} 条数据为“${points[existing].englishName}”，第 ${index + 1} 条数据为“${englishName}”；JSON 暂保留首次英文名，请统一后重新生成`,
          targets: [
            { kind: "dataCell", label: `第 ${firstRow + 1} 条 (${points[existing].englishName})`, rowIndex: firstRow, fields: ["pointName"] },
            { kind: "dataCell", label: `第 ${index + 1} 条 (${englishName})`, rowIndex: index, fields: ["pointName"] },
          ],
        });
      }
      const coordWarnKey = `${displayName}:${coordinateKey}`;
      if (existingCoordinate !== coordinateKey && !warnedNameCoordinates.has(coordWarnKey)) {
        warnedNameCoordinates.add(coordWarnKey);
        const first = rows[firstRow];
        const diffFields = diffCoordinateFields(first, row, coordinateTolerance);
        warningItems.push({
          code: "INCONSISTENT_COORDINATES",
          severity: "warning",
          category: "坐标不一致",
          message: `中文点位“${displayName}”的坐标不一致：第 ${firstRow + 1} 条数据为 (${coordText(first.x)}, ${coordText(first.y)}, ${coordText(first.z)})，第 ${index + 1} 条数据为 (${coordText(row.x)}, ${coordText(row.y)}, ${coordText(row.z)})；JSON 暂保留首次坐标，请统一坐标后重新生成`,
          targets: [
            { kind: "dataCell", label: `第 ${firstRow + 1} 条 · 坐标`, rowIndex: firstRow, fields: diffFields },
            { kind: "dataCell", label: `第 ${index + 1} 条 · 坐标`, rowIndex: index, fields: diffFields },
          ],
        });
      }
    } else {
      const idx = points.length;
      points.push({ name: displayName, englishName, x: row.x, y: row.y, z: row.z });
      firstRowByPoint.push(index);
      pointByName.set(displayName, idx);
      const englishKey = englishName.toLowerCase();
      const dupNameIdx = firstPointByEnglishName.get(englishKey);
      if (dupNameIdx !== undefined) {
        const firstRow = firstRowByPoint[dupNameIdx];
        const first = rows[firstRow];
        warningItems.push({
          code: "DUPLICATE_POINT_NAME",
          severity: "warning",
          category: "英文名重复",
          message: `中文点位“${first.displayName}”（第 ${firstRow + 1} 条数据）与“${displayName}”（第 ${index + 1} 条数据）使用了相同英文名“${englishName}”；JSON 将为后者追加节点号以防覆盖，请修改英文名`,
          targets: [
            { kind: "dataCell", label: `第 ${firstRow + 1} 条 · ${first.displayName}`, rowIndex: firstRow, fields: ["pointName"] },
            { kind: "dataCell", label: `第 ${index + 1} 条 · ${displayName}`, rowIndex: index, fields: ["pointName"] },
          ],
        });
      } else {
        firstPointByEnglishName.set(englishKey, idx);
      }

      const dupCoordIdx = firstPointByCoordinate.get(coordinateKey);
      if (dupCoordIdx !== undefined) {
        const firstRow = firstRowByPoint[dupCoordIdx];
        warningItems.push({
          code: "DUPLICATE_COORDINATES",
          severity: "warning",
          category: "坐标相同",
          message: `点位“${points[dupCoordIdx].name}”（第 ${firstRow + 1} 条数据）与“${displayName}”（第 ${index + 1} 条数据）使用相同坐标 (${coordText(row.x)}, ${coordText(row.y)}, ${coordText(row.z)})；已按名称分别生成节点和 JSON 记录，请检查左右点坐标并完成修改`,
          targets: [
            { kind: "dataCell", label: `第 ${firstRow + 1} 条 · ${points[dupCoordIdx].name}`, rowIndex: firstRow, fields: ["x", "y", "z"] },
            { kind: "dataCell", label: `第 ${index + 1} 条 · ${displayName}`, rowIndex: index, fields: ["x", "y", "z"] },
          ],
        });
      } else {
        firstPointByCoordinate.set(coordinateKey, idx);
      }
    }
  });

  return warningItems;
}
