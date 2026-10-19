import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { buildLoadDeck, exportLoadBundle, exportOutputFile, isDesktop, parseClipboardTable } from "@/lib/loadDeckApi";
import { duplicateJsonKeys, parsePointsJson, serializePointsJson } from "@/lib/pointsJson";
import type { BuildResult, LoadRow, PointJsonEntry } from "@/types/loadDeck";

type View = "paste" | "table" | "points" | "output";
interface MappingRule { id: string; keywords: string; englishName: string; }

const SAMPLE = `case1_braking
Group\tX\tY\tZ\tEnglish Name\t中文名称\tTime\tFX\tFY\tFZ\tTX\tTY\tTZ
front\t1550\t0\t-210\tfrontsusp_a\t前悬架连接点\t7\t-385\t-4150\t35600\t0\t0\t0
front\t0\t-800\t200\tfront_bumper_left\t前保险杠左侧\t7\t0\t0\t0\t0\t0\t0
rear\t4882\t-475\t90\tmid_yrod\t中横推杆连接点\t7\t26100\t-175000\t14900\t0\t0\t0`;
const STORAGE_KEY = "loaddeck.workspace.v1";
const MAPPING_STORAGE_KEY = "loaddeck.case-mappings.v1";
const numericKeys: Array<keyof LoadRow> = ["x", "y", "z", "fx", "fy", "fz", "tx", "ty", "tz"];
const DEFAULT_MAPPING_RULES: MappingRule[] = [
  { id: "rule-static", keywords: "静满载 | 静载工况", englishName: "Static_Full_Load" },
  { id: "rule-front-axle", keywords: "前轮上跳", englishName: "Front_Axle_Bump" },
  { id: "rule-middle-axle", keywords: "中轮上跳", englishName: "Middle_Axle_Bump" },
  { id: "rule-rear-axle", keywords: "后轮上跳", englishName: "Rear_Axle_Bump" },
  { id: "rule-front-left", keywords: "左前单轮上跳", englishName: "Front_Left_Wheel_Bump" },
  { id: "rule-front-right", keywords: "右前单轮上跳", englishName: "Front_Right_Wheel_Bump" },
  { id: "rule-middle-left", keywords: "左中轮上跳", englishName: "Middle_Left_Wheel_Bump" },
  { id: "rule-middle-right", keywords: "右中轮上跳", englishName: "Middle_Right_Wheel_Bump" },
  { id: "rule-rear-left", keywords: "左后轮上跳", englishName: "Rear_Left_Wheel_Bump" },
  { id: "rule-rear-right", keywords: "右后轮上跳", englishName: "Rear_Right_Wheel_Bump" },
  { id: "rule-diagonal-fl-rr", keywords: "左前轮上跳 + 右后轮上跳", englishName: "Front_Left_and_Rear_Right_Bump" },
  { id: "rule-diagonal-fr-rl", keywords: "右前轮上跳 + 左后轮上跳", englishName: "Front_Right_and_Rear_Left_Bump" },
  { id: "rule-left-turn", keywords: "转弯 + 左转", englishName: "Left_Turn" },
  { id: "rule-braking", keywords: "制动", englishName: "Braking_{g}" },
  { id: "rule-acceleration", keywords: "加速", englishName: "Acceleration_{g}" },
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

function ruleKeywordGroups(rule: MappingRule) {
  return rule.keywords
    .split(/[|｜]/)
    .map((group) => group.split(/[+，,、&＆]/).map((value) => value.trim()).filter(Boolean))
    .filter((group) => group.length > 0);
}

function matchingRules(name: string, rules: MappingRule[]) {
  const compact = name.replace(/\s+/g, "").replace(/＆/g, "&");
  return rules
    .map((rule, index) => {
      const matchedGroups = ruleKeywordGroups(rule).filter((group) => group.every((keyword) => compact.includes(keyword)));
      const keywords = matchedGroups.sort((a, b) => b.length - a.length || b.join("").length - a.join("").length)[0] ?? [];
      return { rule, index, keywords };
    })
    .filter(({ rule, keywords }) => rule.englishName.trim() && keywords.length > 0)
    .sort((a, b) => b.keywords.length - a.keywords.length || b.keywords.join("").length - a.keywords.join("").length || a.index - b.index);
}

function applyCaseTemplate(template: string, name: string) {
  const factor = name.replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)g/i)?.[1];
  return template
    .replaceAll("_{g}", factor ? `_${factor}g` : "")
    .replaceAll("{g}", factor ? `${factor}g` : "");
}

function suggestCaseAlias(name: string, index: number, rules: MappingRule[]) {
  const matched = matchingRules(name, rules)[0];
  if (matched) return applyCaseTemplate(matched.rule.englishName.trim(), name);
  const ascii = name
    .replace(/[^a-zA-Z0-9.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 52);
  return ascii || `loadcase_${index + 1}`;
}

function mappingIssues(rules: MappingRule[], caseNames: string[]) {
  const issues = new Set<string>();
  rules.forEach((rule, index) => {
    if (ruleKeywordGroups(rule).length === 0 || !rule.englishName.trim()) issues.add(`第 ${index + 1} 条规则不完整，不会参与匹配`);
  });
  for (let left = 0; left < rules.length; left += 1) {
    const leftGroups = ruleKeywordGroups(rules[left]);
    if (!leftGroups.length) continue;
    for (let right = left + 1; right < rules.length; right += 1) {
      const rightGroups = ruleKeywordGroups(rules[right]);
      if (!rightGroups.length) continue;
      const groupPairs = leftGroups.flatMap((leftKeys) => rightGroups.map((rightKeys) => ({ leftKeys, rightKeys })));
      const sameKeywords = groupPairs.some(({ leftKeys, rightKeys }) => leftKeys.length === rightKeys.length && leftKeys.every((key) => rightKeys.includes(key)));
      const contained = groupPairs.some(({ leftKeys, rightKeys }) =>
        leftKeys.every((key) => rightKeys.some((candidate) => candidate.includes(key))) ||
        rightKeys.every((key) => leftKeys.some((candidate) => candidate.includes(key))));
      if (sameKeywords) issues.add(`第 ${left + 1}、${right + 1} 条关键词重复，请删除或修改其中一条`);
      else if (contained) issues.add(`第 ${left + 1}、${right + 1} 条存在包含匹配；系统将优先使用关键词更多的规则`);
      if (rules[left].englishName.trim() && rules[left].englishName.trim() === rules[right].englishName.trim()) issues.add(`第 ${left + 1}、${right + 1} 条英文名称相同，可能导致模型名称自动加序号`);
    }
  }
  caseNames.forEach((name) => {
    const matches = matchingRules(name, rules);
    if (matches.length > 1) issues.add(`“${name}”同时命中 ${matches.length} 条规则，将使用“${matches[0].rule.englishName}”`);
  });
  return [...issues];
}

export default function App() {
  const [view, setView] = useState<View>("paste");
  const [projectName, setProjectName] = useState("vehicle_loads");
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<LoadRow[]>([]);
  const [caseAliases, setCaseAliases] = useState<Record<string, string>>({});
  const [mappingRules, setMappingRules] = useState<MappingRule[]>(() => {
    try {
      const stored = localStorage.getItem(MAPPING_STORAGE_KEY);
      const data = stored ? JSON.parse(stored) as MappingRule[] : null;
      if (Array.isArray(data)) return data;
    } catch { localStorage.removeItem(MAPPING_STORAGE_KEY); }
    return DEFAULT_MAPPING_RULES.map((rule) => ({ ...rule }));
  });
  const [result, setResult] = useState<BuildResult | null>(null);
  const [jsonEntries, setJsonEntries] = useState<PointJsonEntry[]>([]);
  const [buildSeq, setBuildSeq] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      const data = JSON.parse(stored) as { projectName?: string; source?: string; rows?: LoadRow[]; caseAliases?: Record<string, string> };
      if (data.projectName) setProjectName(data.projectName);
      if (data.source) setSource(data.source);
      if (Array.isArray(data.rows)) setRows(data.rows);
      if (data.caseAliases) setCaseAliases(data.caseAliases);
    } catch { localStorage.removeItem(STORAGE_KEY); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectName, source, rows, caseAliases })), 250);
    return () => window.clearTimeout(timer);
  }, [projectName, source, rows, caseAliases]);

  useEffect(() => {
    localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(mappingRules));
  }, [mappingRules]);

  const caseNames = useMemo(() => [...new Set(rows.map((row) => row.caseName.trim() || "Load Case 1"))], [rows]);
  const caseCount = caseNames.length;
  const resolvedCaseAliases = useMemo(() => Object.fromEntries(caseNames.map((name, index) => [name, caseAliases[name]?.trim() || suggestCaseAlias(name, index, mappingRules)])), [caseAliases, caseNames, mappingRules]);
  const mappingWarnings = useMemo(() => mappingIssues(mappingRules, caseNames), [caseNames, mappingRules]);
  const estimatedPoints = useMemo(() => new Set(rows.map((row, index) => row.displayName.trim() || row.pointName.trim() || `point_${index + 1}`)).size, [rows]);
  const femText = result?.fem ?? "";
  const femStats = useMemo(() => ({
    force: femText.match(/^FORCE,/gm)?.length ?? 0,
    moment: femText.match(/^MOMENT,/gm)?.length ?? 0,
    lines: femText.match(/\n/g)?.length ?? 0,
    kilobytes: (femText.length / 1024).toFixed(1),
  }), [femText]);
  const pointNameByNode = useMemo(() => new Map<number, string>((result?.points ?? []).map((point) => [point.nodeId, point.name] as const)), [result?.points]);
  const duplicateKeys = useMemo(() => duplicateJsonKeys(jsonEntries), [jsonEntries]);

  async function parse() {
    setBusy(true); setError(""); setNotice("");
    try {
      if (!isDesktop()) throw new Error("解析由 Rust 桌面端完成，请使用 npm run tauri:dev 或已安装程序运行。");
      const parsed = await parseClipboardTable(source);
      setRows(parsed.rows); setWarnings(parsed.warnings); setResult(null); setView("table");
      setCaseAliases({});
      setNotice(`已解析 ${parsed.rows.length} 条载荷记录`);
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }

  async function generate(nextView: View = "output") {
    setBusy(true); setError(""); setNotice("");
    try {
      if (!isDesktop()) throw new Error("FEM 由 Rust 桌面端生成，请在 Tauri 应用中运行。");
      const built = await buildLoadDeck(projectName, rows, resolvedCaseAliases);
      setResult(built); setJsonEntries(parsePointsJson(built.json)); setBuildSeq((seq) => seq + 1);
      setWarnings((current) => [...current, ...built.warnings]); setView(nextView);
      setNotice(`已生成 ${built.cases.length} 个 load step；${rows.length} 条载荷记录按中文点位名归并为 ${built.points.length} 个节点`);
      return built;
    } catch (e) { setError(messageOf(e)); return null; }
    finally { setBusy(false); }
  }

  async function exportFiles() {
    const built = result ?? (await generate("output"));
    if (!built) return;
    try {
      if (isDesktop()) {
        const directory = await open({ directory: true, multiple: false, title: "选择 FEM 与 JSON 导出目录" });
        if (!directory) return;
        const exported = await exportLoadBundle(directory, projectName, built.fem, built.json);
        setNotice(`导出完成：${exported.femPath}；${exported.jsonPath}`);
      } else {
        download(`${projectName}.fem`, built.fem, "text/plain;charset=utf-8");
        download(`${projectName}_points.json`, built.json, "application/json;charset=utf-8");
      }
    } catch (e) { setError(messageOf(e)); }
  }

  async function saveSingleFile(kind: "fem" | "json") {
    if (!result) return;
    const isFem = kind === "fem";
    const fileName = isFem ? `${projectName}.fem` : `${projectName}_points.json`;
    const content = isFem ? result.fem : result.json;
    try {
      if (isDesktop()) {
        const path = await save({ title: isFem ? "保存 FEM 文件" : "保存点位 JSON", defaultPath: fileName, filters: [{ name: isFem ? "FEM" : "JSON", extensions: [kind] }] });
        if (!path) return;
        const savedPath = await exportOutputFile(path, content);
        setNotice(`已保存：${savedPath}`);
      } else {
        download(fileName, content, isFem ? "text/plain;charset=utf-8" : "application/json;charset=utf-8");
      }
    } catch (e) { setError(messageOf(e)); }
  }

  async function copyJson() {
    if (!result) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.json);
      } else {
        const field = document.createElement("textarea");
        field.value = result.json;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("系统剪贴板不可用");
      }
      setNotice("JSON 已复制到剪贴板");
    } catch (e) {
      setError(`复制 JSON 失败：${messageOf(e)}`);
    }
  }

  function updateRow(index: number, key: keyof LoadRow, value: string) {
    setRows((current) => current.map((row, i) => {
      if (i !== index) return row;
      if (numericKeys.includes(key)) return { ...row, [key]: Number(value) || 0 };
      if (key === "time") return { ...row, time: value === "" ? null : Number(value) || 0 };
      return { ...row, [key]: value };
    }));
    setResult(null);
  }

  function addRow() {
    const previous = rows.at(-1);
    setRows((current) => [...current, { sourceLine: 0, caseName: previous?.caseName ?? "Load Case 1", groupName: previous?.groupName ?? "", pointName: `point_${current.length + 1}`, displayName: "", x: 0, y: 0, z: 0, time: null, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0 }]);
  }

  function patchJsonEntry(index: number, patch: Partial<PointJsonEntry>) {
    const next = jsonEntries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    setJsonEntries(next);
    setResult((current) => (current ? { ...current, json: serializePointsJson(next) } : current));
  }

  function commitJsonCoordinate(index: number, axis: "x" | "y" | "z", value: string) {
    const parsed = Number(value.trim());
    if (value.trim() === "" || !Number.isFinite(parsed)) return;
    patchJsonEntry(index, axis === "x" ? { x: parsed } : axis === "y" ? { y: parsed } : { z: parsed });
  }

  function reset() {
    setSource(""); setRows([]); setCaseAliases({}); setResult(null); setJsonEntries([]); setWarnings([]); setError(""); setNotice(""); setView("paste");
    localStorage.removeItem(STORAGE_KEY);
  }

  const steps: Array<[View, string, string]> = [["paste", "01", "粘贴数据"], ["table", "02", "校对载荷"], ["points", "03", "点位编号"], ["output", "04", "导出文件"]];

  return <div className="shell">
    <aside className="sidebar">
      <div className="brandMark">LC</div><div className="brandCopy"><b>LoadCreator</b><span>FEM LOAD BUILDER</span></div>
      <nav>{steps.map(([id, number, label]) => <button key={id} className={view === id ? "active" : ""} disabled={id !== "paste" && rows.length === 0} onClick={() => id === "points" && !result ? void generate("points") : setView(id)}><span>{number}</span>{label}</button>)}</nav>
      <div className="sideInfo"><span className="statusDot" /> 本地离线处理<small>Rust parser · Tauri desktop</small></div>
    </aside>

    <main>
      <header><div><p className="eyebrow">ENGINEERING DATA WORKSPACE</p><h1>载荷表格转换器</h1></div><div className="projectField"><label>项目文件名</label><input value={projectName} onChange={(e) => setProjectName(e.target.value)} /></div><button className="ghost" onClick={reset}>新建</button></header>
      <section className="metrics"><div><span>载荷记录</span><strong>{rows.length}</strong></div><div><span>Load Steps</span><strong>{caseCount}</strong></div><div><span>中文点位</span><strong>{result?.points.length ?? estimatedPoints}</strong></div><div><span>起始节点号</span><strong>1001</strong></div></section>
      {error && <div className="alert error"><b>无法继续</b><span>{error}</span></div>}
      {notice && <div className="alert success"><b>处理完成</b><span>{notice}</span></div>}

      {view === "paste" && <section className="panel pastePanel">
        <div className="panelHead"><div><p className="stepLabel">STEP 01</p><h2>粘贴原始表格</h2><p>直接从 Excel / WPS 复制。支持多段工况、合并坐标表头和中英文列名。</p></div><button className="linkButton" onClick={() => setSource(SAMPLE)}>载入格式示例</button></div>
        <div className="formatHint"><b>最少需要</b><span>X / Y / Z</span><span>中文与英文点位名</span><span>FX / FY / FZ</span><span>TX / TY / TZ 可选</span></div>
        <textarea value={source} onChange={(e) => setSource(e.target.value)} placeholder={"在这里粘贴表格…\n\n每个 case / 工况标题会建立一个 load collector 和 load step。"} spellCheck={false} />
        <div className="actions"><span>内容仅在本机处理，不会上传。</span><button className="primary" disabled={busy || !source.trim()} onClick={parse}>{busy ? "正在解析…" : "解析表格 →"}</button></div>
      </section>}

      {view === "table" && <section className="panel tablePanel">
        <div className="panelHead"><div><p className="stepLabel">STEP 02</p><h2>校对载荷数据</h2><p>所有单元格均可编辑。空的扭矩按 0 处理。</p></div><div className="headActions"><button className="ghost" onClick={addRow}>＋ 添加一行</button><button className="primary" disabled={busy || rows.length === 0} onClick={() => void generate("points")}>生成节点映射 →</button></div></div>
        <div className="caseEditor"><div><b>模型内工况命名</b><span>已根据工况关键词自动映射英文名；特殊工况仍可手工调整。</span></div>{caseNames.map((name, index) => <label key={name}><span title={name}>{name}</span><input value={resolvedCaseAliases[name]} onChange={(e) => { setCaseAliases((current) => ({ ...current, [name]: e.target.value })); setResult(null); }} placeholder={suggestCaseAlias(name, index, mappingRules)} /></label>)}</div>
        <details className="mappingManager">
          <summary>关键词映射表 · {mappingRules.length} 条规则 · {mappingWarnings.length > 0 ? `${mappingWarnings.length} 项干涉/提示` : "无干涉"}</summary>
          <div className="mappingToolbar"><span>必含词用“+”连接，备选词组用“|”连接；英文名可使用 <code>{"{g}"}</code> 自动提取载荷系数。</span><div><button className="ghost" onClick={() => { setMappingRules(DEFAULT_MAPPING_RULES.map((rule) => ({ ...rule }))); setResult(null); }}>恢复默认</button><button className="primary" onClick={() => setMappingRules((current) => [...current, { id: `rule-${Date.now()}`, keywords: "", englishName: "" }])}>＋ 添加规则</button></div></div>
          {mappingWarnings.length > 0 && <div className="mappingIssues">{mappingWarnings.map((issue) => <span key={issue}>{issue}</span>)}</div>}
          <div className="mappingTable"><div className="mappingHeader"><span>#</span><span>必含关键词</span><span>英文名称 / 模板</span><span /></div>{mappingRules.map((rule, index) => <div className="mappingRow" key={rule.id}><span>{index + 1}</span><input value={rule.keywords} placeholder="例如：转弯 + 左转" onChange={(e) => { const keywords = e.target.value; setMappingRules((current) => current.map((item) => item.id === rule.id ? { ...item, keywords } : item)); setResult(null); }} /><input value={rule.englishName} placeholder="例如：Left_Turn" onChange={(e) => { const englishName = e.target.value; setMappingRules((current) => current.map((item) => item.id === rule.id ? { ...item, englishName } : item)); setResult(null); }} /><button className="delete" title="删除映射规则" onClick={() => { setMappingRules((current) => current.filter((item) => item.id !== rule.id)); setResult(null); }}>×</button></div>)}</div>
        </details>
        <div className="dataTableWrap"><table className="dataTable"><thead><tr><th>#</th>{["工况 / Load Step", "中文点位名（归并索引）", "英文点位名（JSON）", "X", "Y", "Z", "FX", "FY", "FZ", "TX", "TY", "TZ", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${index}-${row.sourceLine}`}><td>{index + 1}</td>{(["caseName", "displayName", "pointName", "x", "y", "z", "fx", "fy", "fz", "tx", "ty", "tz"] as Array<keyof LoadRow>).map((key) => <td key={key}><input className={typeof row[key] === "number" ? "number" : ""} value={String(row[key] ?? "")} onChange={(e) => updateRow(index, key, e.target.value)} /></td>)}<td><button className="delete" title="删除" onClick={() => { setRows((r) => r.filter((_, i) => i !== index)); setResult(null); }}>×</button></td></tr>)}</tbody></table></div>
      </section>}

      {view === "points" && result && <section className="panel">
        <div className="panelHead"><div><p className="stepLabel">STEP 03</p><h2>点位与节点编号</h2><p>{rows.length} 条载荷记录按中文点位名称归并为 {result.points.length} 个节点；JSON 与 FEM 节点名称使用英文。FEM 不包含 GRID 卡。</p></div><button className="primary" onClick={() => setView("output")}>查看输出 →</button></div>
        <div className="pointGrid">{result.points.map((point) => <article key={point.nodeId}><div><span>NODE</span><strong>{point.nodeId}</strong></div><h3>{point.name}</h3><code>{point.x}, {point.y}, {point.z}</code><p>英文：{point.englishName}</p><p>{point.text}</p></article>)}</div>
      </section>}

      {view === "output" && <section className="panel">
        <div className="panelHead"><div><p className="stepLabel">STEP 04</p><h2>FEM 与点位 JSON</h2><p>先依据 JSON 创建节点，再将 FEM 增量导入模型。</p></div><button className="primary" disabled={busy || rows.length === 0} onClick={() => void exportFiles()}>导出两个文件</button></div>
        {result ? <><div className="caseMap"><b>模型内工况名称</b><span>LC = Load Collector，LS = Load Step</span>{result.cases.map((item) => <code key={`${item.loadId}-${item.femName}`}>{item.name} → {item.collectorName} / {item.loadStepName}</code>)}</div><div className="outputGrid"><article><div className="fileTitle"><span className="fileIcon fem">FEM</span><div><b>{projectName}.fem</b><small>{result.cases.length} collectors · 不含 GRID · ASCII 命名</small></div><button onClick={() => void saveSingleFile("fem")}>单独保存</button></div>
          <dl className="femSummary">
            <div><dt>载荷卡片</dt><dd>FORCE × {femStats.force} · MOMENT × {femStats.moment}</dd></div>
            <div><dt>工况</dt><dd>{result.cases.length} 个 Load Collector / Load Step</dd></div>
            <div><dt>节点引用</dt><dd>{result.points.length} 个节点号（{result.points[0]?.nodeId ?? 1001} 起）</dd></div>
            <div><dt>文件规模</dt><dd>{femStats.lines} 行 · {femStats.kilobytes} KB</dd></div>
          </dl>
          <p className="fileNote">正文不在界面展示。导出后先按 JSON 建立节点，再增量导入本文件；FEM 只引用节点号，下方 JSON 改名不会改变 FEM。</p></article><article><div className="fileTitle"><span className="fileIcon json">JSON</span><div><b>{projectName}_points.json</b><small>{jsonEntries.length} 个点位 · 结构化编辑 · 键顺序与表格一致</small></div><div className="fileActions"><button onClick={() => void copyJson()}>复制 JSON</button><button onClick={() => void saveSingleFile("json")}>单独保存</button></div></div>
          {duplicateKeys.length > 0 && <div className="jsonIssues">{duplicateKeys.map((key) => <span key={key}>英文点位名“{key}”重复：JSON 键会互相覆盖，请修改其中一处</span>)}</div>}
          <div className="jsonTableWrap"><table className="jsonTable">
            <thead><tr><th>#</th><th>节点号</th><th>中文点位名</th><th>英文点位名（JSON 键）</th><th>label</th><th>X</th><th>Y</th><th>Z</th></tr></thead>
            <tbody>{jsonEntries.map((entry, index) => <tr key={`${buildSeq}-${index}`} className={duplicateKeys.includes(entry.key) ? "hasIssue" : ""}>
              <td>{index + 1}</td>
              <td className="nodeId">{entry.nodeId}</td>
              <td className="muted" title={pointNameByNode.get(entry.nodeId) ?? ""}>{pointNameByNode.get(entry.nodeId) ?? "—"}</td>
              <td><input value={entry.key} spellCheck={false} onChange={(e) => patchJsonEntry(index, { key: e.target.value })} /></td>
              <td><input value={entry.label} spellCheck={false} onChange={(e) => patchJsonEntry(index, { label: e.target.value })} /></td>
              {(["x", "y", "z"] as const).map((axis) => <td key={axis}><input className="number" type="number" step="any" defaultValue={entry[axis]} onChange={(e) => commitJsonCoordinate(index, axis, e.target.value)} /></td>)}
            </tr>)}</tbody>
          </table></div>
          <p className="fileNote">label 为「英文点位名_节点号」，此处可按需修改；节点号由编号规则分配、不可改，因为 FEM 按节点号引用。</p>
          <details className="jsonRaw"><summary>查看生成的 JSON 文本（只读）</summary><pre>{result.json}</pre></details></article></div></> : <div className="empty"><p>输出尚未生成</p><button className="primary" onClick={() => void generate("output")}>现在生成</button></div>}
      </section>}

      {warnings.length > 0 && <section className="warnings"><b>解析提示</b>{warnings.map((warning, i) => <span key={`${warning}-${i}`}>{warning}</span>)}</section>}
    </main>
  </div>;
}
