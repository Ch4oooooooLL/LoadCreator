import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = mult * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || (a < 1e-3 && a > 0)) return v.toExponential(1);
  if (a >= 100) return String(Math.round(v));
  if (a >= 1) return String(Number(v.toFixed(2)));
  return String(Number(v.toFixed(3)));
}

function extent(values: number[], pad = 0.08): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    const d = Math.abs(min) || 1;
    min -= d * 0.5;
    max += d * 0.5;
  }
  const span = max - min;
  return [min - span * pad, max + span * pad];
}

/* ------------------------------------------------------------------ */
/* Curve chart — time / displacement, PSD (linear), etc.               */
/* ------------------------------------------------------------------ */

export interface ChartPoint { x: number; y: number }

export function CurveChart({
  points,
  xLabel,
  yLabel,
  height = 236,
  markerX,
  markerLabel,
  tone = "brand",
  interpolate = true,
  emptyHint = "暂无数据",
}: {
  points: ChartPoint[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
  markerX?: number;
  markerLabel?: string;
  tone?: "brand" | "amber" | "blue";
  interpolate?: boolean;
  emptyHint?: string;
}) {
  const W = 640;
  const H = height;
  const m = { top: 16, right: 18, bottom: 34, left: 52 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const stroke = tone === "amber" ? "#a9701a" : tone === "blue" ? "#3a6ea5" : "#1d7a43";
  const fill = tone === "amber" ? "rgba(169,112,26,0.12)" : tone === "blue" ? "rgba(58,110,165,0.12)" : "rgba(29,122,67,0.12)";

  if (clean.length === 0) {
    return (
      <div className="chartEmpty" style={{ height }}>
        <span>{emptyHint}</span>
      </div>
    );
  }

  const xs = clean.map((p) => p.x);
  const ys = clean.map((p) => p.y);
  let [x0, x1] = extent(xs, 0.04);
  let [y0, y1] = extent(ys, 0.12);
  if (markerX !== undefined && Number.isFinite(markerX)) {
    x0 = Math.min(x0, markerX);
    x1 = Math.max(x1, markerX);
  }
  const sx = (v: number) => m.left + ((v - x0) / (x1 - x0 || 1)) * iw;
  const sy = (v: number) => m.top + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

  const sorted = [...clean].sort((a, b) => a.x - b.x);
  const path = sorted.map((p, i) => (i === 0 ? "M" : "L") + sx(p.x).toFixed(2) + " " + sy(p.y).toFixed(2)).join(" ");
  const area = path + " L" + sx(sorted[sorted.length - 1].x).toFixed(2) + " " + sy(y0).toFixed(2) + " L" + sx(sorted[0].x).toFixed(2) + " " + sy(y0).toFixed(2) + " Z";

  const xTicks = niceTicks(x0, x1, 5);
  const yTicks = niceTicks(y0, y1, 4);

  return (
    <svg className="chartSvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="曲线图">
      {yTicks.map((t) => (
        <g key={"y" + t}>
          <line x1={m.left} x2={m.left + iw} y1={sy(t)} y2={sy(t)} className="chartGrid" />
          <text x={m.left - 8} y={sy(t) + 3} className="chartTick" textAnchor="end">{fmt(t)}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={"x" + t}>
          <line x1={sx(t)} x2={sx(t)} y1={m.top} y2={m.top + ih} className="chartGrid" />
          <text x={sx(t)} y={m.top + ih + 16} className="chartTick" textAnchor="middle">{fmt(t)}</text>
        </g>
      ))}
      {y0 < 0 && y1 > 0 && <line x1={m.left} x2={m.left + iw} y1={sy(0)} y2={sy(0)} className="chartAxisZero" />}
      <path d={area} fill={fill} stroke="none" />
      <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {interpolate &&
        sorted.map((p, i) => (
          <circle key={"p" + i} cx={sx(p.x)} cy={sy(p.y)} r={3.2} fill="#fff" stroke={stroke} strokeWidth={1.8}>
            <title>{`(${fmt(p.x)}, ${fmt(p.y)})`}</title>
          </circle>
        ))}
      {markerX !== undefined && Number.isFinite(markerX) && (
        <g>
          <line x1={sx(markerX)} x2={sx(markerX)} y1={m.top} y2={m.top + ih} className="chartMarker" />
          <text x={sx(markerX) + 4} y={m.top + 11} className="chartMarkerLabel" textAnchor="start">{markerLabel ?? "Tstop"}</text>
        </g>
      )}
      {xLabel && <text x={m.left + iw / 2} y={H - 3} className="chartAxisLabel" textAnchor="middle">{xLabel}</text>}
      {yLabel && <text x={12} y={m.top + ih / 2} className="chartAxisLabel" textAnchor="middle" transform={`rotate(-90 12 ${m.top + ih / 2})`}>{yLabel}</text>}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Log-log spectrum chart (PSD)                                        */
/* ------------------------------------------------------------------ */

export function SpectrumChart({
  points,
  xLabel = "频率 (Hz)",
  yLabel = "PSD",
  height = 236,
  band,
  emptyHint = "暂无频点",
}: {
  points: ChartPoint[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
  band?: [number, number];
  emptyHint?: string;
}) {
  const W = 640;
  const H = height;
  const m = { top: 16, right: 20, bottom: 34, left: 56 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0 && p.y > 0);
  if (clean.length === 0) {
    return <div className="chartEmpty" style={{ height }}><span>{emptyHint}（对数坐标需正值）</span></div>;
  }
  const lx = clean.map((p) => Math.log10(p.x));
  const ly = clean.map((p) => Math.log10(p.y));
  const [lx0, lx1] = extent(lx, 0.05);
  const [ly0, ly1] = extent(ly, 0.12);
  const sx = (v: number) => m.left + ((Math.log10(v) - lx0) / (lx1 - lx0 || 1)) * iw;
  const sy = (v: number) => m.top + ih - ((Math.log10(v) - ly0) / (ly1 - ly0 || 1)) * ih;
  const sorted = [...clean].sort((a, b) => a.x - b.x);
  const path = sorted.map((p, i) => (i === 0 ? "M" : "L") + sx(p.x).toFixed(2) + " " + sy(p.y).toFixed(2)).join(" ");

  const powTicks = (lo: number, hi: number): number[] => {
    const out: number[] = [];
    for (let k = Math.floor(lo); k <= Math.ceil(hi); k++) {
      const v = Math.pow(10, k);
      const l = Math.log10(v);
      if (l >= lo && l <= hi) out.push(v);
    }
    return out;
  };
  const xt = powTicks(lx0, lx1);
  const yt = powTicks(ly0, ly1);

  return (
    <svg className="chartSvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="PSD 频谱">
      {band && band[0] > 0 && band[1] > 0 && (
        <rect
          x={sx(band[0])}
          y={m.top}
          width={Math.max(0, sx(band[1]) - sx(band[0]))}
          height={ih}
          fill="rgba(87,201,130,0.10)"
        />
      )}
      {yt.map((t) => (
        <g key={"y" + t}>
          <line x1={m.left} x2={m.left + iw} y1={sy(t)} y2={sy(t)} className="chartGrid" />
          <text x={m.left - 8} y={sy(t) + 3} className="chartTick" textAnchor="end">{fmt(t)}</text>
        </g>
      ))}
      {xt.map((t) => (
        <g key={"x" + t}>
          <line x1={sx(t)} x2={sx(t)} y1={m.top} y2={m.top + ih} className="chartGrid" />
          <text x={sx(t)} y={m.top + ih + 16} className="chartTick" textAnchor="middle">{fmt(t)}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#1d7a43" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {sorted.map((p, i) => (
        <circle key={"p" + i} cx={sx(p.x)} cy={sy(p.y)} r={3} fill="#fff" stroke="#1d7a43" strokeWidth={1.8}>
          <title>{`f=${fmt(p.x)} Hz, PSD=${fmt(p.y)}`}</title>
        </circle>
      ))}
      {xLabel && <text x={m.left + iw / 2} y={H - 3} className="chartAxisLabel" textAnchor="middle">{xLabel}</text>}
      {yLabel && <text x={12} y={m.top + ih / 2} className="chartAxisLabel" textAnchor="middle" transform={`rotate(-90 12 ${m.top + ih / 2})`}>{yLabel}</text>}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Isometric direction gizmo                                           */
/* ------------------------------------------------------------------ */

export function DirectionGizmo({
  vector,
  label,
  size = 150,
}: {
  vector: [number, number, number];
  label?: string;
  size?: number;
}) {
  const C = 0.866; // cos30
  const S = 0.5; // sin30
  const len = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  const n = vector.map((v) => v / len) as [number, number, number];
  const proj = (x: number, y: number, z: number): [number, number] => [
    (x - y) * C,
    (x + y) * S - z,
  ];
  const scale = size * 0.34;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const toPx = (p: [number, number]): [number, number] => [cx + p[0] * scale, cy + p[1] * scale];

  const axes: Array<{ name: string; dir: [number, number, number]; color: string }> = [
    { name: "X", dir: [1, 0, 0], color: "#b2453b" },
    { name: "Y", dir: [0, 1, 0], color: "#1d7a43" },
    { name: "Z", dir: [0, 0, 1], color: "#3a6ea5" },
  ];
  const tip = toPx(proj(n[0], n[1], n[2]));

  return (
    <div className="gizmoWrap">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="方向矢量">
        {axes.map((a) => {
          const p = toPx(proj(a.dir[0], a.dir[1], a.dir[2]));
          return (
            <g key={a.name}>
              <line x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke={a.color} strokeWidth={1.4} strokeDasharray="3 3" opacity={0.55} />
              <text x={p[0]} y={p[1] + 3} fill={a.color} fontSize={10} fontWeight={700} textAnchor="middle">{a.name}</text>
            </g>
          );
        })}
        <line x1={cx} y1={cy} x2={tip[0]} y2={tip[1]} stroke="#111c15" strokeWidth={2.4} strokeLinecap="round" />
        <circle cx={tip[0]} cy={tip[1]} r={4} fill="#111c15" />
        <circle cx={cx} cy={cy} r={3} fill="#fff" stroke="#111c15" strokeWidth={1.5} />
      </svg>
      {label && <span className="gizmoLabel">{label}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Range bar                                                           */
/* ------------------------------------------------------------------ */

export interface RangeSeg { from: number; to: number; label: string; tone?: "brand" | "amber" | "blue" }

export function RangeBar({
  min,
  max,
  segments,
  unit = "Hz",
}: {
  min: number;
  max: number;
  segments: RangeSeg[];
  unit?: string;
}) {
  const W = 560;
  const rowH = 26;
  const H = 20 + segments.length * rowH;
  const m = { left: 14, right: 14, top: 6 };
  const iw = W - m.left - m.right;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const sx = (v: number) => m.left + ((v - lo) / (hi - lo || 1)) * iw;
  const ticks = niceTicks(lo, hi, 5);
  const toneColor: Record<string, string> = { brand: "#1d7a43", amber: "#c08a2a", blue: "#3a6ea5" };

  return (
    <svg className="chartSvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="量程">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={sx(t)} x2={sx(t)} y1={m.top} y2={H - 12} className="chartGrid" />
          <text x={sx(t)} y={H - 2} className="chartTick" textAnchor="middle">{fmt(t)}</text>
        </g>
      ))}
      {segments.map((seg, i) => {
        const x = Math.min(sx(seg.from), sx(seg.to));
        const w = Math.abs(sx(seg.to) - sx(seg.from));
        const y = m.top + 6 + i * rowH;
        return (
          <g key={seg.label + i}>
            <line x1={m.left} x2={m.left + iw} y1={y + 7} y2={y + 7} className="chartTrack" />
            <rect x={x} y={y} width={Math.max(2, w)} height={14} rx={4} fill={toneColor[seg.tone ?? "brand"]} opacity={0.85} />
            <text x={m.left} y={y - 1} className="chartSegLabel">{seg.label}</text>
          </g>
        );
      })}
      <text x={W - m.right} y={H - 2} className="chartUnit" textAnchor="end">{unit}</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* DOF grid                                                            */
/* ------------------------------------------------------------------ */

const DOF_NAMES = ["TX", "TY", "TZ", "RX", "RY", "RZ"];

export function DofGrid({ rows }: { rows: Array<{ label: string; dofs: boolean[] }> }) {
  if (rows.length === 0) return <div className="chartEmpty" style={{ height: 90 }}><span>暂无约束行</span></div>;
  return (
    <div className="dofGrid">
      <div className="dofHead">
        <span className="dofRowLabel" />
        {DOF_NAMES.map((d) => <span key={d} className="dofHeadCell">{d}</span>)}
      </div>
      {rows.map((r, i) => (
        <div className="dofRow" key={i}>
          <span className="dofRowLabel" title={r.label}>{r.label}</span>
          {DOF_NAMES.map((d, di) => (
            <span key={d} className={"dofCell" + (r.dofs[di] ? " on" : "")}>{r.dofs[di] ? "■" : "·"}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mini bars                                                           */
/* ------------------------------------------------------------------ */

export function MiniBars({
  items,
  unit = "",
}: {
  items: Array<{ label: string; value: number }>;
  unit?: string;
}) {
  if (items.length === 0) return <div className="chartEmpty" style={{ height: 80 }}><span>暂无数据</span></div>;
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="miniBars">
      {items.map((it, i) => (
        <div className="miniBarRow" key={i}>
          <span className="miniBarLabel" title={it.label}>{it.label}</span>
          <span className="miniBarTrack">
            <i style={{ width: Math.max(2, (Math.abs(it.value) / max) * 100) + "%" }} />
          </span>
          <span className="miniBarValue">{fmt(it.value)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Engine timeline                                                     */
/* ------------------------------------------------------------------ */

export function TimelineBar({
  endTime,
  animStart,
  animInterval,
  thInterval,
}: {
  endTime: number;
  animStart: number;
  animInterval: number;
  thInterval: number;
}) {
  const W = 560;
  const H = 74;
  const m = { left: 12, right: 12, top: 26 };
  const iw = W - m.left - m.right;
  const total = endTime > 0 ? endTime : 1;
  const sx = (v: number) => m.left + Math.min(1, Math.max(0, v / total)) * iw;
  const ticks = niceTicks(0, total, 5);
  const animCount = animInterval > 0 && endTime > animStart ? Math.floor((endTime - animStart) / animInterval) + 1 : 0;
  const thCount = thInterval > 0 ? Math.floor(endTime / thInterval) + 1 : 0;
  return (
    <div className="timelineWrap">
      <svg className="chartSvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="求解时间轴">
        <line x1={m.left} x2={m.left + iw} y1={m.top + 14} y2={m.top + 14} className="chartTrack" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={m.top + 8} y2={m.top + 20} className="chartGrid" />
            <text x={sx(t)} y={H - 4} className="chartTick" textAnchor="middle">{fmt(t)}</text>
          </g>
        ))}
        <line x1={sx(animStart)} x2={sx(animStart)} y1={m.top + 2} y2={m.top + 26} className="chartMarker" />
        <text x={sx(animStart) + 4} y={m.top - 6} className="chartMarkerLabel">动画起点</text>
        <line x1={sx(endTime)} x2={sx(endTime)} y1={m.top + 2} y2={m.top + 26} className="chartMarker" />
        <text x={sx(endTime) - 4} y={m.top - 6} className="chartMarkerLabel" textAnchor="end">Tstop</text>
      </svg>
      <div className="timelineStats">
        <span>动画帧 ≈ <b>{animCount}</b>（ΔT {fmt(animInterval)}）</span>
        <span>时程点 ≈ <b>{thCount}</b>（Δ {fmt(thInterval)}）</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small framed viz card                                               */
/* ------------------------------------------------------------------ */

export function VizCard({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="vizCard">
      <div className="vizCardHead">
        <div>
          <h4>{title}</h4>
          {hint && <span>{hint}</span>}
        </div>
        {action}
      </div>
      <div className="vizCardBody">{children}</div>
    </div>
  );
}
