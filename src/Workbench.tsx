import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import NumericInput from "@/components/NumericInput";
import InfoTip from "@/components/InfoTip";
import ModulePreview from "@/modules/previews/ModulePreview";
import TabularModule from "@/modules/tabular/TabularModule";
import { FALLBACK_MODULES, MODULE_GROUPS, STATUS_LABELS } from "@/app/moduleRegistry";
import ModuleGallery from "@/app/ModuleGallery";
import {
  buildCase,
  exportCaseFiles,
  isDesktop,
  listCaseModules,
  previewCase,
  type Diagnostic,
  type ModuleDescriptor,
  type PreviewResult,
} from "@/lib/caseApi";

type Draft = Record<string, any>;

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};
const optInt = (value: unknown): number | undefined => {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : undefined;
};
const parseDofs = (value: unknown): number[] => {
  const text = String(value ?? "").replace(/\s+/g, "");
  const out = new Set<number>();
  text.split(",").filter(Boolean).forEach((token) => {
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      for (let d = Math.min(a, b); d <= Math.max(a, b); d += 1) out.add(d);
    } else if (/^[1-6]{2,}$/.test(token)) {
      // Compact form such as "123" means DOFs 1,2,3 (DOF numbers never exceed 6).
      for (const ch of token) out.add(parseInt(ch, 10));
    } else if (/^\d+$/.test(token)) {
      out.add(parseInt(token, 10));
    }
  });
  return [...out].sort((a, b) => a - b);
};

const optNum = (value: unknown): number | undefined => {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : undefined;
};
const parseIdList = (value: unknown): number[] =>
  String(value ?? "")
    .split(/[,\s，、]+/)
    .filter(Boolean)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
const parseRanges = (value: unknown): Array<[number, number]> =>
  String(value ?? "")
    .split(/[;\n]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = chunk.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)] as [number, number];
      const single = parseInt(chunk, 10);
      return Number.isFinite(single) ? ([single, single] as [number, number]) : null;
    })
    .filter((v): v is [number, number] => v !== null);

const RADIOSS_DEFAULTS: Draft = {
  solverVersion: "2022",
  inputMass: "kg", inputLength: "mm", inputTime: "ms",
  workMass: "kg", workLength: "mm", workTime: "ms", confirmModel: false,
  loadKind: "node", loadNodeId: "1001", loadGrnodId: "",
  direction: "X",
  curve: [{ time: "0", value: "0" }, { time: "0.05", value: "40" }, { time: "0.1", value: "40" }],
  tStart: "", tStop: "", skewId: "",
  constraints: [{ kind: "nodes", nodeIds: "2001,2002", grnodId: "", dofs: [true, true, true, false, false, false], skewId: "" }],
  endTime: "0.1", animStart: "0", animInterval: "0.01", thInterval: "0.001",
  timeStepMode: "natural", timeStepScale: "0.9", timeStepTarget: "0.001", amsPartGroupId: "",
  gravityEnabled: false, gravityMagnitude: "0", gravityDir: "Z",
  generatedStart: "800000", occupiedRanges: "",
};

const INITIAL_DRAFTS: Record<string, Draft> = {
  "radioss-rops": { ...RADIOSS_DEFAULTS, name: "ROPS_CASE_1", runName: "ROPS_CASE" },
  "radioss-fops": {
    ...RADIOSS_DEFAULTS,
    name: "FOPS_CASE_1", runName: "FOPS_CASE", direction: "Z",
    loadNodeId: "3001",
    curve: [{ time: "0", value: "0" }, { time: "0.01", value: "30" }, { time: "0.05", value: "30" }],
    constraints: [{ kind: "nodes", nodeIds: "4001,4002", grnodId: "", dofs: [true, true, true, true, true, true], skewId: "" }],
    endTime: "0.05", animInterval: "0.005", thInterval: "0.0005",
    impact: { dropMassKg: "300", dropHeightMm: "3000", gravityG: "1" },
  },
  "nodal-static": {
    name: "Nodal_Static_1", modelUnits: "N-mm-s", solverVersion: "2022",
    existingSpcSetId: "900001", outputProfile: "STATIC_BASIC",
    loads: [{ nodeId: "1001", cid: "0", fx: "", fy: "", fz: "", mx: "", my: "", mz: "", label: "" }],
  },
  constraint: {
    name: "Constraint_1", modelUnits: "N-mm-s", mode: "new",
    existingSpcSetIds: "", combineWithExisting: false,
    rows: [{ nodeId: "", dofs: "123", value: "" }],
  },
  gravity: {
    name: "Gravity_Z", modelUnits: "N-mm-s", magnitudeG: "1", direction: ["0", "0", "-1"],
    cid: "0", existingSpcSetId: "900001", outputProfile: "STATIC_BASIC",
  },
  "normal-modes": {
    name: "Normal_Modes", modelUnits: "N-mm-s", existingSpcSetId: "900001",
    eigrlMinHz: "0", eigrlMaxHz: "300", numModes: "10", outputProfile: "MODAL_BASIC",
  },
  "frequency-response": {
    name: "Frequency_Response", modelUnits: "N-mm-s", existingSpcSetId: "900001",
    minHz: "10", maxHz: "200", stepHz: "1", eigrlMinHz: "0", eigrlMaxHz: "300",
    dampingRatio: "0.02", outputProfile: "MFREQ_BASIC",
  },
  "random-psd": {
    name: "Random_PSD_Z", modelUnits: "N-mm-s", solverVersion: "2022",
    excKind: "base-acceleration", nodeId: "1001", component: "3", existingSpcSetId: "9001",
    inputPsdUnit: "g^2/Hz", referenceAmplitudeG: "1", forceDirection: ["1", "0", "0"], referenceForceN: "1",
    interpolation: "LOG-LOG", outOfRange: "ERROR",
    points: [{ frequencyHz: "10", psd: "0.003" }, { frequencyHz: "100", psd: "0.006" }, { frequencyHz: "200", psd: "0.003" }],
    minHz: "10", maxHz: "200", stepHz: "1", modalMinHz: "0", modalMaxHz: "300", modalSolver: "LANCZOS",
    dampingRatio: "0.02", outputProfile: "PSD_AND_RMS", stress: true, displacement: true, acceleration: true, confirmSpc: false,
  },
};

function buildRadiossParameters(d: Draft): Record<string, unknown> {
  const timeStep =
    d.timeStepMode === "noda-cst"
      ? { mode: "noda-cst", scale: num(d.timeStepScale), target: num(d.timeStepTarget) }
      : d.timeStepMode === "ams"
        ? { mode: "ams", scale: num(d.timeStepScale), target: num(d.timeStepTarget), amsPartGroupId: optInt(d.amsPartGroupId) }
        : { mode: "natural" };
  return {
    name: d.name,
    runName: d.runName,
    solverVersion: d.solverVersion,
    units: {
      input: { mass: d.inputMass, length: d.inputLength, time: d.inputTime },
      work: { mass: d.workMass, length: d.workLength, time: d.workTime },
      confirmedAgainstTargetModel: Boolean(d.confirmModel),
    },
    references: {
      loadTarget:
        d.loadKind === "grnod"
          ? { kind: "grnod", grnodId: num(d.loadGrnodId) }
          : { kind: "node", nodeId: num(d.loadNodeId) },
      constraints: (d.constraints as Draft[]).map((row) => ({
        target:
          row.kind === "grnod"
            ? { kind: "grnod", grnodId: num(row.grnodId) }
            : { kind: "nodes", nodeIds: parseIdList(row.nodeIds) },
        dofs: [0, 1, 2, 3, 4, 5].map((i) => Boolean((row.dofs as boolean[])[i])),
        skewId: optInt(row.skewId),
      })),
    },
    loading: {
      direction: d.direction,
      curve: (d.curve as Draft[]).map((p) => ({ time: num(p.time), value: num(p.value) })),
      tStart: optNum(d.tStart),
      tStop: optNum(d.tStop),
      skewId: optInt(d.skewId),
    },
    engine: {
      endTime: num(d.endTime),
      animation: { startTime: num(d.animStart), interval: num(d.animInterval) },
      timeHistoryInterval: num(d.thInterval),
      timeStep,
    },
    gravity: d.gravityEnabled
      ? { enabled: true, magnitude: num(d.gravityMagnitude), direction: d.gravityDir }
      : undefined,
    idPolicy: { generatedStart: num(d.generatedStart), manuallyOccupiedRanges: parseRanges(d.occupiedRanges) },
  };
}

function buildParameters(id: string, d: Draft): Record<string, unknown> {
  switch (id) {
    case "radioss-rops":
      return buildRadiossParameters(d);
    case "radioss-fops":
      return {
        base: buildRadiossParameters(d),
        impact: {
          dropMassKg: num(d.impact?.dropMassKg),
          dropHeightMm: num(d.impact?.dropHeightMm),
          gravityG: num(d.impact?.gravityG) || 1,
        },
      };
    case "nodal-static":
      return {
        name: d.name, modelUnits: d.modelUnits, solverVersion: d.solverVersion,
        existingSpcSetId: optInt(d.existingSpcSetId), outputProfile: d.outputProfile,
        loads: (d.loads as Draft[]).map((r) => ({
          nodeId: num(r.nodeId), cid: num(r.cid), fx: num(r.fx), fy: num(r.fy), fz: num(r.fz),
          mx: num(r.mx), my: num(r.my), mz: num(r.mz), label: r.label || "",
        })),
      };
    case "constraint":
      return {
        name: d.name, modelUnits: d.modelUnits, mode: d.mode,
        combineWithExisting: Boolean(d.combineWithExisting),
        existingSpcSetIds: String(d.existingSpcSetIds ?? "").split(/[,\s]+/).filter(Boolean).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)),
        rows: (d.rows as Draft[]).map((r) => ({ nodeId: num(r.nodeId), dofs: parseDofs(r.dofs), value: optInt(r.value) ?? 0, cid: 0 })),
      };
    case "gravity":
      return {
        name: d.name, modelUnits: d.modelUnits, magnitudeG: num(d.magnitudeG),
        direction: (d.direction as string[]).map(num), cid: num(d.cid),
        existingSpcSetId: optInt(d.existingSpcSetId), outputProfile: d.outputProfile,
      };
    case "normal-modes":
      return {
        name: d.name, modelUnits: d.modelUnits, existingSpcSetId: optInt(d.existingSpcSetId),
        eigrlMinHz: optInt(d.eigrlMinHz), eigrlMaxHz: optInt(d.eigrlMaxHz), numModes: optInt(d.numModes),
        outputProfile: d.outputProfile,
      };
    case "frequency-response":
      return {
        name: d.name, modelUnits: d.modelUnits, existingSpcSetId: num(d.existingSpcSetId),
        frequencyMinHz: num(d.minHz), frequencyMaxHz: num(d.maxHz), frequencyStepHz: num(d.stepHz),
        eigrlMinHz: num(d.eigrlMinHz), eigrlMaxHz: num(d.eigrlMaxHz), dampingRatio: num(d.dampingRatio),
      };
    case "random-psd": {
      const baseAccel = d.excKind === "base-acceleration";
      return {
        name: d.name, modelUnits: d.modelUnits, solverVersion: d.solverVersion,
        excitation: baseAccel
          ? { kind: "base-acceleration", nodeId: num(d.nodeId), component: num(d.component), existingSpcSetId: num(d.existingSpcSetId), inputPsdUnit: d.inputPsdUnit, referenceAmplitudeG: num(d.referenceAmplitudeG) }
          : { kind: "applied-force", nodeId: num(d.nodeId), cid: 0, direction: (d.forceDirection as string[]).map(num), existingSpcSetId: num(d.existingSpcSetId), inputPsdUnit: d.inputPsdUnit, referenceForceN: num(d.referenceForceN) },
        spectrum: {
          interpolation: d.interpolation, outOfRange: d.outOfRange,
          points: (d.points as Draft[]).map((p) => ({ frequencyHz: num(p.frequencyHz), psd: num(p.psd) })),
        },
        frequency: { minHz: num(d.minHz), maxHz: num(d.maxHz), stepHz: num(d.stepHz) },
        modal: { minHz: num(d.modalMinHz), maxHz: num(d.modalMaxHz), solver: d.modalSolver },
        damping: { kind: "modal-critical-ratio", ratio: num(d.dampingRatio) },
        output: { profile: d.outputProfile, h3d: true, stress: Boolean(d.stress), displacement: Boolean(d.displacement), acceleration: Boolean(d.acceleration) },
        confirmExcitedDofInSpc: Boolean(d.confirmSpc),
      };
    }
    default:
      return {};
  }
}

function Field({ label, children, hint, help }: { label: string; children: ReactNode; hint?: string; help?: ReactNode }) {
  return (
    <label className="wbField">
      <span className="wbFieldLabel">
        {label}
        {hint && <em>{hint}</em>}
        {help && <InfoTip text={help} />}
      </span>
      {children}
    </label>
  );
}

function RawInput({ value, onChange, placeholder, mono }: { value: string | number; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <input className={mono ? "wbInput mono" : "wbInput"} value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />;
}

function DiagList({ items }: { items: Diagnostic[] }) {
  if (items.length === 0) return <p className="wbMuted">无诊断信息。</p>;
  return (
    <ul className="wbDiagList">
      {items.map((d, i) => (
        <li key={i} className={"wbDiag " + d.severity}>
          <span className="wbDiagCode">{d.code}</span>
          <span>{d.message}</span>
          {d.hint && <small>{d.hint}</small>}
        </li>
      ))}
    </ul>
  );
}

/** Shared ROPS / FOPS form body. FOPS adds the drop-hammer impact parameter card. */
function RadiossFields({ draft, patch, fops }: { draft: Draft; patch: (k: string, v: unknown) => void; fops: boolean }) {
  const impact = (draft.impact ?? {}) as Draft;
  const setImpact = (key: string, value: string) => patch("impact", { ...impact, [key]: value });
  return (
    <>
      <div className="wbAlert info">
        {fops
          ? "FOPS 落锤冲击：受控位移近似（对冲击点施加竖直方向位移曲线），附落锤质量/落差换算冲击能量与速度。不生成落锤实体、/INTER/TYPE7 或 /RBODY；外部节点/组 ID 需在 HyperMesh 中核对。实验性，需 P0 实机验证。"
          : "Radioss 2022 单文件增量：只输出 /GRNOD/NODE、/FUNCT、/IMPDISP、/BCS 与 Engine 控制；不含 /NODE 与网格。所有外部节点/组 ID 需在 HyperMesh 中核对。当前为实验性（P0 实机导入验证未执行）。"}
      </div>
      {fops && (
        <>
          <div className="wbSubHead">落锤冲击参数（用于能量/速度换算校核）</div>
          <div className="wbRow3">
            <Field label="落锤质量 kg" help="落锤总质量（kg）。与落差、重力一起换算冲击能量 E = m·g·h，仅作工程校核，不写入 deck。">
              <RawInput value={impact.dropMassKg ?? ""} onChange={(v) => setImpact("dropMassKg", v)} mono />
            </Field>
            <Field label="落差 mm" help="落锤自由下落高度（mm）。用于换算冲击速度 v0 = sqrt(2gh)。">
              <RawInput value={impact.dropHeightMm ?? ""} onChange={(v) => setImpact("dropHeightMm", v)} mono />
            </Field>
            <Field label="重力倍数 (g)" help="重力加速度相对标准重力的倍数，默认 1。参与能量/速度换算，不改变 deck 的 /GRAV 设置。">
              <RawInput value={impact.gravityG ?? "1"} onChange={(v) => setImpact("gravityG", v)} mono />
            </Field>
          </div>
        </>
      )}
      <div className="wbRow3">
        <Field label="工况名"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
        <Field label="ASCII Run Name" hint="4–80 字符" help="用于 .rad 文件名与 /RUN 关键字，只允许 ASCII 字母/数字/下划线/点/连字符，禁止中文与特殊字符。"><RawInput value={draft.runName} onChange={(v) => patch("runName", v)} mono /></Field>
        <Field label="加载对象" help="选择在已有节点（程序生成单节点组 /GRNOD/NODE）或已有节点组 /GRNOD 上施加落锤位移。">
          <select className="wbInput" value={draft.loadKind} onChange={(e) => patch("loadKind", e.target.value)}>
            <option value="node">已有节点（生成单节点组）</option>
            <option value="grnod">已有节点组 /GRNOD</option>
          </select>
        </Field>
        {draft.loadKind === "grnod" ? (
          <Field label="已有 GRNOD ID" help="目标模型中已存在的节点组 ID，须自行确认存在。"><RawInput value={draft.loadGrnodId} onChange={(v) => patch("loadGrnodId", v)} mono /></Field>
        ) : (
          <Field label="加载 Node ID" help="目标模型中已存在的节点号；程序不会重新定义节点。"><RawInput value={draft.loadNodeId} onChange={(v) => patch("loadNodeId", v)} mono /></Field>
        )}
        <Field label="加载方向" help="全局 X / Y / Z 方向。FOPS 落锤冲击通常为竖直 Z。">
          <select className="wbInput" value={draft.direction} onChange={(e) => patch("direction", e.target.value)}>
            {["X", "Y", "Z"].map((ax) => <option key={ax} value={ax}>{ax}</option>)}
          </select>
        </Field>
      </div>
      <div className="wbSubHead">单位（质量 / 长度 / 时间）</div>
      <div className="wbRow3">
        <Field label="输入单位 质量" help="源数据单位制中的质量单位，支持 kg/g/t/tonne。"><RawInput value={draft.inputMass} onChange={(v) => patch("inputMass", v)} mono /></Field>
        <Field label="输入单位 长度"><RawInput value={draft.inputLength} onChange={(v) => patch("inputLength", v)} mono /></Field>
        <Field label="输入单位 时间"><RawInput value={draft.inputTime} onChange={(v) => patch("inputTime", v)} mono /></Field>
        <Field label="工作单位 质量" help="求解器工作单位。v1 要求与输入单位完全一致，否则拒绝导出（未做 Engine 换算验证）。"><RawInput value={draft.workMass} onChange={(v) => patch("workMass", v)} mono /></Field>
        <Field label="工作单位 长度"><RawInput value={draft.workLength} onChange={(v) => patch("workLength", v)} mono /></Field>
        <Field label="工作单位 时间"><RawInput value={draft.workTime} onChange={(v) => patch("workTime", v)} mono /></Field>
      </div>
      <label className="wbCheck warn">
        <input type="checkbox" checked={Boolean(draft.confirmModel)} onChange={(e) => patch("confirmModel", e.target.checked)} />
        我确认上述单位与目标 HyperMesh 模型完全一致（v1 要求输入单位 = 工作单位）
      </label>
      <div className="wbSubHead">{fops ? "落锤位移曲线 t / u（时间严格递增；负值表示反向）" : "位移曲线 t / u（时间严格递增；负值表示反向，不翻转节点组）"}</div>
      {(draft.curve as Draft[]).map((p, index) => (
        <div className="wbRowGrid" key={index}>
          <Field label="时间" help="曲线横轴时间，需严格递增；末点早于 Tstop 时区间外按末两点斜率线性外推。"><NumericInput value={num(p.time)} onCommit={(v) => { const rows = [...(draft.curve as Draft[])]; rows[index] = { ...rows[index], time: String(v) }; patch("curve", rows); }} /></Field>
          <Field label="位移"><NumericInput value={num(p.value)} onCommit={(v) => { const rows = [...(draft.curve as Draft[])]; rows[index] = { ...rows[index], value: String(v) }; patch("curve", rows); }} /></Field>
          <button type="button" className="wbMini danger" onClick={() => patch("curve", (draft.curve as Draft[]).filter((_, i) => i !== index))}>删除</button>
        </div>
      ))}
      <button type="button" className="wbMini" onClick={() => patch("curve", [...(draft.curve as Draft[]), { time: "", value: "" }])}>+ 添加曲线点</button>
      <div className="wbRow3">
        <Field label="IMPDISP Tstart（可选）" help="受控位移开始作用时间，留空表示从头开始。"><RawInput value={draft.tStart} onChange={(v) => patch("tStart", v)} mono /></Field>
        <Field label="IMPDISP Tstop（可选）" help="受控位移停止时间，必须大于 Tstart。"><RawInput value={draft.tStop} onChange={(v) => patch("tStop", v)} mono /></Field>
        <Field label="加载 Skew ID（0=全局，可选）" help="局部坐标系 ID；0 表示使用全局坐标。"><RawInput value={draft.skewId} onChange={(v) => patch("skewId", v)} mono /></Field>
      </div>
      <div className="wbSubHead">Engine 求解控制</div>
      <div className="wbRow3">
        <Field label="终止时间 Tstop" help="显式求解总时长；应覆盖整个冲击过程。"><RawInput value={draft.endTime} onChange={(v) => patch("endTime", v)} mono /></Field>
        <Field label="动画起始 Tstart"><RawInput value={draft.animStart} onChange={(v) => patch("animStart", v)} mono /></Field>
        <Field label="动画间隔 ΔT"><RawInput value={draft.animInterval} onChange={(v) => patch("animInterval", v)} mono /></Field>
        <Field label="时程间隔" help="时间历程输出间隔（/TFILE），越小曲线越细但文件越大。"><RawInput value={draft.thInterval} onChange={(v) => patch("thInterval", v)} mono /></Field>
        <Field label="时间步策略" help="自然时间步最稳；/DT/NODA/CST 质量缩放与 AMS 会提升效率但改变质量分布，需工程确认。">
          <select className="wbInput" value={draft.timeStepMode} onChange={(e) => patch("timeStepMode", e.target.value)}>
            <option value="natural">自然时间步</option>
            <option value="noda-cst">/DT/NODA/CST 质量缩放</option>
            <option value="ams">AMS（/AMS + /DT/AMS）</option>
          </select>
        </Field>
        {draft.timeStepMode !== "natural" && (
          <>
            <Field label="时间步缩放系数"><RawInput value={draft.timeStepScale} onChange={(v) => patch("timeStepScale", v)} mono /></Field>
            <Field label="目标最小时间步"><RawInput value={draft.timeStepTarget} onChange={(v) => patch("timeStepTarget", v)} mono /></Field>
          </>
        )}
        {draft.timeStepMode === "ams" && (
          <Field label="AMS part group（空=全模型）"><RawInput value={draft.amsPartGroupId} onChange={(v) => patch("amsPartGroupId", v)} mono /></Field>
        )}
      </div>
      <div className="wbSubHead">约束节点组 / BCS（六自由度固定码）</div>
      {(draft.constraints as Draft[]).map((row, index) => (
        <div className="wbRowGrid" key={index}>
          <Field label="类型">
            <select className="wbInput" value={row.kind} onChange={(e) => { const rows = [...(draft.constraints as Draft[])]; rows[index] = { ...rows[index], kind: e.target.value }; patch("constraints", rows); }}>
              <option value="nodes">节点列表（生成新组）</option>
              <option value="grnod">已有 GRNOD</option>
            </select>
          </Field>
          {row.kind === "grnod" ? (
            <Field label="GRNOD ID"><RawInput value={row.grnodId} onChange={(v) => { const rows = [...(draft.constraints as Draft[])]; rows[index] = { ...rows[index], grnodId: v }; patch("constraints", rows); }} mono /></Field>
          ) : (
            <Field label="Node IDs（逗号分隔）"><RawInput value={row.nodeIds} onChange={(v) => { const rows = [...(draft.constraints as Draft[])]; rows[index] = { ...rows[index], nodeIds: v }; patch("constraints", rows); }} mono /></Field>
          )}
          <Field label="Skew ID（0=全局）"><RawInput value={row.skewId} onChange={(v) => { const rows = [...(draft.constraints as Draft[])]; rows[index] = { ...rows[index], skewId: v }; patch("constraints", rows); }} mono /></Field>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {["TX", "TY", "TZ", "RX", "RY", "RZ"].map((dof, di) => (
              <label key={dof} className="wbCheck">
                <input
                  type="checkbox"
                  checked={Boolean((row.dofs as boolean[])[di])}
                  onChange={(e) => {
                    const rows = [...(draft.constraints as Draft[])];
                    const dofs = [...((rows[index].dofs as boolean[]) ?? [false, false, false, false, false, false])];
                    dofs[di] = e.target.checked;
                    rows[index] = { ...rows[index], dofs };
                    patch("constraints", rows);
                  }}
                />
                {dof}
              </label>
            ))}
          </div>
          <button type="button" className="wbMini danger" onClick={() => patch("constraints", (draft.constraints as Draft[]).filter((_, i) => i !== index))}>删除</button>
        </div>
      ))}
      <button type="button" className="wbMini" onClick={() => patch("constraints", [...(draft.constraints as Draft[]), { kind: "nodes", nodeIds: "", grnodId: "", dofs: [true, true, true, false, false, false], skewId: "" }])}>+ 添加约束组</button>
      <div className="wbSubHead">可选重力 / 生成 ID 策略</div>
      <div className="wbRow3">
        <label className="wbCheck">
          <input type="checkbox" checked={Boolean(draft.gravityEnabled)} onChange={(e) => patch("gravityEnabled", e.target.checked)} /> 启用 /GRAV
        </label>
        <Field label="重力加速度（签名，工作单位）"><RawInput value={draft.gravityMagnitude} onChange={(v) => patch("gravityMagnitude", v)} mono /></Field>
        <Field label="重力方向">
          <select className="wbInput" value={draft.gravityDir} onChange={(e) => patch("gravityDir", e.target.value)}>
            {["X", "Y", "Z"].map((ax) => <option key={ax} value={ax}>{ax}</option>)}
          </select>
        </Field>
        <Field label="新实体 ID 起始值" help="程序为本工况自动分配 GRNOD/FUNCT/IMPDISP/BCS 等编号的起始值，各家族自动偏移互不冲突。"><RawInput value={draft.generatedStart} onChange={(v) => patch("generatedStart", v)} mono /></Field>
        <Field label="已占用 ID 区间" hint="如 800100-800200" help="模型中已使用的 ID 区间（分号分隔多个），生成器会跳过这些区间，避免覆盖。"><RawInput value={draft.occupiedRanges} onChange={(v) => patch("occupiedRanges", v)} mono /></Field>
      </div>
    </>
  );
}

export default function Workbench() {
  const [modules, setModules] = useState<ModuleDescriptor[]>(FALLBACK_MODULES);
  const [activeId, setActiveId] = useState<string>(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    return hash || "home";
  });
  const [projectName, setProjectName] = useState("LoadCreator_Project");
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => JSON.parse(JSON.stringify(INITIAL_DRAFTS)));
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!isDesktop()) return;
    listCaseModules().then(setModules).catch(() => setModules(FALLBACK_MODULES));
  }, []);

  const active = useMemo(() => modules.find((m) => m.id === activeId) ?? modules[0], [modules, activeId]);
  const draft = drafts[activeId] ?? {};
  const patch = useCallback((key: string, value: unknown) => {
    setDrafts((current) => ({ ...current, [activeId]: { ...(current[activeId] ?? {}), [key]: value } }));
    setPreview(null);
  }, [activeId]);

  const selectModule = (id: string) => {
    setActiveId(id);
    setPreview(null);
    setError("");
    setStatus("");
  };

  const caseName = useMemo(() => {
    const raw = String(draft.name ?? "").trim();
    return raw || active?.title || "CASE";
  }, [draft.name, active?.title]);

  const request = useMemo(
    () => ({ projectName: caseName, case: { kind: activeId, parameters: buildParameters(activeId, draft) } }),
    [caseName, activeId, draft],
  );

  async function runPreview() {
    if (!isDesktop()) { setError("生成由 Rust 桌面端完成，请使用 npm run tauri:dev 或已安装程序运行。"); return; }
    setBusy(true); setError(""); setStatus("");
    try {
      const result = await previewCase(request);
      setPreview(result);
      setStatus(result.summary.canExport ? "校验通过，可导出增量文件" : "存在阻止导出的错误");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runExport() {
    if (!isDesktop()) { setError("导出需要桌面端。"); return; }
    setBusy(true); setError("");
    try {
      const built = await buildCase(request);
      const entries = Object.entries(built.files);
      if (entries.length === 0) { setError("没有可导出的文件，请先修复错误。"); return; }
      const directory = await openDialog({ directory: true, multiple: false, title: "选择导出目录" });
      if (!directory || Array.isArray(directory)) return;
      const written = await exportCaseFiles(directory, caseName, built.files);
      setStatus("已导出 " + written.length + " 个文件：" + written.map((p) => p.split(/[\\/]/).pop()).join("、"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const groups = MODULE_GROUPS;
  const isRadioss = activeId === "radioss-rops" || activeId === "radioss-fops";

  return (
    <div className="wbShell">
      <aside className="wbSidebar">
        <div className="wbBrand"><span className="wbBrandMark">LC</span><div><b>LoadCreator 2.0</b><small>CAE 工况工具箱</small></div></div>
        <nav className="wbNav">
          <button type="button" className={"wbNavItem wbHome" + (activeId === "home" ? " active" : "")} onClick={() => selectModule("home")}>
            <span className="wbNavTitle">⌂ 模块库 · 全部模块</span>
          </button>
          <span className="wbNavHint">选择工况模板 · 更多模块将持续加入</span>
          {groups.map((group) => {
            const list = modules.filter((m) => m.category === group.id);
            if (list.length === 0) return null;
            return (
              <div key={group.id} className="wbNavGroup">
                <span className="wbNavGroupLabel">{group.label}</span>
                {list.map((m) => (
                  <button key={m.id} type="button" className={"wbNavItem" + (m.id === activeId ? " active" : "")} onClick={() => selectModule(m.id)}>
                    <span className="wbNavTitle">{m.title}</span>
                    <span className={"wbBadge " + m.status}>{STATUS_LABELS[m.status] ?? m.status}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="wbSidebarFoot">
          <span>求解器 · {active?.solver === "radioss" ? "Radioss 2022" : "OptiStruct " + (active?.minSupportedVersion ?? "")}</span>
          <small>{active?.solver === "radioss" ? "单文件 .rad · 离线运行" : "增量 FEM · 离线运行"}</small>
        </div>
      </aside>

      <main className="wbMain">
        {activeId === "home" ? (
          <ModuleGallery modules={modules} onOpen={selectModule} />
        ) : activeId === "tabular-load" ? (
          <TabularModule projectName={projectName} onProjectChange={setProjectName} onBack={() => selectModule("home")} />
        ) : (
          <>
        <header className="wbHeader">
          <button type="button" className="wbBack" onClick={() => selectModule("home")}>← 模块库</button>
          <div>
            <p className="wbEyebrow">CASE WORKBENCH</p>
            <h1>{active?.title}</h1>
          </div>
          <div className="wbHeaderMeta">
            <span className="wbChip">{active?.solver === "radioss" ? "Radioss 单文件 .rad" : "SOL 增量"}</span>
            <span className="wbChip muted">{active?.capabilityFlags.join(" · ")}</span>
          </div>
        </header>

        {error && <div className="wbAlert error">{error}</div>}
        {status && <div className="wbAlert info">{status}</div>}

        <section className="wbGrid">
          <div className="wbFormPanel">
            <div className="wbPanelHead"><h2>参数</h2><span>外部实体 ID 需自行确认存在于目标模型 · 悬停 ? 查看说明</span></div>

            {isRadioss && <RadiossFields draft={draft} patch={patch} fops={activeId === "radioss-fops"} />}

            {activeId === "nodal-static" && (
              <>
                <div className="wbRow3">
                  <Field label="工况名"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
                  <Field label="模型单位" help="OptiStruct 模型单位制，如 N-mm-s。"><RawInput value={draft.modelUnits} onChange={(v) => patch("modelUnits", v)} mono /></Field>
                  <Field label="外部 SPC Set ID" hint="留空=无约束" help="目标模型中已存在的约束集合 ID；本模块仅引用，不重新定义。"><RawInput value={draft.existingSpcSetId} onChange={(v) => patch("existingSpcSetId", v)} mono /></Field>
                </div>
                <div className="wbSubHead">节点载荷</div>
                {(draft.loads as Draft[]).map((row, index) => (
                  <div className="wbRowGrid" key={index}>
                    {(["nodeId", "fx", "fy", "fz", "mx", "my", "mz"] as const).map((key) => (
                      <Field key={key} label={key === "nodeId" ? "Node" : key.toUpperCase()} help={key === "nodeId" ? "目标模型已有节点号。" : undefined}>
                        <RawInput value={row[key]} onChange={(v) => { const loads = [...(draft.loads as Draft[])]; loads[index] = { ...loads[index], [key]: v }; patch("loads", loads); }} mono />
                      </Field>
                    ))}
                    <button type="button" className="wbMini danger" onClick={() => { const loads = (draft.loads as Draft[]).filter((_, i) => i !== index); patch("loads", loads.length ? loads : [{ nodeId: "", cid: "0", fx: "", fy: "", fz: "", mx: "", my: "", mz: "", label: "" }]); }}>删除</button>
                  </div>
                ))}
                <button type="button" className="wbMini" onClick={() => patch("loads", [...(draft.loads as Draft[]), { nodeId: "", cid: "0", fx: "", fy: "", fz: "", mx: "", my: "", mz: "", label: "" }])}>+ 添加节点载荷</button>
              </>
            )}

            {activeId === "gravity" && (
              <>
                <div className="wbRow3">
                  <Field label="工况名"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
                  <Field label="幅值 (g)" help="以标准重力 g 为单位的幅值，程序按模型单位换算（N-mm-s 约 9806.65 mm/s2）。"><RawInput value={draft.magnitudeG} onChange={(v) => patch("magnitudeG", v)} mono /></Field>
                  <Field label="外部 SPC Set ID"><RawInput value={draft.existingSpcSetId} onChange={(v) => patch("existingSpcSetId", v)} mono /></Field>
                </div>
                <div className="wbRow3">
                  {["X", "Y", "Z"].map((axis, i) => (
                    <Field key={axis} label={"方向 " + axis} help={i === 0 ? "重力方向矢量（三分量），分量大小不参与归一化，方向为准。" : undefined}>
                      <RawInput value={(draft.direction as string[])[i]} onChange={(v) => { const dir = [...(draft.direction as string[])]; dir[i] = v; patch("direction", dir); }} mono />
                    </Field>
                  ))}
                </div>
                <p className="wbHint">1g 会按模型单位换算（N-mm-s 约 9806.65 mm/s2），不会写入求解器默认单位。</p>
              </>
            )}

            {activeId === "constraint" && (
              <>
                <div className="wbRow3">
                  <Field label="工况名"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
                  <Field label="模式" help="新建 SPC/SPC1 定义约束；仅引用现有集合则只输出 SPCADD 引用。">
                    <select className="wbInput" value={draft.mode} onChange={(e) => patch("mode", e.target.value)}><option value="new">新建 SPC</option><option value="reference">仅引用现有集合</option></select>
                  </Field>
                  <Field label="外部 SPC Set ID（逗号分隔）"><RawInput value={draft.existingSpcSetIds} onChange={(v) => patch("existingSpcSetIds", v)} mono /></Field>
                </div>
                <div className="wbSubHead">约束行（DOF 用 1-6，可写 1,2,5-7）</div>
                {(draft.rows as Draft[]).map((row, index) => (
                  <div className="wbRowGrid three" key={index}>
                    <Field label="Node"><RawInput value={row.nodeId} onChange={(v) => { const rows = [...(draft.rows as Draft[])]; rows[index] = { ...rows[index], nodeId: v }; patch("rows", rows); }} mono /></Field>
                    <Field label="DOF" help="自由度编号 1-6 = TX/TY/TZ/RX/RY/RZ，可写 1,2,5-7 表示集合或区间。"><RawInput value={row.dofs} onChange={(v) => { const rows = [...(draft.rows as Draft[])]; rows[index] = { ...rows[index], dofs: v }; patch("rows", rows); }} mono /></Field>
                    <Field label="强迫位移（0/空=齐次）" help="非零表示强迫位移值（模型单位）；0 或空表示齐次约束。"><RawInput value={row.value} onChange={(v) => { const rows = [...(draft.rows as Draft[])]; rows[index] = { ...rows[index], value: v }; patch("rows", rows); }} mono /></Field>
                    <button type="button" className="wbMini danger" onClick={() => patch("rows", (draft.rows as Draft[]).filter((_, i) => i !== index))}>删除</button>
                  </div>
                ))}
                <button type="button" className="wbMini" onClick={() => patch("rows", [...(draft.rows as Draft[]), { nodeId: "", dofs: "", value: "" }])}>+ 添加约束行</button>
              </>
            )}

            {activeId === "normal-modes" && (
              <div className="wbRow3">
                <Field label="工况名"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
                <Field label="外部约束 SPC Set ID"><RawInput value={draft.existingSpcSetId} onChange={(v) => patch("existingSpcSetId", v)} mono /></Field>
                <Field label="频率下限 Hz" help="EIGRL 提取频率下限，0 表示不设下限。"><RawInput value={draft.eigrlMinHz} onChange={(v) => patch("eigrlMinHz", v)} mono /></Field>
                <Field label="频率上限 Hz" help="EIGRL 提取频率上限。"><RawInput value={draft.eigrlMaxHz} onChange={(v) => patch("eigrlMaxHz", v)} mono /></Field>
                <Field label="模态阶数" help="期望提取的模态数量（ND）。"><RawInput value={draft.numModes} onChange={(v) => patch("numModes", v)} mono /></Field>
              </div>
            )}

            {activeId === "frequency-response" && (
              <div className="wbRow3">
                <Field label="工况名"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
                <Field label="外部 SPC Set ID"><RawInput value={draft.existingSpcSetId} onChange={(v) => patch("existingSpcSetId", v)} mono /></Field>
                <Field label="频段下限 Hz" help="FREQ1 频率扫描起点。"><RawInput value={draft.minHz} onChange={(v) => patch("minHz", v)} mono /></Field>
                <Field label="频段上限 Hz"><RawInput value={draft.maxHz} onChange={(v) => patch("maxHz", v)} mono /></Field>
                <Field label="步长 Hz" help="FREQ1 频率增量，越小曲线越密。"><RawInput value={draft.stepHz} onChange={(v) => patch("stepHz", v)} mono /></Field>
                <Field label="模态上限 Hz" help="模态提取（EIGRL）上限，应覆盖求解频段以保证精度。"><RawInput value={draft.eigrlMaxHz} onChange={(v) => patch("eigrlMaxHz", v)} mono /></Field>
                <Field label="阻尼比" help="模态临界阻尼比（TABDMP1），如 0.02 表示 2%。"><RawInput value={draft.dampingRatio} onChange={(v) => patch("dampingRatio", v)} mono /></Field>
              </div>
            )}

            {activeId === "random-psd" && (
              <>
                <div className="wbRow3">
                  <Field label="工况名"><RawInput value={draft.name} onChange={(v) => patch("name", v)} /></Field>
                  <Field label="激励类型" help="基座加速度（SPCD + RLOAD2 TYPE=ACCE）或随机节点力（DAREA + RLOAD2 TYPE=LOAD）。">
                    <select className="wbInput" value={draft.excKind} onChange={(e) => patch("excKind", e.target.value)}><option value="base-acceleration">基座加速度</option><option value="applied-force">随机节点力</option></select>
                  </Field>
                  <Field label="激励 Node ID"><RawInput value={draft.nodeId} onChange={(v) => patch("nodeId", v)} mono /></Field>
                  <Field label="外部 SPC Set ID"><RawInput value={draft.existingSpcSetId} onChange={(v) => patch("existingSpcSetId", v)} mono /></Field>
                  {draft.excKind === "base-acceleration" ? (
                    <Field label="分量 (1/2/3)" help="激励方向分量：1=X、2=Y、3=Z 平动自由度。"><RawInput value={draft.component} onChange={(v) => patch("component", v)} mono /></Field>
                  ) : (
                    <Field label="参考力 N" help="随机力 PSD 的参考幅值（N），用于将无量纲 PSD 换算为物理谱。"><RawInput value={draft.referenceForceN} onChange={(v) => patch("referenceForceN", v)} mono /></Field>
                  )}
                  <Field label="PSD 单位" help="输入谱的单位，如 g^2/Hz 或 N^2/Hz；需与激励类型匹配。"><RawInput value={draft.inputPsdUnit} onChange={(v) => patch("inputPsdUnit", v)} mono /></Field>
                </div>
                <div className="wbSubHead">PSD 谱表（Hz / PSD）· 插值 {String(draft.interpolation)}</div>
                <div className="wbRow3">
                  <Field label="插值" help="谱点之间的插值方式；随机振动通常 LOG-LOG。">
                    <select className="wbInput" value={draft.interpolation} onChange={(e) => patch("interpolation", e.target.value)}>{["LOG-LOG", "LINEAR-LINEAR", "LOG-LINEAR", "LINEAR-LOG"].map((m) => <option key={m} value={m}>{m}</option>)}</select>
                  </Field>
                  <Field label="越界策略" help="频点超出谱表范围时：ERROR 拒绝外推，FLAT 取端点平坦外推。">
                    <select className="wbInput" value={draft.outOfRange} onChange={(e) => patch("outOfRange", e.target.value)}><option value="ERROR">ERROR（拒绝外推）</option><option value="FLAT">FLAT（平坦外推）</option></select>
                  </Field>
                </div>
                {(draft.points as Draft[]).map((p, index) => (
                  <div className="wbRowGrid" key={index}>
                    <Field label="频率 Hz"><NumericInput value={num(p.frequencyHz)} onCommit={(v) => { const pts = [...(draft.points as Draft[])]; pts[index] = { ...pts[index], frequencyHz: String(v) }; patch("points", pts); }} /></Field>
                    <Field label="PSD"><NumericInput value={num(p.psd)} onCommit={(v) => { const pts = [...(draft.points as Draft[])]; pts[index] = { ...pts[index], psd: String(v) }; patch("points", pts); }} /></Field>
                    <button type="button" className="wbMini danger" onClick={() => patch("points", (draft.points as Draft[]).filter((_, i) => i !== index))}>删除</button>
                  </div>
                ))}
                <button type="button" className="wbMini" onClick={() => patch("points", [...(draft.points as Draft[]), { frequencyHz: "", psd: "" }])}>+ 添加频点</button>
                <div className="wbRow3">
                  <Field label="求解频段下限 Hz"><RawInput value={draft.minHz} onChange={(v) => patch("minHz", v)} mono /></Field>
                  <Field label="求解频段上限 Hz"><RawInput value={draft.maxHz} onChange={(v) => patch("maxHz", v)} mono /></Field>
                  <Field label="频率步长 Hz" help="FREQ1 频率增量。"><RawInput value={draft.stepHz} onChange={(v) => patch("stepHz", v)} mono /></Field>
                  <Field label="模态上限 Hz" help="模态提取上限，应覆盖求解频段。"><RawInput value={draft.modalMaxHz} onChange={(v) => patch("modalMaxHz", v)} mono /></Field>
                  <Field label="阻尼比"><RawInput value={draft.dampingRatio} onChange={(v) => patch("dampingRatio", v)} mono /></Field>
                  <Field label="输出档位">
                    <select className="wbInput" value={draft.outputProfile} onChange={(e) => patch("outputProfile", e.target.value)}><option value="PSD_AND_RMS">PSD + RMS</option><option value="RMS_ONLY">仅 RMS</option></select>
                  </Field>
                </div>
                <label className="wbCheck">
                  <input type="checkbox" checked={Boolean(draft.displacement)} onChange={(e) => patch("displacement", e.target.checked)} /> 位移
                  <input type="checkbox" checked={Boolean(draft.stress)} onChange={(e) => patch("stress", e.target.checked)} /> 应力
                  <input type="checkbox" checked={Boolean(draft.acceleration)} onChange={(e) => patch("acceleration", e.target.checked)} /> 加速度
                </label>
                <label className="wbCheck warn">
                  <input type="checkbox" checked={Boolean(draft.confirmSpc)} onChange={(e) => patch("confirmSpc", e.target.checked)} />
                  我确认被激励节点 DOF 包含在 SPC 集合中，且不是 RBE2 依赖自由度
                </label>
              </>
            )}

            <div className="wbFormActions">
              <button type="button" className="primary" disabled={busy} onClick={() => void runPreview()}>{busy ? "处理中…" : "校验 / 预览 Deck"}</button>
              <button type="button" className="ghost" disabled={busy || !(preview?.summary.canExport)} onClick={() => void runExport()}>{active?.solver === "radioss" ? "导出增量 .rad" : "导出增量 FEM"}</button>
            </div>
          </div>

          <aside className="wbPreviewCol">
            <ModulePreview activeId={activeId} draft={draft} />
            <div className="wbPreviewPanel">
              <div className="wbPanelHead"><h2>求解器 Deck 预览</h2><span>仅 Generated；导入/求解需实机验证</span></div>
              {preview ? (
                <>
                  <div className="wbMetrics">
                    <div><span>SOL</span><b>{preview.summary.sol ?? "—"}</b></div>
                    <div><span>子工况</span><b>{preview.summary.subcaseCount}</b></div>
                    <div><span>卡片</span><b>{Object.values(preview.summary.cardCounts).reduce((a, b) => a + b, 0)}</b></div>
                    <div><span>行数</span><b>{preview.summary.lineCount}</b></div>
                  </div>
                  <div className="wbChips">
                    {Object.entries(preview.summary.cardCounts).map(([name, count]) => <span key={name} className="wbChip">{name} × {count}</span>)}
                  </div>
                  <h3>诊断</h3>
                  <DiagList items={preview.diagnostics} />
                  <h3>外部引用（UNVERIFIED_EXTERNAL）</h3>
                  {preview.externalReferences.length === 0 ? <p className="wbMuted">无外部引用。</p> : (
                    <table className="wbTable"><thead><tr><th>类型</th><th>ID</th><th>说明</th><th>状态</th></tr></thead><tbody>
                      {preview.externalReferences.map((r, i) => <tr key={i}><td>{r.kind}</td><td className="mono">{r.id}</td><td>{r.label ?? "—"}</td><td className="warnText">{r.status}</td></tr>)}
                    </tbody></table>
                  )}
                  <h3>ID 计划</h3>
                  {preview.idPlan.length === 0 ? <p className="wbMuted">无自动分配实体。</p> : (
                    <table className="wbTable"><thead><tr><th>类型</th><th>逻辑键</th><th>ID</th></tr></thead><tbody>
                      {preview.idPlan.map((a, i) => <tr key={i}><td>{a.kind}</td><td>{a.key}</td><td className="mono">{a.id}</td></tr>)}
                    </tbody></table>
                  )}
                  <h3>{active?.solver === "radioss" ? "Radioss Deck 文本" : "FEM 文本"}</h3>
                  <pre className="wbCode">{preview.femPreview || "（存在错误，未生成文本）"}</pre>
                </>
              ) : (
                <div className="wbEmpty">填写参数后点击“校验 / 预览 Deck”。<br /><small>左侧可视化预览无需点击即可实时查看；此处显示求解器实际生成的文本。</small></div>
              )}
            </div>
          </aside>
        </section>
          </>
        )}
      </main>
    </div>
  );
}
