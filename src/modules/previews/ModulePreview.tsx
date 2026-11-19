import {
  CurveChart,
  DirectionGizmo,
  DofGrid,
  GravityVectorGizmo,
  MiniBars,
  RangeBar,
  SpectrumChart,
  TimelineBar,
  VizCard,
  type ChartPoint,
  type RangeSeg,
} from "@/components/charts/Charts";
import { parseFloatList } from "@/lib/caseDrafts";

type Draft = Record<string, any>;

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  return Number.isFinite(x) ? x : 0;
};

function dirVector(dir: string): [number, number, number] {
  const d = String(dir ?? "X").trim().toUpperCase();
  if (d === "-X" || d === "-XX") return [-1, 0, 0];
  if (d === "Y" || d === "+Y" || d === "YY" || d === "+YY") return [0, 1, 0];
  if (d === "-Y" || d === "-YY") return [0, -1, 0];
  if (d === "Z" || d === "+Z" || d === "ZZ" || d === "+ZZ") return [0, 0, 1];
  if (d === "-Z" || d === "-ZZ") return [0, 0, -1];
  return [1, 0, 0];
}

function parseDofBool(text: unknown): boolean[] {
  const out = [false, false, false, false, false, false];
  String(text ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .forEach((tok) => {
      const range = tok.match(/^(\d+)-(\d+)$/);
      if (range) {
        const a = parseInt(range[1], 10);
        const b = parseInt(range[2], 10);
        for (let d = Math.min(a, b); d <= Math.max(a, b); d += 1) {
          if (d >= 1 && d <= 6) out[d - 1] = true;
        }
      } else if (/^[1-6]{2,}$/.test(tok)) {
        for (const ch of tok) out[parseInt(ch, 10) - 1] = true;
      } else if (/^\d+$/.test(tok)) {
        const d = parseInt(tok, 10);
        if (d >= 1 && d <= 6) out[d - 1] = true;
      }
    });
  return out;
}

function StatRow({ items }: { items: Array<{ label: string; value: string; tone?: string }> }) {
  return (
    <div className="liveStats">
      {items.map((it) => (
        <div className={"liveStat" + (it.tone ? " " + it.tone : "")} key={it.label}>
          <span>{it.label}</span>
          <b>{it.value}</b>
        </div>
      ))}
    </div>
  );
}

function approxGrms(points: ChartPoint[], minHz: number, maxHz: number): number | null {
  const pts = points.filter((p) => p.x > 0 && p.y >= 0).sort((a, b) => a.x - b.x);
  if (pts.length < 2) return null;
  const lo = Math.min(minHz, maxHz);
  const hi = Math.max(minHz, maxHz);
  let area = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const f0 = Math.max(a.x, lo);
    const f1 = Math.min(b.x, hi);
    if (f1 <= f0) continue;
    const t0 = (f0 - a.x) / (b.x - a.x || 1);
    const t1 = (f1 - a.x) / (b.x - a.x || 1);
    const p0 = a.y + (b.y - a.y) * t0;
    const p1 = a.y + (b.y - a.y) * t1;
    area += ((p0 + p1) / 2) * (f1 - f0);
  }
  return area > 0 ? Math.sqrt(area) : null;
}

function RopsPreview({ draft, fops }: { draft: Draft; fops: boolean }) {
  const curve: ChartPoint[] = (Array.isArray(draft.curve) ? draft.curve : []).map((p: Draft) => ({ x: n(p.time), y: n(p.value) }));
  const endTime = n(draft.endTime);
  const last = curve.length ? curve[curve.length - 1].x : 0;
  const willExtrapolate = endTime > 0 && last > 0 && last < endTime;
  const dirMode = String(draft.directionMode || "axis");
  const rawVec = Array.isArray(draft.directionVector) ? draft.directionVector : ["0", "0", "-1"];
  const customVec: [number, number, number] = [n(rawVec[0]), n(rawVec[1]), n(rawVec[2])];
  const dir = dirMode === "vector" ? customVec : dirVector(draft.direction);
  const dirLabel =
    dirMode === "vector"
      ? `(${customVec[0]}, ${customVec[1]}, ${customVec[2]})`
      : String(draft.direction ?? "X");
  const constraints = Array.isArray(draft.constraints) ? draft.constraints : [];
  const contacts = Array.isArray(draft.contacts) ? draft.contacts : [];
  const gravityCount = Array.isArray(draft.gravities) && draft.gravities.length > 0
    ? draft.gravities.filter((field: Draft) => field.enabled !== false).length
    : Number(Boolean(draft.gravityEnabled));
  const historyCount = Array.isArray(draft.timeHistories)
    ? draft.timeHistories.filter((row: Draft) => row.enabled !== false).length : 0;
  const impact = (draft.impact ?? {}) as Draft;
  const gStd = 9.80665 * (String(impact.gravityG ?? "").trim() ? n(impact.gravityG) : 1);
  const hM = n(impact.dropHeightMm) / 1000;
  const mass = n(impact.dropMassKg);
  const v0 = hM > 0 && gStd > 0 ? Math.sqrt(2 * gStd * hM) : 0;
  const energy = mass > 0 && hM > 0 ? mass * gStd * hM : 0;

  return (
    <>
      <VizCard title={fops ? "落锤位移曲线（受控位移近似）" : "位移曲线 t / u"} hint={"时间单位与终止时间一致" + (willExtrapolate ? " · 末点早于 Tstop，区间外线性外推" : "")}>
        <CurveChart
          points={curve}
          xLabel={`时间 (${String(draft.workTime || "ms")})`}
          yLabel={fops ? `落锤位移 (${String(draft.workLength || "mm")})` : `位移 (${String(draft.workLength || "mm")})`}
          markerX={endTime > 0 ? endTime : undefined}
          markerLabel="Tstop"
          tone={fops ? "amber" : "brand"}
        />
      </VizCard>
      {fops && (
        <VizCard title="冲击能量换算" hint="由落锤质量 / 落差 / 重力换算，仅作工程校核参考">
          <StatRow
            items={[
              { label: "冲击速度 v₀", value: v0 > 0 ? v0.toFixed(2) + " m/s" : "—", tone: "amber" },
              { label: "冲击能量", value: energy > 0 ? energy.toFixed(0) + " J" : "—", tone: "amber" },
              { label: "落锤质量", value: mass > 0 ? mass + " kg" : "—" },
            ]}
          />
        </VizCard>
      )}
      <div className="vizSplit">
        <VizCard title={dirMode === "vector" ? "加载方向（自定义向量）" : "加载方向"}>
          <DirectionGizmo vector={dir} label={dirLabel} />
        </VizCard>
        <VizCard title="工况概览">
          <StatRow
            items={[
              { label: "曲线点数", value: String(curve.length) },
              { label: "约束组", value: String(constraints.length) },
              { label: "TYPE7 接触", value: contacts.length > 0 ? `${contacts.length} 组` : "未定义", tone: contacts.length > 0 ? "on" : "" },
              { label: "时间步", value: draft.timeStepMode === "ams" ? "AMS" : draft.timeStepMode === "noda-cst" ? "NODA/CST" : "自然" },
              { label: "重力", value: gravityCount > 0 ? `${gravityCount} 个工况` : "未启用", tone: gravityCount > 0 ? "on" : "" },
              { label: "TH 输出", value: `${historyCount} 组`, tone: historyCount > 0 ? "on" : "" },
            ]}
          />
        </VizCard>
      </div>
      <VizCard title="求解时间轴" hint="动画输出 / 时程输出">
        <TimelineBar endTime={endTime} animStart={n(draft.animStart)} animInterval={n(draft.animInterval)} thInterval={draft.engineControl?.emitTfile === false ? 0 : n(draft.thInterval)} />
      </VizCard>
    </>
  );
}

function PsdPreview({ draft }: { draft: Draft }) {
  const points: ChartPoint[] = (Array.isArray(draft.points) ? draft.points : []).map((p: Draft) => ({ x: n(p.frequencyHz), y: n(p.psd) }));
  const minHz = n(draft.minHz);
  const maxHz = n(draft.maxHz);
  const modalMin = draft.modalMethod === "EIGRA" ? n(draft.eigraV1) : n(draft.modalMinHz);
  const modalMax = draft.modalMethod === "EIGRA" ? n(draft.eigraV2) : n(draft.modalMaxHz);
  const unit = String(draft.inputPsdUnit ?? "");
  const grms = unit.trim().toLowerCase().startsWith("g") ? approxGrms(points, minHz, maxHz) : null;
  const freqKind = String(draft.freqKind ?? "FREQ1");
  const freqPoints =
    freqKind === "FREQ2"
      ? (parseInt(String(draft.freqNf ?? "10"), 10) || 10) + 1
      : freqKind === "FREQ"
        ? parseFloatList(draft.explicitHzText).length
        : n(draft.stepHz) > 0 ? Math.max(2, Math.floor((maxHz - minHz) / n(draft.stepHz)) + 1) : 0;

  return (
    <>
      <VizCard title="PSD 频谱（对数-对数）" hint={`插值 ${String(draft.interpolation ?? "LOG-LOG")} · ${String(draft.excForm ?? "RLOAD2")} · ${draft.axisMode === "sequential-tri" ? "顺序三轴 (6 子工况)" : "单轴 (2 子工况)"}`}>
        <SpectrumChart points={points} band={[minHz, maxHz]} yLabel={"PSD (" + (unit || "g^2/Hz") + ")"} />
      </VizCard>
      <StatRow
        items={[
          { label: "谱点 / 频点", value: `${points.length} / ${freqPoints || "—"}` },
          { label: "求解频段", value: maxHz > 0 ? minHz + "–" + maxHz + " Hz" : "—" },
          { label: "约 Grms", value: grms !== null ? grms.toFixed(3) + " g" : "需 g²/Hz", tone: grms !== null ? "on" : "" },
          { label: "阻尼比", value: String(draft.dampingRatio ?? "—") },
        ]}
      />
      <VizCard title="求解与模态覆盖" hint={modalMax < maxHz ? "提示：模态上限低于求解上限，可能影响截断精度" : "模态范围应覆盖求解频段"}>
        <RangeBar
          min={Math.min(minHz || 0, modalMin || 0)}
          max={Math.max(maxHz || 0, modalMax || 0, 1)}
          segments={[
            { from: minHz, to: maxHz, label: `求解频段 (${freqKind})`, tone: "brand" },
            { from: modalMin, to: modalMax, label: `模态提取 (${draft.modalMethod === "EIGRA" ? "EIGRA" : "EIGRL"})`, tone: "blue" },
          ]}
        />
      </VizCard>
    </>
  );
}

function FreqResponsePreview({ draft }: { draft: Draft }) {
  const segs: RangeSeg[] = [
    { from: n(draft.eigrlMinHz), to: n(draft.eigrlMaxHz), label: "模态提取频段", tone: "blue" },
    { from: n(draft.minHz), to: n(draft.maxHz), label: "求解频段", tone: "brand" },
  ];
  const step = n(draft.stepHz);
  const count = step > 0 ? Math.floor((n(draft.maxHz) - n(draft.minHz)) / step) + 1 : 0;
  const modalLow = n(draft.eigrlMaxHz) < n(draft.maxHz);
  return (
    <>
      <VizCard title="频率扫描与模态覆盖" hint={modalLow ? "注意：模态上限低于求解上限" : "FREQ1 步长扫描"}>
        <RangeBar
          min={Math.min(n(draft.eigrlMinHz) || 0, n(draft.minHz) || 0)}
          max={Math.max(n(draft.eigrlMaxHz) || 0, n(draft.maxHz) || 0, 1)}
          segments={segs}
        />
      </VizCard>
      <StatRow
        items={[
          { label: "频点估算", value: count > 0 ? String(count) : "—" },
          { label: "步长", value: step > 0 ? step + " Hz" : "—" },
          { label: "阻尼比", value: String(draft.dampingRatio ?? "—") },
          { label: "外部载荷", value: String(draft.loadId ?? "").trim() || "无" },
        ]}
      />
    </>
  );
}

function ModalPreview({ draft }: { draft: Draft }) {
  const segs: RangeSeg[] = [{ from: n(draft.eigrlMinHz), to: n(draft.eigrlMaxHz), label: "提取频段", tone: "brand" }];
  return (
    <>
      <VizCard title="模态提取频段" hint="EIGRL 频率范围">
        <RangeBar min={n(draft.eigrlMinHz) || 0} max={Math.max(n(draft.eigrlMaxHz) || 0, 1)} segments={segs} />
      </VizCard>
      <StatRow
        items={[
          { label: "频率下限", value: n(draft.eigrlMinHz) + " Hz" },
          { label: "频率上限", value: n(draft.eigrlMaxHz) + " Hz" },
          { label: "目标阶数", value: String(draft.numModes ?? "—") },
        ]}
      />
    </>
  );
}

function GravityPreview({
  draft,
  selectedIndex = 0,
  onSelectIndex,
}: {
  draft: Draft;
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
}) {
  const rows = Array.isArray(draft.cases) ? (draft.cases as Draft[]) : [];
  const units = String(draft.modelUnits || "N-mm-s");
  const oneG = units === "N-m-s" ? 9.80665 : 9806.65;
  const accUnit = units === "N-m-s" ? "m/s²" : "mm/s²";
  const fmtAcc = (v: number) => (units === "N-m-s" ? v.toFixed(3) : v.toFixed(1));

  if (rows.length === 0) {
    return <div className="livePreviewPlaceholder">请先在左侧重力工况表中添加至少一行重力工况。</div>;
  }

  const safeIndex = Math.min(Math.max(0, selectedIndex), rows.length - 1);
  const parsed = rows.map((r, i) => {
    const accel = n(r.acceleration);
    const nx = n(r.nx);
    const ny = n(r.ny);
    const nz = n(r.nz);
    const ax = accel * nx;
    const ay = accel * ny;
    const az = accel * nz;
    const magAcc = Math.hypot(ax, ay, az);
    const magG = magAcc / oneG;
    return {
      index: i,
      name: String(r.name ?? "").trim() || `工况 #${i + 1}`,
      cid: String(r.cid ?? "0").trim() || "0",
      accel,
      nx,
      ny,
      nz,
      ax,
      ay,
      az,
      magAcc,
      magG,
    };
  });

  const active = parsed[safeIndex];
  const maxMagG = Math.max(1e-6, ...parsed.map((p) => p.magG));

  return (
    <>
      <VizCard
        title="重力方向矢量 (3D)"
        hint={`高亮 #${safeIndex + 1} ${active.name} · 虚线为其余工况`}
      >
        {parsed.length > 1 && (
          <div className="gravCaseChips" role="tablist" aria-label="选择预览重力工况">
            {parsed.map((item) => (
              <button
                key={item.index}
                type="button"
                role="tab"
                aria-selected={item.index === safeIndex}
                className={"gravCaseChip" + (item.index === safeIndex ? " active" : "")}
                onClick={() => onSelectIndex?.(item.index)}
              >
                #{item.index + 1} {item.name}
              </button>
            ))}
          </div>
        )}
        <div className="gravGizmoRow">
          <GravityVectorGizmo
            vectors={parsed.map((p) => ({ name: p.name, vector: [p.ax, p.ay, p.az] }))}
            selectedIndex={safeIndex}
          />
          <div className="gravVectorReadout">
            <div className="gravReadoutItem">
              <span>方向系数 (N1, N2, N3)</span>
              <b>({active.nx}, {active.ny}, {active.nz})</b>
            </div>
            <div className="gravReadoutItem">
              <span>加速度分量 ({accUnit})</span>
              <b>({fmtAcc(active.ax)}, {fmtAcc(active.ay)}, {fmtAcc(active.az)})</b>
            </div>
            <div className="gravReadoutItem">
              <span>等效过载分量 (g)</span>
              <b>({(active.ax / oneG).toFixed(2)}g, {(active.ay / oneG).toFixed(2)}g, {(active.az / oneG).toFixed(2)}g)</b>
            </div>
            <div className="gravReadoutItem">
              <span>参考坐标系 CID</span>
              <b>{active.cid}</b>
            </div>
          </div>
        </div>
      </VizCard>

      <StatRow
        items={[
          { label: "工况数量", value: `${parsed.length} 个` },
          { label: "当前工况", value: active.name },
          { label: "合成加速度", value: `${fmtAcc(active.magAcc)} ${accUnit}`, tone: active.magAcc > 0 ? "on" : "" },
          { label: "合成过载", value: `${active.magG.toFixed(2)} g`, tone: active.magG > 0 ? "on" : "" },
        ]}
      />

      <VizCard title="各重力工况对比" hint="点击任意行切换上方 3D 高亮矢量">
        <div className="gravCompareList">
          {parsed.map((item) => {
            const isSel = item.index === safeIndex;
            const pct = Math.min(100, Math.max(2, (item.magG / maxMagG) * 100));
            return (
              <button
                key={item.index}
                type="button"
                className={"gravCompareRow" + (isSel ? " active" : "")}
                onClick={() => onSelectIndex?.(item.index)}
              >
                <div className="gravCompareTop">
                  <span className="gravCompareName">
                    <em>#{item.index + 1}</em> {item.name}
                  </span>
                  <span className="gravCompareVal">
                    {item.magG.toFixed(2)} g · {fmtAcc(item.magAcc)} {accUnit}
                  </span>
                </div>
                <div className="gravCompareMeta">
                  <span className="gravCompareCoeff">
                    系数 ({item.nx}, {item.ny}, {item.nz}) · G={fmtAcc(item.accel)}
                  </span>
                  <span className="miniBarTrack">
                    <i style={{ width: `${item.magG > 0 ? pct : 0}%` }} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </VizCard>
    </>
  );
}

function NodalPreview({ draft }: { draft: Draft }) {
  const loads = Array.isArray(draft.loads) ? (draft.loads as Draft[]) : [];
  const bars = loads.map((r, i) => {
    const f = Math.hypot(n(r.fx), n(r.fy), n(r.fz));
    return { label: "Node " + (String(r.nodeId ?? "").trim() || "#" + (i + 1)), value: f };
  });
  const net: [number, number, number] = [
    loads.reduce((a, r) => a + n(r.fx), 0),
    loads.reduce((a, r) => a + n(r.fy), 0),
    loads.reduce((a, r) => a + n(r.fz), 0),
  ];
  const netMoment = Math.hypot(
    loads.reduce((a, r) => a + n(r.mx), 0),
    loads.reduce((a, r) => a + n(r.my), 0),
    loads.reduce((a, r) => a + n(r.mz), 0),
  );
  const netMag = Math.hypot(net[0], net[1], net[2]);
  return (
    <>
      <VizCard title="合力方向" hint="所有载荷行力矢量的叠加方向">
        {netMag > 0 ? <DirectionGizmo vector={net} label={net.map((v) => v.toFixed(0)).join(", ")} /> : <div className="chartEmpty" style={{ height: 120 }}><span>尚未输入力分量</span></div>}
      </VizCard>
      <StatRow
        items={[
          { label: "节点数", value: String(loads.length) },
          { label: "合力 |F|", value: `${netMag.toFixed(1)} N`, tone: netMag > 0 ? "on" : "" },
          { label: "合力矩 |M|", value: netMoment.toFixed(1) },
          { label: "子工况", value: draft.perRowSubcase ? `${loads.length} 个(逐行)` : "1 个(合并)" },
        ]}
      />
      <VizCard title="各节点力大小" hint="单位同模型单位">
        <MiniBars items={bars} unit=" N" />
      </VizCard>
    </>
  );
}

function ConstraintPreview({ draft }: { draft: Draft }) {
  const rows = Array.isArray(draft.rows) ? (draft.rows as Draft[]) : [];
  const grid = rows.map((r, i) => ({
    label: String(r.nodeId ?? "").trim() || "#" + (i + 1),
    dofs: parseDofBool(r.dofs),
  }));
  return (
    <>
      <VizCard title="自由度约束图" hint="■ 固定 · 每行一个节点">
        <DofGrid rows={grid} />
      </VizCard>
      <StatRow
        items={[
          { label: "约束行", value: String(rows.length) },
          { label: "模式", value: draft.mode === "reference" ? "仅引用外部" : draft.combineWithExisting ? "新建 + SPCADD" : "新建 SPC" },
        ]}
      />
    </>
  );
}

export default function ModulePreview({
  activeId,
  draft,
  gravityRowIndex = 0,
  onSelectGravityRow,
}: {
  activeId: string;
  draft: Draft;
  gravityRowIndex?: number;
  onSelectGravityRow?: (index: number) => void;
}) {
  let body: React.ReactNode = null;

  switch (activeId) {
    case "radioss-rops":
      body = <RopsPreview draft={draft} fops={false} />;
      break;
    case "radioss-fops":
      body = <RopsPreview draft={draft} fops />;
      break;
    case "random-psd":
      body = <PsdPreview draft={draft} />;
      break;
    case "frequency-response":
      body = <FreqResponsePreview draft={draft} />;
      break;
    case "normal-modes":
      body = <ModalPreview draft={draft} />;
      break;
    case "gravity":
      body = (
        <GravityPreview
          draft={draft}
          selectedIndex={gravityRowIndex}
          onSelectIndex={onSelectGravityRow}
        />
      );
      break;
    case "nodal-static":
      body = <NodalPreview draft={draft} />;
      break;
    case "constraint":
      body = <ConstraintPreview draft={draft} />;
      break;
    default:
      body = <div className="livePreviewPlaceholder">该模块暂无图形化预览。</div>;
  }

  return (
    <div className="livePreview">
      <div className="livePreviewBody">{body}</div>
      <p className="livePreviewNote">实时视图随表单输入即时刷新，仅用于几何方向与量级校核；最终卡片文本以“校验 / 预览 Deck”结果为准。</p>
    </div>
  );
}
