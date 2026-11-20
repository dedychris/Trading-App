// Backtest scalping pantulan Bollinger di BNB (5m & 15m), tiap tahun mulai modal baru.
// Data: COINS=BNB TF=5m scripts/download-data.sh data-5m 2020-02 2020-03 ... (bulan yang mau dites)
// Pakai: npx tsx scripts/backtest-scalp.ts <folder-csv-5m-BNB>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBacktest } from '../core/backtest.js';
import { DEFAULT_CONFIG, type BotConfig } from '../core/config.js';
import { stats } from '../core/engine.js';
const dir = process.argv[2] ?? "data-5m"; const c: any[] = [];
for (const f of readdirSync(dir).filter(f=>f.endsWith('.csv')).sort()) for (const l of readFileSync(join(dir,f),'utf8').split('\n')) { if(!l||l.startsWith('open')) continue; const p=l.split(','); c.push({t:+p[0],o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]}); }
c.sort((a,b)=>a.t-b.t);
const data = { BNBUSDT: c };
const months = (c.at(-1).t - c[0].t) / (30.4*86400e3);
const base: BotConfig = { ...DEFAULT_CONFIG, coins: ['BNBUSDT'], strategy: 'bbBounce', btcFilter: false, stopMode: 'pct', maxLeverage: 25, maxOpen: 1, maxSameDir: 1, cooldownBars: 0, dailyLossR: 1e9, timeStopBars: 0, tpPct: 0.40, slPct: 0.24, trailPct: 0.16, tpLock: true, tp1Frac: 0, tp2R: 0, trailAtr: 0 };
const Y = (y:number)=>Date.UTC(y,0,1);
const V: [string, Partial<BotConfig>][] = [
  ['Versi lu (TP 10% / SL 6% + trailing), fee normal', {}],
  ['Versi lu, fee termurah (entry limit/maker)', { takerFee: 0.0005, makerFee: 0.0002, entryMaker: true } as any],
  ['Target 2,5x lebih lebar (TP 25% / SL 15% margin)', { tpPct: 1.0, slPct: 0.6, trailPct: 0.4 }],
  ['Versi lu TANPA fee & slippage', { takerFee: 0, makerFee: 0, slippagePct: 0 }],
];
for (const mode of ['scalp5', 'scalp15'] as const) {
  console.log(`\n=== BNB ${mode === 'scalp5' ? '5 menit' : '15 menit'} — tiap tahun mulai modal baru, hasil rata-rata R per trade ===`);
  const rows = V.map(([name, p]) => {
    const row: Record<string, string | number> = { varian: name };
    let n = 0, sumR = 0;
    for (const y of [2020, 2021, 2022, 2023, 2024, 2025, 2026]) {
      const cfg: any = { ...base, ...p, mode };
      if (cfg.entryMaker) { cfg.slippagePct = 0.02; }
      const r = runBacktest(data, cfg, 1e6, { baseMs: 300_000, from: Y(y), to: Math.min(Y(y + 1), c.at(-1).t) - 1 });
      let tr = r.acc.trades;
      if (cfg.entryMaker) tr = tr.map((t: any) => { const save = t.qty * t.entry * (0.0005 - 0.0002) + t.qty * t.entry * 0.0002; return { ...t, pnl: t.pnl + save, r: (t.pnl + save) / t.riskUsd }; });
      const s = stats(tr, 1e6);
      row[String(y)] = s.avgR.toFixed(2);
      n += s.n; sumR += s.totalR;
    }
    row['trade/bln'] = Math.round(n / months);
    row['rata R'] = (sumR / n).toFixed(3);
    return row;
  });
  console.table(rows);
}
