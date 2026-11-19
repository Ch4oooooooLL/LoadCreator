export interface LoadRow {
  sourceLine: number;
  caseName: string;
  groupName: string;
  pointName: string;
  displayName: string;
  x: number;
  y: number;
  z: number;
  time: number | null;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
}

export type WarningSeverity = "error" | "warning" | "info";
export type WarningTargetKind = "sourceLine" | "dataCell";

export interface WarningTarget {
  kind: WarningTargetKind;
  label?: string;
  rowIndex?: number;
  sourceLine?: number;
  fields?: string[];
}

export interface LoadDeckWarning {
  code: string;
  severity: WarningSeverity;
  category: string;
  message: string;
  targets: WarningTarget[];
}

export interface ParseResult {
  rows: LoadRow[];
  warnings: string[];
  warningItems?: LoadDeckWarning[];
  ignoredLines: number;
}

export interface PointEntry {
  nodeId: number;
  name: string;
  englishName: string;
  x: number;
  y: number;
  z: number;
  text: string;
}

export interface PointJsonEntry {
  key: string;
  nodeId: number;
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface CaseSummary {
  name: string;
  femName: string;
  collectorName: string;
  loadStepName: string;
  loadId: number;
  rowCount: number;
}

export interface BuildResult {
  fem: string;
  json: string;
  points: PointEntry[];
  cases: CaseSummary[];
  warnings: string[];
  warningItems?: LoadDeckWarning[];
}

export interface ValidateRowsResult {
  warnings: string[];
  warningItems: LoadDeckWarning[];
}

export interface ExportResult {
  femPath: string;
  jsonPath: string;
}
