import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "@/lib/loadDeckApi";

export interface ModuleDescriptor {
  id: string;
  title: string;
  category: "static" | "dynamic" | "modal" | "special" | string;
  solver: string;
  minSupportedVersion: string;
  status: "stable" | "beta" | "experimental" | string;
  helpKey: string;
  capabilityFlags: string[];
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  fieldPath?: string;
  entity?: string;
  hint?: string;
}

export interface ExternalReference {
  kind: string;
  id: number;
  label?: string;
  status: string;
  usedBy: string;
}

export interface IdAssignment {
  kind: string;
  key: string;
  id: number;
}

export interface PreviewSummary {
  sol?: number;
  subcaseCount: number;
  cardCounts: Record<string, number>;
  lineCount: number;
  canExport: boolean;
}

export interface PreviewResult {
  kind: string;
  diagnostics: Diagnostic[];
  femPreview: string;
  externalReferences: ExternalReference[];
  idPlan: IdAssignment[];
  summary: PreviewSummary;
}

export interface BuildResultV2 {
  kind: string;
  diagnostics: Diagnostic[];
  files: Record<string, string>;
  externalReferences: ExternalReference[];
  idPlan: IdAssignment[];
}

export interface CaseRequest {
  projectName: string;
  case: { kind: string; parameters: Record<string, unknown> };
}

export async function listCaseModules(): Promise<ModuleDescriptor[]> {
  return invoke<ModuleDescriptor[]>("list_case_modules");
}

export async function previewCase(request: CaseRequest): Promise<PreviewResult> {
  return invoke<PreviewResult>("preview_case", { request });
}

export async function buildCase(request: CaseRequest): Promise<BuildResultV2> {
  return invoke<BuildResultV2>("build_case", { request });
}

export async function exportCaseFiles(directory: string, baseName: string, files: Record<string, string>): Promise<string[]> {
  return invoke<string[]>("export_case_files", { directory, baseName, files });
}

export async function saveProject(path: string, document: unknown): Promise<string> {
  return invoke<string>("save_project", { path, document });
}

export async function openProject(path: string): Promise<unknown> {
  return invoke<unknown>("open_project", { path });
}

export async function migrateLegacyWorkspace(legacy: unknown): Promise<unknown> {
  return invoke<unknown>("migrate_legacy_workspace_cmd", { legacy });
}

/* ---- PSD spectrum import / standard template ---- */

export interface PsdImportPoint {
  frequencyHz: number;
  psd: number;
}

export interface PsdImportResult {
  points: PsdImportPoint[];
  warnings: string[];
  ignoredLines: number;
  /** "csv" | "txt" | "xlsx" | "ods" */
  sourceKind: string;
  /** "comma" | "tab" | "semicolon" | "whitespace" (text files only) */
  delimiter?: string | null;
  header?: string | null;
  sheetName?: string | null;
  interpolationGuess?: string | null;
}

export async function readPsdSpectrumFile(path: string): Promise<PsdImportResult> {
  return invoke<PsdImportResult>("read_psd_spectrum_file", { path });
}

export async function writePsdTemplate(path: string, format: "csv" | "xlsx"): Promise<string> {
  return invoke<string>("write_psd_template", { path, format });
}

export { isDesktop };
