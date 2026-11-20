// Grafik kecil SVG: garis saldo (1 seri, crosshair + tooltip) dan kolom R per bulan (polaritas naik/turun, tooltip per kolom).
import { useMemo, useRef, useState } from 'react';

const W = 640;

function niceTicks(lo: number, hi: number, n = 4) {
  const span = hi - lo || Math.abs(hi) || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function EquityChart({ points, format, label }: { points: { t: number; v: number }[]; format: (v: number) => string; label: (t: number) => string }) {
  const H = 180;
  const pad = { l: 8, r: 52, t: 10, b: 18 };
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const g = useMemo(() => {
    if (points.length < 2) return null;
    const vs = points.map((p) => p.v);
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    const m = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1;
    lo -= m;
    hi += m;
    const t0 = points[0].t;
    const t1 = points.at(-1)!.t;
    const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const area = `${d}L${x(t1).toFixed(1)},${H - pad.b}L${x(t0).toFixed(1)},${H - pad.b}Z`;
    return { x, y, d, area, ticks: niceTicks(lo, hi) };
  }, [points]);
  if (!g) return <div className="grid h-[180px] place-items-center text-sm text-mute">Grafik muncul setelah ada trade selesai.</div>;
  const onMove = (e: React.PointerEvent) => {
    const rc = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - rc.left) / rc.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(g.x(points[i].t) - px) < Math.abs(g.x(points[best].t) - px)) best = i;
    setHover(best);
  };
  const hp = hover !== null ? points[hover] : null;
  const last = points.at(-1)!;
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Grafik saldo">
        {g.ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={g.y(v)} y2={g.y(v)} stroke="rgb(var(--line))" strokeWidth={1} />
            <text x={W - pad.r + 6} y={g.y(v) + 4} fontSize={11} fill="rgb(var(--mute))" className="num">
              {format(v)}
            </text>
          </g>
        ))}
        <path d={g.area} fill="rgb(var(--accent) / .10)" />
        <path d={g.d} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={g.x(last.t)} cy={g.y(last.v)} r={4} fill="rgb(var(--accent))" stroke="rgb(var(--panel))" strokeWidth={2} />
        {hp && (
          <>
            <line x1={g.x(hp.t)} x2={g.x(hp.t)} y1={pad.t} y2={H - pad.b} stroke="rgb(var(--mute))" strokeWidth={1} />
            <circle cx={g.x(hp.t)} cy={g.y(hp.v)} r={5} fill="rgb(var(--accent))" stroke="rgb(var(--panel))" strokeWidth={2} />
          </>
        )}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-1 rounded-md border border-line bg-panel px-2 py-1 text-xs shadow" style={{ left: `clamp(0px, calc(${(g.x(hp.t) / W) * 100}% - 60px), calc(100% - 130px))` }}>
          <div className="num font-semibold">{format(hp.v)}</div>
          <div className="text-mute">{label(hp.t)}</div>
        </div>
      )}
    </div>
  );
}

export function BarsR({ data }: { data: { k: string; v: number }[] }) {
  const H = 170;
  const pad = { l: 34, r: 4, t: 10, b: 20 };
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;
  const vs = data.map((d) => d.v);
  const lo = Math.min(0, ...vs);
  const hi = Math.max(0, ...vs);
  const ticks = niceTicks(lo, hi);
  const y0 = Math.min(lo, ticks[0]);
  const y1 = Math.max(hi, ticks.at(-1)!);
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const band = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(24, band - 2);
  const rad = 4;
  const bar = (i: number, v: number) => {
    const cx = pad.l + band * i + band / 2;
    const x0 = cx - bw / 2;
    const yb = y(0);
    const yv = y(v);
    const h = Math.abs(yv - yb);
    const r = Math.min(rad, h);
    if (h < 0.5) return '';
    return v >= 0
      ? `M${x0},${yb}V${yv + r}Q${x0},${yv} ${x0 + r},${yv}H${x0 + bw - r}Q${x0 + bw},${yv} ${x0 + bw},${yv + r}V${yb}Z`
      : `M${x0},${yb}V${yv - r}Q${x0},${yv} ${x0 + r},${yv}H${x0 + bw - r}Q${x0 + bw},${yv} ${x0 + bw},${yv - r}V${yb}Z`;
  };
  const hd = hover !== null ? data[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label="R per bulan">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="rgb(var(--line))" strokeWidth={1} />
            <text x={pad.l - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="rgb(var(--mute))" className="num">
              {v}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="rgb(var(--mute))" strokeWidth={1} />
        {data.map((d, i) => (
          <g key={d.k} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" />
            <path d={bar(i, d.v)} fill={d.v >= 0 ? 'rgb(var(--up))' : 'rgb(var(--down))'} opacity={hover === null || hover === i ? 1 : 0.5} />
            {i % Math.ceil(data.length / 8) === 0 && (
              <text x={pad.l + band * i + band / 2} y={H - 5} fontSize={10} textAnchor="middle" fill="rgb(var(--mute))">
                {d.k.slice(2)}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hd && (
        <div className="pointer-events-none absolute top-1 rounded-md border border-line bg-panel px-2 py-1 text-xs shadow" style={{ left: `clamp(0px, calc(${((pad.l + band * hover! + band / 2) / W) * 100}% - 40px), calc(100% - 90px))` }}>
          <div className="num font-semibold">
            {hd.v > 0 ? '+' : ''}
            {hd.v.toFixed(1)}R
          </div>
          <div className="text-mute">{hd.k}</div>
        </div>
      )}
    </div>
  );
}
