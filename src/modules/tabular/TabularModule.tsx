import { useCallback, useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { buildLoadDeck, exportLoadBundle, exportOutputFile, isDesktop, parseClipboardTable } from "@/lib/loadDeckApi";
import { duplicateJsonKeys, parsePointsJson, serializePointsJson } from "@/lib/pointsJson";
import { DEFAULT_MAPPING_RULES, aliasConflicts, mappingIssues, suggestCaseAlias, type MappingRule } from "@/lib/caseMapping";
import NumericInput from "@/components/NumericInput";
import {
  ArrowRightIcon,
  CheckIcon,
  ClipboardIcon,
  CopyIcon,
  DownloadIcon,
  HashIcon,
  LayersIcon,
  NodeIcon,
  PlusIcon,
  ResetIcon,
  SaveIcon,
  SearchIcon,
  SpinnerIcon,
  TableIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from "@/components/Icons";
import type { BuildResult, LoadRow, PointJsonEntry } from "@/types/loadDeck";

type View = "data" | "points" | "export";
type ToastTone = "success" | "info" | "error";
interface Toast { id: number; tone: ToastTone; text: string; }
type NumericKey = "x" | "y" | "z" | "fx" | "fy" | "fz" | "tx" | "ty" | "tz";

const SAMPLE = "case1_braking\nGroup\tX\tY\tZ\tEnglish Name\t中文名称\tTime\tFX\tFY\tFZ\tTX\tTY\tTZ\nfront\t1550\t0\t-210\tfrontsusp_a\t前悬架连接点\t7\t-385\t-4150\t35600\t0\t0\t0\nfront\t0\t-800\t200\tfront_bumper_left\t前保险杠左侧\t7\t0\t0\t0\t0\t0\t0\nrear\t4882\t-475\t90\tmid_yrod\t中横推杆连接点\t7\t26100\t-175000\t14900\t0\t0\t0";
const STORAGE_KEY = "loaddeck.workspace.v1";
const MAPPING_STORAGE_KEY = "loaddeck.case-mappings.v1";
const NUMERIC_KEYS: NumericKey[] = ["x", "y", "z", "fx", "fy", "fz", "tx", "ty", "tz"];
const TABLE_HEADERS = ["工况 / Load Step", "中文点位名（归并索引）", "英文点位名（JSON）", "X", "Y", "Z", "FX", "FY", "FZ", "TX", "TY", "TZ"];

const VIEWS: Array<{ id: View; num: string; label: string; hint: string }> = [
  { id: "data", num: "01", label: "数据导入与校对", hint: "粘贴 / 编辑载荷与工况命名" },
  { id: "points", num: "02", label: "点位与节点", hint: "坐标、JSON 与节点号" },
  { id: "export", num: "03", label: "生成与导出", hint: "FEM 与点位 JSON" },
];

function messageOf(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the legacy textarea + execCommand path.
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("系统剪贴板不可用");
}

function loadMappingRules(): MappingRule[] {
  try {
    const stored = localStorage.getItem(MAPPING_STORAGE_KEY);
    const data = stored ? (JSON.parse(stored) as MappingRule[]) : null;
    if (Array.isArray(data)) return data;
  } catch {
    localStorage.removeItem(MAPPING_STORAGE_KEY);
  }
  return DEFAULT_MAPPING_RULES.map((rule) => ({ ...rule }));
}

export default function TabularModule({ projectName, onProjectChange, onBack }: { projectName: string; onProjectChange: (value: string) => void; onBack?: () => void }) {
  const [view, setView] = useState<View>("data");
  const [showSource, setShowSource] = useState(true);
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<LoadRow[]>([]);
  const [caseAliases, setCaseAliases] = useState<Record<string, string>>({});
  const [mappingRules, setMappingRules] = useState<MappingRule[]>(loadMappingRules);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [jsonEntries, setJsonEntries] = useState<PointJsonEntry[]>([]);
  const [buildSeq, setBuildSeq] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [rowQuery, setRowQuery] = useState("");
  const [pointQuery, setPointQuery] = useState("");

  const toast = useCallback((tone: ToastTone, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, tone, text }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 4200);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      const data = JSON.parse(stored) as { projectName?: string; source?: string; rows?: LoadRow[]; caseAliases?: Record<string, string> };
      if (data.projectName) onProjectChange(data.projectName);
      if (typeof data.source === "string") setSource(data.source);
      if (Array.isArray(data.rows)) setRows(data.rows);
      if (data.caseAliases) setCaseAliases(data.caseAliases);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectName, source, rows, caseAliases })),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [projectName, source, rows, caseAliases]);

  useEffect(() => {
    localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(mappingRules));
  }, [mappingRules]);

  const caseNames = useMemo(() => [...new Set(rows.map((row) => row.caseName.trim() || "Load Case 1"))], [rows]);
  const caseCount = caseNames.length;
  const resolvedCaseAliases = useMemo(
    () => Object.fromEntries(caseNames.map((name, index) => [name, caseAliases[name]?.trim() || suggestCaseAlias(name, index, mappingRules)])),
    [caseAliases, caseNames, mappingRules],
  );
  const mappingWarnings = useMemo(() => mappingIssues(mappingRules, caseNames), [caseNames, mappingRules]);
  const aliasConflictsInfo = useMemo(() => aliasConflicts(resolvedCaseAliases), [resolvedCaseAliases]);
  const estimatedPoints = useMemo(
    () => new Set(rows.map((row, index) => row.displayName.trim() || row.pointName.trim() || "point_" + (index + 1))).size,
    [rows],
  );
  const allWarnings = useMemo(() => [...new Set([...warnings, ...(result?.warnings ?? [])])], [warnings, result]);

  const femText = result?.fem ?? "";
  const femStats = useMemo(
    () => ({
      force: femText.match(/^FORCE,/gm)?.length ?? 0,
      moment: femText.match(/^MOMENT,/gm)?.length ?? 0,
      lines: femText.match(/\n/g)?.length ?? 0,
      kilobytes: (femText.length / 1024).toFixed(1),
    }),
    [femText],
  );
  const pointNameByNode = useMemo(
    () => new Map<number, string>((result?.points ?? []).map((point) => [point.nodeId, point.name] as const)),
    [result?.points],
  );
  const duplicateKeys = useMemo(() => duplicateJsonKeys(jsonEntries), [jsonEntries]);

  const filteredRows = useMemo(() => {
    const query = rowQuery.trim().toLowerCase();
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) =>
        !query || [row.caseName, row.groupName, row.displayName, row.pointName].some((value) => value.toLowerCase().includes(query)),
      );
  }, [rows, rowQuery]);

  const filteredPoints = useMemo(() => {
    const query = pointQuery.trim().toLowerCase();
    const points = result?.points ?? [];
    return points.filter(
      (point) => !query || [point.name, point.englishName, point.text].some((value) => value.toLowerCase().includes(query)),
    );
  }, [result, pointQuery]);

  const currentIndex = Math.max(0, VIEWS.findIndex((item) => item.id === view));
  const progress = (currentIndex / (VIEWS.length - 1)) * 100;

  function markDirty() {
    setResult(null);
    setJsonEntries([]);
  }

  function go(next: View) {
    if (busy) return;
    if (next !== "data" && rows.length === 0) return;
    setError("");
    if ((next === "points" || next === "export") && !result) {
      void generate(next);
      return;
    }
    setView(next);
  }

  async function parse() {
    setBusy(true);
    setError("");
    try {
      if (!isDesktop()) throw new Error("解析由 Rust 桌面端完成，请使用 npm run tauri:dev 或已安装程序运行。");
      const parsed = await parseClipboardTable(source);
      setRows(parsed.rows);
      setWarnings(parsed.warnings);
      setResult(null);
      setJsonEntries([]);
      setCaseAliases({});
      setRowQuery("");
      setShowSource(false);
      setView("data");
      toast("success", "已解析 " + parsed.rows.length + " 条载荷记录");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function generate(nextView: View = "export"): Promise<BuildResult | null> {
    if (rows.length === 0) return null;
    setBusy(true);
    setError("");
    try {
      if (!isDesktop()) throw new Error("FEM 由 Rust 桌面端生成，请在 Tauri 应用中运行。");
      const built = await buildLoadDeck(projectName, rows, resolvedCaseAliases);
      setResult(built);
      setJsonEntries(parsePointsJson(built.json));
      setBuildSeq((seq) => seq + 1);
      setView(nextView);
      toast("success", "已生成 " + built.cases.length + " 个 load step · " + built.points.length + " 个节点");
      return built;
    } catch (e) {
      setError(messageOf(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function exportFiles() {
    const built = result ?? (await generate("export"));
    if (!built) return;
    setBusy(true);
    try {
      if (isDesktop()) {
        const directory = await open({ directory: true, multiple: false, title: "选择 FEM 与 JSON 导出目录" });
        if (!directory) return;
        const exported = await exportLoadBundle(directory, projectName, built.fem, built.json);
        toast("success", "已导出：" + exported.femPath + " · " + exported.jsonPath);
      } else {
        download(projectName + ".fem", built.fem, "text/plain;charset=utf-8");
        download(projectName + "_points.json", built.json, "application/json;charset=utf-8");
        toast("success", "已开始下载 FEM 与 JSON");
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveSingleFile(kind: "fem" | "json") {
    if (!result) return;
    const isFem = kind === "fem";
    const fileName = isFem ? projectName + ".fem" : projectName + "_points.json";
    const content = isFem ? result.fem : result.json;
    try {
      if (isDesktop()) {
        const path = await save({
          title: isFem ? "保存 FEM 文件" : "保存点位 JSON",
          defaultPath: fileName,
          filters: [{ name: isFem ? "FEM" : "JSON", extensions: [kind] }],
        });
        if (!path) return;
        const savedPath = await exportOutputFile(path, content);
        toast("success", "已保存：" + savedPath);
      } else {
        download(fileName, content, isFem ? "text/plain;charset=utf-8" : "application/json;charset=utf-8");
        toast("success", "已开始下载 " + fileName);
      }
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function copyContent(text: string, label: string) {
    try {
      await copyText(text);
      toast("success", label + " 已复制到剪贴板");
    } catch (e) {
      toast("error", "复制失败：" + messageOf(e));
    }
  }

  function updateRow(index: number, key: "caseName" | "groupName" | "displayName" | "pointName", value: string) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
    markDirty();
  }

  function updateRowNumber(index: number, key: NumericKey, value: number) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
    markDirty();
  }

  function addRow() {
    const previous = rows.at(-1);
    setRows((current) => [
      ...current,
      {
        sourceLine: 0,
        caseName: previous?.caseName ?? "Load Case 1",
        groupName: previous?.groupName ?? "",
        pointName: "point_" + (current.length + 1),
        displayName: "",
        x: 0,
        y: 0,
        z: 0,
        time: null,
        fx: 0,
        fy: 0,
        fz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
      },
    ]);
    markDirty();
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
    markDirty();
  }

  function patchJsonEntry(index: number, patch: Partial<PointJsonEntry>) {
    const next = jsonEntries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    setJsonEntries(next);
    setResult((current) => (current ? { ...current, json: serializePointsJson(next) } : current));
  }

  function commitJsonCoordinate(index: number, axis: "x" | "y" | "z", value: number) {
    if (!Number.isFinite(value)) return;
    patchJsonEntry(index, axis === "x" ? { x: value } : axis === "y" ? { y: value } : { z: value });
  }

  function reset() {
    if (rows.length > 0 && !window.confirm("确定要清空当前工作区吗？已填入的数据将全部丢失，此操作不可撤销。")) return;
    setSource("");
    setRows([]);
    setCaseAliases({});
    setResult(null);
    setJsonEntries([]);
    setWarnings([]);
    setError("");
    setRowQuery("");
    setPointQuery("");
    setShowSource(true);
    setView("data");
    localStorage.removeItem(STORAGE_KEY);
    toast("info", "已新建工作区");
  }

  const busyOrEmpty = busy || rows.length === 0;

  return (
    <div className="tabModule">
      <div className="tabStepper" aria-label="表格载荷流程">
        <div className="tabSteps">
          {VIEWS.map((item, index) => {
            const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "todo";
            const disabled = item.id !== "data" && rows.length === 0;
            return (
              <button
                key={item.id}
                type="button"
                className={"tabStep " + state + (disabled ? " disabled" : "")}
                disabled={disabled}
                onClick={() => go(item.id)}
              >
                <span className="tabStepDot">{state === "done" ? <CheckIcon size={13} /> : item.num}</span>
                <span className="tabStepText"><b>{item.label}</b><small>{item.hint}</small></span>
              </button>
            );
          })}
        </div>
        <div className="tabProgressWrap">
          <span>流程进度 {Math.round(progress)}%</span>
          <div className="progressTrack"><i style={{ width: progress + "%" }} /></div>
        </div>
      </div>
      <div className="tabMain">
        <header className="mainHeader">
          <div className="headerTitle">
            <p className="eyebrow">VEHICLE LOAD-CASE GENERATOR</p>
            <h1>整车工况生成</h1>
          </div>
          <div className="headerTools">
            {onBack && <button type="button" className="ghost" onClick={onBack}>← 模块库</button>}
            <label className="tabProjectTag" title="项目名：决定导出的 FEM / JSON 文件名">
              项目
              <input value={projectName} spellCheck={false} onChange={(e) => onProjectChange(e.target.value)} />
            </label>
            <button type="button" className="ghost" onClick={reset}>
              <ResetIcon size={15} /> 新建
            </button>
          </div>
        </header>

        <section className="metrics" aria-label="项目概览">
          <div className="metric">
            <span className="metricIcon"><TableIcon size={18} /></span>
            <div className="metricBody"><span>载荷记录</span><strong>{rows.length}</strong></div>
          </div>
          <div className="metric">
            <span className="metricIcon"><LayersIcon size={18} /></span>
            <div className="metricBody"><span>Load Steps</span><strong>{caseCount}</strong></div>
          </div>
          <div className="metric">
            <span className="metricIcon"><NodeIcon size={18} /></span>
            <div className="metricBody"><span>命名节点</span><strong>{result?.points.length ?? estimatedPoints}</strong></div>
          </div>
          <div className="metric">
            <span className="metricIcon"><HashIcon size={18} /></span>
            <div className="metricBody"><span>起始节点号</span><strong>1001</strong></div>
          </div>
        </section>

        {error && (
          <div className="alert error" role="alert">
            <span className="alertIcon"><WarningIcon size={18} /></span>
            <div className="alertBody"><b>无法继续</b><span>{error}</span></div>
            <button type="button" className="alertClose" onClick={() => setError("")} aria-label="关闭提示"><XIcon size={16} /></button>
          </div>
        )}

        {(view === "data" && (rows.length === 0 || showSource)) && (
          <section className="panel pastePanel">
            <div className="panelHead">
              <div>
                <p className="stepLabel">STEP 01 · IMPORT</p>
                <h2 className="panelTitle">粘贴原始表格</h2>
                <p className="panelDesc">直接从 Excel / WPS 复制。支持多段工况、合并坐标表头和中英文列名。</p>
              </div>
              <div className="headActions">
                {rows.length > 0 && (
                  <button type="button" className="ghost" onClick={() => setShowSource(false)}>← 返回表格</button>
                )}
                <button type="button" className="linkButton" onClick={() => setSource(SAMPLE)}>
                  <ClipboardIcon size={15} /> 载入格式示例
                </button>
              </div>
            </div>
            <div className="formatHint">
              <span className="hintChip"><CheckIcon size={12} /> X / Y / Z</span>
              <span className="hintChip"><CheckIcon size={12} /> 中文点位名（归并索引）</span>
              <span className="hintChip"><CheckIcon size={12} /> FX / FY / FZ</span>
              <span className="hintChip muted">TX / TY / TZ 可选</span>
            </div>
            <div className="editorShell">
              <div className="editorBar">
                <div className="editorDots"><i /><i /><i /></div>
                <span className="editorTitle">load_table.tsv</span>
                <span className="editorCount">
                  {source ? source.split(/\r?\n/).length + " 行 · " + source.length + " 字符" : "等待粘贴"}
                </span>
              </div>
              <textarea
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={"在这里粘贴表格…\n\n每个 case / 工况标题会建立一个 load collector 和 load step。"}
                spellCheck={false}
              />
            </div>
            <div className="actions">
              <span className="actionsHint"><CheckIcon size={13} /> 内容仅在本机处理，不会上传。</span>
              <div className="actionsButtons">
                {source && (
                  <button type="button" className="ghost" onClick={() => setSource("")}>
                    <TrashIcon size={15} /> 清空
                  </button>
                )}
                <button type="button" className="primary" disabled={busy || !source.trim()} onClick={() => void parse()}>
                  {busy ? <><SpinnerIcon /> 正在解析…</> : <>解析表格 <ArrowRightIcon size={16} /></>}
                </button>
              </div>
            </div>
          </section>
        )}

        {(view === "data" && rows.length > 0 && !showSource) && (
          <section className="panel tablePanel">
            <div className="panelHead">
              <div>
                <p className="stepLabel">STEP 01 · REVIEW</p>
                <h2 className="panelTitle">校对载荷数据</h2>
                <p className="panelDesc">所有单元格均可编辑。空的扭矩按 0 处理，负数可直接键入。</p>
              </div>
              <div className="headActions">
                <button type="button" className="ghost" onClick={() => setShowSource(true)}><ClipboardIcon size={15} /> 重新粘贴</button>
                <button type="button" className="ghost" onClick={addRow}><PlusIcon size={15} /> 添加一行</button>
                <button type="button" className="primary" disabled={busyOrEmpty} onClick={() => void generate("points")}>
                  {busy ? <><SpinnerIcon /> 生成中…</> : <>生成节点映射 <ArrowRightIcon size={16} /></>}
                </button>
              </div>
            </div>

            <div className="tableToolbar">
              <div className="toolbarLeft">
                <span className="rowCountBadge">{rows.length} 条记录</span>
                <span className="toolbarHint">共 {caseCount} 个工况 · {estimatedPoints} 个点位</span>
              </div>
              <label className="filterBox">
                <SearchIcon size={15} />
                <input value={rowQuery} onChange={(e) => setRowQuery(e.target.value)} placeholder="搜索工况 / 点位…" spellCheck={false} />
                {rowQuery && <button type="button" onClick={() => setRowQuery("")} aria-label="清除搜索"><XIcon size={14} /></button>}
              </label>
            </div>

            <div className="caseEditor">
              <div className="caseEditorHead">
                <b>模型内工况命名</b>
                <span>按关键词自动映射英文名，可手工调整；特殊工况将自动追加序号</span>
              </div>
              {caseNames.map((name, index) => (
                <label className="caseField" key={name}>
                  <span title={name}>{name}</span>
                  <input
                    value={resolvedCaseAliases[name]}
                    placeholder={suggestCaseAlias(name, index, mappingRules)}
                    spellCheck={false}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCaseAliases((current) => ({ ...current, [name]: value }));
                      markDirty();
                    }}
                  />
                </label>
              ))}
              {caseNames.length === 0 && <p className="muted">暂无工况</p>}
            </div>

            {aliasConflictsInfo.length > 0 && (
              <div className="inlineIssues">
                {aliasConflictsInfo.map((issue) => <span key={issue}>{issue}</span>)}
              </div>
            )}

            <details className="mappingManager">
              <summary>
                关键词映射表 · {mappingRules.length} 条规则 · {mappingWarnings.length > 0 ? mappingWarnings.length + " 项干涉/提示" : "无干涉"}
              </summary>
              <div className="mappingToolbar">
                <span>必含词用 “+” 连接，备选词组用 “|” 连接；英文名可使用 <code>{"{g}"}</code> 自动提取载荷系数。</span>
                <div>
                  <button type="button" className="ghost" onClick={() => { setMappingRules(DEFAULT_MAPPING_RULES.map((rule) => ({ ...rule }))); markDirty(); }}>
                    <ResetIcon size={14} /> 恢复默认
                  </button>
                  <button type="button" className="primary" onClick={() => setMappingRules((current) => [...current, { id: "rule-" + Date.now(), keywords: "", englishName: "" }])}>
                    <PlusIcon size={14} /> 添加规则
                  </button>
                </div>
              </div>
              {mappingWarnings.length > 0 && (
                <div className="mappingIssues">
                  {mappingWarnings.map((issue) => <span key={issue}>{issue}</span>)}
                </div>
              )}
              <div className="mappingTable">
                <div className="mappingHeader"><span>#</span><span>必含关键词</span><span>英文名称 / 模板</span><span /></div>
                {mappingRules.map((rule, index) => (
                  <div className="mappingRow" key={rule.id}>
                    <span className="ruleIndex">{index + 1}</span>
                    <input
                      value={rule.keywords}
                      placeholder="例如：转弯 + 左转"
                      spellCheck={false}
                      onChange={(e) => {
                        const keywords = e.target.value;
                        setMappingRules((current) => current.map((item) => (item.id === rule.id ? { ...item, keywords } : item)));
                        markDirty();
                      }}
                    />
                    <input
                      value={rule.englishName}
                      placeholder="例如：Left_Turn"
                      spellCheck={false}
                      onChange={(e) => {
                        const englishName = e.target.value;
                        setMappingRules((current) => current.map((item) => (item.id === rule.id ? { ...item, englishName } : item)));
                        markDirty();
                      }}
                    />
                    <button
                      type="button"
                      className="delete"
                      title="删除映射规则"
                      onClick={() => { setMappingRules((current) => current.filter((item) => item.id !== rule.id)); markDirty(); }}
                    >
                      <TrashIcon size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </details>

            <div className="dataTableWrap">
              <table className="dataTable">
                <thead>
                  <tr>
                    <th className="colIndex">#</th>
                    {TABLE_HEADERS.map((header) => <th key={header}>{header}</th>)}
                    <th className="colOps" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr><td className="emptyCell" colSpan={TABLE_HEADERS.length + 2}>{rows.length === 0 ? "尚未导入数据" : "没有匹配的记录"}</td></tr>
                  )}
                  {filteredRows.map(({ row, index }) => (
                    <tr key={index + "-" + row.sourceLine}>
                      <td className="rowIndex">{index + 1}</td>
                      <td><input className="textInput" value={row.caseName} onChange={(e) => updateRow(index, "caseName", e.target.value)} /></td>
                      <td><input className="textInput" value={row.displayName} onChange={(e) => updateRow(index, "displayName", e.target.value)} /></td>
                      <td><input className="textInput mono" value={row.pointName} onChange={(e) => updateRow(index, "pointName", e.target.value)} /></td>
                      {NUMERIC_KEYS.map((key) => (
                        <td key={key}>
                          <NumericInput value={row[key]} onCommit={(value) => updateRowNumber(index, key, value)} />
                        </td>
                      ))}
                      <td className="colOps">
                        <button type="button" className="delete" title="删除该行" onClick={() => removeRow(index)}><TrashIcon size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tableFoot">
              <span>修改表格或命名后需重新生成节点映射。</span>
              <button type="button" className="primary" disabled={busyOrEmpty} onClick={() => void generate("points")}>
                {busy ? <><SpinnerIcon /> 生成中…</> : <>生成节点映射 <ArrowRightIcon size={16} /></>}
              </button>
            </div>
          </section>
        )}

        {view === "points" && result && (
          <section className="panel pointsPanel">
            <div className="panelHead">
              <div>
                <p className="stepLabel">STEP 02 · NODES</p>
                <h2 className="panelTitle">点位与节点编号</h2>
                <p className="panelDesc">
                  {rows.length} 条载荷记录按中文点位名称归并为 {result.points.length} 个节点；JSON 与 FEM 节点名称使用英文，FEM 不包含 GRID 卡。
                </p>
              </div>
              <div className="headActions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void copyContent(result.points.map((point) => [point.nodeId, point.name, point.englishName, point.x, point.y, point.z].join("\t")).join("\n"), "节点清单")}
                >
                  <CopyIcon size={15} /> 复制节点清单
                </button>
                <button type="button" className="primary" onClick={() => setView("export")}>
                  查看输出 <ArrowRightIcon size={16} />
                </button>
              </div>
            </div>
            <div className="pointToolbar">
              <span className="rowCountBadge">{result.points.length} 个节点</span>
              <label className="filterBox">
                <SearchIcon size={15} />
                <input value={pointQuery} onChange={(e) => setPointQuery(e.target.value)} placeholder="搜索节点 / 名称…" spellCheck={false} />
                {pointQuery && <button type="button" onClick={() => setPointQuery("")} aria-label="清除搜索"><XIcon size={14} /></button>}
              </label>
            </div>
            <div className="pointGrid">
              {filteredPoints.map((point) => (
                <article className="pointCard" key={point.nodeId}>
                  <div className="nodeBadge"><span>NODE</span><strong>{point.nodeId}</strong></div>
                  <h3>{point.name}</h3>
                  <code className="pointCoords">{point.x}, {point.y}, {point.z}</code>
                  <div className="pointMeta">
                    <span className="tag">EN {point.englishName}</span>
                    <span className="tag mono">{point.text}</span>
                  </div>
                </article>
              ))}
              {filteredPoints.length === 0 && <div className="emptyCell gridEmpty">没有匹配的节点</div>}
            </div>
          </section>
        )}

        {view === "export" && (
          <section className="panel outputPanel">
            <div className="panelHead">
              <div>
                <p className="stepLabel">STEP 03 · EXPORT</p>
                <h2 className="panelTitle">FEM 与点位 JSON</h2>
                <p className="panelDesc">先依据 JSON 创建节点，再将 FEM 增量导入模型。</p>
              </div>
              <div className="headActions">
                <button type="button" className="primary" disabled={busyOrEmpty} onClick={() => void exportFiles()}>
                  {busy ? <><SpinnerIcon /> 处理中…</> : <><DownloadIcon size={16} /> 导出两个文件</>}
                </button>
              </div>
            </div>

            {result ? (
              <>
                <div className="caseMap">
                  <b>模型内工况名称</b>
                  <span>LC = Load Collector，LS = Load Step</span>
                  {result.cases.map((item) => (
                    <code key={item.loadId + "-" + item.femName}>{item.name} → {item.collectorName} / {item.loadStepName}</code>
                  ))}
                </div>
                <div className="outputGrid">
                  <article className="fileCard">
                    <div className="fileTitle">
                      <span className="fileIcon fem">FEM</span>
                      <div className="fileMeta"><b>{projectName}.fem</b><small>{result.cases.length} collectors · 不含 GRID · ASCII 命名</small></div>
                      <div className="fileActions">
                        <button type="button" onClick={() => void copyContent(result.fem, "FEM")}><CopyIcon size={14} /> 复制</button>
                        <button type="button" onClick={() => void saveSingleFile("fem")}><SaveIcon size={14} /> 保存</button>
                      </div>
                    </div>
                    <dl className="femSummary">
                      <div><dt>载荷卡片</dt><dd>FORCE × {femStats.force} · MOMENT × {femStats.moment}</dd></div>
                      <div><dt>工况</dt><dd>{result.cases.length} 个 Load Collector / Load Step</dd></div>
                      <div><dt>节点引用</dt><dd>{result.points.length} 个节点号（{result.points[0]?.nodeId ?? 1001} 起）</dd></div>
                      <div><dt>文件规模</dt><dd>{femStats.lines} 行 · {femStats.kilobytes} KB</dd></div>
                    </dl>
                    <p className="fileNote">正文不在界面展示。导出后先按 JSON 建立节点，再增量导入本文件；FEM 只引用节点号，下方 JSON 改名不会改变 FEM。</p>
                  </article>
                  <article className="fileCard">
                    <div className="fileTitle">
                      <span className="fileIcon json">JSON</span>
                      <div className="fileMeta"><b>{projectName}_points.json</b><small>{jsonEntries.length} 个点位 · 结构化编辑 · 键顺序与表格一致</small></div>
                      <div className="fileActions">
                        <button type="button" onClick={() => void copyContent(result.json, "JSON")}><CopyIcon size={14} /> 复制</button>
                        <button type="button" onClick={() => void saveSingleFile("json")}><SaveIcon size={14} /> 保存</button>
                      </div>
                    </div>
                    {duplicateKeys.length > 0 && (
                      <div className="jsonIssues">
                        {duplicateKeys.map((key) => <span key={key}>英文点位名“{key}”重复：JSON 键会互相覆盖，请修改其中一处</span>)}
                      </div>
                    )}
                    <div className="jsonTableWrap">
                      <table className="jsonTable">
                        <thead>
                          <tr><th>#</th><th>节点号</th><th>中文点位名</th><th>英文点位名（JSON 键）</th><th>label</th><th>X</th><th>Y</th><th>Z</th></tr>
                        </thead>
                        <tbody>
                          {jsonEntries.map((entry, index) => (
                            <tr key={buildSeq + "-" + index} className={duplicateKeys.includes(entry.key) ? "hasIssue" : ""}>
                              <td>{index + 1}</td>
                              <td className="nodeId">{entry.nodeId}</td>
                              <td className="muted" title={pointNameByNode.get(entry.nodeId) ?? ""}>{pointNameByNode.get(entry.nodeId) ?? "—"}</td>
                              <td><input value={entry.key} spellCheck={false} onChange={(e) => patchJsonEntry(index, { key: e.target.value })} /></td>
                              <td><input value={entry.label} spellCheck={false} onChange={(e) => patchJsonEntry(index, { label: e.target.value })} /></td>
                              {(["x", "y", "z"] as const).map((axis) => (
                                <td key={axis}>
                                  <NumericInput value={entry[axis]} onCommit={(value) => commitJsonCoordinate(index, axis, value)} className="jsonNumber" />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="fileNote">label 为「英文点位名_节点号」，此处可按需修改；节点号由编号规则分配、不可改，因为 FEM 按节点号引用。</p>
                    <details className="jsonRaw">
                      <summary>查看生成的 JSON 文本（只读）</summary>
                      <pre>{result.json}</pre>
                    </details>
                  </article>
                </div>
              </>
            ) : (
              <div className="empty">
                <span className="emptyIcon"><DownloadIcon size={30} /></span>
                <p>输出尚未生成</p>
                <span>先完成校对，再生成 FEM 与点位 JSON。</span>
                <button type="button" className="primary" disabled={busyOrEmpty} onClick={() => void generate("export")}>
                  {busy ? <><SpinnerIcon /> 生成中…</> : "现在生成"}
                </button>
              </div>
            )}
          </section>
        )}

        {allWarnings.length > 0 && (
          <section className="warnings">
            <div className="warningHead"><WarningIcon size={16} /><b>检查提示 · {allWarnings.length} 项</b></div>
            <ul>{allWarnings.map((warning, i) => <li key={warning + "-" + i}>{warning}</li>)}</ul>
          </section>
        )}
      </div>

      <div className="toastStack" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={"toast " + item.tone}>
            <span className="toastIcon">
              {item.tone === "error" ? <WarningIcon size={16} /> : item.tone === "info" ? <ClipboardIcon size={16} /> : <CheckIcon size={16} />}
            </span>
            <span className="toastText">{item.text}</span>
            <button type="button" className="toastClose" onClick={() => setToasts((list) => list.filter((t) => t.id !== item.id))} aria-label="关闭"><XIcon size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

