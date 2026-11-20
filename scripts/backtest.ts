// Backtest strategi pakai data asli Binance (hasil scripts/download-data.sh).
// Pakai: npx tsx scripts/backtest.ts <folder-data> [--out public/backtest.json] [--modal 200000] [--idr 16500]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBacktest } from '../core/backtest.js';
import { DEFAULT_CONFIG, type BotConfig } from '../core/config.js';
import { stats } from '../core/engine.js';
import type { Candle } from '../core/types.js';

const args = process.argv.slice(2);
const dir = args[0] ?? 'data';
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = arg('--out');
const idr = +(arg('--idr') ?? 16500);
const modalIdr = +(arg('--modal') ?? 200_000);

function load(): Record<string, Candle[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
  const data: Record<string, Candle[]> = {};
  for (const f of files) {
    const sym = f.split('-')[0];
    const rows = readFileSync(join(dir, f), 'utf8').split('\n');
    const arr = (data[sym] ??= []);
    for (const line of rows) {
      if (!line || line.startsWith('open_time')) continue;
      const p = line.split(',');
      arr.push({ t: +p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] });
    }
  }
  for (const s of Object.keys(data)) data[s].sort((a, b) => a.t - b.t);
  return data;
}

const data = load();
const syms = Object.keys(data);
const t0 = Math.min(...syms.map((s) => data[s][0].t));
const t1 = Math.max(...syms.map((s) => data[s].at(-1)!.t));
const d = (t: number) => new Date(t).toISOString().slice(0, 10);
console.log(`Data: ${syms.length} koin, ${d(t0)} → ${d(t1)}\n`);

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
type Row = { name: string; cfg: BotConfig };
// Default (yang dipakai bot) dibandingkan dengan pendekatan lain yang sudah dites.
const variants: Row[] = [
  { name: 'DEFAULT 4H/harian, TP1+trailing', cfg: DEFAULT_CONFIG },
  { name: '4H/harian, tanpa TP (trailing saja)', cfg: { ...DEFAULT_CONFIG, tp1Frac: 0, trailAlways: true } },
  { name: '1H/4H swing, TP 1R+2,5R', cfg: { ...DEFAULT_CONFIG, mode: 'swing', biasFast: 50, biasSlow: 200, slAtr: 1.5, tp2R: 2.5, trailAtr: 2, timeStopBars: 32 } },
  { name: '15m/1H intraday, TP 1R+2,5R', cfg: { ...DEFAULT_CONFIG, mode: 'intraday', biasFast: 50, biasSlow: 200, slAtr: 1.5, tp2R: 2.5, trailAtr: 2, timeStopBars: 32 } },
];
// Hasil per tahun kalender untuk cek konsistensi
const years: [string, number, number][] = [];
for (let y = new Date(t0).getUTCFullYear(); Date.UTC(y, 0, 1) <= t1; y++) years.push([String(y), Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)]);

const BIG = 1000;
const table: Record<string, unknown>[] = [];
const results: Record<string, ReturnType<typeof runBacktest>> = {};
for (const v of variants) {
  const r = runBacktest(data, v.cfg, BIG);
  results[v.name] = r;
  const perYear = Object.fromEntries(years.map(([k, a, b]) => [`R ${k}`, stats(r.acc.trades.filter((t) => t.openedAt >= a && t.openedAt < b), BIG).totalR.toFixed(1)]));
  table.push({
    varian: v.name,
    trade: r.stats.n,
    winrate: pct(r.stats.winrate),
    'rata R': r.stats.avgR.toFixed(2),
    'total R': r.stats.totalR.toFixed(1),
    PF: r.stats.pf.toFixed(2),
    'maxDD%': r.stats.maxDdPct.toFixed(0),
    ...perYear,
  });

}
console.log(`Modal ${BIG} USDT (tanpa batas minimal order), risiko ${DEFAULT_CONFIG.riskPct}%/trade:`);
console.table(table);

const best = Object.entries(results)[0];
console.log(`\nDetail ${best[0]}:`);
const bs = best[1];
console.log('Exit:', bs.stats.byExit);
console.log('Alasan dilewati (top):', Object.entries(bs.decisions.skipReasons).sort((a, b) => b[1] - a[1]).slice(0, 8));
const perSetup = ['pullback', 'breakout'].map((k) => {
  const s = stats(bs.acc.trades.filter((t) => t.setup === k), BIG);
  return { setup: k, trade: s.n, winrate: pct(s.winrate), 'rata R': s.avgR.toFixed(2), 'total R': s.totalR.toFixed(1) };
});
console.table(perSetup);
const perCoin = syms
  .map((s) => {
    const st = stats(bs.acc.trades.filter((t) => t.symbol === s), BIG);
    return { koin: s, trade: st.n, winrate: pct(st.winrate), 'total R': +st.totalR.toFixed(1) };
  })
  .sort((a, b) => b['total R'] - a['total R']);
console.table(perCoin);

// Modal kecil dalam Rupiah (kurs tetap untuk konversi), dengan batas minimal order Binance
const small = modalIdr / idr;
const rp = (usdt: number) => `Rp ${Math.round(usdt * idr).toLocaleString('id-ID')}`;
const bestCfg = variants.find((v) => v.name === best[0])!.cfg;
const rs = runBacktest(data, bestCfg, small);
console.log(`\nModal ${rp(small)} (${small.toFixed(2)} USDT, kurs ${idr}): ${rs.stats.n} trade, winrate ${pct(rs.stats.winrate)}, saldo akhir ${rp(small + rs.stats.pnl)} (${rs.stats.returnPct.toFixed(0)}%), maxDD ${rs.stats.maxDdPct.toFixed(0)}%`);
let bal = small;
const smallYears = years.map(([k, a, b]) => {
  const tr = rs.acc.trades.filter((t) => t.closedAt >= a && t.closedAt < b);
  const st = stats(tr, bal);
  const start = bal;
  let lo = bal;
  for (const t of tr) {
    bal += t.pnl;
    lo = Math.min(lo, bal);
  }
  return { tahun: k, trade: st.n, winrate: pct(st.winrate), 'saldo awal': rp(start), 'saldo akhir': rp(bal), hasil: `${(((bal - start) / start) * 100).toFixed(0)}%`, 'saldo terendah': rp(lo), 'DD maks': `${st.maxDdPct.toFixed(0)}%` };
});
console.table(smallYears);
console.log('Alasan dilewati (top):', Object.entries(rs.decisions.skipReasons).sort((a, b) => b[1] - a[1]).slice(0, 5));

const monthly: Record<string, number> = {};
for (const t of bs.acc.trades) {
  const m = new Date(t.closedAt).toISOString().slice(0, 7);
  monthly[m] = (monthly[m] ?? 0) + t.r;
}
console.log('\nR per bulan (default):', Object.fromEntries(Object.entries(monthly).map(([k, v]) => [k, +v.toFixed(1)])));

if (out) {
  const json = {
    generatedAt: Date.now(),
    period: { from: t0, to: t1 },
    coins: syms.length,
    startBalance: BIG,
    best: best[0],
    years: years.map(([k]) => k),
    variants: variants.map((v) => ({ name: v.name, mode: v.cfg.mode, ...summary(results[v.name].stats), perYear: years.map(([, a, b]) => stats(results[v.name].acc.trades.filter((t) => t.openedAt >= a && t.openedAt < b), BIG).totalR) })),
    perSetup,
    perCoin,
    monthly,
    equity: bs.acc.equity.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 300)) === 0 || i === a.length - 1),
    small: { startUsdt: small, startIdr: modalIdr, idrRate: idr, ...summary(rs.stats), years: smallYears },
  };
  writeFileSync(out, JSON.stringify(json));
  console.log(`\nDisimpan ke ${out}`);
}

function summary(s: ReturnType<typeof stats>) {
  return { n: s.n, winrate: s.winrate, avgR: s.avgR, totalR: s.totalR, pf: Number.isFinite(s.pf) ? s.pf : null, returnPct: s.returnPct, maxDdPct: s.maxDdPct, byExit: s.byExit };
}
