import {
  CurveChart,
  DirectionGizmo,
  DofGrid,
  MiniBars,
  RangeBar,
  SpectrumChart,
  TimelineBar,
  VizCard,
  type ChartPoint,
  type RangeSeg,
} from "@/components/charts/Charts";

type Draft = Record<string, any>;

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  return Number.isFinite(x) ? x : 0;
};

function dirVector(dir: string): [number, number, number] {
  const d = String(dir ?? "X").trim().toUpperCase();
  if (d === "Y") return [0, 1, 0];
  if (d === "Z") return [0, 0, 1];
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
  const dir = dirVector(draft.direction);
  const constraints = Array.isArray(draft.constraints) ? draft.constraints : [];
  const impact = (draft.impact ?? {}) as Draft;
  const gStd = 9.80665 * (n(impact.gravityG) || 1);
  const hM = n(impact.dropHeightMm) / 1000;
  const mass = n(impact.dropMassKg);
  const v0 = hM > 0 ? Math.sqrt(2 * gStd * hM) : 0;
  const energy = mass > 0 && hM > 0 ? mass * gStd * hM : 0;

  return (
    <>
      <VizCard title={fops ? "落锤位移曲线（受控位移近似）" : "位移曲线 t / u"} hint={"时间单位与终止时间一致" + (willExtrapolate ? " · 末点早于 Tstop，区间外线性外推" : "")}>
        <CurveChart
          points={curve}
          xLabel="时间 (ms)"
          yLabel={fops ? "落锤位移 (mm)" : "位移 (mm)"}
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
        <VizCard title="加载方向">
          <DirectionGizmo vector={dir} label={String(draft.direction ?? "X")} />
        </VizCard>
        <VizCard title="工况概览">
          <StatRow
            items={[
              { label: "曲线点数", value: String(curve.length) },
              { label: "约束组", value: String(constraints.length) },
              { label: "终止时间", value: endTime > 0 ? String(endTime) : "—" },
              { label: "重力", value: draft.gravityEnabled ? "启用" : "未启用", tone: draft.gravityEnabled ? "on" : "" },
            ]}
          />
        </VizCard>
      </div>
      <VizCard title="求解时间轴" hint="动画输出 / 时程输出">
        <TimelineBar endTime={endTime} animStart={n(draft.animStart)} animInterval={n(draft.animInterval)} thInterval={n(draft.thInterval)} />
      </VizCard>
    </>
  );
}

function PsdPreview({ draft }: { draft: Draft }) {
  const points: ChartPoint[] = (Array.isArray(draft.points) ? draft.points : []).map((p: Draft) => ({ x: n(p.frequencyHz), y: n(p.psd) }));
  const minHz = n(draft.minHz);
  const maxHz = n(draft.maxHz);
  const unit = String(draft.inputPsdUnit ?? "");
  const grms = unit.trim().toLowerCase().startsWith("g") ? approxGrms(points, minHz, maxHz) : null;
  return (
    <>
      <VizCard title="PSD 频谱（对数-对数）" hint={"插值 " + String(draft.interpolation ?? "LOG-LOG")}>
        <SpectrumChart points={points} band={[minHz, maxHz]} yLabel={"PSD (" + (unit || "g^2/Hz") + ")"} />
      </VizCard>
      <StatRow
        items={[
          { label: "频点", value: String(points.length) },
          { label: "求解频段", value: maxHz > 0 ? minHz + "–" + maxHz + " Hz" : "—" },
          { label: "约 Grms", value: grms !== null ? grms.toFixed(3) + " g" : "需 g²/Hz", tone: grms !== null ? "on" : "" },
          { label: "阻尼比", value: String(draft.dampingRatio ?? "—") },
        ]}
      />
      <VizCard title="求解频段" hint="绿色为积分频段">
        <RangeBar
          min={Math.min(minHz || 0, n(draft.modalMinHz) || 0)}
          max={Math.max(maxHz || 0, n(draft.modalMaxHz) || 0, 1)}
          segments={[
            { from: minHz, to: maxHz, label: "求解频段", tone: "brand" },
            { from: n(draft.modalMinHz), to: n(draft.modalMaxHz), label: "模态提取", tone: "blue" },
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
  return (
    <>
      <VizCard title="频率扫描范围" hint="FREQ1 步长扫描">
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

function GravityPreview({ draft }: { draft: Draft }) {
  const vec = (Array.isArray(draft.direction) ? draft.direction : ["0", "0", "-1"]).map(n) as [number, number, number];
  return (
    <>
      <VizCard title="重力方向" hint="按模型单位换算，不写入求解器默认单位">
        <DirectionGizmo vector={vec} label={vec.map((v) => v.toFixed(2)).join(", ")} />
      </VizCard>
      <StatRow
        items={[
          { label: "幅值", value: n(draft.magnitudeG) + " g" },
          { label: "约合", value: (n(draft.magnitudeG) * 9806.65).toFixed(0) + " mm/s²" },
          { label: "CID", value: String(draft.cid ?? "0") },
        ]}
      />
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
  const netMag = Math.hypot(net[0], net[1], net[2]);
  return (
    <>
      <VizCard title="合力方向" hint="所有载荷行力矢量的叠加方向">
        {netMag > 0 ? <DirectionGizmo vector={net} label={net.map((v) => v.toFixed(0)).join(", ")} /> : <div className="chartEmpty" style={{ height: 120 }}><span>尚未输入力分量</span></div>}
      </VizCard>
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
          { label: "模式", value: draft.mode === "reference" ? "仅引用" : "新建 SPC" },
        ]}
      />
    </>
  );
}

export default function ModulePreview({ activeId, draft }: { activeId: string; draft: Draft }) {
  let heading = "实时预览";
  let body: React.ReactNode = null;

  switch (activeId) {
    case "radioss-rops":
      heading = "ROPS 位移工况";
      body = <RopsPreview draft={draft} fops={false} />;
      break;
    case "radioss-fops":
      heading = "FOPS 落锤冲击";
      body = <RopsPreview draft={draft} fops />;
      break;
    case "random-psd":
      heading = "PSD 随机振动";
      body = <PsdPreview draft={draft} />;
      break;
    case "frequency-response":
      heading = "频率响应";
      body = <FreqResponsePreview draft={draft} />;
      break;
    case "normal-modes":
      heading = "模态";
      body = <ModalPreview draft={draft} />;
      break;
    case "gravity":
      heading = "重力";
      body = <GravityPreview draft={draft} />;
      break;
    case "nodal-static":
      heading = "节点力 / 力矩";
      body = <NodalPreview draft={draft} />;
      break;
    case "constraint":
      heading = "位移约束";
      body = <ConstraintPreview draft={draft} />;
      break;
    default:
      heading = "实时预览";
      body = <div className="livePreviewPlaceholder">该模块暂无图形化预览。</div>;
  }

  return (
    <div className="livePreview">
      <div className="livePreviewHead">
        <div>
          <p className="livePreviewEyebrow"><span className="livePulse" /> LIVE PREVIEW</p>
          <h3>{heading}</h3>
        </div>
        <span className="liveBadge">实时</span>
      </div>
      <div className="livePreviewBody">{body}</div>
      <p className="livePreviewNote">预览随输入实时更新，用于填写时校核方向/量级；最终数值以求解器 deck 为准。</p>
    </div>
  );
}
