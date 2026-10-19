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

export interface ParseResult {
  rows: LoadRow[];
  warnings: string[];
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
}

export interface ExportResult {
  femPath: string;
  jsonPath: string;
}
