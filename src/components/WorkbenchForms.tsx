import { useState, type ReactNode } from "react";
import NumericInput from "@/components/NumericInput";
import InfoTip from "@/components/InfoTip";
import {
  RadiossEngineSection,
  RadiossFunctionsManager,
  RadiossGravitySection,
  RadiossTimeHistorySection,
} from "@/components/RadiossSections";
import { CopyIcon, PlusIcon, TrashIcon } from "@/components/Icons";
import { createDefaultRadiossContact, num, optNum, parseDofs, toggleDofInString, type Draft } from "@/lib/caseDrafts";
import type { PsdImportResult } from "@/lib/caseApi";

function FormSection({
  step,
  title,
  subtitle,
  badge,
  actions,
  children,
}: {
  step?: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="formSection">
      <header className="formSectionHead">
        <div className="formSectionTitleWrap">
          {step && <span className="formSectionStep">{step}</span>}
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {badge}
        </div>
        {actions && <div className="formSectionActions">{actions}</div>}
      </header>
      <div className="formSectionBody">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  hint,
  help,
  span,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  help?: ReactNode;
  span?: 2 | 3;
}) {
  return (
    <label className={"wbField" + (span ? " span" + span : "")}>
      <span className="wbFieldLabel">
        <span>{label}</span>
        {hint && <em>{hint}</em>}
        {help && <InfoTip text={help} />}
      </span>
      {children}
    </label>
  );
}

function RawInput({
  value,
  onChange,
  placeholder,
  mono,
  disabled,
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      className={mono ? "wbInput mono" : "wbInput"}
      value={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export interface MultiCaseFormContext {
  modelUnits: string;
  spcSummary?: string;
  loadSummary?: string;
}

function SegmentedControl<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segControl" role="group">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={"segBtn" + (value === opt.value ? " active" : "")}
          aria-pressed={value === opt.value}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function UnitSelect({
  value,
  onChange,
  lockedUnits,
}: {
  value: string;
  onChange: (v: string) => void;
  lockedUnits?: string;
}) {
  return (
    <SegmentedControl
      value={((lockedUnits || value) || "N-mm-s") as "N-mm-s" | "N-m-s"}
      options={[
        { value: "N-mm-s", label: "N-mm-s" },
        { value: "N-m-s", label: "N-m-s" },
      ]}
      disabled={Boolean(lockedUnits)}
      onChange={onChange}
    />
  );
}

const DOF_LABELS = ["TX", "TY", "TZ", "RX", "RY", "RZ"];

function DofBoolPills({
  dofs,
  onChange,
}: {
  dofs: boolean[];
  onChange: (next: boolean[]) => void;
}) {
  return (
    <div className="dofPills">
      {DOF_LABELS.map((label, i) => {
        const on = Boolean(dofs[i]);
        return (
          <button
            key={label}
            type="button"
            className={"dofPill" + (on ? " on" : "")}
            aria-pressed={on}
            onClick={() => {
              const next = [0, 1, 2, 3, 4, 5].map((idx) => Boolean(dofs[idx]));
              next[i] = !next[i];
              onChange(next);
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Nodal Static (FORCE / MOMENT)                                   */
/* ------------------------------------------------------------------ */
function NodalStaticForm({
  draft,
  patch,
  mc,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
  mc?: MultiCaseFormContext;
}) {
  const loads = (Array.isArray(draft.loads) ? draft.loads : []) as Draft[];
  const updateRow = (index: number, key: string, value: string) => {
    const next = [...loads];
    next[index] = { ...next[index], [key]: value };
    patch("loads", next);
  };
  const addRow = () =>
    patch("loads", [
      ...loads,
      { nodeId: "", cid: "0", fx: "", fy: "", fz: "", mx: "", my: "", mz: "", label: "" },
    ]);

  return (
    <>
      <FormSection step="01" title="工况标识与子工况策略" subtitle="定义静力载荷集合、外部 SPC 约束引用与输出选项">
        <div className="formGrid3">
          <Field label="工况名称"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
          <Field label="模型单位制" hint={mc ? "随工程统一" : undefined} help="OptiStruct 模型一致单位制（影响 Manifest 记录与校核）。">
            <UnitSelect value={draft.modelUnits} lockedUnits={mc?.modelUnits} onChange={(v) => patch("modelUnits", v)} />
          </Field>
          {mc ? (
            <Field label="SPC 约束来源" hint="上方协同栏管理">
              <RawInput value={mc.spcSummary ?? "无约束"} onChange={() => {}} disabled />
            </Field>
          ) : (
            <Field label="外部 SPC Set ID" hint="留空=无约束" help="目标模型已有约束集合 ID；仅引用不创建。">
              <RawInput value={draft.existingSpcSetId} onChange={(v) => patch("existingSpcSetId", v)} mono placeholder="例如 900001" />
            </Field>
          )}
        </div>
        <div className="formGrid2" style={{ marginTop: 12 }}>
          <Field label="输出范围" help="STATIC_BASIC 输出 DISPLACEMENT/STRESS/STRAIN；DISPLACEMENT_ONLY 仅输出位移。">
            <SegmentedControl
              value={(draft.outputProfile || "STATIC_BASIC") as "STATIC_BASIC" | "DISPLACEMENT_ONLY"}
              options={[
                { value: "STATIC_BASIC", label: "位移 + 应力 + 应变" },
                { value: "DISPLACEMENT_ONLY", label: "仅输出位移" },
              ]}
              onChange={(v) => patch("outputProfile", v)}
            />
          </Field>
          <Field label="多行子工况模式" help="关闭：所有节点力合并至同一 Load Step；开启：每行单独生成独立子工况。">
            <label className="wbSwitchRow">
              <input
                type="checkbox"
                checked={Boolean(draft.perRowSubcase)}
                onChange={(e) => patch("perRowSubcase", e.target.checked)}
              />
              <span>每行生成独立 SUBCASE（perRowSubcase）</span>
            </label>
          </Field>
        </div>
      </FormSection>

      <FormSection
        step="02"
        title="节点载荷清单"
        subtitle="支持多节点集中力 (FORCE) 与集中力矩 (MOMENT)；留空分量按 0 处理"
        actions={
          <button type="button" className="btnMini" onClick={addRow}>
            <PlusIcon size={14} /> 添加节点行
          </button>
        }
      >
        <div className="compactTableWrap">
          <table className="compactTable">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th style={{ minWidth: 64 }}>Node ID</th>
                <th style={{ minWidth: 44 }}>CID</th>
                <th style={{ minWidth: 80 }}>点位描述</th>
                <th style={{ minWidth: 52 }}>FX</th>
                <th style={{ minWidth: 52 }}>FY</th>
                <th style={{ minWidth: 52 }}>FZ</th>
                <th style={{ minWidth: 52 }}>MX</th>
                <th style={{ minWidth: 52 }}>MY</th>
                <th style={{ minWidth: 52 }}>MZ</th>
                <th style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {loads.map((row, index) => (
                <tr key={index}>
                  <td className="rowNum">{index + 1}</td>
                  <td><RawInput value={row.nodeId} onChange={(v) => updateRow(index, "nodeId", v)} mono placeholder="1001" /></td>
                  <td><RawInput value={row.cid ?? "0"} onChange={(v) => updateRow(index, "cid", v)} mono placeholder="0" /></td>
                  <td><RawInput value={row.label ?? ""} onChange={(v) => updateRow(index, "label", v)} placeholder="可选标签" /></td>
                  {(["fx", "fy", "fz", "mx", "my", "mz"] as const).map((k) => (
                    <td key={k}><RawInput value={row[k]} onChange={(v) => updateRow(index, k, v)} mono placeholder="0" /></td>
                  ))}
                  <td className="rowOp">
                    <button
                      type="button"
                      className="iconTrashBtn"
                      title="删除行"
                      onClick={() => {
                        const next = loads.filter((_, i) => i !== index);
                        patch("loads", next.length ? next : [{ nodeId: "", cid: "0", fx: "", fy: "", fz: "", mx: "", my: "", mz: "", label: "" }]);
                      }}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FormSection>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Constraint (SPC / SPC1 / SPCADD)                                */
/* ------------------------------------------------------------------ */
function ConstraintForm({
  draft,
  patch,
  mc,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
  mc?: MultiCaseFormContext;
}) {
  const rows = (Array.isArray(draft.rows) ? draft.rows : []) as Draft[];
  const updateRow = (index: number, key: string, value: string) => {
    const next = [...rows];
    next[index] = { ...next[index], [key]: value };
    patch("rows", next);
  };
  const isRefOnly = draft.mode === "reference";

  return (
    <>
      <FormSection step="01" title="约束模式与外部集合引用" subtitle="创建 SPC / SPC1 约束卡片，或通过 SPCADD 合并外部已有约束集">
        <div className="formGrid3">
          <Field label="工况名称"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
          <Field label="模型单位制" hint={mc ? "随工程统一" : undefined}>
            <UnitSelect value={draft.modelUnits} lockedUnits={mc?.modelUnits} onChange={(v) => patch("modelUnits", v)} />
          </Field>
          <Field label="约束生成模式" help="新建 SPC：生成 SPC/SPC1 卡片；仅引用外部集合：不生成节点约束卡片，只登记外部引用。">
            <SegmentedControl
              value={(draft.mode || "new") as "new" | "reference"}
              options={[
                { value: "new", label: "新建 SPC" },
                { value: "reference", label: "仅引用外部集合" },
              ]}
              onChange={(v) => patch("mode", v)}
            />
          </Field>
        </div>
        <div className="formGrid2" style={{ marginTop: 12 }}>
          <Field label="外部 SPC Set IDs" hint="逗号或空格分隔" help="目标模型中已存在的约束集 ID 列表。">
            <RawInput value={draft.existingSpcSetIds} onChange={(v) => patch("existingSpcSetIds", v)} mono placeholder="例如 900001, 900002" />
          </Field>
          {!isRefOnly && (
            <Field label="集合组合 (SPCADD)" help="勾选后自动生成 SPCADD 卡片，将新建约束集与上方外部 SPC 集合并。">
              <label className="wbSwitchRow">
                <input
                  type="checkbox"
                  checked={Boolean(draft.combineWithExisting)}
                  onChange={(e) => patch("combineWithExisting", e.target.checked)}
                />
                <span>通过 SPCADD 与外部 SPC 集合组合</span>
              </label>
            </Field>
          )}
        </div>
      </FormSection>

      {!isRefOnly && (
        <FormSection
          step="02"
          title="节点自由度约束表"
          subtitle="可直接点击 1-6 (TX–RZ) 自由度按钮，或在文本框输入如 123 / 1-3,6"
          actions={
            <button
              type="button"
              className="btnMini"
              onClick={() => patch("rows", [...rows, { nodeId: "", dofs: "123", value: "", cid: "0" }])}
            >
              <PlusIcon size={14} /> 添加约束行
            </button>
          }
        >
          <div className="compactTableWrap">
            <table className="compactTable">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th style={{ minWidth: 88 }}>Node ID</th>
                  <th style={{ minWidth: 230 }}>快速勾选 DOF (1–6)</th>
                  <th style={{ minWidth: 94 }}>DOF 表达式</th>
                  <th style={{ minWidth: 100 }}>强迫位移 D</th>
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const activeSet = new Set(parseDofs(row.dofs));
                  return (
                    <tr key={index}>
                      <td className="rowNum">{index + 1}</td>
                      <td><RawInput value={row.nodeId} onChange={(v) => updateRow(index, "nodeId", v)} mono placeholder="2001" /></td>
                      <td>
                        <div className="dofPills">
                          {[1, 2, 3, 4, 5, 6].map((d, di) => {
                            const on = activeSet.has(d);
                            return (
                              <button
                                key={d}
                                type="button"
                                className={"dofPill" + (on ? " on" : "")}
                                title={`${d} (${DOF_LABELS[di]})`}
                                onClick={() => updateRow(index, "dofs", toggleDofInString(row.dofs, d))}
                              >
                                {d}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td><RawInput value={row.dofs} onChange={(v) => updateRow(index, "dofs", v)} mono placeholder="123" /></td>
                      <td><RawInput value={row.value} onChange={(v) => updateRow(index, "value", v)} mono placeholder="0 (齐次)" /></td>
                      <td className="rowOp">
                        <button
                          type="button"
                          className="iconTrashBtn"
                          title="删除行"
                          onClick={() => patch("rows", rows.filter((_, i) => i !== index))}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FormSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Gravity (GRAV)                                                  */
/* ------------------------------------------------------------------ */
function GravityForm({
  draft,
  patch,
  selectedIndex = 0,
  onSelectIndex,
  mc,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
  mc?: MultiCaseFormContext;
}) {
  const units = String((mc?.modelUnits || draft.modelUnits) || "N-mm-s");
  const oneGVal = units === "N-m-s" ? 9.80665 : 9806.65;
  const oneGStr = units === "N-m-s" ? "9.80665" : "9806.65";
  const accUnit = units === "N-m-s" ? "m/s²" : "mm/s²";
  const rows = (Array.isArray(draft.cases) ? draft.cases : []) as Draft[];
  const safeSelected = rows.length > 0 ? Math.min(Math.max(0, selectedIndex), rows.length - 1) : 0;

  const uniqueName = (base: string, existing: Draft[]): string => {
    const used = new Set(existing.map((r) => String(r.name ?? "").trim()));
    if (!used.has(base)) return base;
    let idx = 2;
    while (used.has(`${base}_${idx}`)) idx += 1;
    return `${base}_${idx}`;
  };

  const makeEmptyRow = (existing: Draft[]): Draft => ({
    name: uniqueName("Gravity_Case", existing),
    acceleration: oneGStr,
    nx: "0",
    ny: "0",
    nz: "-1",
    cid: "0",
  });

  const handleUnitChange = (nextUnits: string) => {
    const prevOneG = units === "N-m-s" ? "9.80665" : "9806.65";
    const nextOneG = nextUnits === "N-m-s" ? "9.80665" : "9806.65";
    patch("modelUnits", nextUnits);
    if (rows.length > 0 && prevOneG !== nextOneG) {
      let changed = false;
      const updated = rows.map((r) => {
        if (String(r.acceleration ?? "").trim() === prevOneG) {
          changed = true;
          return { ...r, acceleration: nextOneG };
        }
        return r;
      });
      if (changed) patch("cases", updated);
    }
  };

  const updateRow = (index: number, key: string, value: string) => {
    const next = [...rows];
    next[index] = { ...next[index], [key]: value };
    patch("cases", next);
  };

  const addRow = () => {
    const next = [...rows, makeEmptyRow(rows)];
    patch("cases", next);
    onSelectIndex?.(next.length - 1);
  };

  const addPresetRow = (baseName: string, nx: string, ny: string, nz: string) => {
    const next = [
      ...rows,
      {
        name: uniqueName(baseName, rows),
        acceleration: oneGStr,
        nx,
        ny,
        nz,
        cid: "0",
      },
    ];
    patch("cases", next);
    onSelectIndex?.(next.length - 1);
  };

  const duplicateRow = (index: number) => {
    const src = rows[index];
    if (!src) return;
    const copy = {
      ...src,
      name: uniqueName(String(src.name || "Gravity_Case"), rows),
    };
    const next = [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)];
    patch("cases", next);
    onSelectIndex?.(index + 1);
  };

  const deleteRow = (index: number) => {
    const filtered = rows.filter((_, i) => i !== index);
    const next = filtered.length > 0 ? filtered : [makeEmptyRow([])];
    patch("cases", next);
    onSelectIndex?.(Math.min(safeSelected, next.length - 1));
  };

  const fillAllOneG = () => {
    patch(
      "cases",
      rows.map((r) => ({ ...r, acceleration: oneGStr })),
    );
  };

  const handleTablePaste = (e: React.ClipboardEvent<HTMLTableElement>, startRow: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const parsedRows = lines
      .map((line) => line.split(/\t+/).map((c) => c.trim()))
      .filter((cols) => cols.length >= 4);
    if (parsedRows.length === 0) return;
    e.preventDefault();
    const next = [...rows];
    parsedRows.forEach((cols, offset) => {
      const targetIdx = startRow + offset;
      // Support 5+ columns: [name, accel, nx, ny, nz, cid?] or 4 columns: [name, nx, ny, nz]
      const hasAccel = cols.length >= 5;
      const newRow: Draft = {
        name: cols[0] || uniqueName("Gravity_Case", next),
        acceleration: hasAccel ? cols[1] || oneGStr : oneGStr,
        nx: hasAccel ? cols[2] ?? "0" : cols[1] ?? "0",
        ny: hasAccel ? cols[3] ?? "0" : cols[2] ?? "0",
        nz: hasAccel ? cols[4] ?? "-1" : cols[3] ?? "-1",
        cid: hasAccel ? cols[5] ?? "0" : "0",
      };
      if (targetIdx < next.length) {
        next[targetIdx] = newRow;
      } else {
        next.push(newRow);
      }
    });
    patch("cases", next);
    onSelectIndex?.(Math.min(startRow, next.length - 1));
  };

  const presets: Array<{ label: string; name: string; vec: [string, string, string] }> = [
    { label: "+ -Z 垂向", name: "Gravity_Z", vec: ["0", "0", "-1"] },
    { label: "+ +X 前向", name: "Gravity_PosX", vec: ["1", "0", "0"] },
    { label: "+ 制动 (-0.8X, -1Z)", name: "Braking_XZ", vec: ["-0.8", "0", "-1"] },
    { label: "+ 左转 (+0.8Y, -1Z)", name: "Corner_PosY", vec: ["0", "0.8", "-1"] },
    { label: "+ 右转 (-0.8Y, -1Z)", name: "Corner_NegY", vec: ["0", "-0.8", "-1"] },
  ];

  return (
    <>
      <FormSection step="01" title="重力工况集与单位制" subtitle={`当前单位制换算基准：1 g = ${oneGStr} ${accUnit}；表格每行生成一个独立 GRAV 与 SUBCASE`}>
        <div className="formGrid2">
          <Field label="工况集 / 文件名称"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
          <Field label="模型单位制" hint={mc ? "随工程统一" : undefined} help="不同单位制对应不同 1g 数值：N-mm-s 为 9806.65 mm/s²，N-m-s 为 9.80665 m/s²。">
            <UnitSelect value={units} lockedUnits={mc?.modelUnits} onChange={handleUnitChange} />
          </Field>
          {mc ? (
            <Field label="SPC 约束来源" hint="上方协同栏管理">
              <RawInput value={mc.spcSummary ?? "无约束"} onChange={() => {}} disabled />
            </Field>
          ) : (
            <Field label="外部 SPC Set ID" hint="留空=无约束"><RawInput value={draft.existingSpcSetId} onChange={(v) => patch("existingSpcSetId", v)} mono placeholder="例如 900001" /></Field>
          )}
          <Field label="输出范围">
            <SegmentedControl
              value={(draft.outputProfile || "STATIC_BASIC") as "STATIC_BASIC" | "DISPLACEMENT_ONLY"}
              options={[
                { value: "STATIC_BASIC", label: "位移+应力+应变" },
                { value: "DISPLACEMENT_ONLY", label: "仅位移" },
              ]}
              onChange={(v) => patch("outputProfile", v)}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        step="02"
        title="重力工况表"
        subtitle={`填写各工况的重力加速度 (${accUnit}) 及 X / Y / Z 方向系数 (N1, N2, N3)，实际载荷 = G × (N1, N2, N3)`}
        actions={
          <div className="formSectionBtnGroup">
            <button type="button" className="btnMini" onClick={fillAllOneG} title={`将全部行的重力加速度设为 ${oneGStr} ${accUnit}`}>
              全部设为 1g ({oneGStr})
            </button>
            <button type="button" className="btnMini" onClick={addRow}>
              <PlusIcon size={14} /> 添加工况行
            </button>
          </div>
        }
      >
        <div className="presetRow" style={{ marginBottom: 10 }}>
          <span className="presetLabel">快捷新增行：</span>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="presetBtn"
              onClick={() => addPresetRow(p.name, p.vec[0], p.vec[1], p.vec[2])}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="compactTableWrap">
          <table className="compactTable">
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                <th style={{ minWidth: 112 }}>工况名称</th>
                <th style={{ minWidth: 96 }}>重力加速度 ({accUnit})</th>
                <th style={{ minWidth: 62 }}>X 系数</th>
                <th style={{ minWidth: 62 }}>Y 系数</th>
                <th style={{ minWidth: 62 }}>Z 系数</th>
                <th style={{ width: 56 }}>CID</th>
                <th style={{ width: 64 }}>合成 (g)</th>
                <th style={{ width: 58 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const isSel = index === safeSelected;
                const magAcc = num(row.acceleration) * Math.hypot(num(row.nx), num(row.ny), num(row.nz));
                const magG = magAcc / oneGVal;
                return (
                  <tr
                    key={index}
                    className={isSel ? "activeRow" : undefined}
                    onClick={() => onSelectIndex?.(index)}
                    onFocusCapture={() => onSelectIndex?.(index)}
                    onPaste={(e) => handleTablePaste(e as unknown as React.ClipboardEvent<HTMLTableElement>, index)}
                  >
                    <td className="rowNum" title="点击在右侧预览该工况">{index + 1}</td>
                    <td><RawInput value={row.name} onChange={(v) => updateRow(index, "name", v)} placeholder="Gravity_Z" /></td>
                    <td><RawInput value={row.acceleration} onChange={(v) => updateRow(index, "acceleration", v)} mono placeholder={oneGStr} /></td>
                    <td><RawInput value={row.nx} onChange={(v) => updateRow(index, "nx", v)} mono placeholder="0" /></td>
                    <td><RawInput value={row.ny} onChange={(v) => updateRow(index, "ny", v)} mono placeholder="0" /></td>
                    <td><RawInput value={row.nz} onChange={(v) => updateRow(index, "nz", v)} mono placeholder="-1" /></td>
                    <td><RawInput value={row.cid ?? "0"} onChange={(v) => updateRow(index, "cid", v)} mono placeholder="0" /></td>
                    <td className="gravResultCell">{magG.toFixed(2)}g</td>
                    <td className="rowOp">
                      <div className="rowOpBtns">
                        <button
                          type="button"
                          className="iconTrashBtn"
                          title="复制该行"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateRow(index);
                          }}
                        >
                          <CopyIcon size={13} />
                        </button>
                        <button
                          type="button"
                          className="iconTrashBtn"
                          title="删除行"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRow(index);
                          }}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="tableInlineFoot">
          <span className="wbFieldHint">
            共 {rows.length} 个重力工况 · 点击或聚焦任意行可在右侧 3D 实时预览；支持从 Excel 复制多行（名称 / 加速度 / X / Y / Z / CID）直接粘贴。
          </span>
        </div>
      </FormSection>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Normal Modes (EIGRL)                                            */
/* ------------------------------------------------------------------ */
function NormalModesForm({
  draft,
  patch,
  mc,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
  mc?: MultiCaseFormContext;
}) {
  return (
    <FormSection step="01" title="模态提取配置 (EIGRL · SOL 103)" subtitle="通过频率上下限或模态阶数控制 Lanczos 模态提取">
      <div className="formGrid3">
        <Field label="工况名称"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
        <Field label="模型单位制" hint={mc ? "随工程统一" : undefined}>
          <UnitSelect value={draft.modelUnits} lockedUnits={mc?.modelUnits} onChange={(v) => patch("modelUnits", v)} />
        </Field>
        {mc ? (
          <Field label="SPC 约束来源" hint="上方协同栏管理">
            <RawInput value={mc.spcSummary ?? "无约束"} onChange={() => {}} disabled />
          </Field>
        ) : (
          <Field label="外部约束 SPC Set ID" hint="留空=自由模态"><RawInput value={draft.existingSpcSetId} onChange={(v) => patch("existingSpcSetId", v)} mono /></Field>
        )}
        <Field label="频率下限 V1 (Hz)" help="EIGRL 提取起始频率，0 表示包含刚体/低频模态。"><RawInput value={draft.eigrlMinHz} onChange={(v) => patch("eigrlMinHz", v)} mono /></Field>
        <Field label="频率上限 V2 (Hz)" help="EIGRL 提取截止频率上限。"><RawInput value={draft.eigrlMaxHz} onChange={(v) => patch("eigrlMaxHz", v)} mono /></Field>
        <Field label="提取阶数 ND" help="期望提取模态总数，可与频率上限配合或单独使用。"><RawInput value={draft.numModes} onChange={(v) => patch("numModes", v)} mono /></Field>
      </div>
    </FormSection>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Frequency Response (MFREQ · SOL 108)                            */
/* ------------------------------------------------------------------ */
function FrequencyResponseForm({
  draft,
  patch,
  mc,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
  mc?: MultiCaseFormContext;
}) {
  return (
    <>
      <FormSection step="01" title="频响基本参数与外部引用" subtitle="生成 EIGRL + FREQ1 + TABDMP1 + MFREQ 扫频子工况">
        <div className="formGrid3">
          <Field label="工况名称"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
          <Field label="模型单位制" hint={mc ? "随工程统一" : undefined}>
            <UnitSelect value={draft.modelUnits} lockedUnits={mc?.modelUnits} onChange={(v) => patch("modelUnits", v)} />
          </Field>
          {mc ? (
            <Field label="SPC 约束来源" hint="上方协同栏管理">
              <RawInput value={mc.spcSummary ?? "未绑定"} onChange={() => {}} disabled />
            </Field>
          ) : (
            <Field label="外部 SPC Set ID"><RawInput value={draft.existingSpcSetId} onChange={(v) => patch("existingSpcSetId", v)} mono /></Field>
          )}
          {mc ? (
            <Field label="载荷 Load 来源" hint="上方协同栏管理">
              <RawInput value={mc.loadSummary ?? "不引用"} onChange={() => {}} disabled />
            </Field>
          ) : (
            <Field label="外部载荷 Load ID" hint="可选，引用 RLOAD1/2/DLOAD"><RawInput value={draft.loadId} onChange={(v) => patch("loadId", v)} mono placeholder="留空表示不引用" /></Field>
          )}
          <Field label="模态临界阻尼比" help="TABDMP1 临界阻尼比，例如 0.02 表示 2%。"><RawInput value={draft.dampingRatio} onChange={(v) => patch("dampingRatio", v)} mono /></Field>
        </div>
      </FormSection>

      <FormSection step="02" title="扫频范围与模态提取窗口" subtitle="模态提取上限通常应覆盖求解上限的 1.5~2 倍以降低模态截断误差">
        <div className="formGrid3">
          <Field label="扫频下限 (Hz)"><RawInput value={draft.minHz} onChange={(v) => patch("minHz", v)} mono /></Field>
          <Field label="扫频上限 (Hz)"><RawInput value={draft.maxHz} onChange={(v) => patch("maxHz", v)} mono /></Field>
          <Field label="频率步长 (Hz)"><RawInput value={draft.stepHz} onChange={(v) => patch("stepHz", v)} mono /></Field>
          <Field label="模态下限 V1 (Hz)"><RawInput value={draft.eigrlMinHz} onChange={(v) => patch("eigrlMinHz", v)} mono /></Field>
          <Field label="模态上限 V2 (Hz)"><RawInput value={draft.eigrlMaxHz} onChange={(v) => patch("eigrlMaxHz", v)} mono /></Field>
        </div>
      </FormSection>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Random PSD                                                      */
/* ------------------------------------------------------------------ */
function RandomPsdForm({
  draft,
  patch,
  psdBusy,
  psdImport,
  onImportPsd,
  onDownloadTemplate,
  onLoadSample,
  mc,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
  psdBusy: boolean;
  psdImport: PsdImportResult | null;
  onImportPsd: () => void;
  onDownloadTemplate: (fmt: "csv" | "xlsx") => void;
  onLoadSample: () => void;
  mc?: MultiCaseFormContext;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const points = (Array.isArray(draft.points) ? draft.points : []) as Draft[];
  const forceDir = (Array.isArray(draft.forceDirection) ? draft.forceDirection : ["0", "0", "1"]) as string[];
  const baseAccel = draft.excKind === "base-acceleration";

  return (
    <>
      <FormSection step="01" title="激励定义与外部实体引用" subtitle="基座加速度 (SPCD + RLOAD) 或随机节点力 (DAREA + RLOAD)">
        <div className="formGrid3">
          <Field label="工况名称"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
          <Field label="模型单位制" hint={mc ? "随工程统一" : undefined}>
            <UnitSelect value={draft.modelUnits} lockedUnits={mc?.modelUnits} onChange={(v) => patch("modelUnits", v)} />
          </Field>
          <Field label="激励类型">
            <SegmentedControl
              value={(draft.excKind || "base-acceleration") as "base-acceleration" | "applied-force"}
              options={[
                { value: "base-acceleration", label: "基座加速度" },
                { value: "applied-force", label: "随机节点力" },
              ]}
              onChange={(v) => patch("excKind", v)}
            />
          </Field>
          <Field label="激励 Node ID"><RawInput value={draft.nodeId} onChange={(v) => patch("nodeId", v)} mono /></Field>
          {mc ? (
            <Field label="SPC 约束来源" hint="上方协同栏管理">
              <RawInput value={mc.spcSummary ?? "未绑定"} onChange={() => {}} disabled />
            </Field>
          ) : (
            <Field label="外部 SPC Set ID"><RawInput value={draft.existingSpcSetId} onChange={(v) => patch("existingSpcSetId", v)} mono /></Field>
          )}
          <Field label="PSD 谱单位" help="如 g^2/Hz 或 N^2/Hz，需与激励类型对应。"><RawInput value={draft.inputPsdUnit} onChange={(v) => patch("inputPsdUnit", v)} mono /></Field>
        </div>

        {baseAccel ? (
          <div className="formGrid3" style={{ marginTop: 12 }}>
            <Field label="激励方向分量">
              <SegmentedControl
                value={(String(draft.component || "3")) as "1" | "2" | "3"}
                options={[
                  { value: "1", label: "1 (X)" },
                  { value: "2", label: "2 (Y)" },
                  { value: "3", label: "3 (Z)" },
                ]}
                onChange={(v) => patch("component", v)}
              />
            </Field>
            <Field label="参考加速度幅值 (g)" help="用于计算单位激励缩放，默认 1 g。">
              <RawInput value={draft.referenceAmplitudeG ?? "1"} onChange={(v) => patch("referenceAmplitudeG", v)} mono />
            </Field>
          </div>
        ) : (
          <div className="formGrid3" style={{ marginTop: 12 }}>
            <Field label="参考力幅值 (N)" help="随机力 PSD 的参考力幅值，默认 1 N。"><RawInput value={draft.referenceForceN} onChange={(v) => patch("referenceForceN", v)} mono /></Field>
            <Field label="局部坐标系 CID"><RawInput value={draft.forceCid ?? "0"} onChange={(v) => patch("forceCid", v)} mono /></Field>
            <Field label="力矢量方向 [X, Y, Z]">
              <div className="vec3Inputs">
                {[0, 1, 2].map((idx) => (
                  <RawInput
                    key={idx}
                    value={forceDir[idx]}
                    onChange={(v) => {
                      const next = [...forceDir];
                      next[idx] = v;
                      patch("forceDirection", next);
                    }}
                    mono
                  />
                ))}
              </div>
            </Field>
          </div>
        )}
      </FormSection>

      <FormSection step="02" title="求解链配置（模态 / 激励 / 频点 / 轴模式）" subtitle="支持 EIGRL/EIGRA、RLOAD1/RLOAD2、FREQ1/FREQ2/FREQ 与顺序三轴">
        <div className="formGrid2">
          <Field label="模态提取方法">
            <SegmentedControl
              value={(draft.modalMethod || "LANCZOS") as "LANCZOS" | "EIGRA"}
              options={[
                { value: "LANCZOS", label: "EIGRL (Lanczos)" },
                { value: "EIGRA", label: "EIGRA (AMSES)" },
              ]}
              onChange={(v) => patch("modalMethod", v)}
            />
          </Field>
          <Field label="激励卡片形式" help="RLOAD2 为幅值/相位形式（默认）；RLOAD1 为复数实虚部（TC=1, TD=0）。">
            <SegmentedControl
              value={(draft.excForm || "RLOAD2") as "RLOAD2" | "RLOAD1"}
              options={[
                { value: "RLOAD2", label: "RLOAD2 (幅相)" },
                { value: "RLOAD1", label: "RLOAD1 (实虚)" },
              ]}
              onChange={(v) => patch("excForm", v)}
            />
          </Field>
          <Field label="频率分布卡片" help="FREQ1 等间隔；FREQ2 对数均匀；FREQ 显式离散频率列表。">
            <SegmentedControl
              value={(draft.freqKind || "FREQ1") as "FREQ1" | "FREQ2" | "FREQ"}
              options={[
                { value: "FREQ1", label: "FREQ1 等距" },
                { value: "FREQ2", label: "FREQ2 对数" },
                { value: "FREQ", label: "FREQ 显式" },
              ]}
              onChange={(v) => patch("freqKind", v)}
            />
          </Field>
          <Field label="轴向模式" help="顺序三轴生成 3 组独立 MFREQ + RANDOM 自谱（仅支持基座加速度，非同时相关合成）。">
            <SegmentedControl
              value={(draft.axisMode || "single") as "single" | "sequential-tri"}
              options={[
                { value: "single", label: "单轴" },
                { value: "sequential-tri", label: "顺序三轴 (独立自谱)" },
              ]}
              onChange={(v) => patch("axisMode", v)}
            />
          </Field>
        </div>

        <div className="formGrid3" style={{ marginTop: 12 }}>
          <Field label="求解频段下限 (Hz)"><RawInput value={draft.minHz} onChange={(v) => patch("minHz", v)} mono /></Field>
          <Field label="求解频段上限 (Hz)"><RawInput value={draft.maxHz} onChange={(v) => patch("maxHz", v)} mono /></Field>
          {draft.freqKind === "FREQ2" ? (
            <Field label="FREQ2 对数区间数 NF" help="输出频点总数 = NF + 1。"><RawInput value={draft.freqNf} onChange={(v) => patch("freqNf", v)} mono /></Field>
          ) : draft.freqKind === "FREQ" ? (
            <Field label="离散频率点 (Hz，逗号分隔)"><RawInput value={draft.explicitHzText ?? ""} onChange={(v) => patch("explicitHzText", v)} mono placeholder="10, 20, 50, 100" /></Field>
          ) : (
            <Field label="FREQ1 频率步长 (Hz)"><RawInput value={draft.stepHz} onChange={(v) => patch("stepHz", v)} mono /></Field>
          )}
        </div>

        {draft.modalMethod === "EIGRA" ? (
          <div className="subBox">
            <div className="subBoxTitle">EIGRA (AMSES) 高级参数</div>
            <div className="formGrid3">
              <Field label="V1 下限 (Hz)"><RawInput value={draft.eigraV1} onChange={(v) => patch("eigraV1", v)} mono /></Field>
              <Field label="V2 上限 (Hz, 必填)"><RawInput value={draft.eigraV2} onChange={(v) => patch("eigraV2", v)} mono /></Field>
              <Field label="阶数 ND (可选)"><RawInput value={draft.eigraNd} onChange={(v) => patch("eigraNd", v)} mono /></Field>
              <Field label="AMPFFACT"><RawInput value={draft.eigraAmpffact} onChange={(v) => patch("eigraAmpffact", v)} mono /></Field>
              <Field label="MSGLVL (0/1)"><RawInput value={draft.eigraMsglvl} onChange={(v) => patch("eigraMsglvl", v)} mono /></Field>
              <Field label="NORM 归一化">
                <select className="wbInput" value={draft.eigraNorm} onChange={(e) => patch("eigraNorm", e.target.value)}>
                  <option value="MASS">MASS</option>
                  <option value="MAX">MAX</option>
                  <option value="ALL">ALL</option>
                </select>
              </Field>
            </div>
          </div>
        ) : (
          <div className="formGrid3" style={{ marginTop: 12 }}>
            <Field label="模态提取下限 (Hz)"><RawInput value={draft.modalMinHz} onChange={(v) => patch("modalMinHz", v)} mono /></Field>
            <Field label="模态提取上限 (Hz)"><RawInput value={draft.modalMaxHz} onChange={(v) => patch("modalMaxHz", v)} mono /></Field>
          </div>
        )}
      </FormSection>

      <FormSection
        step="03"
        title="PSD 输入谱表 (TABRND1)"
        subtitle="频率须严格递增；LOG-LOG 插值时 PSD 须大于 0"
        actions={
          <div className="btnCluster">
            <button type="button" className="btnMini" disabled={psdBusy} onClick={onImportPsd}>
              {psdBusy ? "读取中…" : "导入 CSV/XLSX"}
            </button>
            <button type="button" className="btnMini" onClick={() => onDownloadTemplate("xlsx")}>Excel 模板</button>
            <button type="button" className="btnMini" onClick={() => onDownloadTemplate("csv")}>CSV 模板</button>
            <button type="button" className="btnMini" onClick={onLoadSample}>载入示例</button>
          </div>
        }
      >
        <div className="formGrid2" style={{ marginBottom: 12 }}>
          <Field label="谱点插值方式">
            <select className="wbInput" value={draft.interpolation} onChange={(e) => patch("interpolation", e.target.value)}>
              {["LOG-LOG", "LINEAR-LINEAR", "LOG-LINEAR", "LINEAR-LOG"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="越界外推策略">
            <select className="wbInput" value={draft.outOfRange} onChange={(e) => patch("outOfRange", e.target.value)}>
              <option value="ERROR">ERROR（拒绝外推，推荐）</option>
              <option value="FLAT">FLAT（端点平坦延伸）</option>
            </select>
          </Field>
        </div>

        {psdImport && (
          <div className="inlineNotice info" style={{ marginBottom: 10 }}>
            <div>
              已导入 <b>{psdImport.points.length}</b> 个谱点 · 来源 {psdImport.sourceKind.toUpperCase()}
              {psdImport.sheetName ? ` · 工作表「${psdImport.sheetName}」` : ""}
              {psdImport.header ? ` · 表头「${psdImport.header}」` : ""}
              {psdImport.ignoredLines ? ` · 忽略 ${psdImport.ignoredLines} 行` : ""}
            </div>
            {psdImport.warnings.length > 0 && (
              <ul>{psdImport.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
          </div>
        )}

        <div className="compactTableWrap">
          <table className="compactTable">
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th>频率 (Hz)</th>
                <th>PSD ({draft.inputPsdUnit || "g^2/Hz"})</th>
                <th style={{ width: 38 }} />
              </tr>
            </thead>
            <tbody>
              {points.map((p, index) => (
                <tr key={index}>
                  <td className="rowNum">{index + 1}</td>
                  <td>
                    <NumericInput
                      value={num(p.frequencyHz)}
                      onCommit={(v) => {
                        const next = [...points];
                        next[index] = { ...next[index], frequencyHz: String(v) };
                        patch("points", next);
                      }}
                    />
                  </td>
                  <td>
                    <NumericInput
                      value={num(p.psd)}
                      onCommit={(v) => {
                        const next = [...points];
                        next[index] = { ...next[index], psd: String(v) };
                        patch("points", next);
                      }}
                    />
                  </td>
                  <td className="rowOp">
                    <button
                      type="button"
                      className="iconTrashBtn"
                      title="删除频点"
                      onClick={() => patch("points", points.filter((_, i) => i !== index))}
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
          <button
            type="button"
            className="btnMini"
            onClick={() => patch("points", [...points, { frequencyHz: "", psd: "" }])}
          >
            <PlusIcon size={14} /> 添加频点
          </button>
          <button type="button" className="textLinkBtn" onClick={() => setRulesOpen((v) => !v)}>
            {rulesOpen ? "收起识别规则" : "查看文件导入识别规则"}
          </button>
        </div>
        {rulesOpen && (
          <ul className="miniRuleList">
            <li>支持 CSV / TXT（逗号、制表符、分号或空白分隔）与 XLSX / XLS / ODS 工作簿。</li>
            <li>自动识别中英文表头（频率Hz / Freq / F / X 与 PSD / 功率谱密度 / g^2/Hz），无表头自动跳过序号列。</li>
            <li>单元格内单位文本（如 “10 Hz”）会自动清洗提取数字；# 或 // 开头注释行忽略。</li>
          </ul>
        )}
      </FormSection>

      <FormSection step="04" title="阻尼、输出请求与边界确认">
        <div className="formGrid3">
          <Field label="模态临界阻尼比"><RawInput value={draft.dampingRatio} onChange={(v) => patch("dampingRatio", v)} mono /></Field>
          <Field label="结果输出档位">
            <SegmentedControl
              value={(draft.outputProfile || "PSD_AND_RMS") as "PSD_AND_RMS" | "RMS_ONLY"}
              options={[
                { value: "PSD_AND_RMS", label: "PSD + RMS" },
                { value: "RMS_ONLY", label: "仅 RMS" },
              ]}
              onChange={(v) => patch("outputProfile", v)}
            />
          </Field>
          <Field label="输出物理量">
            <div className="checkPills">
              {[
                { key: "displacement", label: "位移" },
                { key: "stress", label: "应力" },
                { key: "acceleration", label: "加速度" },
              ].map((item) => {
                const checked = Boolean(draft[item.key]);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={"checkPill" + (checked ? " on" : "")}
                    onClick={() => patch(item.key, !checked)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        <label className="safetyAck warn" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={Boolean(draft.confirmSpc)}
            onChange={(e) => patch("confirmSpc", e.target.checked)}
          />
          <span>我确认被激励节点 DOF 已包含在目标模型 SPC 集合中，且非 RBE2 依赖自由度（未勾选将阻止导出）</span>
        </label>
      </FormSection>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 7. Radioss ROPS & FOPS (Radioss 2022 Baseline)                     */
/* ------------------------------------------------------------------ */
type ContactTabKey = "basic" | "gap" | "stiff" | "advanced";

function AnnotatedParam({
  label,
  note,
  hint,
  span,
  children,
}: {
  label: string;
  note: string;
  hint?: string;
  span?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <div className={"annotatedParam" + (span ? " span" + span : "")}>
      <label className="wbField">
        <span className="wbFieldLabel">
          <span>{label}</span>
          {hint && <em>{hint}</em>}
        </span>
        {children}
      </label>
      <p className="paramNote">{note}</p>
    </div>
  );
}

function RadiossContactCard({
  index,
  ct,
  lengthUnit,
  timeUnit,
  onChange,
  onRemove,
}: {
  index: number;
  ct: Draft;
  lengthUnit: string;
  timeUnit: string;
  onChange: (next: Draft) => void;
  onRemove: () => void;
}) {
  const [tab, setTab] = useState<ContactTabKey>("basic");
  const set = (k: string, v: string) => onChange({ ...ct, [k]: v });
  const icurv = Number(ct.icurv ?? 0);
  const ifric = Number(ct.ifric ?? 0);

  return (
    <div className="bcsCard contactCard">
      <div className="bcsCardTop">
        <div className="contactTitleRow">
          <span className="bcsCardTitle">工装-模型接触 #{index + 1} · /INTER/TYPE7</span>
          <span className="contactBaselineTag">Radioss 2022 基线</span>
        </div>
        <button type="button" className="iconTrashBtn" title="删除接触定义" onClick={onRemove}>
          <TrashIcon size={14} />
        </button>
      </div>

      {/* 两个核心 Set ID 与接触名称 */}
      <div className="contactSetGrid" style={{ marginTop: 10 }}>
        <AnnotatedParam
          label="接触名称 (ASCII Title)"
          hint="写入卡片标题"
          note="仅允许 ASCII 字母/数字/下划线，用于标识该接触对（如 TOOL_MODEL_CONTACT）。"
        >
          <RawInput value={ct.title ?? ""} onChange={(v) => set("title", v)} mono placeholder="TOOL_MODEL_CONTACT" />
        </AnnotatedParam>
        <AnnotatedParam
          label="模型侧从节点组 Set ID (grnd_IDs · /GRNOD)"
          hint="必填正整数"
          note="填写模型侧（变形体/驾驶室结构，建议网格较细一侧）的 /GRNOD 节点集合 Set ID，作为穿透检查从侧（Secondary）。"
        >
          <RawInput value={ct.slaveGrnodId ?? ""} onChange={(v) => set("slaveGrnodId", v)} mono placeholder="例如 101" />
        </AnnotatedParam>
        <AnnotatedParam
          label="工装侧主表面 Set ID (surf_IDm · /SURF)"
          hint="必填正整数"
          note="填写工装侧（压板/落锤等刚性体或网格较粗一侧）的 /SURF 表面集合 Set ID，作为受冲击主表面（Main）。"
        >
          <RawInput value={ct.masterSurfId ?? ""} onChange={(v) => set("masterSurfId", v)} mono placeholder="例如 201" />
        </AnnotatedParam>
      </div>

      {/* Radioss 2022 参数选项卡 */}
      <div className="contactTabs" role="tablist" aria-label="Radioss 2022 TYPE7 参数选项卡">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "basic"}
          className={"contactTab" + (tab === "basic" ? " active" : "")}
          onClick={() => setTab("basic")}
        >
          1. 核心标志 (Card 1)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "gap"}
          className={"contactTab" + (tab === "gap" ? " active" : "")}
          onClick={() => setTab("gap")}
        >
          2. 间隙与穿透 (Card 2–3)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "stiff"}
          className={"contactTab" + (tab === "stiff" ? " active" : "")}
          onClick={() => setTab("stiff")}
        >
          3. 刚度·摩擦·时间 (Card 4)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "advanced"}
          className={"contactTab" + (tab === "advanced" ? " active" : "")}
          onClick={() => setTab("advanced")}
        >
          4. 阻尼·初始穿透·高级摩擦 (Card 5–6)
        </button>
      </div>

      <div className="contactTabBody">
        {tab === "basic" && (
          <div className="annotatedGrid2">
            <AnnotatedParam
              label="Istf · 接触刚度计算方式"
              note="控制惩罚刚度 K 如何由主/从两侧计算。工装压溃/冲击强烈推荐选 4（min(Km,Ks)），可防止刚性工装与薄壁模型接触时刚度过高引发时间步骤降。"
            >
              <select className="wbInput" value={String(ct.istf ?? "4")} onChange={(e) => set("istf", e.target.value)}>
                <option value="4">4 — 主/从刚度最小值 min(Km,Ks)（推荐）</option>
                <option value="2">2 — 主/从刚度平均值 (Km+Ks)/2</option>
                <option value="3">3 — 主/从刚度最大值 max(Km,Ks)</option>
                <option value="5">5 — 主/从刚度串联 Km·Ks/(Km+Ks)</option>
                <option value="1">1 — 直接使用 Stfac 作为恒定刚度 K</option>
                <option value="1000">1000 — 仅由主面（工装）刚度决定（默认）</option>
                <option value="0">0 — 继承 /DEFAULT/INTER/TYPE7（未定义等效 1000）</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Igap · 接触间隙计算方式"
              note="定义接触激活厚度的计算方式。推荐 2（变间隙+缩放）或 3（额外考虑网格尺寸防自穿透），会随壳厚动态计算并受 Gapmin/Gapmax 约束。"
            >
              <select className="wbInput" value={String(ct.igap ?? "2")} onChange={(e) => set("igap", e.target.value)}>
                <option value="2">2 — 变间隙 + Fscale_gap 缩放与上下限（推荐）</option>
                <option value="3">3 — 变间隙 + 网格尺寸比例修正（%mesh_size）</option>
                <option value="1">1 — 变间隙（主面与从侧厚度之和）</option>
                <option value="1000">1000 — 恒定间隙（固定等于 Gapmin）</option>
                <option value="0">0 — 继承 /DEFAULT/INTER/TYPE7（等效 1000）</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Idel · 失效单元删除处理"
              note="当单元因材料失效被删除时如何更新接触面。推荐 2：任意关联壳/体单元失效即移除对应接触片段，防止残留节点产生非物理“幽灵力”。"
            >
              <select className="wbInput" value={String(ct.idel ?? "2")} onChange={(e) => set("idel", e.target.value)}>
                <option value="2">2 — 任一关联单元失效即移除接触片段（推荐）</option>
                <option value="1">1 — 共享片段的全部单元失效后才移除</option>
                <option value="-2">-2 — 按 2 移除失效片段，保留从侧未连接节点</option>
                <option value="-1">-1 — 按 1 移除失效片段，保留从侧未连接节点</option>
                <option value="1000">1000 — 不移除失效单元对应的接触（默认）</option>
                <option value="0">0 — 继承 /DEFAULT/INTER/TYPE7</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Ithe · 热传导开关"
              note="选择 1 会输出热接触续行。换热是否生效还取决于目标模型的热分析和材料设置。纯结构工况保持 0。"
            >
              <select className="wbInput" value={String(ct.ithe ?? "0")} onChange={(e) => set("ithe", e.target.value)}>
                <option value="0">0 — 不考虑接触传热（默认）</option>
                <option value="1">1 — 启用接触热传递</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Ibag · 气囊泄气孔封堵"
              note="气囊接触时使用。0 继承默认接触设置，2 显式关闭封堵。"
            >
              <select className="wbInput" value={String(ct.ibag) === "1000" ? "2" : String(ct.ibag ?? "0")} onChange={(e) => set("ibag", e.target.value)}>
                <option value="0">0 — 继承 /DEFAULT/INTER/TYPE7</option>
                <option value="1">1 — 接触时自动关闭气囊泄气孔</option>
                <option value="2">2 — 不关闭气囊泄气孔</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Icurv · 曲率节点修正开关"
              note="选 1 时输入球心节点，选 2 时输入确定圆柱轴线的两个节点，选 3 时使用自动双三次曲面。"
            >
              <select className="wbInput" value={String(ct.icurv ?? "0")} onChange={(e) => set("icurv", e.target.value)}>
                <option value="0">0 — 不使用额外曲率节点（默认）</option>
                <option value="1">1 — 球面曲率</option>
                <option value="2">2 — 圆柱面曲率</option>
                <option value="3">3 — 自动双三次曲面</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Iadm · 自适应网格 (/ADMESH) 兼容"
              note="若模型启用 /ADMESH 自适应网格加密则选 1；常规固定网格模型选 0（关闭）。"
            >
              <select className="wbInput" value={String(ct.iadm ?? "0")} onChange={(e) => set("iadm", e.target.value)}>
                <option value="0">0 — 不使用自适应网格兼容（默认）</option>
                <option value="1">1 — 兼容 /ADMESH 网格加密</option>
              </select>
            </AnnotatedParam>

            {(icurv === 1 || icurv === 2) && (
              <>
                <AnnotatedParam label="node_ID1 · 曲率节点 1" note="Icurv=1/2 时必填的外部参考节点号 1。">
                  <RawInput value={ct.curvNodeId1 ?? ""} onChange={(v) => set("curvNodeId1", v)} mono />
                </AnnotatedParam>
                {icurv === 2 && <AnnotatedParam label="node_ID2 · 曲率节点 2" note="圆柱轴线的第二个节点。">
                  <RawInput value={ct.curvNodeId2 ?? ""} onChange={(v) => set("curvNodeId2", v)} mono />
                </AnnotatedParam>}
              </>
            )}
            {Number(ct.ithe) === 1 && (
              <>
                <AnnotatedParam label="Ithe_form · 换热方式" note="0 表示固定温度界面与从侧壳换热，1 表示接触双方换热。">
                  <select className="wbInput" value={ct.heatFormulation ?? "0"} onChange={(e) => set("heatFormulation", e.target.value)}>
                    <option value="0">0 — 固定温度界面与从侧壳</option>
                    <option value="1">1 — 接触双方</option>
                  </select>
                </AnnotatedParam>
                {[
                  ["heatCoefficient", "Kthe · 换热系数", "未引用函数时为常数换热系数，引用后为纵轴比例。", "0"],
                  ["heatFunctionId", "fct_ID_K · 压力曲线 ID", "填模型已有的压力—换热函数编号，0 表示使用常数。", "0"],
                  ["heatInterfaceTemperature", "Tint · 界面温度", "指定固定温度界面的温度，绝对温度以 K 输入。", "0"],
                  ["heatPressureScale", "Ascale_K · 压力缩放", "换热函数的压力横轴比例，默认 1。", "1"],
                  ["heatRadiationFactor", "Frad · 辐射系数", "控制接触界面辐射换热，0 表示未设置。", "0"],
                  ["heatRadiationDistance", "Drad · 辐射距离", `计算辐射的最大距离（${lengthUnit}）。`, "0"],
                  ["heatSecondaryFriction", "Fheat_s · 从侧摩擦生热", "输入从侧的摩擦生热系数。", "0"],
                  ["heatMainFriction", "Fheat_m · 主侧摩擦生热", "输入主侧的摩擦生热系数。", "0"],
                ].map(([key, label, note, fallback]) => (
                  <AnnotatedParam key={key} label={label} note={note}>
                    <RawInput value={ct[key] ?? fallback} onChange={(v) => set(key, v)} mono />
                  </AnnotatedParam>
                ))}
              </>
            )}
          </div>
        )}

        {tab === "gap" && (
          <div className="annotatedGrid2">
            <AnnotatedParam
              label="Fscale_gap · 间隙缩放因子"
              note="对计算得到的变间隙乘以该系数（Igap=1/2/3 时生效）。默认 1.0，工装-模型接触常取 0.8~1.0 以略微收敛初始间隙、避免误触发。"
            >
              <RawInput value={ct.fscaleGap ?? "0.8"} onChange={(v) => set("fscaleGap", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label={`Gapmax · 最大接触间隙 (${lengthUnit})`}
              note="限制变间隙上限（Igap=1/2/3 时生效）。0 表示不设上限；当工装实体/厚板较大时可设正值防止搜索间隙过大。"
            >
              <RawInput value={ct.gapMax ?? "0"} onChange={(v) => set("gapMax", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="Fpenmax · 最大允许穿透率"
              note="穿透深度与间隙的比值上限（0~1）。0 表示不启用阈值去激活；当某节点穿透超过 Fpenmax×Gap 时按求解器规则处理以防失稳。"
            >
              <RawInput value={ct.fpenmax ?? "0"} onChange={(v) => set("fpenmax", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="I_TIED · 绑定接触标志"
              note="接触时间步低于阈值时可绑定从节点。1 允许反弹，2 禁止反弹，0 关闭绑定。实测 HyperMesh 的 Radioss 2022 模板回导时会丢失该字段，使用非零值时须核对最终求解文件。"
            >
              <select className="wbInput" value={String(ct.iTied ?? "0")} onChange={(e) => set("iTied", e.target.value)}>
                <option value="0">0 — 标准滑移/冲击接触（默认）</option>
                <option value="1">1 — 达到时间步阈值时绑定，允许反弹</option>
                <option value="2">2 — 达到时间步阈值时绑定，禁止反弹</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Stmin · 最小接触刚度下限"
              note="仅在 Istf=2/3/4/5 时生效，防止软材料刚度过小导致穿透过大。0 表示不限制下限。"
            >
              <RawInput value={ct.stMin ?? "0"} onChange={(v) => set("stMin", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="Stmax · 最大接触刚度上限"
              note="仅在 Istf=2/3/4/5 时生效，防止刚性接触刚度过高导致显式时间步骤降。0 表示使用 Radioss 内部默认上限 (1e30)。"
            >
              <RawInput value={ct.stMax ?? "0"} onChange={(v) => set("stMax", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="%mesh_size · 网格尺寸比例"
              note="仅在 Igap=3 时生效，用于限制计算间隙不超过相邻单元尺寸的该比例。Radioss 2022 官方默认 0.4（即 40%）。"
            >
              <RawInput value={ct.percentMeshSize ?? "0.4"} onChange={(v) => set("percentMeshSize", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label={`dtmin · 最小接触时间步 (${timeUnit})`}
              note="若接触界面稳定时间步低于 dtmin，则触发保护机制。0 表示不设该阈值限制。"
            >
              <RawInput value={ct.dtmin ?? "0"} onChange={(v) => set("dtmin", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="Irem_gap · 小单元从节点停用标志"
              note="当从节点周围单元尺寸小于接触间隙时是否停用该从节点，避免精细网格自锁。推荐 2。"
            >
              <select className="wbInput" value={String(ct.iremGap ?? "2")} onChange={(e) => set("iremGap", e.target.value)}>
                <option value="2">2 — 单元尺寸小于间隙时自动停用从节点（推荐）</option>
                <option value="1">1 — 不停用从节点（默认）</option>
                <option value="0">0 — 继承 /DEFAULT/INTER/TYPE7</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Irem_i2 · TYPE2 重叠节点去重标志"
              note="若某从节点已定义在 /INTER/TYPE2 绑定接触中，是否从本 TYPE7 接触中移除以避免过约束。"
            >
              <select className="wbInput" value={String(ct.iremI2 ?? "0")} onChange={(e) => set("iremI2", e.target.value)}>
                <option value="0">0 — 继承 /DEFAULT/INTER/TYPE7（显式默认 3）</option>
                <option value="1">1 — 自动移除与 TYPE2 重叠的从节点（推荐防冲突）</option>
                <option value="3">3 — 保留不做移除</option>
              </select>
            </AnnotatedParam>
          </div>
        )}

        {tab === "stiff" && (
          <div className="annotatedGrid2">
            <AnnotatedParam
              label="Stfac · 接触刚度比例系数"
              note="当 Istf≠1 时作为自动计算刚度的乘子（一般取 0.2~1.0，默认 1.0）；当 Istf=1 时直接作为接触弹簧刚度值 K。"
            >
              <RawInput value={ct.stfac ?? "1.0"} onChange={(v) => set("stfac", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="Fric · 库仑摩擦系数 μ"
              note="主/从接触面切向库仑摩擦系数。0 为无摩擦；钢质工装压板/落锤与车体钢/铝结构接触常用 0.1~0.2。"
            >
              <RawInput value={ct.fric ?? "0.15"} onChange={(v) => set("fric", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label={`Gapmin · 最小接触间隙 (${lengthUnit})`}
              note="触发惩罚接触力的最小接触厚度。Radioss 2022 强烈建议不留 0，通常取最薄板厚的一半或 0.1~0.5 mm（按工作长度单位填写）。"
            >
              <RawInput value={ct.gapMin ?? "0.5"} onChange={(v) => set("gapMin", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label={`Tstart · 接触激活时间 (${timeUnit})`}
              note="接触开始生效的仿真时间（默认 0 从零时刻起全程生效）。可用于先重力预平衡后再激活工装接触。"
            >
              <RawInput value={ct.tStart ?? "0"} onChange={(v) => set("tStart", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label={`Tstop · 接触停用时间 (${timeUnit})`}
              note="接触失效关闭的时间；填写 0 表示不关闭（持续至分析结束 Tstop）。"
            >
              <RawInput value={ct.tStop ?? "0"} onChange={(v) => set("tStop", v)} mono />
            </AnnotatedParam>
          </div>
        )}

        {tab === "advanced" && (
          <div className="annotatedGrid2">
            <AnnotatedParam
              label="IBC · 接触时停用边界条件 (XYZ)"
              note="3 位二进制标志（分别对应 X/Y/Z 平动）：000 不停用既有 /BCS 约束；111 表示节点发生接触后关闭其三向约束以免过约束冲突。"
            >
              <div className="ibcInputRow">
                <select
                  className="wbInput"
                  value={["000", "111", "100", "010", "001"].includes(String(ct.ibc ?? "000")) ? String(ct.ibc ?? "000") : "custom"}
                  onChange={(e) => {
                    if (e.target.value !== "custom") set("ibc", e.target.value);
                  }}
                >
                  <option value="000">000 — 不停用任何方向约束（默认）</option>
                  <option value="111">111 — 停用 X/Y/Z 全部边界条件</option>
                  <option value="100">100 — 仅停用 X 向</option>
                  <option value="010">010 — 仅停用 Y 向</option>
                  <option value="001">001 — 仅停用 Z 向</option>
                  <option value="custom">自定义 3 位码</option>
                </select>
                <RawInput value={ct.ibc ?? "000"} onChange={(v) => set("ibc", v)} mono placeholder="000" />
              </div>
            </AnnotatedParam>

            <AnnotatedParam
              label="Inacti · 初始穿透处理方式"
              note="t=0 时刻若工装与模型存在初始网格穿透时的处置策略。推荐 6：平滑减小初始间隙且分离后可恢复，避免初始能量尖峰。"
            >
              <select className="wbInput" value={String(ct.inacti ?? "6")} onChange={(e) => set("inacti", e.target.value)}>
                <option value="6">6 — 变间隙平滑修正初始穿透，分离后恢复（推荐）</option>
                <option value="5">5 — 仅缩减初始间隙为 Gap0 - P0</option>
                <option value="3">3 — 自动移动节点坐标消除穿透</option>
                <option value="1">1 — 停用穿透从节点刚度</option>
                <option value="2">2 — 停用穿透主面单元刚度</option>
                <option value="1000">1000 — 不处理初始穿透（易产生能量突变）</option>
                <option value="0">0 — 继承 /DEFAULT/INTER/TYPE7（等效 1000）</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="VisS · 法向接触临界阻尼"
              note="界面法向惩罚弹簧的临界阻尼比，用于抑制高速冲击下的高频法向抖振。通常取 0.0~0.05（默认 0）。"
            >
              <RawInput value={ct.visS ?? "0"} onChange={(v) => set("visS", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="VisF · 切向摩擦临界阻尼"
              note="切向摩擦力的粘性阻尼系数，用于抑制粘滑切换导致的切向高频振荡。一般保持 0（或取 0.05~1.0）。"
            >
              <RawInput value={ct.visF ?? "0"} onChange={(v) => set("visF", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="Bumult · 桶排序搜索系数"
              note="Bucket Sort 邻域搜索盒子倍增系数。0 表示使用 Radioss 内部默认值 0.20；高速飞溅或大步长可略增大。"
            >
              <RawInput value={ct.bumult ?? "0"} onChange={(v) => set("bumult", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="Iform · 摩擦惩罚公式类型"
              note="推荐 2（增量刚度库仑摩擦），在准静态 ROPS 压溃与低速滑动下稳定性远优于粘性公式 1。"
            >
              <select className="wbInput" value={String(ct.iform ?? "2")} onChange={(e) => set("iform", e.target.value)}>
                <option value="2">2 — 增量刚度库仑摩擦（推荐）</option>
                <option value="1">1 — 粘性（总速度）摩擦公式</option>
                <option value="0">0 — 继承 /DEFAULT/INTER/TYPE7</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Ifric · 摩擦定律选择"
              note="0 为标准常数库仑摩擦（仅使用 Fric）；选 1/2/3 将启用压力/速度相关高级摩擦定律并展开 C1–C6 系数。"
            >
              <select className="wbInput" value={String(ct.ifric ?? "0")} onChange={(e) => set("ifric", e.target.value)}>
                <option value="0">0 — 标准静/动库仑摩擦（默认）</option>
                <option value="1">1 — 广义粘性摩擦定律 (C1–C5)</option>
                <option value="2">2 — 修正 Darmstadt 摩擦定律 (C1–C6)</option>
                <option value="3">3 — Renard 摩擦定律 (C1–C6)</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Ifiltr · 接触力滤波选项"
              note="对界面法向/切向接触应力施加数值低通滤波以消除高频噪声。常规模型保持 0（不滤波）。"
            >
              <select className="wbInput" value={String(ct.ifiltr ?? "0")} onChange={(e) => set("ifiltr", e.target.value)}>
                <option value="0">0 — 不滤波（默认）</option>
                <option value="1">1 — 简单滤波</option>
                <option value="2">2 — 标准滤波</option>
                <option value="3">3 — 指数滤波</option>
              </select>
            </AnnotatedParam>

            <AnnotatedParam
              label="Xfreq · 滤波截止频率"
              note="仅当 Ifiltr > 0 时有效，指定接触力滤波频率系数/截止频率。默认 0。"
            >
              <RawInput value={ct.xfreq ?? "0"} onChange={(v) => set("xfreq", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="sens_ID · 传感器 ID"
              note="可选外部 /SENSOR ID，0 表示不使用传感器触发。"
            >
              <RawInput value={ct.sensId ?? "0"} onChange={(v) => set("sensId", v)} mono />
            </AnnotatedParam>

            <AnnotatedParam
              label="fct_IDf / Ascale_F · 摩擦函数缩放"
              note="可选引用外部 /FUNCT ID 动态缩放摩擦系数（0 表示常数 Fric），右侧为函数幅值比例系数 Ascale_F。"
            >
              <div className="formGrid2">
                <RawInput value={ct.fctIdF ?? "0"} onChange={(v) => set("fctIdF", v)} mono placeholder="fct_IDf=0" />
                <RawInput value={ct.ascaleF ?? "0"} onChange={(v) => set("ascaleF", v)} mono placeholder="Ascale_F=0" />
              </div>
            </AnnotatedParam>

            <AnnotatedParam
              label="fric_ID · 外部 /FRICTION ID"
              note="可选引用外部多材料摩擦表 /FRICTION ID；0 表示使用本卡片自带摩擦参数。"
            >
              <RawInput value={ct.fricId ?? "0"} onChange={(v) => set("fricId", v)} mono />
            </AnnotatedParam>

            {ifric > 0 && (
              <AnnotatedParam
                span={2}
                label="高级摩擦定律系数 C1 – C6"
                note="Ifric = 1 使用 C1–C5；Ifric = 2 或 3 使用 C1–C6（依据 Radioss 2022 对应摩擦方程填写）。"
              >
                <div className="vec3Inputs">
                  <RawInput value={ct.c1 ?? "0"} onChange={(v) => set("c1", v)} mono placeholder="C1" />
                  <RawInput value={ct.c2 ?? "0"} onChange={(v) => set("c2", v)} mono placeholder="C2" />
                  <RawInput value={ct.c3 ?? "0"} onChange={(v) => set("c3", v)} mono placeholder="C3" />
                  <RawInput value={ct.c4 ?? "0"} onChange={(v) => set("c4", v)} mono placeholder="C4" />
                  <RawInput value={ct.c5 ?? "0"} onChange={(v) => set("c5", v)} mono placeholder="C5" />
                  {(ifric === 2 || ifric === 3) && (
                    <RawInput value={ct.c6 ?? "0"} onChange={(v) => set("c6", v)} mono placeholder="C6" />
                  )}
                </div>
              </AnnotatedParam>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RadiossForm({
  draft,
  patch,
  fops,
  onNotify,
}: {
  draft: Draft;
  patch: (k: string, v: unknown) => void;
  fops: boolean;
  onNotify?: (message: string) => void;
}) {
  const impact = (draft.impact ?? {}) as Draft;
  const setImpact = (k: string, v: string) => patch("impact", { ...impact, [k]: v });
  const curve = (Array.isArray(draft.curve) ? draft.curve : []) as Draft[];
  const constraints = (Array.isArray(draft.constraints) ? draft.constraints : []) as Draft[];
  const contacts = (Array.isArray(draft.contacts) ? draft.contacts : []) as Draft[];
  const dirMode = (draft.directionMode || "axis") as "axis" | "vector";
  const dirVec = (Array.isArray(draft.directionVector) ? draft.directionVector : ["0", "0", "-1"]) as string[];
  const vecOrigin = (Array.isArray(draft.vectorOrigin) ? draft.vectorOrigin : ["0", "0", "0"]) as string[];

  const gStd = 9.80665 * (optNum(impact.gravityG) ?? 1);
  const hM = num(impact.dropHeightMm) / 1000;
  const mass = num(impact.dropMassKg);
  const v0 = hM > 0 && gStd > 0 ? Math.sqrt(2 * gStd * hM) : 0;
  const energy = mass > 0 && hM > 0 ? mass * gStd * hM : 0;

  const applyUnitPreset = (m: string, l: string, t: string) => {
    patch("inputMass", m);
    patch("inputLength", l);
    patch("inputTime", t);
    patch("workMass", m);
    patch("workLength", l);
    patch("workTime", t);
  };

  const normDirToken = (() => {
    const raw = String(draft.direction || "X").trim().toUpperCase();
    if (raw === "X" || raw === "Y" || raw === "Z") return "+" + raw;
    if (raw === "XX" || raw === "YY" || raw === "ZZ") return "+" + raw;
    return raw;
  })();

  return (
    <>
      <div className="inlineNotice amber">
        {fops
          ? "FOPS 落锤冲击（Radioss 2022 基线 · 实验性）：支持受控位移曲线 + /INTER/TYPE7 工装-模型接触与 /SKEW/FIX 方向定义，单文件增量 .rad 导出（P0 实机导入待验证）。"
          : "ROPS 受控位移（Radioss 2022 基线 · 实验性）：支持坐标轴/三维矢量加载方向、/INTER/TYPE7 工装-模型接触、/BCS 与 Engine 控制，单文件增量 .rad 导出（P0 实机导入待验证）。"}
      </div>

      {fops && (
        <FormSection
          step="00"
          title="落锤冲击参数换算"
          subtitle="工程校核专用（v₀ = √(2gh)，E = mgh），不直接写入 .rad 卡片"
          badge={
            energy > 0 ? (
              <span className="inlineCalcBadge">
                v₀ ≈ {v0.toFixed(2)} m/s · E ≈ {energy.toFixed(0)} J
              </span>
            ) : undefined
          }
        >
          <div className="formGrid3">
            <Field label="落锤质量 (kg)" help="用于按 E = mgh 估算冲击能量，填写落锤质量。"><RawInput value={impact.dropMassKg ?? ""} onChange={(v) => setImpact("dropMassKg", v)} mono /></Field>
            <Field label="自由落差 (mm)" help="从释放位置到接触位置的竖直落差，用于估算碰撞速度和能量。"><RawInput value={impact.dropHeightMm ?? ""} onChange={(v) => setImpact("dropHeightMm", v)} mono /></Field>
            <Field label="重力倍数 (g)" help="用于自由落体换算。求解时的实际重力由下方 /GRAV 工况设置。"><RawInput value={impact.gravityG ?? "1"} onChange={(v) => setImpact("gravityG", v)} mono /></Field>
          </div>
        </FormSection>
      )}

      <FormSection step="01" title="工况标识、加载对象与加载方向" subtitle="Run Name 仅限 ASCII 字符；支持正负坐标轴与任意三维加载方向向量">
        <div className="formGrid3">
          <Field label="工况展示名称"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
          <Field label="ASCII Run Name" hint="4–80 字符"><RawInput value={draft.runName} onChange={(v) => patch("runName", v)} mono /></Field>
          <Field label="加载对象类型">
            <SegmentedControl
              value={(draft.loadKind || "node") as "node" | "grnod"}
              options={[
                { value: "node", label: "已有单节点" },
                { value: "grnod", label: "已有 /GRNOD" },
              ]}
              onChange={(v) => patch("loadKind", v)}
            />
          </Field>
          {draft.loadKind === "grnod" ? (
            <Field label="已有 GRNOD ID"><RawInput value={draft.loadGrnodId} onChange={(v) => patch("loadGrnodId", v)} mono /></Field>
          ) : (
            <Field label="已有 Node ID"><RawInput value={draft.loadNodeId} onChange={(v) => patch("loadNodeId", v)} mono /></Field>
          )}
          <Field label="加载方向模式" span={2}>
            <SegmentedControl
              value={dirMode}
              options={[
                { value: "axis", label: "坐标轴方向 (±X/Y/Z, ±XX/YY/ZZ)" },
                { value: "vector", label: "自定义三维向量 (自动生成 /SKEW/FIX)" },
              ]}
              onChange={(v) => patch("directionMode", v)}
            />
          </Field>
        </div>

        {dirMode === "axis" ? (
          <div className="subBox">
            <div className="formGrid3">
              <AnnotatedParam
                span={2}
                label="加载方向 (Dir & 极性)"
                note="选择负方向（-X/-Y/-Z）时自动在 /IMPDISP 中设置 Fscale_Y = -1.0，位移曲线保持正值即可沿负向加载；也可下拉切换转动自由度（±XX/YY/ZZ）。"
              >
                <div className="dirAxisRow">
                  <div className="presetRow">
                    {["+X", "-X", "+Y", "-Y", "+Z", "-Z"].map((ax) => (
                      <button
                        key={ax}
                        type="button"
                        className={"presetBtn" + (normDirToken === ax ? " active" : "")}
                        onClick={() => patch("direction", ax.startsWith("+") ? ax.slice(1) : ax)}
                      >
                        {ax}
                      </button>
                    ))}
                  </div>
                  <select
                    className="wbInput dirSelect"
                    value={normDirToken}
                    onChange={(e) => {
                      const val = e.target.value;
                      patch("direction", val.startsWith("+") ? val.slice(1) : val);
                    }}
                  >
                    <option value="+X">+X (平动正向)</option>
                    <option value="-X">-X (平动负向)</option>
                    <option value="+Y">+Y (平动正向)</option>
                    <option value="-Y">-Y (平动负向)</option>
                    <option value="+Z">+Z (平动正向)</option>
                    <option value="-Z">-Z (平动负向)</option>
                    <option value="+XX">+XX (绕 X 正转)</option>
                    <option value="-XX">-XX (绕 X 反转)</option>
                    <option value="+YY">+YY (绕 Y 正转)</option>
                    <option value="-YY">-YY (绕 Y 反转)</option>
                    <option value="+ZZ">+ZZ (绕 Z 正转)</option>
                    <option value="-ZZ">-ZZ (绕 Z 反转)</option>
                  </select>
                </div>
              </AnnotatedParam>
              <AnnotatedParam
                label="已有局部 Skew ID"
                hint="0=全局坐标系"
                note="若填写非 0 外部 /SKEW ID，则上述加载方向在对应局部坐标系下生效。"
              >
                <RawInput value={draft.skewId} onChange={(v) => patch("skewId", v)} mono placeholder="0" />
              </AnnotatedParam>
            </div>
          </div>
        ) : (
          <div className="subBox">
            <div className="formGrid2">
              <AnnotatedParam
                label="加载方向向量 (dx, dy, dz)"
                note="输入任意三维加载方向（无需归一化，如 (0, -0.866, -0.5) 表示斜向压溃）。导出时自动构建 /SKEW/FIX 并将 /IMPDISP 绑定至局部 X' 轴。"
              >
                <div className="vec3Inputs">
                  {[0, 1, 2].map((idx) => (
                    <RawInput
                      key={idx}
                      value={dirVec[idx] ?? "0"}
                      mono
                      placeholder={["dx", "dy", "dz"][idx]}
                      onChange={(v) => {
                        const next = [...dirVec];
                        next[idx] = v;
                        patch("directionVector", next);
                      }}
                    />
                  ))}
                </div>
              </AnnotatedParam>
              <AnnotatedParam
                label="局部 Skew 参考原点 (Ox, Oy, Oz)"
                hint="默认 0,0,0"
                note="生成的 /SKEW/FIX 原点坐标（工作长度单位）；对于纯平动方向加载，原点取值不影响载荷方向。"
              >
                <div className="vec3Inputs">
                  {[0, 1, 2].map((idx) => (
                    <RawInput
                      key={idx}
                      value={vecOrigin[idx] ?? "0"}
                      mono
                      placeholder={["Ox", "Oy", "Oz"][idx]}
                      onChange={(v) => {
                        const next = [...vecOrigin];
                        next[idx] = v;
                        patch("vectorOrigin", next);
                      }}
                    />
                  ))}
                </div>
              </AnnotatedParam>
            </div>
          </div>
        )}
      </FormSection>

      <FormSection
        step="02"
        title="单位制一致性校验"
        subtitle="v1 要求输入单位与工作单位完全一致"
        actions={
          <div className="btnCluster">
            <button type="button" className="btnMini" onClick={() => applyUnitPreset("kg", "mm", "ms")}>kg / mm / ms</button>
            <button type="button" className="btnMini" onClick={() => applyUnitPreset("t", "mm", "s")}>t / mm / s</button>
            <button type="button" className="btnMini" onClick={() => applyUnitPreset("kg", "m", "s")}>kg / m / s</button>
          </div>
        }
      >
        <div className="unitCompareGrid">
          <div className="unitGroupBox">
            <span>输入单位制 (Input)</span>
            <div className="formGrid3">
              <Field label="质量"><RawInput value={draft.inputMass} onChange={(v) => patch("inputMass", v)} mono /></Field>
              <Field label="长度"><RawInput value={draft.inputLength} onChange={(v) => patch("inputLength", v)} mono /></Field>
              <Field label="时间"><RawInput value={draft.inputTime} onChange={(v) => patch("inputTime", v)} mono /></Field>
            </div>
          </div>
          <div className="unitGroupBox">
            <span>工作单位制 (Work)</span>
            <div className="formGrid3">
              <Field label="质量"><RawInput value={draft.workMass} onChange={(v) => patch("workMass", v)} mono /></Field>
              <Field label="长度"><RawInput value={draft.workLength} onChange={(v) => patch("workLength", v)} mono /></Field>
              <Field label="时间"><RawInput value={draft.workTime} onChange={(v) => patch("workTime", v)} mono /></Field>
            </div>
          </div>
        </div>
        <label className="safetyAck warn" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={Boolean(draft.confirmModel)} onChange={(e) => patch("confirmModel", e.target.checked)} />
          <span>我确认上述单位与 HyperMesh 目标模型完全一致（未确认将阻止导出）</span>
        </label>
      </FormSection>

      <FormSection
        step="03"
        title={fops ? "落锤受控位移曲线 t / u (/FUNCT + /IMPDISP)" : "受控位移曲线 t / u (/FUNCT + /IMPDISP)"}
        subtitle="时间严格递增；负位移表示反方向加载"
        actions={
          <button type="button" className="btnMini" onClick={() => patch("curve", [...curve, { time: "", value: "" }])}>
            <PlusIcon size={14} /> 添加点
          </button>
        }
      >
        <div className="compactTableWrap">
          <table className="compactTable">
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th>时间 ({draft.workTime || "ms"})</th>
                <th>位移 ({draft.workLength || "mm"})</th>
                <th style={{ width: 38 }} />
              </tr>
            </thead>
            <tbody>
              {curve.map((p, index) => (
                <tr key={index}>
                  <td className="rowNum">{index + 1}</td>
                  <td>
                    <NumericInput
                      value={num(p.time)}
                      onCommit={(v) => {
                        const next = [...curve];
                        next[index] = { ...next[index], time: String(v) };
                        patch("curve", next);
                      }}
                    />
                  </td>
                  <td>
                    <NumericInput
                      value={num(p.value)}
                      onCommit={(v) => {
                        const next = [...curve];
                        next[index] = { ...next[index], value: String(v) };
                        patch("curve", next);
                      }}
                    />
                  </td>
                  <td className="rowOp">
                    <button
                      type="button"
                      className="iconTrashBtn"
                      title="删除点"
                      onClick={() => patch("curve", curve.filter((_, i) => i !== index))}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="formGrid2" style={{ marginTop: 12 }}>
          <Field label="IMPDISP Tstart" hint="留空=全程起点"><RawInput value={draft.tStart} onChange={(v) => patch("tStart", v)} mono /></Field>
          <Field label="IMPDISP Tstop" hint="留空=全程终点"><RawInput value={draft.tStop} onChange={(v) => patch("tStop", v)} mono /></Field>
        </div>
      </FormSection>

      <FormSection
        step="04"
        title="边界条件 / BCS（六自由度约束组）"
        subtitle="支持引用已有 /GRNOD 或指定节点号自动构建 /GRNOD/NODE"
        actions={
          <button
            type="button"
            className="btnMini"
            onClick={() =>
              patch("constraints", [
                ...constraints,
                { kind: "nodes", nodeIds: "", grnodId: "", dofs: [true, true, true, false, false, false], skewId: "" },
              ])
            }
          >
            <PlusIcon size={14} /> 添加约束组
          </button>
        }
      >
        <div className="bcsCardList">
          {constraints.map((row, index) => (
            <div className="bcsCard" key={index}>
              <div className="bcsCardTop">
                <span className="bcsCardTitle">约束组 #{index + 1}</span>
                <SegmentedControl
                  value={(row.kind || "nodes") as "nodes" | "grnod"}
                  options={[
                    { value: "nodes", label: "节点列表" },
                    { value: "grnod", label: "已有 GRNOD" },
                  ]}
                  onChange={(v) => {
                    const next = [...constraints];
                    next[index] = { ...next[index], kind: v };
                    patch("constraints", next);
                  }}
                />
                <button
                  type="button"
                  className="iconTrashBtn"
                  title="删除约束组"
                  onClick={() => patch("constraints", constraints.filter((_, i) => i !== index))}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
              <div className="formGrid2" style={{ marginTop: 8 }}>
                {row.kind === "grnod" ? (
                  <Field label="GRNOD ID">
                    <RawInput
                      value={row.grnodId}
                      onChange={(v) => {
                        const next = [...constraints];
                        next[index] = { ...next[index], grnodId: v };
                        patch("constraints", next);
                      }}
                      mono
                    />
                  </Field>
                ) : (
                  <Field label="Node IDs（逗号分隔）">
                    <RawInput
                      value={row.nodeIds}
                      onChange={(v) => {
                        const next = [...constraints];
                        next[index] = { ...next[index], nodeIds: v };
                        patch("constraints", next);
                      }}
                      mono
                    />
                  </Field>
                )}
                <Field label="Skew ID（0=全局）">
                  <RawInput
                    value={row.skewId}
                    onChange={(v) => {
                      const next = [...constraints];
                      next[index] = { ...next[index], skewId: v };
                      patch("constraints", next);
                    }}
                    mono
                    placeholder="0"
                  />
                </Field>
              </div>
              <div style={{ marginTop: 8 }}>
                <span className="wbFieldLabel" style={{ marginBottom: 4 }}>固定自由度 (1–6)</span>
                <DofBoolPills
                  dofs={row.dofs ?? [false, false, false, false, false, false]}
                  onChange={(nextDofs) => {
                    const next = [...constraints];
                    next[index] = { ...next[index], dofs: nextDofs };
                    patch("constraints", next);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection
        step="05"
        title="工装-模型接触定义 / INTER / TYPE7（Radioss 2022 基线）"
        subtitle="通过模型侧从节点集 (grnd_IDs) 与工装侧主表面集 (surf_IDm) 完成接触定义，所有参数均附 2022 基线注释"
        actions={
          <button
            type="button"
            className="btnMini"
            onClick={() => patch("contacts", [...contacts, createDefaultRadiossContact()])}
          >
            <PlusIcon size={14} /> 添加工装-模型接触
          </button>
        }
      >
        {contacts.length === 0 ? (
          <div className="contactEmptyState">
            <p>
              当前未添加接触接口。若需在增量 .rad 中建立工装（压板 / 落锤）与模型之间的 <code>/INTER/TYPE7</code> 接触，请点击右上角“添加工装-模型接触”并填写两个 Set ID。
            </p>
          </div>
        ) : (
          <div className="bcsCardList">
            {contacts.map((ct, index) => (
              <RadiossContactCard
                key={index}
                index={index}
                ct={ct}
                lengthUnit={String(draft.workLength || "mm")}
                timeUnit={String(draft.workTime || "ms")}
                onChange={(nextCt) => {
                  const next = [...contacts];
                  next[index] = nextCt;
                  patch("contacts", next);
                }}
                onRemove={() => {
                  patch("contacts", contacts.filter((_, i) => i !== index));
                  const histories = (draft.timeHistories ?? []) as Draft[];
                  patch("timeHistories", histories.map((history) => ({
                    ...history,
                    contactIndices: ((history.contactIndices ?? []) as number[])
                      .filter((i) => i !== index)
                      .map((i) => i > index ? i - 1 : i),
                  })));
                }}
              />
            ))}
          </div>
        )}
      </FormSection>

      <FormSection step="06" title="重力场与重力曲线 /GRAV">
        <RadiossGravitySection draft={draft} patch={patch} fops={fops} onNotify={onNotify} />
      </FormSection>
      <FormSection step="07" title="时程输出 /TH">
        <RadiossTimeHistorySection draft={draft} patch={patch} />
      </FormSection>
      <FormSection step="08" title="Engine 求解控制与输出">
        <RadiossEngineSection draft={draft} patch={patch} />
      </FormSection>
      <FormSection step="09" title="Radioss Functions /FUNCT">
        <RadiossFunctionsManager draft={draft} patch={patch} onNotify={onNotify} />
      </FormSection>
      <FormSection step="10" title="ID 分配策略">
        <div className="formGrid2">
          <Field label="新实体 ID 起始值" help="GRNOD / FUNCT / IMPDISP / BCS 等家族将自动分区偏移。">
            <RawInput value={draft.generatedStart} onChange={(v) => patch("generatedStart", v)} mono />
          </Field>
          <Field label="已占用 ID 区间" hint="如 800100-800200;800500" help="生成时自动避让模型中已占用的编号区间。">
            <RawInput value={draft.occupiedRanges} onChange={(v) => patch("occupiedRanges", v)} mono />
          </Field>
        </div>
      </FormSection>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                         */
/* ------------------------------------------------------------------ */
export default function WorkbenchForms({
  activeId,
  draft,
  patch,
  psdBusy,
  psdImport,
  gravityRowIndex = 0,
  onSelectGravityRow,
  onImportPsd,
  onDownloadTemplate,
  onLoadSample,
  multiCaseContext,
  onNotify,
}: {
  activeId: string;
  draft: Draft;
  patch: (key: string, value: unknown) => void;
  psdBusy: boolean;
  psdImport: PsdImportResult | null;
  gravityRowIndex?: number;
  onSelectGravityRow?: (index: number) => void;
  onImportPsd: () => void;
  onDownloadTemplate: (fmt: "csv" | "xlsx") => void;
  onLoadSample: () => void;
  multiCaseContext?: MultiCaseFormContext;
  onNotify?: (message: string) => void;
}) {
  switch (activeId) {
    case "nodal-static":
      return <NodalStaticForm draft={draft} patch={patch} mc={multiCaseContext} />;
    case "constraint":
      return <ConstraintForm draft={draft} patch={patch} mc={multiCaseContext} />;
    case "gravity":
      return (
        <GravityForm
          draft={draft}
          patch={patch}
          selectedIndex={gravityRowIndex}
          onSelectIndex={onSelectGravityRow}
          mc={multiCaseContext}
        />
      );
    case "normal-modes":
      return <NormalModesForm draft={draft} patch={patch} mc={multiCaseContext} />;
    case "frequency-response":
      return <FrequencyResponseForm draft={draft} patch={patch} mc={multiCaseContext} />;
    case "random-psd":
      return (
        <RandomPsdForm
          draft={draft}
          patch={patch}
          psdBusy={psdBusy}
          psdImport={psdImport}
          onImportPsd={onImportPsd}
          onDownloadTemplate={onDownloadTemplate}
          onLoadSample={onLoadSample}
          mc={multiCaseContext}
        />
      );
    case "radioss-rops":
      return <RadiossForm key={activeId} draft={draft} patch={patch} fops={false} onNotify={onNotify} />;
    case "radioss-fops":
      return <RadiossForm key={activeId} draft={draft} patch={patch} fops onNotify={onNotify} />;
    default:
      return null;
  }
}
