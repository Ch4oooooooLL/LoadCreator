import { useRef, useState, type ReactNode } from "react";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import NumericInput from "@/components/NumericInput";
import InfoTip, { HoverTipWrap, type TooltipMeta } from "@/components/InfoTip";
import { CopyIcon, DownloadIcon, PlusIcon, TrashIcon } from "@/components/Icons";
import {
  collectRadiossFunctionsForExport,
  createDefaultRadiossFunction,
  createDefaultRadiossGravity,
  createDefaultRadiossTh,
  num,
  optInt,
  renderRadiossFunctionsCsvClient,
  type Draft,
} from "@/lib/caseDrafts";
import {
  exportRadiossFunctionsTable,
  isDesktop,
  readRadiossCurveFile,
} from "@/lib/caseApi";
import {
  ANIM_ELEM_CATALOG,
  ANIM_NODA_CATALOG,
  ANIM_VECT_CATALOG,
  ENGINE_HELP,
  FUNCTIONS_HELP,
  GRAVITY_HELP,
  TFILE_TYPE_OPTIONS,
  TH_KIND_CATALOG,
  oneGForUnits,
  type RadiossOptionMeta,
} from "@/lib/radiossCatalog";

function downloadBlobText(name: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback below */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function parsePastedCurveText(text: string): Array<{ time: string; value: string }> {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  const parsed: Array<{ time: string; value: string }> = [];
  for (const line of lines) {
    const cols = line
      .split(/[\t,;，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const nums = cols
      .map((c) => {
        const m = c.match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
      })
      .filter((v) => Number.isFinite(v));
    if (nums.length >= 2) {
      // If 3 numeric columns and first looks like 1,2,3 index, take cols 1 & 2
      if (nums.length >= 3 && Number.isInteger(nums[0]) && nums[0] === parsed.length + 1) {
        parsed.push({ time: String(nums[1]), value: String(nums[2]) });
      } else {
        parsed.push({ time: String(nums[0]), value: String(nums[1]) });
      }
    }
  }
  return parsed;
}

export function HoverField({
  label,
  hint,
  tip,
  span,
  children,
}: {
  label: string;
  hint?: string;
  tip?: TooltipMeta;
  span?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <HoverTipWrap {...(tip ?? { text: null })} className={"wbField" + (span ? " span" + span : "")}>
      {tip ? (
        <span className="wbFieldLabel">
          <span>{label}</span>
          {hint && <em>{hint}</em>}
          <span className="infoTipDot" aria-hidden="true">?</span>
        </span>
      ) : (
        <span className="wbFieldLabel">
          <span>{label}</span>
          {hint && <em>{hint}</em>}
        </span>
      )}
      {children}
    </HoverTipWrap>
  );
}

function AnimOptionGrid({
  catalog,
  selected,
  onChange,
  extraActions,
}: {
  catalog: RadiossOptionMeta[];
  selected: string[];
  onChange: (next: string[]) => void;
  extraActions?: ReactNode;
}) {
  const selectedSet = new Set(selected.map((s) => s.toUpperCase()));
  const defaultKeys = catalog.filter((item) => item.defaultChecked).map((item) => item.key);
  const groups: string[] = [];
  for (const item of catalog) {
    if (!groups.includes(item.group)) groups.push(item.group);
  }

  const toggle = (key: string) => {
    const up = key.toUpperCase();
    if (selectedSet.has(up)) {
      onChange(selected.filter((x) => x.toUpperCase() !== up));
    } else {
      onChange([...selected, up]);
    }
  };

  return (
    <div className="animCatalogWrap">
      <div className="animCatalogToolbar">
        <span className="animSelectedCount">
          已勾选 <b>{selected.length}</b> / {catalog.length} 项
        </span>
        <div className="btnCluster">
          <button type="button" className="btnMini" onClick={() => onChange([...defaultKeys])}>
            恢复图中默认 ({defaultKeys.length})
          </button>
          {extraActions}
          <button type="button" className="btnMini" onClick={() => onChange([])}>
            清空
          </button>
        </div>
      </div>

      {groups.map((groupName) => (
        <div className="animGroupBlock" key={groupName}>
          <div className="animGroupTitle">{groupName}</div>
          <div className="animCheckGrid">
            {catalog
              .filter((item) => item.group === groupName)
              .map((item) => {
                const checked = selectedSet.has(item.key.toUpperCase());
                return (
                  <HoverTipWrap
                    key={item.key}
                    title={`${item.key} · ${item.label}`}
                    keyword={item.keyword}
                    summary={item.summary}
                    text={item.detail}
                  >
                    <label
                      className={
                        "animCheckItem" +
                        (checked ? " checked" : "") +
                        (item.defaultChecked ? " refDefault" : "")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(item.key)}
                      />
                      <span className="animCheckCode">{item.key}</span>
                      <span className="animCheckName">{item.label}</span>
                      {item.defaultChecked && (
                        <span className="animDefaultBadge">
                          图选
                        </span>
                      )}
                    </label>
                  </HoverTipWrap>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RadiossCurveTableEditor({
  title,
  xHeader,
  yHeader,
  points,
  onChange,
  presets,
  onNotify,
  exportName,
}: {
  title: string;
  xHeader: string;
  yHeader: string;
  points: Draft[];
  onChange: (next: Draft[]) => void;
  presets?: Array<{ label: string; tip: string; build: () => Array<{ time: string; value: string }> }>;
  onNotify?: (msg: string) => void;
  exportName?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePaste = (e: React.ClipboardEvent<HTMLTableElement>) => {
    const raw = e.clipboardData.getData("text/plain");
    if (!raw || (!raw.includes("\t") && !raw.includes("\n") && !raw.includes(","))) return;
    const parsed = parsePastedCurveText(raw);
    if (parsed.length >= 2) {
      e.preventDefault();
      onChange(parsed);
      onNotify?.(`已从剪贴板粘贴 ${parsed.length} 个曲线点`);
    }
  };

  const handleImportFile = async () => {
    if (!isDesktop()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const path = await openDialog({
        multiple: false,
        title: `导入曲线数据 (${title})`,
        filters: [
          { name: "曲线表格", extensions: ["csv", "txt", "tsv", "xlsx", "xls", "ods"] },
          { name: "所有文件", extensions: ["*"] },
        ],
      });
      if (!path || Array.isArray(path)) return;
      const res = await readRadiossCurveFile(path);
      if (res.points.length === 0) {
        onNotify?.("未在文件中识别到有效 (X, Y) 曲线点");
        return;
      }
      onChange(res.points.map((p) => ({ time: String(p.time), value: String(p.value) })));
      onNotify?.(`已导入 ${res.points.length} 个点（${res.sourceKind.toUpperCase()}）`);
    } catch (err) {
      onNotify?.(`导入曲线失败：${String(err)}`);
    }
  };

  const handleCopyTsv = async () => {
    const tsv = [
      `${xHeader}\t${yHeader}`,
      ...points.map((p) => `${p.time ?? ""}\t${p.value ?? ""}`),
    ].join("\n");
    const ok = await copyTextSafe(tsv);
    onNotify?.(ok ? "已复制曲线表格（可直接粘贴到 Excel）" : "剪贴板不可用");
  };

  const handleExportSingleCsv = async () => {
    const csv =
      "\ufeff" +
      [
        `${xHeader},${yHeader}`,
        ...points.map((p) => `${p.time ?? ""},${p.value ?? ""}`),
      ].join("\n") +
      "\n";
    const fileName = `${exportName || "radioss_function"}.csv`;
    if (!isDesktop()) {
      downloadBlobText(fileName, csv, "text/csv;charset=utf-8");
      onNotify?.(`已下载 ${fileName}`);
      return;
    }
    try {
      const path = await saveDialog({
        defaultPath: fileName,
        filters: [{ name: "CSV 表格", extensions: ["csv"] }],
      });
      if (!path) return;
      await exportRadiossFunctionsTable(path, "csv", [
        {
          id: 1,
          title: exportName || "FUNCT",
          role: title,
          xLabel: xHeader,
          yLabel: yHeader,
          points: points.map((p) => ({ time: num(p.time), value: num(p.value) })),
        },
      ]);
      onNotify?.(`已导出表格：${path}`);
    } catch (err) {
      onNotify?.(`导出失败：${String(err)}`);
    }
  };

  return (
    <div className="curveEditorBox">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,.tsv"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            void f.text().then((txt) => {
              const parsed = parsePastedCurveText(txt);
              if (parsed.length > 0) {
                onChange(parsed);
                onNotify?.(`已导入 ${parsed.length} 个曲线点`);
              }
            });
          }
          e.target.value = "";
        }}
      />

      <div className="curveEditorToolbar">
        <div className="presetRow">
          {presets?.map((pr) => (
            <HoverTipWrap key={pr.label} title={pr.label} text={pr.tip}>
              <button
                type="button"
                className="presetBtn"
                onClick={() => onChange(pr.build())}
              >
                {pr.label}
              </button>
            </HoverTipWrap>
          ))}
        </div>
        <div className="btnCluster">
          <button type="button" className="btnMini" onClick={() => void handleImportFile()}>
            导入 CSV/XLSX
          </button>
          <button type="button" className="btnMini" onClick={() => void handleCopyTsv()}>
            <CopyIcon size={12} /> 复制表格
          </button>
          <button type="button" className="btnMini" onClick={() => void handleExportSingleCsv()}>
            <DownloadIcon size={12} /> 导出 CSV
          </button>
          <button
            type="button"
            className="btnMini"
            onClick={() => onChange([...points, { time: "", value: "" }])}
          >
            <PlusIcon size={13} /> 加点
          </button>
        </div>
      </div>

      <div className="compactTableWrap">
        <table className="compactTable" onPaste={handlePaste}>
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th>{xHeader}</th>
              <th>{yHeader}</th>
              <th style={{ width: 38 }} />
            </tr>
          </thead>
          <tbody>
            {points.map((p, index) => (
              <tr key={index}>
                <td className="rowNum">{index + 1}</td>
                <td>
                  <NumericInput
                    value={num(p.time)}
                    onCommit={(v) => {
                      const next = [...points];
                      next[index] = { ...next[index], time: String(v) };
                      onChange(next);
                    }}
                  />
                </td>
                <td>
                  <NumericInput
                    value={num(p.value)}
                    onCommit={(v) => {
                      const next = [...points];
                      next[index] = { ...next[index], value: String(v) };
                      onChange(next);
                    }}
                  />
                </td>
                <td className="rowOp">
                  <button
                    type="button"
                    className="iconTrashBtn"
                    title="删除点"
                    onClick={() => onChange(points.filter((_, i) => i !== index))}
                  >
                    <TrashIcon size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tableInlineFoot">
        <span className="wbFieldHint">
          共 {points.length} 点 · 支持从 Excel / WPS 复制两列 (X, Y) 后在表格内 Ctrl+V 直接粘贴。
        </span>
      </div>
    </div>
  );
}

export function RadiossFunctionsManager({
  draft,
  patch,
  onNotify,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
  onNotify?: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const extras = Array.isArray(draft.functions) ? (draft.functions as Draft[]) : [];
  const allFunctions = collectRadiossFunctionsForExport(draft);
  const timeUnit = String(draft.workTime || "ms");

  const handleExportAll = async (format: "csv" | "xlsx") => {
    const stem = String(draft.runName || draft.name || "RADIOSS").replace(/[^a-zA-Z0-9_.-]+/g, "_");
    const defaultName = `${stem}_functions.${format}`;
    if (!isDesktop()) {
      if (format === "csv") {
        downloadBlobText(defaultName, renderRadiossFunctionsCsvClient(allFunctions), "text/csv;charset=utf-8");
        onNotify?.(`已导出 ${defaultName}`);
      } else {
        onNotify?.("Excel (.xlsx) 多工作表导出需在桌面端应用运行，已可导出 CSV 表格。");
      }
      return;
    }
    try {
      const path = await saveDialog({
        defaultPath: defaultName,
        filters:
          format === "xlsx"
            ? [{ name: "Excel 工作簿 (.xlsx)", extensions: ["xlsx"] }]
            : [{ name: "CSV 表格 (.csv)", extensions: ["csv"] }],
      });
      if (!path) return;
      const written = await exportRadiossFunctionsTable(path, format, allFunctions);
      onNotify?.(`已导出 Radioss Functions 表格：${written}`);
    } catch (err) {
      onNotify?.(`导出 Functions 表格失败：${String(err)}`);
    }
  };

  const handleCopyAllTsv = async () => {
    const lines = ["Function_ID\tFunction_Title\tRole\tPoint_Index\tX\tY"];
    for (const fn of allFunctions) {
      fn.points.forEach((pt, idx) => {
        lines.push(`${fn.id}\t${fn.title}\t${fn.role}\t${idx + 1}\t${pt.time}\t${pt.value}`);
      });
    }
    const ok = await copyTextSafe(lines.join("\n"));
    onNotify?.(ok ? `已复制全部 ${allFunctions.length} 条 Functions 表格至剪贴板` : "剪贴板不可用");
  };

  return (
    <div className="subBox" style={{ marginTop: 12 }}>
      <div className="bcsCardTop">
        <HoverTipWrap {...FUNCTIONS_HELP.section}>
          <div className="contactTitleRow">
            <span className="bcsCardTitle">
              Radioss Functions 表格输出与自定义函数库 (/FUNCT)
            </span>
            <span className="contactBaselineTag">{allFunctions.length} 条曲线</span>
            <InfoTip {...FUNCTIONS_HELP.section} />
          </div>
        </HoverTipWrap>
        <div className="btnCluster">
          <button type="button" className="btnMini" title="复制带表头的制表符分隔文本，可粘贴到 Excel。" onClick={() => void handleCopyAllTsv()}>
            <CopyIcon size={12} /> 复制总表
          </button>
          <button type="button" className="btnMini" title="将全部函数的 X/Y 点写入一个 UTF-8 CSV，包含函数编号、名称和用途。" onClick={() => void handleExportAll("csv")}>
            <DownloadIcon size={12} /> 输出 CSV 表格
          </button>
          <button type="button" className="btnMini" title="桌面端导出 Excel 工作簿，包含汇总页以及每条函数的 X/Y 两列表。" onClick={() => void handleExportAll("xlsx")}>
            <DownloadIcon size={12} /> 输出 Excel (.xlsx)
          </button>
          <button
            type="button"
            className="btnMini"
            title="新增可写入增量文件的独立 X/Y 函数，可指定模型中的空闲 ID。"
            onClick={() => {
              patch("functions", [...extras, createDefaultRadiossFunction(extras.length + 1)]);
              setExpanded(true);
            }}
          >
            <PlusIcon size={13} /> 新增附加 /FUNCT
          </button>
          <button type="button" className="btnMini" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收起明细" : "展开表格预览"}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="compactTableWrap">
            <table className="compactTable">
              <thead>
                <tr>
                  <th>Function ID</th>
                  <th>ASCII 名称</th>
                  <th>曲线用途</th>
                  <th>点数</th>
                  <th>X 范围</th>
                  <th>Y 范围</th>
                </tr>
              </thead>
              <tbody>
                {allFunctions.map((fn, idx) => {
                  const xs = fn.points.map((p) => p.time);
                  const ys = fn.points.map((p) => p.value);
                  const xRange = xs.length ? `${Math.min(...xs)} ~ ${Math.max(...xs)}` : "—";
                  const yRange = ys.length ? `${Math.min(...ys)} ~ ${Math.max(...ys)}` : "—";
                  return (
                    <tr key={`${fn.id}-${idx}`}>
                      <td className="mono">{fn.id}</td>
                      <td className="mono">{fn.title}</td>
                      <td>{fn.role}</td>
                      <td className="mono">{fn.points.length}</td>
                      <td className="mono">{xRange}</td>
                      <td className="mono">{yRange}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {extras.map((fn, idx) => (
            <div className="bcsCard" key={idx}>
              <div className="bcsCardTop">
                <span className="bcsCardTitle">附加曲线 #{idx + 1} · /FUNCT</span>
                <button
                  type="button"
                  className="iconTrashBtn"
                  title="删除自定义曲线"
                  onClick={() => patch("functions", extras.filter((_, i) => i !== idx))}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
              <div className="formGrid3" style={{ marginTop: 8 }}>
                <HoverField
                  label="ASCII Title"
                  tip={{
                    title: "Function 标题",
                    keyword: "/FUNCT/<ID>",
                    text: "仅限 ASCII 字符，将写入 .rad 与导出表格的 Function_Title 列。",
                  }}
                >
                  <input
                    className="wbInput mono"
                    value={fn.title ?? ""}
                    onChange={(e) => {
                      const next = [...extras];
                      next[idx] = { ...next[idx], title: e.target.value };
                      patch("functions", next);
                    }}
                  />
                </HoverField>
                <HoverField
                  label="指定 Function ID"
                  hint="留空=自动分配"
                  tip={{
                    title: "显式指定 /FUNCT ID",
                    keyword: "funct_ID",
                    text: "留空时由确定性分配器在 FUNCT 族（810001+）自动分配；如需与外部卡片固定编号对接可手动指定正整数。",
                  }}
                >
                  <input
                    className="wbInput mono"
                    value={fn.explicitId ?? ""}
                    placeholder="自动分配"
                    onChange={(e) => {
                      const next = [...extras];
                      next[idx] = { ...next[idx], explicitId: e.target.value };
                      patch("functions", next);
                    }}
                  />
                </HoverField>
                <HoverField
                  label="备注用途"
                  tip={{
                    title: "表格备注列",
                    text: "仅用于导出 CSV/Excel 表格中的用途说明，不写入 .rad。",
                  }}
                >
                  <input
                    className="wbInput"
                    value={fn.note ?? ""}
                    placeholder="例如 摩擦曲线 / 材料缩放"
                    onChange={(e) => {
                      const next = [...extras];
                      next[idx] = { ...next[idx], note: e.target.value };
                      patch("functions", next);
                    }}
                  />
                </HoverField>
              </div>
              <div style={{ marginTop: 8 }}>
                <RadiossCurveTableEditor
                  title={String(fn.title || `FUNCT_${idx + 1}`)}
                  xHeader={`X (${timeUnit})`}
                  yHeader="Y (Value)"
                  points={Array.isArray(fn.points) ? (fn.points as Draft[]) : []}
                  exportName={String(fn.title || `FUNCT_${idx + 1}`)}
                  onNotify={onNotify}
                  onChange={(nextPts) => {
                    const next = [...extras];
                    next[idx] = { ...next[idx], points: nextPts };
                    patch("functions", next);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RadiossGravitySection({
  draft,
  patch,
  fops,
  onNotify,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
  fops: boolean;
  onNotify?: (msg: string) => void;
}) {
  const gravities = Array.isArray(draft.gravities) ? (draft.gravities as Draft[]) : [];
  const oneG = oneGForUnits(
    String(draft.workLength || "mm"),
    String(draft.workTime || "ms"),
  );
  const endT = num(draft.endTime) || (fops ? 0.05 : 0.1);
  const timeUnit = String(draft.workTime || "ms");

  const updateGrav = (idx: number, nextItem: Draft) => {
    const next = [...gravities];
    next[idx] = nextItem;
    patch("gravities", next);
  };

  return (
    <div className="bcsCardList">
      <div className="gravTopToolbar">
        <HoverTipWrap {...GRAVITY_HELP.section}>
          <span className="wbFieldHint">
            当前工作单位下 <code>1 g = {oneG.value} {oneG.unitLabel}</code>
            {fops ? "（FOPS 推荐启用 -Z 重力曲线或恒定重力场）" : "（按需可加恒定或曲线驱动重力场）"}
            {" "}
            <InfoTip {...GRAVITY_HELP.section} />
          </span>
        </HoverTipWrap>
        <div className="btnCluster">
          <button
            type="button"
            className="btnMini"
            onClick={() =>
              patch("gravities", [
                ...gravities,
                createDefaultRadiossGravity({
                  fops,
                  mode: "curve",
                  title: `${fops ? "FOPS" : "ROPS"}_GRAV_CURVE_${gravities.length + 1}`,
                  oneG: oneG.value,
                  endTime: endT,
                }),
              ])
            }
          >
            <PlusIcon size={13} /> 添加重力曲线工况 (/GRAV + /FUNCT)
          </button>
          <button
            type="button"
            className="btnMini"
            onClick={() =>
              patch("gravities", [
                ...gravities,
                createDefaultRadiossGravity({
                  fops,
                  mode: "constant",
                  title: `${fops ? "FOPS" : "ROPS"}_GRAV_CONST_${gravities.length + 1}`,
                  oneG: oneG.value,
                  endTime: endT,
                }),
              ])
            }
          >
            <PlusIcon size={13} /> 添加恒定重力场 (/GRAV)
          </button>
        </div>
      </div>

      {gravities.length === 0 ? (
        <div className="contactEmptyState">
          <p>
            当前未启用重力场工况。点击右上方按钮即可添加“重力曲线驱动”或“恒定重力场” <code>/GRAV</code> 卡片。
          </p>
        </div>
      ) : (
        gravities.map((g, idx) => {
          const isCurve = g.mode === "curve";
          const dirToken = String(g.direction || "-Z").toUpperCase();
          const sign = dirToken.startsWith("-") ? -1 : 1;
          const axis = dirToken.replace(/^[+-]/, "") || "Z";
          const rawMag = isCurve
            ? (String(g.fScale ?? "").trim() !== "" ? num(g.fScale) : num(g.magnitude) || 1)
            : (String(g.fScale ?? "").trim() !== "" ? num(g.fScale) : num(g.magnitude));
          const effScale = sign * rawMag;
          const isEnabled = g.enabled !== false;

          return (
            <div className="bcsCard" key={idx}>
              <div className="bcsCardTop">
                <div className="contactTitleRow">
                  <HoverTipWrap title="重力场状态" keyword="/GRAV" text="勾选后将此重力场写入增量文件。取消勾选可保留当前设置，便于切换工况。">
                  <label className="wbSwitchRow">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => updateGrav(idx, { ...g, enabled: e.target.checked })}
                    />
                    <span className="bcsCardTitle">
                      重力场工况 #{idx + 1} · {isCurve ? "重力曲线驱动 (/GRAV + /FUNCT)" : "恒定重力场 (/GRAV)"}
                    </span>
                  </label>
                  </HoverTipWrap>
                  <span className="contactBaselineTag">
                    输出 Dir={axis} · Fscale_Y={effScale} {oneG.unitLabel}
                  </span>
                </div>
                <button
                  type="button"
                  className="iconTrashBtn"
                  title="删除重力工况"
                  onClick={() => patch("gravities", gravities.filter((_, i) => i !== idx))}
                >
                  <TrashIcon size={14} />
                </button>
              </div>

              <div className="formGrid3" style={{ marginTop: 10 }}>
                <HoverField
                  label="ASCII 标题"
                  tip={{
                    title: "重力场卡片标题",
                    keyword: "grav_title",
                    text: "仅支持 ASCII 字符，作为 /GRAV/<ID> 卡片标题写入 .rad。",
                  }}
                >
                  <input
                    className="wbInput mono"
                    value={g.title ?? ""}
                    disabled={!isEnabled}
                    onChange={(e) => updateGrav(idx, { ...g, title: e.target.value })}
                  />
                </HoverField>

                <HoverField label="重力加载方式" tip={GRAVITY_HELP.mode}>
                  <div className="segControl">
                    <button
                      type="button"
                      className={"segBtn" + (!isCurve ? " active" : "")}
                      disabled={!isEnabled}
                      onClick={() => updateGrav(idx, { ...g, mode: "constant" })}
                    >
                      恒定重力 (fct=0)
                    </button>
                    <button
                      type="button"
                      className={"segBtn" + (isCurve ? " active" : "")}
                      disabled={!isEnabled}
                      onClick={() =>
                        updateGrav(idx, {
                          ...g,
                          mode: "curve",
                          curve:
                            Array.isArray(g.curve) && g.curve.length >= 2
                              ? g.curve
                              : [
                                  { time: "0", value: "0" },
                                  { time: String(Number((endT * 0.2).toPrecision(4)) || 0.01), value: "1" },
                                  { time: String(endT), value: "1" },
                                ],
                        })
                      }
                    >
                      重力曲线 (/FUNCT)
                    </button>
                  </div>
                </HoverField>

                <HoverField label="方向与极性" tip={GRAVITY_HELP.direction}>
                  <div className="presetRow">
                    {["+X", "-X", "+Y", "-Y", "+Z", "-Z"].map((ax) => (
                      <button
                        key={ax}
                        type="button"
                        disabled={!isEnabled}
                        className={"presetBtn" + (dirToken === ax || (dirToken === ax.slice(1) && ax.startsWith("+")) ? " active" : "")}
                        onClick={() => updateGrav(idx, { ...g, direction: ax })}
                      >
                        {ax}
                      </button>
                    ))}
                  </div>
                </HoverField>

                {!isCurve ? (
                  <HoverField
                    label={`重力加速度幅值 (${oneG.unitLabel})`}
                    tip={GRAVITY_HELP.magnitude}
                  >
                    <div className="inlineInputWithBtn">
                      <input
                        className="wbInput mono"
                        value={g.magnitude ?? ""}
                        disabled={!isEnabled}
                        onChange={(e) =>
                          updateGrav(idx, { ...g, magnitude: e.target.value, fScale: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="btnMini"
                        disabled={!isEnabled}
                        onClick={() =>
                          updateGrav(idx, {
                            ...g,
                            magnitude: String(oneG.value),
                            fScale: String(oneG.value),
                          })
                        }
                      >
                        1g
                      </button>
                    </div>
                  </HoverField>
                ) : (
                  <>
                    <HoverField
                      label={`纵轴缩放 Fscale_Y (${oneG.unitLabel} 或 1.0)`}
                      tip={GRAVITY_HELP.fScale}
                    >
                      <div className="inlineInputWithBtn">
                        <input
                          className="wbInput mono"
                          value={g.fScale ?? g.magnitude ?? String(oneG.value)}
                          disabled={!isEnabled}
                          onChange={(e) => updateGrav(idx, { ...g, fScale: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btnMini"
                          disabled={!isEnabled}
                          onClick={() => updateGrav(idx, { ...g, fScale: String(oneG.value) })}
                        >
                          1g
                        </button>
                      </div>
                    </HoverField>
                    <HoverField label="时间缩放 Ascale_x" tip={GRAVITY_HELP.aScale}>
                      <input
                        className="wbInput mono"
                        value={g.aScale ?? "1.0"}
                        disabled={!isEnabled}
                        onChange={(e) => updateGrav(idx, { ...g, aScale: e.target.value })}
                      />
                    </HoverField>
                  </>
                )}

                <HoverField label="作用节点组 grnd_ID" hint="0=全模型" tip={GRAVITY_HELP.grnodId}>
                  <input
                    className="wbInput mono"
                    value={g.grnodId ?? "0"}
                    disabled={!isEnabled}
                    onChange={(e) => updateGrav(idx, { ...g, grnodId: e.target.value })}
                  />
                </HoverField>

                <HoverField label="局部坐标系 skew_ID" hint="0=全局" tip={GRAVITY_HELP.skewId}>
                  <input
                    className="wbInput mono"
                    value={g.skewId ?? "0"}
                    disabled={!isEnabled}
                    onChange={(e) => updateGrav(idx, { ...g, skewId: e.target.value })}
                  />
                </HoverField>

                <HoverField label="传感器 sens_ID" hint="0=t=0生效" tip={GRAVITY_HELP.sensorId}>
                  <input
                    className="wbInput mono"
                    value={g.sensorId ?? "0"}
                    disabled={!isEnabled}
                    onChange={(e) => updateGrav(idx, { ...g, sensorId: e.target.value })}
                  />
                </HoverField>

                {isCurve && (
                  <HoverField
                    label="引用已有 Function ID"
                    hint="留空=由下方曲线表自动新建"
                    tip={{
                      title: "外部或已有 /FUNCT ID",
                      keyword: "fct_IDT",
                      text: "填写正整数时直接引用该 /FUNCT，保留编辑过的曲线点，清空 ID 后恢复使用本地曲线。",
                    }}
                  >
                    <input
                      className="wbInput mono"
                      value={g.existingFunctId ?? ""}
                      disabled={!isEnabled}
                      placeholder="留空=自动新建 /FUNCT"
                      onChange={(e) => updateGrav(idx, { ...g, existingFunctId: e.target.value })}
                    />
                  </HoverField>
                )}
              </div>

              {isCurve && !optInt(g.existingFunctId) && isEnabled && (
                <div style={{ marginTop: 10 }}>
                  <RadiossCurveTableEditor
                    title={`重力曲线 #${idx + 1}`}
                    xHeader={`时间 (${timeUnit})`}
                    yHeader={`重力归一化系数 (实际=${effScale}×Y)`}
                    points={Array.isArray(g.curve) ? (g.curve as Draft[]) : []}
                    exportName={String(g.title || `GRAV_CURVE_${idx + 1}`)}
                    onNotify={onNotify}
                    presets={[
                      {
                        label: "斜坡预平衡 (0→1)",
                        tip: "t=0 从 0 平滑爬坡至 0.2×Tstop 达到 1.0 并保持，避免 t=0 瞬间加重力引起弹性震荡。",
                        build: () => [
                          { time: "0", value: "0" },
                          { time: String(Number((endT * 0.2).toPrecision(4)) || 0.01), value: "1" },
                          { time: String(endT), value: "1" },
                        ],
                      },
                      {
                        label: "恒定阶跃 (1→1)",
                        tip: "全程保持系数 1.0（配合 Fscale_Y = ±1g）。",
                        build: () => [
                          { time: "0", value: "1" },
                          { time: String(endT), value: "1" },
                        ],
                      },
                      {
                        label: "半正弦冲击脉冲",
                        tip: "先升至峰值 1.0 再回落的半正弦重力/惯性脉冲曲线。",
                        build: () => {
                          const t1 = Number((endT * 0.25).toPrecision(4));
                          const t2 = Number((endT * 0.5).toPrecision(4));
                          const t3 = Number((endT * 0.75).toPrecision(4));
                          return [
                            { time: "0", value: "0" },
                            { time: String(t1), value: "0.707" },
                            { time: String(t2), value: "1" },
                            { time: String(t3), value: "0.707" },
                            { time: String(endT), value: "0" },
                          ];
                        },
                      },
                    ]}
                    onChange={(nextPts) => updateGrav(idx, { ...g, curve: nextPts })}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export function RadiossTimeHistorySection({
  draft,
  patch,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
}) {
  const ths = Array.isArray(draft.timeHistories) ? (draft.timeHistories as Draft[]) : [];
  const contacts = Array.isArray(draft.contacts) ? (draft.contacts as Draft[]) : [];

  const addPreset = (preset: Parameters<typeof createDefaultRadiossTh>[0]) => {
    const item = createDefaultRadiossTh(preset);
    if (preset === "contact" && contacts.length > 0) {
      item.contactIndices = contacts.map((_, i) => i);
      item.objectIdsText = "";
    }
    patch("timeHistories", [...ths, item]);
  };

  const updateTh = (idx: number, nextItem: Draft) => {
    const next = [...ths];
    next[idx] = nextItem;
    patch("timeHistories", next);
  };

  const presetButtons: Array<{
    preset: Parameters<typeof createDefaultRadiossTh>[0];
    label: string;
    tip: string;
  }> = [
    {
      preset: "bolt",
      label: "+ 驾驶室与工装固定螺栓 (SPRING)",
      tip: "添加 /TH/SPRING 卡片，监测驾驶室底座与工装固定螺栓弹簧的三向力、弯矩、伸长量及断裂状态。",
    },
    {
      preset: "bolt-beam",
      label: "+ 螺栓梁单元 (BEAM)",
      tip: "添加 /TH/BEAM 卡片，若固定螺栓采用梁单元建模，输出轴力 F1、剪力 F2/F3 与弯矩 M1/M2/M3。",
    },
    {
      preset: "rwall-rbe2",
      label: "+ 边界 / 刚性墙 RBE2 主节点",
      tip: "填写 /RBE2 的主节点 ID，通过 /TH/NODE 追踪运动及该节点受约束自由度的反力和力矩。各 RBE2 的连接合力可按需要通过模型截面统计。",
    },
    {
      preset: "rbody",
      label: "+ 工装刚体 (RBODY)",
      tip: "填写原模型中 /RBODY 的刚体 ID，输出刚体的三向力、力矩和转动。",
    },
    {
      preset: "rwall",
      label: "+ 刚性墙 (RWALL)",
      tip: "填写 /RWALL ID，监测解析刚性墙承受的法向与切向碰撞反力。",
    },
    {
      preset: "rwall-node",
      label: "+ 刚性墙/边界节点 (NODE)",
      tip: "添加 /TH/NODE 卡片，监测刚性墙节点、加载点或 /BCS 约束节点的位移、加速度与支反力 REACX/Y/Z。",
    },
    {
      preset: "contact",
      label: "+ 工装接触力 (INTER)",
      tip: "添加 /TH/INTER 卡片，自动绑定当前配置的 /INTER/TYPE7 接触面并输出接触法向力与摩擦力曲线。",
    },
    {
      preset: "sectio",
      label: "+ 螺栓/立柱截面 (SECTIO)",
      tip: "添加 /TH/SECTIO 卡片，监测截面合力、弯矩与做功。",
    },
    {
      preset: "part",
      label: "+ 部件能量 (PART)",
      tip: "添加 /TH/PART 卡片，输出各 Part 内能 IE、动能 KE 与总质量 MASS。",
    },
  ];

  return (
    <div className="bcsCardList">
      <div className="presetRow" style={{ marginBottom: 4 }}>
        <span className="presetLabel">快捷添加 TH 曲线：</span>
        {presetButtons.map((btn) => (
          <HoverTipWrap key={btn.preset} title={btn.label} text={btn.tip}>
            <button
              type="button"
              className="presetBtn"
              onClick={() => addPreset(btn.preset)}
            >
              {btn.label}
            </button>
          </HoverTipWrap>
        ))}
      </div>

      {ths.length === 0 ? (
        <div className="contactEmptyState">
          <p>
            当前未添加 <code>/TH</code> 时程曲线输出请求。点击上方快捷按钮可快速添加固定螺栓、RBE2 刚体、刚性墙、节点反力及接触界面曲线。
          </p>
        </div>
      ) : (
        ths.map((th, idx) => {
          const kind = String(th.kind || "node").toLowerCase();
          const kindMeta =
            TH_KIND_CATALOG.find((k) => k.kind === kind) ?? TH_KIND_CATALOG[0];
          const vars = Array.isArray(th.variables) ? (th.variables as string[]) : [];
          const isEnabled = th.enabled !== false;
          const nodeEntries = Array.isArray(th.nodeEntries) ? (th.nodeEntries as Draft[]) : [];
          const elemEntries = Array.isArray(th.elemEntries) ? (th.elemEntries as Draft[]) : [];
          const contactIndices = Array.isArray(th.contactIndices)
            ? (th.contactIndices as number[])
            : [];

          const toggleVar = (code: string) => {
            const up = code.toUpperCase();
            if (vars.includes(up)) {
              updateTh(idx, { ...th, variables: vars.filter((v) => v !== up) });
            } else if (vars.length < 10) {
              updateTh(idx, { ...th, variables: [...vars, up] });
            }
          };

          return (
            <div className={"bcsCard" + (!isEnabled ? " thCardMuted" : "")} key={idx}>
              <div className="bcsCardTop">
                <div className="contactTitleRow">
                  <HoverTipWrap title={kindMeta.label} keyword={kindMeta.keyword} summary={kindMeta.summary} text={kindMeta.detail}>
                  <label className="wbSwitchRow">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => updateTh(idx, { ...th, enabled: e.target.checked })}
                    />
                    <span className="bcsCardTitle">
                      TH 输出 #{idx + 1} · {th.role === "rwall-rbe2" ? "RBE2 主节点" : kindMeta.label}
                    </span>
                  </label>
                  </HoverTipWrap>
                  <span className="contactBaselineTag">{kindMeta.keyword}</span>
                </div>
                <button
                  type="button"
                  className="iconTrashBtn"
                  title="删除 TH 输出"
                  onClick={() => patch("timeHistories", ths.filter((_, i) => i !== idx))}
                >
                  <TrashIcon size={14} />
                </button>
              </div>

              <div className="formGrid3" style={{ marginTop: 10 }}>
                <HoverField
                  label="输出对象类型"
                  tip={{
                    title: kindMeta.label,
                    keyword: kindMeta.keyword,
                    summary: kindMeta.summary,
                    text: kindMeta.detail,
                  }}
                >
                  <select
                    className="wbInput"
                    value={kind}
                    onChange={(e) => {
                      const nextKind = e.target.value;
                      const nextMeta =
                        TH_KIND_CATALOG.find((k) => k.kind === nextKind) ?? TH_KIND_CATALOG[0];
                      updateTh(idx, {
                        ...th,
                        kind: nextKind,
                        role: "custom",
                        variables: [...nextMeta.defaultVars],
                      });
                    }}
                  >
                    {TH_KIND_CATALOG.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.keyword} — {k.label}
                      </option>
                    ))}
                  </select>
                </HoverField>

                <HoverField
                  label="ASCII 分组标题 (thgroup_name)"
                  tip={{
                    title: "TH 分组名称",
                    keyword: "thgroup_name",
                    text: "写入 T01 文件与 HyperGraph 曲线浏览器中显示的对象组名称（仅 ASCII）。",
                  }}
                >
                  <input
                    className="wbInput mono"
                    value={th.title ?? ""}
                    onChange={(e) => updateTh(idx, { ...th, title: e.target.value })}
                  />
                </HoverField>

                <HoverField
                  label={`输出变量 (${vars.length}/10)`}
                  hint={vars.length >= 10 ? "已达 Radioss 单卡上限 10 个" : "悬浮选项看解释"}
                  tip={{
                    title: "TH 输出变量选择",
                    keyword: "var_ID 1..10",
                    text: "Radioss 单张 /TH 卡片最多允许同时输出 10 个 var_ID 变量；选用 DEF 可一键输出该实体默认全套曲线。",
                  }}
                >
                  <div className="btnCluster">
                    <button
                      type="button"
                      className="btnMini"
                      onClick={() => updateTh(idx, { ...th, variables: [...kindMeta.defaultVars] })}
                    >
                      默认推荐
                    </button>
                    <button
                      type="button"
                      className="btnMini"
                      onClick={() => updateTh(idx, { ...th, variables: ["DEF"] })}
                    >
                      仅 DEF
                    </button>
                  </div>
                </HoverField>
              </div>

              <div className="thVarChipsRow" style={{ marginTop: 8 }}>
                {kindMeta.varOptions.map((vo) => {
                  const active = vars.includes(vo.code);
                  const disabled = !active && vars.length >= 10;
                  return (
                    <HoverTipWrap
                      key={vo.code}
                      title={`${vo.code} · ${vo.label}`}
                      keyword={kindMeta.keyword}
                      text={vo.desc}
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        className={"checkPill" + (active ? " on" : "")}
                        onClick={() => toggleVar(vo.code)}
                      >
                        {vo.code}
                      </button>
                    </HoverTipWrap>
                  );
                })}
              </div>

              {kind === "node" && (
                <div style={{ marginTop: 10 }}>
                  <div className="bcsCardTop" style={{ marginBottom: 6 }}>
                    <span className="wbFieldLabel">监控节点列表（node_ID / skew_ID / 节点标签）</span>
                    <button
                      type="button"
                      className="btnMini"
                      onClick={() =>
                        updateTh(idx, {
                          ...th,
                          nodeEntries: [...nodeEntries, { nodeId: "", skewId: "0", label: "" }],
                        })
                      }
                    >
                      <PlusIcon size={12} /> 添加节点
                    </button>
                  </div>
                  <div className="compactTableWrap">
                    <table className="compactTable">
                      <thead>
                        <tr>
                          <th>Node ID</th>
                          <th>Skew ID (0=全局)</th>
                          <th>ASCII 标签</th>
                          <th style={{ width: 34 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {nodeEntries.map((ne, ni) => (
                          <tr key={ni}>
                            <td>
                              <input
                                className="wbInput mono"
                                value={ne.nodeId ?? ""}
                                placeholder="例如 1001"
                                onChange={(e) => {
                                  const next = [...nodeEntries];
                                  next[ni] = { ...next[ni], nodeId: e.target.value };
                                  updateTh(idx, { ...th, nodeEntries: next });
                                }}
                              />
                            </td>
                            <td>
                              <input
                                className="wbInput mono"
                                value={ne.skewId ?? "0"}
                                onChange={(e) => {
                                  const next = [...nodeEntries];
                                  next[ni] = { ...next[ni], skewId: e.target.value };
                                  updateTh(idx, { ...th, nodeEntries: next });
                                }}
                              />
                            </td>
                            <td>
                              <input
                                className="wbInput mono"
                                value={ne.label ?? ""}
                                placeholder="NODE_NAME"
                                onChange={(e) => {
                                  const next = [...nodeEntries];
                                  next[ni] = { ...next[ni], label: e.target.value };
                                  updateTh(idx, { ...th, nodeEntries: next });
                                }}
                              />
                            </td>
                            <td className="rowOp">
                              <button
                                type="button"
                                className="iconTrashBtn"
                                onClick={() =>
                                  updateTh(idx, {
                                    ...th,
                                    nodeEntries: nodeEntries.filter((_, i) => i !== ni),
                                  })
                                }
                              >
                                <TrashIcon size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(kind === "spring" || kind === "beam") && (
                <div style={{ marginTop: 10 }}>
                  <div className="bcsCardTop" style={{ marginBottom: 6 }}>
                    <span className="wbFieldLabel">
                      监控{kind === "spring" ? "弹簧/螺栓" : "梁"}单元列表（elem_ID / 单元名称）
                    </span>
                    <button
                      type="button"
                      className="btnMini"
                      onClick={() =>
                        updateTh(idx, {
                          ...th,
                          elemEntries: [...elemEntries, { elemId: "", label: "" }],
                        })
                      }
                    >
                      <PlusIcon size={12} /> 添加单元
                    </button>
                  </div>
                  <div className="compactTableWrap">
                    <table className="compactTable">
                      <thead>
                        <tr>
                          <th>Element ID (必填正整数)</th>
                          <th>ASCII 名称 (如 CAB_BOLT_FL)</th>
                          <th style={{ width: 34 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {elemEntries.map((ee, ei) => (
                          <tr key={ei}>
                            <td>
                              <input
                                className="wbInput mono"
                                value={ee.elemId ?? ""}
                                placeholder="例如 50001"
                                onChange={(e) => {
                                  const next = [...elemEntries];
                                  next[ei] = { ...next[ei], elemId: e.target.value };
                                  updateTh(idx, { ...th, elemEntries: next });
                                }}
                              />
                            </td>
                            <td>
                              <input
                                className="wbInput mono"
                                value={ee.label ?? ""}
                                placeholder="BOLT_1"
                                onChange={(e) => {
                                  const next = [...elemEntries];
                                  next[ei] = { ...next[ei], label: e.target.value };
                                  updateTh(idx, { ...th, elemEntries: next });
                                }}
                              />
                            </td>
                            <td className="rowOp">
                              <button
                                type="button"
                                className="iconTrashBtn"
                                onClick={() =>
                                  updateTh(idx, {
                                    ...th,
                                    elemEntries: elemEntries.filter((_, i) => i !== ei),
                                  })
                                }
                              >
                                <TrashIcon size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {kind !== "node" && kind !== "spring" && kind !== "beam" && (
                <div className="formGrid2" style={{ marginTop: 10 }}>
                  <HoverField
                    label="目标对象 ID（逗号分隔）"
                    tip={{
                      title: "Obj_ID 对象编号",
                      keyword: kindMeta.keyword,
                      text: "填入一个或多个对应模型实体的正整数 ID。若已绑定本模块生成的接触，可留空。",
                    }}
                  >
                    <input
                      className="wbInput mono"
                      value={th.objectIdsText ?? ""}
                      placeholder="例如 1201,1202"
                      onChange={(e) => updateTh(idx, { ...th, objectIdsText: e.target.value })}
                    />
                  </HoverField>

                  {kind === "inter" && contacts.length > 0 && (
                    <HoverField
                      label="绑定本文件生成的 /INTER/TYPE7"
                      tip={{
                        title: "自动引用本模块接触 ID",
                        keyword: "/INTER/TYPE7",
                        text: "勾选后将本模块分配的接触接口 ID 写入 /TH/INTER。",
                      }}
                    >
                      <div className="checkPills">
                        {contacts.map((ct, cIdx) => {
                          const linked = contactIndices.includes(cIdx);
                          return (
                            <button
                              key={cIdx}
                              type="button"
                              className={"checkPill" + (linked ? " on" : "")}
                              onClick={() => {
                                const next = linked
                                  ? contactIndices.filter((x) => x !== cIdx)
                                  : [...contactIndices, cIdx];
                                updateTh(idx, { ...th, contactIndices: next });
                              }}
                            >
                              接触 #{cIdx + 1} ({ct.title || "TYPE7"})
                            </button>
                          );
                        })}
                      </div>
                    </HoverField>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

type EngineTabKey = "base" | "elem" | "noda" | "vect";

export function RadiossEngineSection({
  draft,
  patch,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
}) {
  const [tab, setTab] = useState<EngineTabKey>("base");
  const ctrl = (draft.engineControl ?? {}) as Draft;
  const setCtrl = (k: string, v: unknown) =>
    patch("engineControl", { ...ctrl, [k]: v });

  const aliases: Record<string, string> = { ENER: "ENERGY", P: "PRES", THICK: "THIC", EPSX: "TRUSS/EPSX" };
  const animElem = Array.isArray(ctrl.animElem)
    ? Array.from(new Set((ctrl.animElem as string[]).map((value) => {
        const key = value.trim().toUpperCase();
        return aliases[key] ?? key;
      })))
    : [];
  const animNoda = Array.isArray(ctrl.animNoda) ? (ctrl.animNoda as string[]) : [];
  const animVect = Array.isArray(ctrl.animVect) ? (ctrl.animVect as string[]) : [];
  const selectedTfileType = String(ctrl.tfileType ?? "0");
  const emitTfile = ctrl.emitTfile !== false;

  return (
    <div>
      <div className="contactTabs" role="tablist" aria-label="Radioss Engine 控制选项卡">
        <HoverTipWrap {...ENGINE_HELP.engFileData}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "base"}
            className={"contactTab" + (tab === "base" ? " active" : "")}
            onClick={() => setTab("base")}
          >
            1. 基础控制 (FILEDATA/VERS/PARITH/PRINT/TFILE)
          </button>
        </HoverTipWrap>

        <HoverTipWrap
          title="ENG_ANIM_ELEM · 单元动画输出"
          keyword="/ANIM/ELEM/*"
          summary="控制单元级应力、塑性应变、能量与损伤云图输出"
          text="默认勾选 EPSP、ENERGY、VONM、PRES、HOURG。悬浮选项可查看导出关键字和适用条件。"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "elem"}
            className={"contactTab" + (tab === "elem" ? " active" : "")}
            onClick={() => setTab("elem")}
          >
            2. 单元动画 ANIM_ELEM ({animElem.length})
          </button>
        </HoverTipWrap>

        <HoverTipWrap
          title="ENG_ANIM_NODA · 节点标量输出"
          keyword="/ANIM/NODA/*"
          summary="控制节点时间步、质量缩放增量 DMAS/NDMAS 等标量云图"
          text="包含图中 7 项（默认已勾 DMAS）及温度/气囊扩展项。"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "noda"}
            className={"contactTab" + (tab === "noda" ? " active" : "")}
            onClick={() => setTab("noda")}
          >
            3. 节点标量 ANIM_NODA ({animNoda.length})
          </button>
        </HoverTipWrap>

        <HoverTipWrap
          title="ENG_ANIM_VECT · 节点矢量输出"
          keyword="/ANIM/VECT/*"
          summary="控制加速度、接触力、位移与约束反力矢量输出"
          text="默认勾选 ACC、CONT、DISP。可按需增加反力、转动、绑定接触和焊点输出。"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "vect"}
            className={"contactTab" + (tab === "vect" ? " active" : "")}
            onClick={() => setTab("vect")}
          >
            4. 节点矢量 ANIM_VECT ({animVect.length})
          </button>
        </HoverTipWrap>
      </div>

      <div className="contactTabBody">
        {tab === "base" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <HoverTipWrap {...ENGINE_HELP.engFileData}>
              <div className="contactTitleRow">
                <strong className="bcsCardTitle">ENG_FILEDATA</strong>
                <span className="contactBaselineTag">主模型 · Engine 1 · {draft.runName}</span>
              </div>
            </HoverTipWrap>
            {/* 运行时间与动画频率 */}
            <div className="formGrid3">
              <HoverField label="终止时间 Tstop" tip={ENGINE_HELP.endTime}>
                <input
                  className="wbInput mono"
                  value={draft.endTime ?? ""}
                  onChange={(e) => patch("endTime", e.target.value)}
                />
              </HoverField>
              <HoverField label="动画起始 Tstart (/ANIM/DT)" tip={ENGINE_HELP.animDt}>
                <input
                  className="wbInput mono"
                  value={draft.animStart ?? ""}
                  onChange={(e) => patch("animStart", e.target.value)}
                />
              </HoverField>
              <HoverField label="动画输出间隔 ΔT (/ANIM/DT)" tip={ENGINE_HELP.animDt}>
                <input
                  className="wbInput mono"
                  value={draft.animInterval ?? ""}
                  onChange={(e) => patch("animInterval", e.target.value)}
                />
              </HoverField>
            </div>

            {/* 图中四张控制卡片：ENG_VERS, ENG_PARITH, ENG_PRINT, ENG_TFILE */}
            <div className="annotatedGrid2">
              <div className="bcsCard">
                <div className="bcsCardTop">
                  <HoverTipWrap {...ENGINE_HELP.engVers}>
                    <label className="wbSwitchRow">
                      <input
                        type="checkbox"
                        checked={ctrl.emitVers !== false}
                        onChange={(e) => setCtrl("emitVers", e.target.checked)}
                      />
                      <span className="bcsCardTitle">ENG_VERS · /VERS/</span>
                      <InfoTip {...ENGINE_HELP.engVers} />
                    </label>
                  </HoverTipWrap>
                  <span className="contactBaselineTag">图选默认 ☑</span>
                </div>
                <div className="formGrid2" style={{ marginTop: 8 }}>
                  <HoverField label="VersionNum" tip={ENGINE_HELP.engVers}>
                    <input
                      className="wbInput mono"
                      value={ctrl.versionNum ?? "2022"}
                      disabled={ctrl.emitVers === false}
                      onChange={(e) => setCtrl("versionNum", e.target.value)}
                    />
                  </HoverField>
                </div>
              </div>

              <div className="bcsCard">
                <div className="bcsCardTop">
                  <HoverTipWrap {...ENGINE_HELP.engParith}>
                    <span className="bcsCardTitle">
                      ENG_PARITH · /PARITH/ <InfoTip {...ENGINE_HELP.engParith} />
                    </span>
                  </HoverTipWrap>
                  <span className="contactBaselineTag">图选默认 ON</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <HoverField label="Keyword2 (并行算术一致性)" tip={ENGINE_HELP.engParith}>
                    <div className="segControl">
                      {[
                        { value: "ON", label: "ON (位一致推荐)" },
                        { value: "OFF", label: "OFF (不强制)" },
                        { value: "OMIT", label: "不输出此卡" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={
                            "segBtn" + ((ctrl.parithMode || "ON") === opt.value ? " active" : "")
                          }
                          onClick={() => setCtrl("parithMode", opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </HoverField>
                </div>
              </div>

              <div className="bcsCard">
                <div className="bcsCardTop">
                  <HoverTipWrap {...ENGINE_HELP.engPrint}>
                    <label className="wbSwitchRow">
                      <input
                        type="checkbox"
                        checked={ctrl.emitPrint !== false}
                        onChange={(e) => setCtrl("emitPrint", e.target.checked)}
                      />
                      <span className="bcsCardTitle">ENG_PRINT · /PRINT//</span>
                      <InfoTip {...ENGINE_HELP.engPrint} />
                    </label>
                  </HoverTipWrap>
                  <span className="contactBaselineTag">图选默认 ☑</span>
                </div>
                <div className="formGrid2" style={{ marginTop: 8 }}>
                  <HoverField
                    label="N_print (步频)"
                    hint="负值=屏幕+.out"
                    tip={ENGINE_HELP.engPrint}
                  >
                    <input
                      className="wbInput mono"
                      value={ctrl.nPrint ?? "-1000"}
                      disabled={ctrl.emitPrint === false}
                      onChange={(e) => setCtrl("nPrint", e.target.value)}
                    />
                  </HoverField>
                  <HoverField label="N_line (表头行数)" hint="0=默认" tip={ENGINE_HELP.engPrint}>
                    <input
                      className="wbInput mono"
                      value={ctrl.nLine ?? "0"}
                      disabled={ctrl.emitPrint === false}
                      onChange={(e) => setCtrl("nLine", e.target.value)}
                    />
                  </HoverField>
                </div>
              </div>

              <div className="bcsCard">
                <div className="bcsCardTop">
                  <HoverTipWrap {...ENGINE_HELP.engTfile}>
                    <label className="wbSwitchRow">
                      <input type="checkbox" checked={emitTfile} onChange={(e) => setCtrl("emitTfile", e.target.checked)} />
                      <span className="bcsCardTitle">ENG_TFILE · /TFILE</span>
                    </label>
                  </HoverTipWrap>
                  <span className="contactBaselineTag">图选 Type 0</span>
                </div>
                <div className="formGrid2" style={{ marginTop: 8 }}>
                  <div className="wbField span2" role="group" aria-label="TFILE 编码格式">
                    <span className="wbFieldLabel">Type（文件编码）</span>
                    <div className="checkPills">
                      {TFILE_TYPE_OPTIONS.map((type) => (
                        <HoverTipWrap key={type.value} title={type.label} keyword={type.value === "0" ? "/TFILE" : `/TFILE/${type.value}`} text={type.desc}>
                          <button type="button" disabled={!emitTfile} aria-pressed={selectedTfileType === type.value}
                            className={"checkPill" + (selectedTfileType === type.value ? " on" : "")}
                            onClick={() => setCtrl("tfileType", type.value)}>{type.label}</button>
                        </HoverTipWrap>
                      ))}
                    </div>
                  </div>
                  <HoverField
                    label="Time_frequency (ΔT_his)"
                    tip={ENGINE_HELP.engTfile}
                  >
                    <input
                      className="wbInput mono"
                      value={draft.thInterval ?? ""}
                      disabled={!emitTfile}
                      onChange={(e) => patch("thInterval", e.target.value)}
                    />
                  </HoverField>
                  <HoverTipWrap title="图片中的时程采样间隔" text="将 ΔT_his 设置为 0.1（工作时间单位）。采样间隔应短于需要观察的事件持续时间。">
                    <button type="button" className="btnMini" disabled={!emitTfile} onClick={() => patch("thInterval", "0.1")}>应用图示 ΔT = 0.1</button>
                  </HoverTipWrap>
                  <HoverField label="时程格式版本 (/TH/VERS)" tip={{
                    title: "时程结果格式版本", keyword: "/TH/VERS",
                    text: "默认 41 生成 T01。51 或 2021 生成 .thy 并支持较长标题。选择 2021 可输出接触能量。TFILE Type 单独控制文件编码。",
                  }}>
                    <select className="wbInput" disabled={!emitTfile} value={ctrl.thVersion ?? ""} onChange={(e) => setCtrl("thVersion", e.target.value)}>
                      <option value="">求解器默认（41 / T01）</option>
                      <option value="41">41 · T01</option>
                      <option value="51">51 · THY</option>
                      <option value="2021">2021 · THY 与接触能量</option>
                    </select>
                  </HoverField>
                </div>
              </div>
            </div>

            {/* 时间步策略 */}
            <div className="subBox">
              <div className="formGrid3">
                <HoverField label="时间步控制策略" span={2} tip={ENGINE_HELP.timeStep}>
                  <div className="segControl">
                    {[
                      { value: "natural", label: "自然时间步" },
                      { value: "noda-cst", label: "/DT/NODA/CST" },
                      { value: "ams", label: "/AMS + /DT/AMS" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={
                          "segBtn" + ((draft.timeStepMode || "natural") === opt.value ? " active" : "")
                        }
                        onClick={() => patch("timeStepMode", opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </HoverField>
                {draft.timeStepMode !== "natural" && (
                  <>
                    <HoverField
                      label="时间步缩放系数"
                      tip={{
                        title: "时间步比例因子",
                        keyword: "ΔT_sca",
                        text: "稳定时间步长乘子，推荐 0.9。",
                      }}
                    >
                      <input
                        className="wbInput mono"
                        value={draft.timeStepScale ?? "0.9"}
                        onChange={(e) => patch("timeStepScale", e.target.value)}
                      />
                    </HoverField>
                    <HoverField
                      label="目标最小时间步"
                      tip={{
                        title: "目标最小步长 ΔT_min",
                        keyword: "ΔT_min",
                        text: "低于该步长时将通过质量缩放或 AMS 保持在该目标步长运行。",
                      }}
                    >
                      <input
                        className="wbInput mono"
                        value={draft.timeStepTarget ?? "0.001"}
                        onChange={(e) => patch("timeStepTarget", e.target.value)}
                      />
                    </HoverField>
                    {draft.timeStepMode === "ams" && (
                      <HoverField
                        label="AMS Part Group"
                        hint="空=全模型"
                        tip={{
                          title: "/AMS 作用部件组",
                          keyword: "/AMS grpart_ID",
                          text: "指定启用 AMS 的部件组 ID；留空表示作用于全模型所有部件。",
                        }}
                      >
                        <input
                          className="wbInput mono"
                          value={draft.amsPartGroupId ?? ""}
                          onChange={(e) => patch("amsPartGroupId", e.target.value)}
                        />
                      </HoverField>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "elem" && (
          <AnimOptionGrid
            catalog={ANIM_ELEM_CATALOG}
            selected={animElem}
            onChange={(next) => setCtrl("animElem", next)}
            extraActions={
              <button
                type="button"
                className="btnMini"
                onClick={() =>
                  setCtrl(
                    "animElem",
                    Array.from(
                      new Set([
                        ...animElem,
                        "EPSP",
                        "ENERGY",
                        "VONM",
                        "PRES",
                        "HOURG",
                        "THIC",
                        "OFF",
                        "SIGX",
                        "SIGY",
                        "SIGZ",
                      ]),
                    ),
                  )
                }
              >
                + 加选壳厚/应力/状态
              </button>
            }
          />
        )}

        {tab === "noda" && (
          <AnimOptionGrid
            catalog={ANIM_NODA_CATALOG}
            selected={animNoda}
            onChange={(next) => setCtrl("animNoda", next)}
            extraActions={
              <button
                type="button"
                className="btnMini"
                onClick={() =>
                  setCtrl("animNoda", Array.from(new Set([...animNoda, "DMAS", "NDMAS", "DT"])))
                }
              >
                + 加选 AMS/DT 监控
              </button>
            }
          />
        )}

        {tab === "vect" && (
          <AnimOptionGrid
            catalog={ANIM_VECT_CATALOG}
            selected={animVect}
            onChange={(next) => setCtrl("animVect", next)}
            extraActions={
              <button
                type="button"
                className="btnMini"
                onClick={() =>
                  setCtrl(
                    "animVect",
                    Array.from(new Set([...animVect, "ACC", "CONT", "DISP", "FREAC", "MREAC", "VEL"])),
                  )
                }
              >
                + 加选反力/速度矢量
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}
