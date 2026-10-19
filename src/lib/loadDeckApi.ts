import { invoke } from "@tauri-apps/api/core";
import type { BuildResult, ExportResult, LoadRow, ParseResult } from "@/types/loadDeck";

export const isDesktop = () => "__TAURI_INTERNALS__" in window;

export async function parseClipboardTable(text: string): Promise<ParseResult> {
  return invoke<ParseResult>("parse_clipboard_table", { text });
}

export async function buildLoadDeck(projectName: string, rows: LoadRow[], caseAliases: Record<string, string>, coordinateTolerance = 1e-6): Promise<BuildResult> {
  return invoke<BuildResult>("build_load_deck", { request: { projectName, rows, caseAliases, coordinateTolerance } });
}

export async function exportLoadBundle(directory: string, baseName: string, fem: string, json: string): Promise<ExportResult> {
  return invoke<ExportResult>("export_load_bundle", { directory, baseName, fem, json });
}

export async function exportOutputFile(path: string, content: string): Promise<string> {
  return invoke<string>("export_output_file", { path, content });
}
