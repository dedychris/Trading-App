// Backtest: jalankan mesin yang sama dengan bot live di atas candle historis.
// Sinyal di candle close → entry di open candle berikutnya (+slippage). SL/TP dicek pakai high/low candle (SL duluan kalau ambigu).
import { MODE_TF, type BotConfig } from './config.js';
import { checkExits, newAccount, onBarClose, stats, tryEnter, type Account, type Stats } from './engine.js';
import { biasAt, evaluate, prepare, type Prepared } from './strategy.js';
import { TF_MS, type Candle, type Decision, type TF } from './types.js';

/** Gabungkan candle kecil jadi TF lebih besar (hanya grup yang lengkap). */
export function aggregate(c: Candle[], fromMs: number, toMs: number): Candle[] {
  if (fromMs === toMs) return c;
  const per = toMs / fromMs;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let cnt = 0;
  for (const x of c) {
    const gt = Math.floor(x.t / toMs) * toMs;
    if (!cur || cur.t !== gt) {
      if (cur && cnt === per) out.push(cur);
      cur = { t: gt, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v };
      cnt = 1;
    } else {
      cur.h = Math.max(cur.h, x.h);
      cur.l = Math.min(cur.l, x.l);
      cur.c = x.c;
      cur.v += x.v;
      cnt++;
    }
  }
  if (cur && cnt === per) out.push(cur);
  return out;
}

export type BacktestResult = { acc: Account; stats: Stats; decisions: { open: number; skip: number; skipReasons: Record<string, number> } };

export function runBacktest(data15m: Record<string, Candle[]>, cfg: BotConfig, startBalance: number, opts: { from?: number; to?: number; logDecisions?: (d: Decision) => void } = {}): BacktestResult {
  const { entry, bias } = MODE_TF[cfg.mode];
  const eMs = TF_MS[entry];
  const prep: Record<string, Prepared> = {};
  const idx: Record<string, Map<number, number>> = {};
  for (const s of cfg.coins) {
    const c = data15m[s];
    if (!c?.length) continue;
    const e = aggregate(c, TF_MS['15m'], eMs);
    const b = aggregate(c, TF_MS['15m'], TF_MS[bias as TF]);
    prep[s] = prepare(s, e, b, cfg);
    idx[s] = new Map(e.map((x, i) => [x.t, i]));
  }
  const syms = Object.keys(prep);
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const s of syms) {
    t0 = Math.min(t0, prep[s].e.c[0].t);
    t1 = Math.max(t1, prep[s].e.c.at(-1)!.t);
  }
  if (opts.from) t0 = Math.max(t0, Math.floor(opts.from / eMs) * eMs);
  if (opts.to) t1 = Math.min(t1, opts.to);
  const acc = newAccount(startBalance, t0);
  const dec = { open: 0, skip: 0, skipReasons: {} as Record<string, number> };
  const btc = prep['BTCUSDT'];

  for (let t = t0; t <= t1; t += eMs) {
    const closeT = t + eMs;
    // 1. kelola posisi terbuka dengan candle ini
    for (const p of [...acc.positions]) {
      const i = idx[p.symbol].get(t);
      if (i === undefined) continue;
      const x = prep[p.symbol].e.c[i];
      if (checkExits(acc, cfg, p, x.h, x.l, closeT, eMs)) continue;
      onBarClose(acc, cfg, p, x.c, prep[p.symbol].e.atr[i], closeT, eMs);
    }
    // 2. nilai sinyal di candle yang baru close, entry di open candle berikutnya
    const ib = btc ? idx['BTCUSDT'].get(t) : undefined;
    const btcBias = btc && ib !== undefined ? biasAt(btc, ib) : null;
    for (const s of syms) {
      const i = idx[s].get(t);
      if (i === undefined || i + 1 >= prep[s].e.c.length) continue;
      const ev = evaluate(prep[s], i, cfg);
      if (!ev.dir) continue;
      const d = tryEnter(acc, cfg, { symbol: s, ev, price: prep[s].e.c[i + 1].o, t: closeT, btcBias, barMs: eMs });
      opts.logDecisions?.(d);
      if (d.action === 'OPEN') dec.open++;
      else if (d.action === 'SKIP') {
        dec.skip++;
        const k = d.reason.split('DILEWATI: ')[1]?.replace(/[\d.,−-]+/g, '#').slice(0, 60) ?? '?';
        dec.skipReasons[k] = (dec.skipReasons[k] ?? 0) + 1;
      }
    }
  }
  return { acc, stats: stats(acc.trades, startBalance), decisions: dec };
}
