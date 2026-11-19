import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import WorkbenchForms from "@/components/WorkbenchForms";
import ModulePreview from "@/modules/previews/ModulePreview";
import {
  buildCase,
  exportCaseFiles,
  isDesktop,
  openProject,
  previewCase,
  readPsdSpectrumFile,
  saveProject,
  writePsdTemplate,
  type BuildResultV2,
  type Diagnostic,
  type PreviewResult,
  type PsdImportResult,
} from "@/lib/caseApi";
import { parseClipboardTable } from "@/lib/loadDeckApi";
import { INITIAL_DRAFTS, PSD_SAMPLE_POINTS, type Draft } from "@/lib/caseDrafts";
import {
  MULTI_CASE_KINDS,
  MULTI_CASE_STORAGE_KEY,
  analyzeMultiCaseLocal,
  buildMultiCaseParameters,
  createMultiCaseItem,
  createTabularDraftFromRows,
  fromProjectDocument,
  getCaseDisplayName,
  multiCaseKindMeta,
  readStoredMultiCaseProject,
  readTabularWorkspaceFromStorage,
  syncDraftUnits,
  toProjectDocument,
  type EntityLink,
  type MultiCaseItem,
  type MultiCaseKind,
  type MultiCaseProject,
} from "@/lib/multiCase";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  FolderOpenIcon,
  LayersIcon,
  LinkIcon,
  ModuleGlyph,
  PlayCheckIcon,
  PlusIcon,
  SaveIcon,
  ShieldAlertIcon,
  SpinnerIcon,
  TrashIcon,
  ActivityIcon,
} from "@/components/Icons";

type ToastTone = "success" | "info" | "error";
type InspectorTab = "visual" | "audit" | "deck";

interface MultiCaseWorkspaceProps {
  singleModuleDrafts: Record<string, Draft>;
  onToast: (tone: ToastTone, text: string) => void;
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

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
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
    // Fallback below.
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

function DiagList({ items }: { items: Diagnostic[] }) {
  if (items.length === 0) return <p className="emptyMuted">校验通过，无错误或警告诊断。</p>;
  return (
    <ul className="diagList">
      {items.map((d, i) => (
        <li key={i} className={"diagItem " + d.severity}>
          <div className="diagHead">
            <span className="diagSev">{d.severity.toUpperCase()}</span>
            <code className="diagCode">{d.code}</code>
            {d.fieldPath && <span className="diagField">{d.fieldPath}</span>}
          </div>
          <p className="diagMsg">{d.message}</p>
          {d.hint && <small className="diagHint">{d.hint}</small>}
        </li>
      ))}
    </ul>
  );
}

export default function MultiCaseWorkspace({
  singleModuleDrafts,
  onToast,
}: MultiCaseWorkspaceProps) {
  const [project, setProject] = useState<MultiCaseProject>(readStoredMultiCaseProject);
  const [selectedId, setSelectedId] = useState<string>(() => project.cases[0]?.caseId ?? "");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("visual");
  const [deckView, setDeckView] = useState<"fem" | "manifest" | "points">("fem");
  const [gravityRowIndex, setGravityRowIndex] = useState(0);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [builtFiles, setBuiltFiles] = useState<Record<string, string> | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [psdBusy, setPsdBusy] = useState(false);
  const [psdImport, setPsdImport] = useState<PsdImportResult | null>(null);
  const [copiedLabel, setCopiedLabel] = useState("");
  const projectFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(MULTI_CASE_STORAGE_KEY, JSON.stringify(project));
      } catch {
        /* ignore */
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (!project.cases.some((c) => c.caseId === selectedId)) {
      setSelectedId(project.cases[0]?.caseId ?? "");
    }
  }, [project.cases, selectedId]);

  const activeItem = useMemo(
    () => project.cases.find((c) => c.caseId === selectedId) ?? project.cases[0] ?? null,
    [project.cases, selectedId],
  );

  const constraintCases = useMemo(
    () => project.cases.filter((c) => c.kind === "constraint"),
    [project.cases],
  );

  const loadCapableCases = useMemo(
    () =>
      project.cases.filter(
        (c) =>
          (c.kind === "nodal-static" && !c.draft.perRowSubcase) ||
          (c.kind === "gravity" && (!Array.isArray(c.draft.cases) || c.draft.cases.length <= 1)),
      ),
    [project.cases],
  );

  const localCompat = useMemo(() => analyzeMultiCaseLocal(project), [project]);

  const markDirty = useCallback(() => {
    if (preview) setStale(true);
  }, [preview]);

  const updateProject = useCallback(
    (updater: (prev: MultiCaseProject) => MultiCaseProject) => {
      setProject((prev) => updater(prev));
      markDirty();
    },
    [markDirty],
  );

  const changeModelUnits = useCallback(
    (nextUnits: "N-mm-s" | "N-m-s") => {
      updateProject((prev) => ({
        ...prev,
        modelUnits: nextUnits,
        cases: prev.cases.map((item) => ({
          ...item,
          draft: syncDraftUnits(item.kind, item.draft, nextUnits),
        })),
      }));
      onToast("info", `已将工程及全部工况单位制统一为 ${nextUnits}`);
    },
    [updateProject, onToast],
  );

  const addCase = useCallback(
    (kind: MultiCaseKind, overrideDraft?: Draft) => {
      const nextItem = createMultiCaseItem(kind, project.modelUnits, project.cases, overrideDraft);
      updateProject((prev) => ({
        ...prev,
        cases: [...prev.cases, nextItem],
      }));
      setSelectedId(nextItem.caseId);
      setAddMenuOpen(false);
      setImportMenuOpen(false);
    },
    [project.modelUnits, project.cases, updateProject],
  );

  const importFromSingleModule = useCallback(
    (kind: MultiCaseKind) => {
      if (kind === "tabular-load") {
        const snap = readTabularWorkspaceFromStorage();
        if (!snap || snap.rows.length === 0) {
          onToast("error", "「整车工况生成」标签页暂无已解析的表格行，请先在该标签页导入数据");
          setImportMenuOpen(false);
          return;
        }
        const draft = createTabularDraftFromRows(
          snap.rows,
          snap.caseAliases,
          snap.source,
          snap.exportPrefix || "Vehicle_Tabular",
        );
        addCase("tabular-load", draft);
        onToast("success", `已从整车工况表导入 ${snap.rows.length} 行数据`);
        return;
      }
      const sourceDraft = singleModuleDrafts[kind] ?? INITIAL_DRAFTS[kind];
      if (!sourceDraft) return;
      addCase(kind, sourceDraft);
      onToast("success", `已导入单模块「${multiCaseKindMeta(kind).title}」当前草稿`);
    },
    [singleModuleDrafts, addCase, onToast],
  );

  const updateItem = useCallback(
    (caseId: string, updater: (item: MultiCaseItem) => MultiCaseItem) => {
      updateProject((prev) => ({
        ...prev,
        cases: prev.cases.map((item) => (item.caseId === caseId ? updater(item) : item)),
      }));
    },
    [updateProject],
  );

  const patchActiveDraft = useCallback(
    (key: string, value: unknown) => {
      if (!activeItem) return;
      updateItem(activeItem.caseId, (item) => ({
        ...item,
        draft: { ...item.draft, [key]: value },
      }));
    },
    [activeItem, updateItem],
  );

  const duplicateItem = useCallback(
    (item: MultiCaseItem) => {
      const copy = createMultiCaseItem(item.kind, project.modelUnits, project.cases, item.draft);
      copy.enabled = item.enabled;
      copy.spcSource = item.spcSource ? { ...item.spcSource } : undefined;
      copy.loadSource = item.loadSource ? { ...item.loadSource } : undefined;
      updateProject((prev) => ({
        ...prev,
        cases: [...prev.cases, copy],
      }));
      setSelectedId(copy.caseId);
    },
    [project.modelUnits, project.cases, updateProject],
  );

  const removeItem = useCallback(
    (caseId: string) => {
      updateProject((prev) => ({
        ...prev,
        cases: prev.cases.filter((c) => c.caseId !== caseId),
      }));
    },
    [updateProject],
  );

  const moveItem = useCallback(
    (index: number, delta: -1 | 1) => {
      const target = index + delta;
      if (target < 0 || target >= project.cases.length) return;
      updateProject((prev) => {
        const next = [...prev.cases];
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved);
        return { ...prev, cases: next };
      });
    },
    [project.cases.length, updateProject],
  );

  const buildRequest = useCallback(
    () => ({
      projectName: project.projectName.trim() || "Full_Vehicle_FEM",
      case: {
        kind: "multi-case",
        parameters: buildMultiCaseParameters(project),
      },
    }),
    [project],
  );

  const runPreview = useCallback(async () => {
    if (!isDesktop()) {
      onToast("error", "联合 FEM 校验与生成由 Rust 桌面端完成，请使用 npm run tauri:dev 或桌面程序运行。");
      return;
    }
    setBusy(true);
    try {
      const req = buildRequest();
      const res = await previewCase(req);
      setPreview(res);
      setStale(false);
      if (res.summary.canExport) {
        const built: BuildResultV2 = await buildCase(req);
        setBuiltFiles(built.files);
        const warnCount = res.diagnostics.filter((d) => d.severity === "warning").length;
        onToast(
          "success",
          `联合 FEM 生成通过 · SOL ${res.summary.sol ?? 101} · ${res.summary.subcaseCount} 个子工况 · ${res.summary.lineCount} 行${warnCount ? `（${warnCount} 项警告）` : ""}`,
        );
        if (inspectorTab === "visual") setInspectorTab("deck");
      } else {
        setBuiltFiles(null);
        setInspectorTab("audit");
        const errCount = res.diagnostics.filter((d) => d.severity === "error").length;
        onToast("error", `联合校验未通过：${errCount} 项错误阻止导出`);
      }
    } catch (e) {
      onToast("error", "联合生成失败：" + messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [buildRequest, inspectorTab, onToast]);

  const runExport = useCallback(async () => {
    if (!isDesktop()) {
      onToast("error", "导出完整 FEM 由 Rust 桌面端完成，请在 Tauri 应用中运行。");
      return;
    }
    setBusy(true);
    try {
      const req = buildRequest();
      const fresh = !preview || stale ? await previewCase(req) : preview;
      setPreview(fresh);
      setStale(false);
      if (!fresh.summary.canExport) {
        setInspectorTab("audit");
        onToast("error", "存在阻止导出的兼容性或参数错误，请先修复诊断信息");
        return;
      }
      const built = await buildCase(req);
      setBuiltFiles(built.files);
      if (built.diagnostics.some((d) => d.severity === "error") || Object.keys(built.files).length === 0) {
        setInspectorTab("audit");
        onToast("error", "生成失败，请检查诊断列表");
        return;
      }
      const dir = await openDialog({
        directory: true,
        multiple: false,
        title: "选择完整 FEM 导出目录",
      });
      if (!dir) return;
      const written = await exportCaseFiles(dir, req.projectName, built.files);
      onToast("success", `已导出 ${written.length} 个文件至 ${dir}`);
    } catch (e) {
      onToast("error", "导出失败：" + messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [buildRequest, preview, stale, onToast]);

  const handleSaveProject = useCallback(async () => {
    const doc = toProjectDocument(project);
    const defaultName = `${project.projectName || "Full_Vehicle_FEM"}.lccase.json`;
    if (!isDesktop()) {
      downloadBlob(defaultName, JSON.stringify(doc, null, 2));
      onToast("success", "已下载工程文件 (.lccase.json)");
      return;
    }
    try {
      const path = await saveDialog({
        defaultPath: defaultName,
        filters: [{ name: "LoadCreator 多工况工程", extensions: ["lccase.json", "json"] }],
      });
      if (!path) return;
      const written = await saveProject(path, doc);
      onToast("success", `工程已保存：${written}`);
    } catch (e) {
      onToast("error", "保存工程失败：" + messageOf(e));
    }
  }, [project, onToast]);

  const applyOpenedProject = useCallback(
    (raw: unknown) => {
      try {
        const parsed = fromProjectDocument(raw);
        if (!parsed || parsed.cases.length === 0) {
          onToast("error", "无法识别工程文件格式或工程中无有效工况");
          return;
        }
        setProject(parsed);
        setSelectedId(parsed.cases[0].caseId);
        setPreview(null);
        setBuiltFiles(null);
        setStale(false);
        onToast("success", `已载入工程「${parsed.projectName}」（${parsed.cases.length} 个工况）`);
      } catch (e) {
        onToast("error", messageOf(e));
      }
    },
    [onToast],
  );

  const handleOpenProject = useCallback(async () => {
    if (!isDesktop()) {
      projectFileInputRef.current?.click();
      return;
    }
    try {
      const path = await openDialog({
        multiple: false,
        title: "打开 LoadCreator 多工况工程",
        filters: [{ name: "LoadCreator 工程", extensions: ["json"] }],
      });
      if (!path || Array.isArray(path)) return;
      const doc = await openProject(path);
      applyOpenedProject(doc);
    } catch (e) {
      onToast("error", "打开工程失败：" + messageOf(e));
    }
  }, [applyOpenedProject, onToast]);

  // PSD helpers for active random-psd case
  const importPsdForActive = useCallback(async () => {
    if (!activeItem || activeItem.kind !== "random-psd") return;
    if (!isDesktop()) {
      onToast("error", "PSD 谱文件导入需由桌面端读取文件。");
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
      updateItem(activeItem.caseId, (item) => ({
        ...item,
        draft: {
          ...item.draft,
          points: nextPoints,
          ...(res.interpolationGuess ? { interpolation: res.interpolationGuess } : {}),
        },
      }));
      setPsdImport(res);
      onToast("success", `已导入 ${res.points.length} 个 PSD 谱点`);
    } catch (e) {
      onToast("error", "导入 PSD 谱失败：" + messageOf(e));
    } finally {
      setPsdBusy(false);
    }
  }, [activeItem, updateItem, onToast]);

  const downloadPsdTemplate = useCallback(
    async (format: "csv" | "xlsx") => {
      const defaultName = format === "xlsx" ? "PSD_谱表模板.xlsx" : "PSD_谱表模板.csv";
      if (!isDesktop()) {
        if (format === "csv") {
          downloadBlob(defaultName, PSD_CSV_TEMPLATE, "text/csv;charset=utf-8");
          onToast("success", "已下载标准 CSV 模板");
        } else {
          onToast("error", "Excel (.xlsx) 模板生成需由桌面端执行。");
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
        onToast("success", `已保存标准模板：${written}`);
      } catch (e) {
        onToast("error", "保存模板失败：" + messageOf(e));
      }
    },
    [onToast],
  );

  const loadPsdSample = useCallback(() => {
    if (!activeItem || activeItem.kind !== "random-psd") return;
    updateItem(activeItem.caseId, (item) => ({
      ...item,
      draft: {
        ...item.draft,
        points: PSD_SAMPLE_POINTS.map((p) => ({ ...p })),
      },
    }));
    setPsdImport(null);
    onToast("info", `已载入标准 PSD 示例谱（${PSD_SAMPLE_POINTS.length} 点）`);
  }, [activeItem, updateItem, onToast]);

  // Tabular paste parser inside MultiCase
  const parseTabularSource = useCallback(async () => {
    if (!activeItem || activeItem.kind !== "tabular-load") return;
    const text = String(activeItem.draft.source ?? "");
    if (!text.trim()) {
      onToast("error", "请先粘贴来自 Excel / WPS 的载荷表文本");
      return;
    }
    if (!isDesktop()) {
      onToast("error", "表格解析由 Rust 桌面端完成，请在桌面端使用，或点击「从整车工况生成导入」。");
      return;
    }
    try {
      const res = await parseClipboardTable(text);
      updateItem(activeItem.caseId, (item) => ({
        ...item,
        draft: {
          ...item.draft,
          rows: res.rows,
        },
      }));
      onToast("success", `成功解析 ${res.rows.length} 行载荷数据`);
    } catch (e) {
      onToast("error", "解析失败：" + messageOf(e));
    }
  }, [activeItem, updateItem, onToast]);

  const syncFromTabularWorkspace = useCallback(() => {
    if (!activeItem || activeItem.kind !== "tabular-load") return;
    const snap = readTabularWorkspaceFromStorage();
    if (!snap || snap.rows.length === 0) {
      onToast("error", "「整车工况生成」标签页暂无已解析的数据行");
      return;
    }
    updateItem(activeItem.caseId, (item) => ({
      ...item,
      draft: {
        ...item.draft,
        projectName: snap.exportPrefix || item.draft.projectName || "Vehicle_Tabular",
        source: snap.source,
        rows: JSON.parse(JSON.stringify(snap.rows)),
        caseAliases: { ...snap.caseAliases },
      },
    }));
    onToast("success", `已同步整车工况表（${snap.rows.length} 行）`);
  }, [activeItem, updateItem, onToast]);

  // Ctrl+Enter triggers full FEM preview
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void runPreview();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runPreview]);

  const describeLink = useCallback(
    (link: EntityLink | undefined, fallbackLabel: string): string => {
      if (!link || link.kind === "none") return fallbackLabel;
      if (link.kind === "external") return `外部 ID ${link.id || "未填"}`;
      const target = project.cases.find((c) => c.caseId === link.caseId);
      return target ? `工程工况 · ${getCaseDisplayName(target)}` : "引用目标缺失";
    },
    [project.cases],
  );

  const canExport = Boolean(preview?.summary.canExport);
  const errorCount = preview?.diagnostics.filter((d) => d.severity === "error").length ?? 0;
  const warnCount = preview?.diagnostics.filter((d) => d.severity === "warning").length ?? 0;

  const manifestText = useMemo(() => {
    if (!builtFiles) return "";
    const key = Object.keys(builtFiles).find((k) => k.endsWith(".manifest.json"));
    return key ? builtFiles[key] : "";
  }, [builtFiles]);

  const pointsJsonText = useMemo(() => {
    if (!builtFiles) return "";
    const key = Object.keys(builtFiles).find((k) => k.endsWith("_points.json"));
    return key ? builtFiles[key] : "";
  }, [builtFiles]);

  const codeText =
    deckView === "manifest"
      ? manifestText
      : deckView === "points"
        ? pointsJsonText
        : preview?.femPreview ?? "";
  const codeLines = useMemo(() => (codeText ? codeText.split(/\r?\n/) : []), [codeText]);

  const copyCode = useCallback(
    async (text: string, label: string) => {
      try {
        await writeClipboard(text);
        setCopiedLabel(label);
        onToast("success", `${label}已复制到剪贴板`);
        window.setTimeout(() => setCopiedLabel(""), 1800);
      } catch (e) {
        onToast("error", "复制失败：" + messageOf(e));
      }
    },
    [onToast],
  );

  let statusTone = "idle";
  let statusText = `尚未校验 · 预计 SOL ${localCompat.expectedSol}（${localCompat.enabledCount} 个启用工况）`;
  if (preview) {
    if (stale) {
      statusTone = "stale";
      statusText = "参数或协同关系已变更 · 请重新校验生成";
    } else if (preview.summary.canExport) {
      statusTone = "pass";
      statusText = `校验通过 · SOL ${preview.summary.sol ?? 101} · ${preview.summary.subcaseCount} 子工况 · ${preview.summary.lineCount} 行`;
    } else {
      statusTone = "error";
      statusText = `阻止导出 · ${errorCount} 项错误${warnCount ? ` · ${warnCount} 项警告` : ""}`;
    }
  }

  return (
    <div className="wbWorkspace mcWorkspace">
      <input
        ref={projectFileInputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            file.text().then((txt) => applyOpenedProject(JSON.parse(txt))).catch((err) => onToast("error", messageOf(err)));
          }
          e.target.value = "";
        }}
      />

      <header className="wbActionBar mcActionBar">
        <div className="mcHeaderLeft">
          <div className="mcTitleBadge">
            <LayersIcon size={16} />
            <h1>多工况联合建模</h1>
          </div>
          <label className="mcInlineField">
            <span>工程名称</span>
            <input
              className="wbInput mono mcProjInput"
              value={project.projectName}
              onChange={(e) => updateProject((p) => ({ ...p, projectName: e.target.value }))}
              placeholder="Full_Vehicle_FEM"
            />
          </label>
          <div className="mcInlineField">
            <span>统一单位制</span>
            <div className="segControl" role="group" aria-label="工程统一单位制">
              {(["N-mm-s", "N-m-s"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  className={"segBtn" + (project.modelUnits === u ? " active" : "")}
                  onClick={() => changeModelUnits(u)}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <span className="wbSubTag" title="多工况组装严格限定在同一个求解器内，严禁混入 Radioss 等其他求解器工况">
            同求解器锁定：OptiStruct 2022 · 预计 SOL {localCompat.expectedSol}
          </span>
        </div>

        <div className="wbActionBarButtons">
          <button type="button" className="btnSecondary" onClick={() => void handleOpenProject()}>
            <FolderOpenIcon size={14} /> 打开工程
          </button>
          <button type="button" className="btnSecondary" onClick={() => void handleSaveProject()}>
            <SaveIcon size={14} /> 保存工程
          </button>
          <button
            type="button"
            className={canExport && !stale ? "btnSecondary" : "btnPrimary"}
            disabled={busy}
            onClick={() => void runPreview()}
            title="校验全部工况兼容性并生成完整 FEM（Ctrl+Enter）"
          >
            {busy ? <SpinnerIcon size={14} /> : <PlayCheckIcon size={14} />}
            <span>{busy ? "生成中…" : stale ? "重新生成完整 FEM" : "校验并生成 FEM"}</span>
          </button>
          <button
            type="button"
            className={canExport && !stale ? "btnPrimary" : "btnSecondary"}
            disabled={busy || !canExport}
            onClick={() => void runExport()}
          >
            <DownloadIcon size={14} /> 导出完整 FEM
          </button>
        </div>
      </header>

      <div className="mcBody">
        {/* Column 1: Case list */}
        <aside className="mcSidebar" aria-label="工程工况清单">
          <div className="mcSidebarHead">
            <div>
              <h2>工况清单</h2>
              <small>启用 {localCompat.enabledCount} / 共 {project.cases.length} 项</small>
            </div>
            <div className="mcSidebarBtns">
              <div className="mcMenuWrap">
                <button
                  type="button"
                  className="btnMini primary"
                  onClick={() => { setAddMenuOpen((v) => !v); setImportMenuOpen(false); }}
                >
                  <PlusIcon size={13} /> 添加工况
                </button>
                {addMenuOpen && (
                  <div className="mcDropdown" role="menu">
                    <div className="mcDropdownHead">选择 OptiStruct 2022 工况类型</div>
                    {MULTI_CASE_KINDS.map((k) => (
                      <button
                        key={k.kind}
                        type="button"
                        className="mcDropdownItem"
                        onClick={() => addCase(k.kind)}
                      >
                        <div className="mcDropdownRow">
                          <ModuleGlyph id={k.kind} size={14} />
                          <b>{k.title}</b>
                          <span className="mcKindTag">{k.badge}</span>
                        </div>
                        <small>{k.hint}</small>
                      </button>
                    ))}
                    <div className="mcDropdownFoot">
                      注：Radioss (.rad) 为显式求解器独立格式，不混入 OptiStruct .fem 模型。
                    </div>
                  </div>
                )}
              </div>

              <div className="mcMenuWrap">
                <button
                  type="button"
                  className="btnMini"
                  onClick={() => { setImportMenuOpen((v) => !v); setAddMenuOpen(false); }}
                  title="从单模块标签页当前编辑的参数草稿导入"
                >
                  导入草稿
                </button>
                {importMenuOpen && (
                  <div className="mcDropdown" role="menu">
                    <div className="mcDropdownHead">从单模块工作区导入当前草稿</div>
                    {MULTI_CASE_KINDS.map((k) => (
                      <button
                        key={k.kind}
                        type="button"
                        className="mcDropdownItem"
                        onClick={() => importFromSingleModule(k.kind)}
                      >
                        <div className="mcDropdownRow">
                          <ModuleGlyph id={k.kind} size={14} />
                          <b>{k.title}</b>
                          <span className="mcKindTag">{k.badge}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mcCaseList">
            {project.cases.map((item, idx) => {
              const meta = multiCaseKindMeta(item.kind);
              const isSelected = activeItem?.caseId === item.caseId;
              const name = getCaseDisplayName(item);
              const hasIssue = localCompat.issues.some((iss) => iss.caseId === item.caseId && iss.severity === "error");
              const spcLabel =
                meta.needsSpc !== "none" ? describeLink(item.spcSource, "无约束") : null;

              return (
                <div
                  key={item.caseId}
                  className={
                    "mcCaseCard" +
                    (isSelected ? " active" : "") +
                    (!item.enabled ? " disabled" : "") +
                    (hasIssue ? " hasError" : "")
                  }
                  onClick={() => {
                    setSelectedId(item.caseId);
                    setAddMenuOpen(false);
                    setImportMenuOpen(false);
                  }}
                >
                  <div className="mcCaseCardTop">
                    <label
                      className="mcEnableCheck"
                      title={item.enabled ? "禁用此工况（暂不输出到 FEM）" : "启用此工况"}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(e) => updateItem(item.caseId, (cur) => ({ ...cur, enabled: e.target.checked }))}
                      />
                    </label>
                    <span className={"mcKindBadge kind-" + item.kind}>{meta.badge}</span>
                    <b className="mcCaseName" title={name}>{name}</b>
                  </div>

                  <div className="mcCaseMeta">
                    {spcLabel ? (
                      <span className="mcLinkPill">
                        <LinkIcon size={11} /> {spcLabel}
                      </span>
                    ) : (
                      <span className="mcLinkPill muted">
                        {item.kind === "constraint" ? "可被工程内其他工况引用" : meta.title}
                      </span>
                    )}
                  </div>

                  <div className="mcCaseActions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="iconTrashBtn"
                      title="上移"
                      disabled={idx === 0}
                      onClick={() => moveItem(idx, -1)}
                    >
                      <ArrowUpIcon size={12} />
                    </button>
                    <button
                      type="button"
                      className="iconTrashBtn"
                      title="下移"
                      disabled={idx === project.cases.length - 1}
                      onClick={() => moveItem(idx, 1)}
                    >
                      <ArrowDownIcon size={12} />
                    </button>
                    <button
                      type="button"
                      className="iconTrashBtn"
                      title="复制工况"
                      onClick={() => duplicateItem(item)}
                    >
                      <CopyIcon size={12} />
                    </button>
                    <button
                      type="button"
                      className="iconTrashBtn"
                      title="删除工况"
                      onClick={() => removeItem(item.caseId)}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                </div>
              );
            })}

            {project.cases.length === 0 && (
              <div className="mcEmptyList">
                <p>尚未添加任何工况</p>
                <button type="button" className="btnSecondary" onClick={() => addCase("constraint")}>
                  <PlusIcon size={14} /> 添加位移约束起步
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Column 2: Active Case Editor */}
        <section className="wbFormCol mcEditorCol" aria-label="当前工况参数编辑">
          {activeItem ? (
            <>
              <div className="mcLinkBanner">
                <div className="mcLinkBannerHead">
                  <div className="mcLinkBannerTitle">
                    <LinkIcon size={14} />
                    <b>跨工况协同与兼容配置</b>
                    <span className="mcUnitSyncPill">单位已统一：{project.modelUnits}</span>
                  </div>
                  {!activeItem.enabled && <span className="mcDisabledTag">当前工况已禁用（不参与生成）</span>}
                </div>

                {multiCaseKindMeta(activeItem.kind).needsSpc !== "none" && (
                  <div className="mcLinkRow">
                    <span className="mcLinkLabel">SPC 约束来源</span>
                    <div className="mcLinkControls">
                      <div className="segControl" role="group">
                        <button
                          type="button"
                          className={"segBtn" + (activeItem.spcSource?.kind === "case" ? " active" : "")}
                          onClick={() => {
                            const target = constraintCases.find((c) => c.enabled) ?? constraintCases[0];
                            if (!target) {
                              onToast("info", "工程中暂无约束工况，请先添加一个「位移约束」工况");
                              return;
                            }
                            updateItem(activeItem.caseId, (cur) => ({
                              ...cur,
                              spcSource: { kind: "case", caseId: target.caseId },
                            }));
                          }}
                        >
                          引用工程约束
                        </button>
                        <button
                          type="button"
                          className={"segBtn" + (activeItem.spcSource?.kind === "external" ? " active" : "")}
                          onClick={() => {
                            const fallback = parseInt(String(activeItem.draft.existingSpcSetId ?? ""), 10) || 900001;
                            updateItem(activeItem.caseId, (cur) => ({
                              ...cur,
                              spcSource: { kind: "external", id: fallback },
                            }));
                          }}
                        >
                          外部 SPC ID
                        </button>
                        {multiCaseKindMeta(activeItem.kind).needsSpc === "optional" && (
                          <button
                            type="button"
                            className={"segBtn" + (!activeItem.spcSource || activeItem.spcSource.kind === "none" ? " active" : "")}
                            onClick={() =>
                              updateItem(activeItem.caseId, (cur) => ({
                                ...cur,
                                spcSource: { kind: "none" },
                              }))
                            }
                          >
                            无约束
                          </button>
                        )}
                      </div>

                      {activeItem.spcSource?.kind === "case" && (
                        <select
                          className="wbInput mcLinkSelect"
                          value={activeItem.spcSource.caseId}
                          onChange={(e) =>
                            updateItem(activeItem.caseId, (cur) => ({
                              ...cur,
                              spcSource: { kind: "case", caseId: e.target.value },
                            }))
                          }
                        >
                          {constraintCases.map((c) => (
                            <option key={c.caseId} value={c.caseId}>
                              {getCaseDisplayName(c)}
                              {!c.enabled ? " (已禁用)" : ""}
                            </option>
                          ))}
                        </select>
                      )}

                      {activeItem.spcSource?.kind === "external" && (
                        <input
                          className="wbInput mono mcLinkIdInput"
                          value={activeItem.spcSource.id || ""}
                          placeholder="如 900001"
                          onChange={(e) => {
                            const id = parseInt(e.target.value.trim(), 10);
                            updateItem(activeItem.caseId, (cur) => ({
                              ...cur,
                              spcSource: { kind: "external", id: Number.isFinite(id) ? id : 0 },
                            }));
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}

                {multiCaseKindMeta(activeItem.kind).supportsLoadLink && (
                  <div className="mcLinkRow">
                    <span className="mcLinkLabel">载荷 LOAD 来源</span>
                    <div className="mcLinkControls">
                      <div className="segControl" role="group">
                        <button
                          type="button"
                          className={"segBtn" + (activeItem.loadSource?.kind === "case" ? " active" : "")}
                          onClick={() => {
                            const target = loadCapableCases.find((c) => c.enabled) ?? loadCapableCases[0];
                            if (!target) {
                              onToast("info", "工程中暂无可用的单载荷静力/重力工况");
                              return;
                            }
                            updateItem(activeItem.caseId, (cur) => ({
                              ...cur,
                              loadSource: { kind: "case", caseId: target.caseId },
                            }));
                          }}
                        >
                          引用工程载荷
                        </button>
                        <button
                          type="button"
                          className={"segBtn" + (activeItem.loadSource?.kind === "external" ? " active" : "")}
                          onClick={() => {
                            const fallback = parseInt(String(activeItem.draft.loadId ?? ""), 10) || 100001;
                            updateItem(activeItem.caseId, (cur) => ({
                              ...cur,
                              loadSource: { kind: "external", id: fallback },
                            }));
                          }}
                        >
                          外部 Load ID
                        </button>
                        <button
                          type="button"
                          className={"segBtn" + (!activeItem.loadSource || activeItem.loadSource.kind === "none" ? " active" : "")}
                          onClick={() =>
                            updateItem(activeItem.caseId, (cur) => ({
                              ...cur,
                              loadSource: { kind: "none" },
                            }))
                          }
                        >
                          不引用
                        </button>
                      </div>

                      {activeItem.loadSource?.kind === "case" && (
                        <select
                          className="wbInput mcLinkSelect"
                          value={activeItem.loadSource.caseId}
                          onChange={(e) =>
                            updateItem(activeItem.caseId, (cur) => ({
                              ...cur,
                              loadSource: { kind: "case", caseId: e.target.value },
                            }))
                          }
                        >
                          {loadCapableCases.map((c) => (
                            <option key={c.caseId} value={c.caseId}>
                              {getCaseDisplayName(c)}
                              {!c.enabled ? " (已禁用)" : ""}
                            </option>
                          ))}
                        </select>
                      )}

                      {activeItem.loadSource?.kind === "external" && (
                        <input
                          className="wbInput mono mcLinkIdInput"
                          value={activeItem.loadSource.id || ""}
                          placeholder="如 100001"
                          onChange={(e) => {
                            const id = parseInt(e.target.value.trim(), 10);
                            updateItem(activeItem.caseId, (cur) => ({
                              ...cur,
                              loadSource: { kind: "external", id: Number.isFinite(id) ? id : 0 },
                            }));
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {activeItem.kind === "tabular-load" ? (
                <TabularSubEditor
                  draft={activeItem.draft}
                  patch={patchActiveDraft}
                  onSyncFromTab={syncFromTabularWorkspace}
                  onParseSource={() => void parseTabularSource()}
                />
              ) : (
                <WorkbenchForms
                  activeId={activeItem.kind}
                  draft={activeItem.draft}
                  patch={patchActiveDraft}
                  psdBusy={psdBusy}
                  psdImport={psdImport}
                  gravityRowIndex={gravityRowIndex}
                  onSelectGravityRow={setGravityRowIndex}
                  onImportPsd={() => void importPsdForActive()}
                  onDownloadTemplate={(fmt) => void downloadPsdTemplate(fmt)}
                  onLoadSample={loadPsdSample}
                  multiCaseContext={{
                    modelUnits: project.modelUnits,
                    spcSummary: describeLink(activeItem.spcSource, "无约束"),
                    loadSummary: describeLink(activeItem.loadSource, "不引用"),
                  }}
                />
              )}
            </>
          ) : (
            <div className="livePreviewPlaceholder">请在左侧添加或选择一个工况进行编辑。</div>
          )}
        </section>

        {/* Column 3: Unified Inspector */}
        <aside className="wbInspectorCol inspectorPane" aria-label="联合模型检视器">
          <div className={"inspectorStatus " + statusTone}>
            <div className="inspectorStatusLeft">
              <span className="statusDot" />
              <span>{statusText}</span>
            </div>
            <div className="inspectorStatusActions">
              <button type="button" className="btnXs" disabled={busy} onClick={() => void runPreview()}>
                {busy ? "生成中…" : preview && !stale ? "重新校验" : "生成预览"}
              </button>
              {canExport && !stale && (
                <button type="button" className="btnXs primary" disabled={busy} onClick={() => void runExport()}>
                  <DownloadIcon size={12} /> 导出
                </button>
              )}
            </div>
          </div>

          <div className="inspectorTabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === "visual"}
              className={"inspectorTab" + (inspectorTab === "visual" ? " active" : "")}
              onClick={() => setInspectorTab("visual")}
            >
              <ActivityIcon size={14} />
              <span>兼容拓扑与预览</span>
              {localCompat.issues.some((i) => i.severity === "error") && (
                <span className="tabCounter err">
                  {localCompat.issues.filter((i) => i.severity === "error").length} 错
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === "audit"}
              className={"inspectorTab" + (inspectorTab === "audit" ? " active" : "")}
              onClick={() => setInspectorTab("audit")}
            >
              <ShieldAlertIcon size={14} />
              <span>诊断与全局台账</span>
              {preview && (
                <span className={"tabCounter " + (errorCount > 0 ? "err" : warnCount > 0 ? "warn" : "ok")}>
                  {errorCount > 0 ? `${errorCount} 错` : warnCount > 0 ? `${warnCount} 警` : "PASS"}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === "deck"}
              className={"inspectorTab" + (inspectorTab === "deck" ? " active" : "")}
              onClick={() => setInspectorTab("deck")}
            >
              <CodeIcon size={14} />
              <span>完整 FEM 预览</span>
              {preview?.summary.lineCount ? <span className="tabCounter">{preview.summary.lineCount} 行</span> : null}
            </button>
          </div>

          <div className="inspectorBody">
            {inspectorTab === "visual" && (
              <div className="inspectorVisual">
                <div className="vizCard">
                  <div className="vizCardHead">
                    <span>多工况协同兼容摘要</span>
                    <small>SOL {localCompat.expectedSol} · {project.modelUnits}</small>
                  </div>
                  <div className="mcCompatStats">
                    <div className="liveStat"><span>启用工况</span><b>{localCompat.enabledCount} 项</b></div>
                    <div className="liveStat"><span>目标求解</span><b>SOL {localCompat.expectedSol}</b></div>
                    <div className="liveStat">
                      <span>约束关联</span>
                      <b>{localCompat.constraintLinks.length} 组</b>
                    </div>
                  </div>
                  {localCompat.constraintLinks.length > 0 && (
                    <ul className="mcLinkAuditList">
                      {localCompat.constraintLinks.map((lnk) => (
                        <li key={lnk.fromId} className={lnk.ok ? "ok" : "err"}>
                          <span>{lnk.fromName}</span>
                          <span>→</span>
                          <b>{lnk.targetLabel}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                  {localCompat.issues.length > 0 ? (
                    <ul className="mcIssueMiniList">
                      {localCompat.issues.map((iss, idx) => (
                        <li key={idx} className={iss.severity}>{iss.message}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mcCompatOkNote">前置兼容性检查通过：单位制统一、引用关系完整。</p>
                  )}
                </div>

                {activeItem && activeItem.kind !== "tabular-load" && (
                  <ModulePreview
                    activeId={activeItem.kind}
                    draft={{ ...activeItem.draft, modelUnits: project.modelUnits }}
                    gravityRowIndex={gravityRowIndex}
                    onSelectGravityRow={setGravityRowIndex}
                  />
                )}
              </div>
            )}

            {inspectorTab === "audit" && (
              <div className="inspectorAudit">
                {!preview ? (
                  <div className="auditEmptyCallout">
                    <ShieldAlertIcon size={24} />
                    <h3>尚未运行联合求解器校验</h3>
                    <p>点击「校验并生成 FEM」（快捷键 Ctrl+Enter），Rust 后端将统一分配全球唯一 ID 并执行全量跨工况兼容性校验。</p>
                    <button type="button" className="btnPrimary" disabled={busy} onClick={() => void runPreview()}>
                      <PlayCheckIcon size={14} /> 立即校验并生成
                    </button>
                  </div>
                ) : (
                  <>
                    <section className="auditBlock">
                      <h4>联合诊断信息 ({preview.diagnostics.length})</h4>
                      <DiagList items={preview.diagnostics} />
                    </section>

                    <section className="auditBlock">
                      <div className="auditBlockHead">
                        <h4>全局外部实体引用台账 ({preview.externalReferences.length})</h4>
                        <span className="unverifiedPill">UNVERIFIED_EXTERNAL</span>
                      </div>
                      {preview.externalReferences.length === 0 ? (
                        <p className="emptyMuted">无外部未验证引用。</p>
                      ) : (
                        <table className="auditTable">
                          <thead>
                            <tr><th>实体类型</th><th>ID</th><th>来源工况</th><th>说明</th></tr>
                          </thead>
                          <tbody>
                            {preview.externalReferences.map((r, i) => (
                              <tr key={i}>
                                <td><code>{r.kind}</code></td>
                                <td className="mono">{r.id}</td>
                                <td>{r.usedBy}</td>
                                <td>{r.label ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </section>

                    <section className="auditBlock">
                      <h4>全局自动编号台账（零冲突验证 · {preview.idPlan.length} 项）</h4>
                      {preview.idPlan.length === 0 ? (
                        <p className="emptyMuted">未分配内部 ID。</p>
                      ) : (
                        <table className="auditTable">
                          <thead>
                            <tr><th>家族</th><th>逻辑键</th><th>分配 ID</th></tr>
                          </thead>
                          <tbody>
                            {preview.idPlan.map((p, i) => (
                              <tr key={i}>
                                <td><code>{p.kind}</code></td>
                                <td className="mono keyCell">{p.key}</td>
                                <td className="mono"><b>{p.id}</b></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </section>
                  </>
                )}
              </div>
            )}

            {inspectorTab === "deck" && (
              <div className="inspectorDeck">
                {!preview || !preview.femPreview ? (
                  <div className="auditEmptyCallout">
                    <CodeIcon size={24} />
                    <h3>{preview ? "校验未通过，未生成完整 FEM" : "尚未生成完整 FEM"}</h3>
                    <p>通过联合校验后可在此处实时检视完整 `.fem` 文件、`.manifest.json` 及伴随点位 `_points.json`。</p>
                    <button type="button" className="btnPrimary" disabled={busy} onClick={() => void runPreview()}>
                      <PlayCheckIcon size={14} /> 生成完整 FEM 预览
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="deckToolbar">
                      <div className="segControl" role="group">
                        <button
                          type="button"
                          className={"segBtn" + (deckView === "fem" ? " active" : "")}
                          onClick={() => setDeckView("fem")}
                        >
                          完整 .fem ({preview.summary.lineCount} 行)
                        </button>
                        <button
                          type="button"
                          className={"segBtn" + (deckView === "manifest" ? " active" : "")}
                          onClick={() => setDeckView("manifest")}
                          disabled={!manifestText}
                        >
                          .manifest.json
                        </button>
                        {pointsJsonText && (
                          <button
                            type="button"
                            className={"segBtn" + (deckView === "points" ? " active" : "")}
                            onClick={() => setDeckView("points")}
                          >
                            _points.json
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btnXs"
                        onClick={() => void copyCode(codeText, deckView === "fem" ? "完整 FEM" : deckView === "manifest" ? "Manifest JSON" : "点位 JSON")}
                      >
                        {copiedLabel ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                        {copiedLabel ? "已复制" : "复制"}
                      </button>
                    </div>

                    <div className="deckSummaryStrip">
                      {preview.summary.sol !== undefined && <span>SOL {preview.summary.sol}</span>}
                      <span>{preview.summary.subcaseCount} SUBCASE</span>
                      {Object.entries(preview.summary.cardCounts).map(([card, count]) => (
                        <span key={card}>{card} × {count}</span>
                      ))}
                    </div>

                    <div className="codeBox">
                      <ol className="codeLines">
                        {codeLines.map((line, i) => (
                          <li key={i}>
                            <span className="lineNum">{i + 1}</span>
                            <span className={line.startsWith("$") ? "lineTxt comment" : "lineTxt"}>{line || " "}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function TabularSubEditor({
  draft,
  patch,
  onSyncFromTab,
  onParseSource,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
  onSyncFromTab: () => void;
  onParseSource: () => void;
}) {
  const rows = (Array.isArray(draft.rows) ? draft.rows : []) as Array<Record<string, unknown>>;
  const uniqueCases = useMemo(
    () => [...new Set(rows.map((r) => String(r.caseName || "Load Case 1")))],
    [rows],
  );
  const uniquePoints = useMemo(
    () => [...new Set(rows.map((r) => String(r.displayName || r.pointName || "")).filter(Boolean))],
    [rows],
  );

  return (
    <>
      <section className="formSection">
        <header className="formSectionHead">
          <div className="formSectionTitleWrap">
            <span className="formSectionStep">01</span>
            <div>
              <h3>整车工况表导入与同步</h3>
              <p>可直接从「整车工况生成」标签页一键同步已校对表格，或在此粘贴 Excel / WPS 原文解析；导出时自动附带 _points.json</p>
            </div>
          </div>
          <div className="formSectionActions">
            <button type="button" className="btnMini primary" onClick={onSyncFromTab}>
              从「整车工况生成」同步表格
            </button>
          </div>
        </header>
        <div className="formSectionBody">
          <div className="formGrid2" style={{ marginBottom: 12 }}>
            <label className="wbField">
              <span className="wbFieldLabel"><span>点位表工程标识</span></span>
              <input
                className="wbInput"
                value={String(draft.projectName ?? "")}
                onChange={(e) => patch("projectName", e.target.value)}
                placeholder="Vehicle_Tabular"
              />
            </label>
            <div className="mcTabStats">
              <div className="liveStat"><span>载荷行</span><b>{rows.length} 条</b></div>
              <div className="liveStat"><span>工况数</span><b>{uniqueCases.length} 个</b></div>
              <div className="liveStat"><span>归并点位</span><b>{uniquePoints.length} 点</b></div>
            </div>
          </div>

          <label className="wbField">
            <span className="wbFieldLabel">
              <span>粘贴载荷表原文（Tab / 逗号分隔）</span>
              <button type="button" className="textLinkBtn" onClick={onParseSource}>
                解析下方文本 →
              </button>
            </span>
            <textarea
              className="wbInput mono mcTabularPaste"
              rows={5}
              value={String(draft.source ?? "")}
              onChange={(e) => patch("source", e.target.value)}
              placeholder="从 Excel / WPS 复制整车载荷表后粘贴至此处，点击右上角「解析下方文本」或直接点击「从整车工况生成同步表格」"
            />
          </label>
        </div>
      </section>

      <section className="formSection">
        <header className="formSectionHead">
          <div className="formSectionTitleWrap">
            <span className="formSectionStep">02</span>
            <div>
              <h3>已载入载荷行预览（前 30 条）</h3>
              <p>所有节点编号（1001 起）与点位坐标将生成至伴随 _points.json，并与其余工况共享全局 SUBCASE / LOAD 编号规划</p>
            </div>
          </div>
        </header>
        <div className="formSectionBody">
          {rows.length === 0 ? (
            <p className="emptyMuted">尚无已解析数据行。请点击「从整车工况生成同步表格」或粘贴表格文本后解析。</p>
          ) : (
            <div className="compactTableWrap">
              <table className="compactTable">
                <thead>
                  <tr>
                    <th>工况名</th>
                    <th>中文点位</th>
                    <th>英文点位</th>
                    <th>FX</th>
                    <th>FY</th>
                    <th>FZ</th>
                    <th>TX</th>
                    <th>TY</th>
                    <th>TZ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 30).map((r, i) => (
                    <tr key={i}>
                      <td>{String(r.caseName ?? "")}</td>
                      <td>{String(r.displayName ?? "")}</td>
                      <td className="mono">{String(r.pointName ?? "")}</td>
                      <td className="mono">{String(r.fx ?? 0)}</td>
                      <td className="mono">{String(r.fy ?? 0)}</td>
                      <td className="mono">{String(r.fz ?? 0)}</td>
                      <td className="mono">{String(r.tx ?? 0)}</td>
                      <td className="mono">{String(r.ty ?? 0)}</td>
                      <td className="mono">{String(r.tz ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
