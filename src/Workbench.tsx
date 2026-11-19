import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import TitleBar from "@/components/TitleBar";
import ToolTabBar from "@/components/ToolTabBar";
import CommandPalette from "@/components/CommandPalette";
import WorkbenchForms from "@/components/WorkbenchForms";
import InspectorPane, { type InspectorTab } from "@/components/InspectorPane";
import ModuleGallery from "@/app/ModuleGallery";
import MultiCaseWorkspace from "@/modules/multicase/MultiCaseWorkspace";
import TabularModule from "@/modules/tabular/TabularModule";
import { FALLBACK_MODULES, MULTI_CASE_DESCRIPTOR, STATUS_LABELS, moduleMeta } from "@/app/moduleRegistry";
import {
  INITIAL_DRAFTS,
  PSD_SAMPLE_POINTS,
  buildParameters,
  createInitialDrafts,
  mergeWithInitialDrafts,
  type Draft,
} from "@/lib/caseDrafts";
import {
  buildCase,
  exportCaseFiles,
  isDesktop,
  listCaseModules,
  previewCase,
  readPsdSpectrumFile,
  readTextFile,
  saveTextFile,
  writePsdTemplate,
  type ModuleDescriptor,
  type PreviewResult,
  type PsdImportResult,
} from "@/lib/caseApi";
import "@/lib/tabularWorkspaceStore";
import { applyTemplateModules, collectTemplateModules } from "@/lib/templateRegistry";
import {
  createTemplateDocument,
  parseTemplateText,
  serializeTemplateToJson,
  serializeTemplateToXml,
} from "@/lib/templateCodec";
import { DownloadIcon, PlayCheckIcon, ResetIcon, SpinnerIcon, XIcon } from "@/components/Icons";

type ToastTone = "success" | "info" | "error";
interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

const DRAFTS_KEY = "loadcreator.drafts.v1";
const OPEN_TABS_KEY = "loadcreator.openTabs.v1";

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

function readHash(): string {
  const raw = window.location.hash.replace(/^#/, "").trim();
  return raw || "home";
}

function readStoredDrafts(): Record<string, Draft> {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return createInitialDrafts();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return mergeWithInitialDrafts(parsed as Record<string, Draft>);
    }
  } catch {
    localStorage.removeItem(DRAFTS_KEY);
  }
  return createInitialDrafts();
}

function readStoredOpenTabs(initialActive: string): string[] {
  const list: string[] = [];
  try {
    const raw = localStorage.getItem(OPEN_TABS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item !== "home" && !list.includes(item)) {
            list.push(item);
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  if (initialActive !== "home" && !list.includes(initialActive)) {
    list.push(initialActive);
  }
  return list;
}

function downloadBlob(name: string, content: string, mime = "application/json;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function writeClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back to execCommand below.
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const ok = document.execCommand("copy");
  field.remove();
  if (!ok) throw new Error("系统剪贴板不可用");
}

const PSD_CSV_TEMPLATE = [
  "\ufeff# LoadCreator PSD 标准导入模板（UTF-8 CSV）",
  "# 第一列：频率 (Hz)，须严格递增；第二列：功率谱密度 PSD (如 g^2/Hz)",
  "频率(Hz),PSD(g^2/Hz)",
  "10,0.003",
  "20,0.01",
  "50,0.02",
  "100,0.006",
  "200,0.003",
].join("\n");

export default function Workbench() {
  const [modules, setModules] = useState<ModuleDescriptor[]>(FALLBACK_MODULES);
  const [activeId, setActiveId] = useState<string>(readHash);
  const [openIds, setOpenIds] = useState<string[]>(() => readStoredOpenTabs(readHash()));
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, Draft>>(readStoredDrafts);
  const [previewsById, setPreviewsById] = useState<Record<string, PreviewResult | null>>({});
  const [staleById, setStaleById] = useState<Record<string, boolean>>({});
  const [inspectorTabById, setInspectorTabById] = useState<Record<string, InspectorTab>>({});
  const [busy, setBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [psdBusy, setPsdBusy] = useState(false);
  const [psdImport, setPsdImport] = useState<PsdImportResult | null>(null);
  const [gravityRowIndex, setGravityRowIndex] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  const pushToast = useCallback((tone: ToastTone, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, tone, text }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    const fallbackOrder = new Map(FALLBACK_MODULES.map((m, idx) => [m.id, idx]));
    listCaseModules()
      .then((list) => {
        if (!Array.isArray(list) || list.length === 0) return;
        const merged = list.map((item) => {
          const fb = FALLBACK_MODULES.find((m) => m.id === item.id);
          return fb ? { ...item, capabilityFlags: fb.capabilityFlags } : item;
        });
        merged.sort((a, b) => (fallbackOrder.get(a.id) ?? 999) - (fallbackOrder.get(b.id) ?? 999));
        setModules(merged);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onHash = () => {
      const next = readHash();
      setActiveId(next);
      if (next !== "home") {
        setOpenIds((prev) => (prev.includes(next) ? prev : [...prev, next]));
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      } catch {
        /* ignore */
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [drafts]);

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openIds));
    } catch {
      /* ignore */
    }
  }, [openIds]);

  const selectModule = useCallback((id: string) => {
    window.location.hash = id === "home" ? "" : id;
    setActiveId(id);
    if (id !== "home") {
      setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }
  }, []);

  const closeTab = useCallback((id: string) => {
    setOpenIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const next = prev.filter((item) => item !== id);
      if (activeId === id) {
        const fallback = next[idx - 1] ?? next[idx] ?? "home";
        window.location.hash = fallback === "home" ? "" : fallback;
        setActiveId(fallback);
      }
      return next;
    });
  }, [activeId]);

  const closeOtherTabs = useCallback((keepId?: string) => {
    if (keepId) {
      setOpenIds((prev) => (prev.includes(keepId) ? [keepId] : []));
    } else {
      setOpenIds([]);
      if (activeId !== "home") {
        window.location.hash = "";
        setActiveId("home");
      }
    }
  }, [activeId]);

  const active = useMemo(
    () =>
      activeId === "multi-case"
        ? MULTI_CASE_DESCRIPTOR
        : modules.find((m) => m.id === activeId),
    [modules, activeId],
  );
  const resolvedId = activeId === "home" || activeId === "multi-case" || active ? activeId : "home";
  const isParametric = resolvedId !== "home" && resolvedId !== "tabular-load" && resolvedId !== "multi-case";
  const draft: Draft = isParametric ? drafts[resolvedId] ?? {} : {};
  const preview = isParametric ? previewsById[resolvedId] ?? null : null;
  const previewStale = isParametric ? Boolean(staleById[resolvedId]) : false;
  const inspectorTab: InspectorTab = isParametric ? inspectorTabById[resolvedId] ?? "visual" : "visual";
  const validOpenIds = useMemo(
    () => openIds.filter((id) => id === "multi-case" || modules.some((m) => m.id === id)),
    [openIds, modules],
  );

  const setActiveInspectorTab = useCallback((tab: InspectorTab) => {
    if (!isParametric) return;
    setInspectorTabById((prev) => ({ ...prev, [resolvedId]: tab }));
  }, [isParametric, resolvedId]);

  const patch = useCallback((key: string, value: unknown) => {
    if (!isParametric) return;
    setDrafts((prev) => ({ ...prev, [resolvedId]: { ...(prev[resolvedId] ?? {}), [key]: value } }));
    if (previewsById[resolvedId]) {
      setStaleById((prev) => ({ ...prev, [resolvedId]: true }));
    }
  }, [isParametric, resolvedId, previewsById]);

  const resetActiveDraft = useCallback(() => {
    if (!isParametric || !INITIAL_DRAFTS[resolvedId]) return;
    setDrafts((prev) => ({
      ...prev,
      [resolvedId]: JSON.parse(JSON.stringify(INITIAL_DRAFTS[resolvedId])) as Draft,
    }));
    setPreviewsById((prev) => ({ ...prev, [resolvedId]: null }));
    setStaleById((prev) => ({ ...prev, [resolvedId]: false }));
    setInspectorTabById((prev) => ({ ...prev, [resolvedId]: "visual" }));
    if (resolvedId === "random-psd") setPsdImport(null);
    if (resolvedId === "gravity") setGravityRowIndex(0);
    pushToast("info", `已恢复「${active?.title ?? resolvedId}」默认参数`);
  }, [isParametric, resolvedId, active?.title, pushToast]);

  const runPreview = useCallback(async (): Promise<PreviewResult | null> => {
    if (!isParametric) return null;
    if (!isDesktop()) {
      pushToast("error", "求解器校验与生成由 Rust 桌面端完成，请使用 npm run tauri:dev 或桌面程序运行。");
      return null;
    }
    setBusy(true);
    try {
      const res = await previewCase({
        projectName: String(draft.name || resolvedId),
        case: { kind: resolvedId, parameters: buildParameters(resolvedId, draft) },
      });
      setPreviewsById((prev) => ({ ...prev, [resolvedId]: res }));
      setStaleById((prev) => ({ ...prev, [resolvedId]: false }));
      if (!res.summary.canExport) {
        setInspectorTabById((prev) => ({ ...prev, [resolvedId]: "audit" }));
        const errCount = res.diagnostics.filter((d) => d.severity === "error").length;
        pushToast("error", `校验未通过：${errCount} 项错误阻止导出`);
      } else {
        if (inspectorTab === "visual") {
          setInspectorTabById((prev) => ({ ...prev, [resolvedId]: "deck" }));
        }
        const warnCount = res.diagnostics.filter((d) => d.severity === "warning").length;
        pushToast(
          "success",
          `校验通过 · ${res.summary.lineCount} 行${warnCount ? `（${warnCount} 项警告）` : ""}`,
        );
      }
      return res;
    } catch (e) {
      pushToast("error", "预览生成失败：" + messageOf(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [isParametric, resolvedId, draft, inspectorTab, pushToast]);

  const runExport = useCallback(async () => {
    if (!isParametric) return;
    if (!isDesktop()) {
      pushToast("error", "导出增量文件由 Rust 桌面端完成，请在 Tauri 应用中运行。");
      return;
    }
    setBusy(true);
    try {
      const request = {
        projectName: String(draft.name || resolvedId),
        case: { kind: resolvedId, parameters: buildParameters(resolvedId, draft) },
      };
      if (!preview || previewStale) {
        const fresh = await previewCase(request);
        setPreviewsById((prev) => ({ ...prev, [resolvedId]: fresh }));
        setStaleById((prev) => ({ ...prev, [resolvedId]: false }));
        if (!fresh.summary.canExport) {
          setInspectorTabById((prev) => ({ ...prev, [resolvedId]: "audit" }));
          pushToast("error", "参数校验未通过，请先修复诊断错误后导出");
          return;
        }
      }
      const built = await buildCase(request);
      const hasErr = built.diagnostics.some((d) => d.severity === "error");
      if (hasErr || Object.keys(built.files).length === 0) {
        setInspectorTabById((prev) => ({ ...prev, [resolvedId]: "audit" }));
        pushToast("error", "存在阻止导出的错误，请检查诊断与台账");
        return;
      }
      const dir = await openDialog({
        directory: true,
        multiple: false,
        title: "选择增量文件导出目录",
      });
      if (!dir) return;
      const written = await exportCaseFiles(dir, String(draft.name || resolvedId), built.files);
      pushToast("success", `已导出 ${written.length} 个文件至 ${dir}`);
    } catch (e) {
      pushToast("error", "导出失败：" + messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [isParametric, resolvedId, draft, preview, previewStale, pushToast]);

  const importPsdSpectrum = useCallback(async () => {
    if (!isDesktop()) {
      pushToast("error", "PSD 谱文件导入需由桌面端读取文件，请在 Tauri 应用中运行。");
      return;
    }
    setPsdBusy(true);
    try {
      const path = await openDialog({
        multiple: false,
        title: "导入 PSD 谱表（CSV / TXT / XLSX）",
        filters: [
          { name: "PSD 谱表", extensions: ["csv", "txt", "tsv", "dat", "xlsx", "xls", "xlsm", "ods"] },
          { name: "所有文件", extensions: ["*"] },
        ],
      });
      if (!path || Array.isArray(path)) return;
      const res = await readPsdSpectrumFile(path);
      const nextPoints = res.points.map((p) => ({
        frequencyHz: String(p.frequencyHz),
        psd: String(p.psd),
      }));
      setDrafts((prev) => {
        const cur = prev["random-psd"] ?? {};
        return {
          ...prev,
          "random-psd": {
            ...cur,
            points: nextPoints,
            ...(res.interpolationGuess ? { interpolation: res.interpolationGuess } : {}),
          },
        };
      });
      setPsdImport(res);
      if (previewsById["random-psd"]) {
        setStaleById((prev) => ({ ...prev, "random-psd": true }));
      }
      pushToast("success", `已导入 ${res.points.length} 个 PSD 谱点`);
    } catch (e) {
      pushToast("error", "导入 PSD 谱失败：" + messageOf(e));
    } finally {
      setPsdBusy(false);
    }
  }, [previewsById, pushToast]);

  const downloadPsdTemplate = useCallback(async (format: "csv" | "xlsx") => {
    const defaultName = format === "xlsx" ? "PSD_谱表模板.xlsx" : "PSD_谱表模板.csv";
    if (!isDesktop()) {
      if (format === "csv") {
        downloadBlob(defaultName, PSD_CSV_TEMPLATE, "text/csv;charset=utf-8");
        pushToast("success", "已下载标准 CSV 模板");
      } else {
        pushToast("error", "Excel (.xlsx) 模板生成需由桌面端执行，可先下载 CSV 模板。");
      }
      return;
    }
    try {
      const path = await saveDialog({
        defaultPath: defaultName,
        filters:
          format === "xlsx"
            ? [{ name: "Excel 工作簿", extensions: ["xlsx"] }]
            : [{ name: "CSV 文本", extensions: ["csv"] }],
      });
      if (!path) return;
      const written = await writePsdTemplate(path, format);
      pushToast("success", `已保存标准模板：${written}`);
    } catch (e) {
      pushToast("error", "保存模板失败：" + messageOf(e));
    }
  }, [pushToast]);

  const loadPsdSample = useCallback(() => {
    setDrafts((prev) => ({
      ...prev,
      "random-psd": {
        ...(prev["random-psd"] ?? {}),
        points: PSD_SAMPLE_POINTS.map((p) => ({ ...p })),
      },
    }));
    setPsdImport(null);
    if (previewsById["random-psd"]) {
      setStaleById((prev) => ({ ...prev, "random-psd": true }));
    }
    pushToast("info", `已载入标准 PSD 示例谱（${PSD_SAMPLE_POINTS.length} 点）`);
  }, [previewsById, pushToast]);

  const handleCopyText = useCallback(async (text: string, label: string) => {
    try {
      await writeClipboard(text);
      pushToast("success", `${label}已复制到剪贴板`);
    } catch (e) {
      pushToast("error", "复制失败：" + messageOf(e));
    }
  }, [pushToast]);

  const applyImportedTemplateText = useCallback((rawText: string) => {
    const doc = parseTemplateText(rawText);
    const { nextParametricDrafts, appliedIds, unknownIds } = applyTemplateModules(
      doc.modules,
      drafts,
      modules.map((m) => m.id),
    );
    if (appliedIds.length === 0 && unknownIds.length === 0) {
      pushToast("error", "模板中未包含任何有效的模块配置");
      return;
    }
    setDrafts(nextParametricDrafts);
    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(nextParametricDrafts));
    } catch {
      /* ignore */
    }
    setPreviewsById({});
    setStaleById({});
    setPsdImport(null);
    const extra = unknownIds.length > 0 ? `（另有 ${unknownIds.length} 个扩展模块配置已保留）` : "";
    pushToast("success", `已导入模板：恢复 ${appliedIds.length} 个模块填写值与选择项${extra}`);
  }, [drafts, modules, pushToast]);

  const exportTemplate = useCallback(async () => {
    setTemplateBusy(true);
    try {
      const snapshot = collectTemplateModules(drafts, modules.map((m) => m.id));
      const moduleCount = Object.keys(snapshot).length;
      const doc = createTemplateDocument(snapshot);
      const today = new Date().toISOString().slice(0, 10);
      const defaultName = `LoadCreator_模板_${today}.xml`;

      if (!isDesktop()) {
        downloadBlob(defaultName, serializeTemplateToXml(doc), "application/xml;charset=utf-8");
        pushToast("success", `已导出 XML 模板（包含 ${moduleCount} 个模块配置）`);
        return;
      }

      const path = await saveDialog({
        title: "导出全局参数模板（记录所有模块填写值与选择项）",
        defaultPath: defaultName,
        filters: [
          { name: "LoadCreator XML 模板", extensions: ["xml"] },
          { name: "LoadCreator JSON 模板", extensions: ["json"] },
        ],
      });
      if (!path) return;

      const isJson = path.toLowerCase().endsWith(".json");
      const content = isJson ? serializeTemplateToJson(doc) : serializeTemplateToXml(doc);
      const written = await saveTextFile(path, content);
      pushToast("success", `已导出${isJson ? " JSON " : " XML "}模板（${moduleCount} 个模块）：${written}`);
    } catch (e) {
      pushToast("error", "导出模板失败：" + messageOf(e));
    } finally {
      setTemplateBusy(false);
    }
  }, [drafts, modules, pushToast]);

  const importTemplate = useCallback(async () => {
    if (!isDesktop()) {
      templateFileInputRef.current?.click();
      return;
    }
    setTemplateBusy(true);
    try {
      const path = await openDialog({
        multiple: false,
        title: "导入全局参数模板（XML / JSON）",
        filters: [
          { name: "LoadCreator 模板", extensions: ["xml", "json"] },
          { name: "所有文件", extensions: ["*"] },
        ],
      });
      if (!path || Array.isArray(path)) return;
      const rawText = await readTextFile(path);
      applyImportedTemplateText(rawText);
    } catch (e) {
      pushToast("error", "导入模板失败：" + messageOf(e));
    } finally {
      setTemplateBusy(false);
    }
  }, [applyImportedTemplateText, pushToast]);

  const handleWebTemplateFileChange = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setTemplateBusy(true);
    try {
      const rawText = await file.text();
      applyImportedTemplateText(rawText);
    } catch (e) {
      pushToast("error", "导入模板失败：" + messageOf(e));
    } finally {
      setTemplateBusy(false);
    }
  }, [applyImportedTemplateText, pushToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && isParametric && !paletteOpen) {
        e.preventDefault();
        void runPreview();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isParametric, paletteOpen, runPreview]);

  const meta = active ? moduleMeta(active.id) : null;
  const canExport = Boolean(preview?.summary.canExport);

  return (
    <div className="appShell">
      <TitleBar
        activeId={resolvedId}
        activeModule={active}
        templateBusy={templateBusy}
        onOpenHome={() => selectModule("home")}
        onOpenPalette={() => setPaletteOpen(true)}
        onImportTemplate={() => void importTemplate()}
        onExportTemplate={() => void exportTemplate()}
      />

      <input
        ref={templateFileInputRef}
        type="file"
        accept=".xml,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          void handleWebTemplateFileChange(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <ToolTabBar
        modules={modules}
        openIds={validOpenIds}
        activeId={resolvedId}
        previewsById={previewsById}
        staleById={staleById}
        onSelectHome={() => selectModule("home")}
        onSelectTab={selectModule}
        onCloseTab={closeTab}
        onCloseOthers={closeOtherTabs}
        onOpenLauncher={() => setPaletteOpen(true)}
      />

      <div className="appBody">
        <main className="appWorkspace">
          {resolvedId === "home" ? (
            <ModuleGallery
              modules={modules}
              openIds={validOpenIds}
              templateBusy={templateBusy}
              onOpen={selectModule}
              onOpenPalette={() => setPaletteOpen(true)}
              onImportTemplate={() => void importTemplate()}
              onExportTemplate={() => void exportTemplate()}
            />
          ) : resolvedId === "multi-case" ? (
            <MultiCaseWorkspace
              singleModuleDrafts={drafts}
              onToast={pushToast}
            />
          ) : resolvedId === "tabular-load" ? (
            <TabularModule
              onToast={pushToast}
            />
          ) : (
            <div className="wbWorkspace">
              <header className="wbActionBar">
                <div className="wbActionBarTitle">
                  <h1>{active?.title ?? resolvedId}</h1>
                  {meta && <span className="wbSubTag">{meta.solTag} · 输出 {meta.outputExt}</span>}
                  {active && (
                    <span className={"statusPill " + active.status}>
                      {STATUS_LABELS[active.status] ?? active.status}
                    </span>
                  )}
                </div>

                <div className="wbActionBarButtons">
                  <button
                    type="button"
                    className="btnSecondary"
                    disabled={busy}
                    onClick={resetActiveDraft}
                    title="将该模块参数恢复为出厂默认值"
                  >
                    <ResetIcon size={14} /> 恢复默认
                  </button>
                  <button
                    type="button"
                    className={canExport && !previewStale ? "btnSecondary" : "btnPrimary"}
                    disabled={busy}
                    onClick={() => void runPreview()}
                    title="调用 Rust 求解器引擎校验参数并生成 Deck（快捷键 Ctrl+Enter）"
                  >
                    {busy ? <SpinnerIcon size={14} /> : <PlayCheckIcon size={14} />}
                    <span>{busy ? "校验中…" : previewStale ? "重新校验" : "校验 / 预览 Deck"}</span>
                  </button>
                  <button
                    type="button"
                    className={canExport && !previewStale ? "btnPrimary" : "btnSecondary"}
                    disabled={busy || !canExport}
                    onClick={() => void runExport()}
                  >
                    <DownloadIcon size={14} />
                    <span>{active?.solver === "radioss" ? "导出增量 .rad" : "导出增量 FEM"}</span>
                  </button>
                </div>
              </header>

              <div className="wbSplit">
                <div className="wbFormCol">
                  <WorkbenchForms
                    activeId={resolvedId}
                    draft={draft}
                    patch={patch}
                    psdBusy={psdBusy}
                    psdImport={psdImport}
                    gravityRowIndex={gravityRowIndex}
                    onSelectGravityRow={setGravityRowIndex}
                    onImportPsd={() => void importPsdSpectrum()}
                    onDownloadTemplate={(fmt) => void downloadPsdTemplate(fmt)}
                    onLoadSample={loadPsdSample}
                    onNotify={(message) => pushToast("info", message)}
                  />
                </div>

                <div className="wbInspectorCol">
                  <InspectorPane
                    activeId={resolvedId}
                    solver={active?.solver ?? "optistruct"}
                    draft={draft}
                    preview={preview}
                    stale={previewStale}
                    busy={busy}
                    tab={inspectorTab}
                    gravityRowIndex={gravityRowIndex}
                    onSelectGravityRow={setGravityRowIndex}
                    onTabChange={setActiveInspectorTab}
                    onValidate={() => void runPreview()}
                    onExport={() => void runExport()}
                    onCopyText={(text, label) => void handleCopyText(text, label)}
                  />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        modules={modules}
        activeId={resolvedId}
        openIds={validOpenIds}
        onClose={() => setPaletteOpen(false)}
        onSelectModule={selectModule}
        onCloseModule={closeTab}
        onValidate={isParametric ? () => void runPreview() : undefined}
        onImportTemplate={() => void importTemplate()}
        onExportTemplate={() => void exportTemplate()}
      />

      {toasts.length > 0 && (
        <div className="toastStack" aria-live="polite">
          {toasts.map((item) => (
            <div key={item.id} className={"toastItem " + item.tone}>
              <span className="toastMsg">{item.text}</span>
              <button
                type="button"
                className="iconTrashBtn"
                onClick={() => setToasts((list) => list.filter((t) => t.id !== item.id))}
                aria-label="关闭"
              >
                <XIcon size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
