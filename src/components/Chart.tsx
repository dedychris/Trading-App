import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import type { Series } from '../lib/signals';
import { useApp } from '../store/app';

function cssColor(name: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `rgb(${v.split(' ').join(',')})`;
}

export function PriceChart({ series, lines }: { series: Series; lines?: { price: number; color: 'up' | 'down' | 'warn' | 'accent'; title: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useApp((s) => s.book.settings.theme);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const up = cssColor('--up');
    const down = cssColor('--down');
    const chart: IChartApi = createChart(el, {
      height: 300,
      width: el.clientWidth,
      layout: { background: { color: 'transparent' }, textColor: cssColor('--mute'), fontSize: 11 },
      grid: { vertLines: { color: cssColor('--line') }, horzLines: { color: cssColor('--line') } },
      rightPriceScale: { borderColor: cssColor('--line') },
      timeScale: { borderColor: cssColor('--line'), timeVisible: true },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const cs = chart.addCandlestickSeries({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    const n = series.candles.length;
    const start = Math.max(0, n - 200);
    cs.setData(series.candles.slice(start).map((c) => ({ time: (c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    const addLine = (vals: number[], color: string, w: 1 | 2 = 1) => {
      const l = chart.addLineSeries({ color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      l.setData(series.candles.slice(start).map((c, i) => ({ time: (c.t / 1000) as UTCTimestamp, value: vals[start + i] })).filter((p) => !Number.isNaN(p.value)));
    };
    addLine(series.ema9, '#f5b301', 2);
    addLine(series.ema21, '#3b82f6', 2);
    addLine(series.ema200, '#a855f7', 1);
    for (const l of lines ?? []) {
      cs.createPriceLine({ price: l.price, color: cssColor(`--${l.color}`), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: l.title });
    }
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [series, theme, JSON.stringify(lines)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <div ref={ref} className="w-full" />
      <div className="mt-1 flex gap-3 text-[11px] text-mute">
        <span><span className="text-[#f5b301]">━</span> EMA9</span>
        <span><span className="text-[#3b82f6]">━</span> EMA21</span>
        <span><span className="text-[#a855f7]">━</span> EMA200</span>
      </div>
    </div>
  );
}

export function EquityChart({ points }: { points: { t: number; v: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useApp((s) => s.book.settings.theme);
  useEffect(() => {
    if (!ref.current || points.length < 2) return;
    const el = ref.current;
    const chart = createChart(el, {
      height: 220,
      width: el.clientWidth,
      layout: { background: { color: 'transparent' }, textColor: cssColor('--mute'), fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: cssColor('--line') } },
      rightPriceScale: { borderColor: cssColor('--line') },
      timeScale: { borderColor: cssColor('--line'), timeVisible: true },
    });
    const accent = cssColor('--accent');
    const s = chart.addAreaSeries({ lineColor: accent, topColor: accent.replace('rgb', 'rgba').replace(')', ',0.25)'), bottomColor: 'transparent', lineWidth: 2 });
    // waktu harus unik & naik
    const data: { time: UTCTimestamp; value: number }[] = [];
    for (const p of points) {
      let t = Math.floor(p.t / 1000);
      if (data.length && t <= data[data.length - 1].time) t = data[data.length - 1].time + 1;
      data.push({ time: t as UTCTimestamp, value: p.v });
    }
    s.setData(data);
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [points, theme]);
  if (points.length < 2) return <div className="flex h-[220px] items-center justify-center text-sm text-mute">Grafik saldo muncul setelah ada trade.</div>;
  return <div ref={ref} className="w-full" />;
}
