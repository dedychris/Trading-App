// Uji #1 Donchian breakout & #2 momentum harian (time-series momentum) di 3 periode.
// Aturan dikunci sebelum melihat hasil (lihat HASIL.md). Data: scripts/backtest/download.sh (semua periode).
// Jalankan: npx vite-node scripts/backtest/trend.ts
import { readFileSync, existsSync } from 'node:fs';
import { atr } from '../../src/lib/indicators';
import type { Candle } from '../../src/lib/binance';

const DIR = process.env.BT_DIR ?? new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const COINS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'LINKUSDT', 'AVAXUSDT', 'SUIUSDT', 'TONUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'XLMUSDT', 'HBARUSDT', 'NEARUSDT', 'UNIUSDT', 'APTUSDT'];
const PERIODS: Record<string, { label: string; months: string[] }> = {
  '4': { label: 'Nov 2024–Apr 2025', months: ['2024-09', '2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03', '2025-04'] },
  '3': { label: 'Mei–Okt 2025', months: ['2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10'] },
  '2': { label: 'Nov 2025–Apr 2026', months: ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'] },
  '1': { label: 'Mei–Okt 2026', months: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'] },
};
const FEE = 0.0005;
const H = 3_600_000;
const DAY = 86_400_000;

function loadCsv(sym: string, iv: string, months: string[]): Candle[] {
  const out: Candle[] = [];
  for (const m of months) {
    const f = `${DIR}/data/csv/${sym}-${iv}-${m}.csv`;
    if (!existsSync(f)) throw new Error(`data tidak ada: ${f} (jalankan download.sh)`);
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line || line[0] === 'o') continue;
      const p = line.split(',');
      out.push({ t: +p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] });
    }
  }
  return out;
}

/** Candle harian (UTC) dari candle 1 jam. */
function toDaily(h1: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of h1) {
    const d = Math.floor(c.t / DAY) * DAY;
    const last = out[out.length - 1];
    if (last && last.t === d) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
    } else out.push({ t: d, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
  }
  return out;
}

type Dir = 1 | -1;
type Trade = { sym: string; dir: Dir; t: number; entry: number; slMove: number; exitT: number; exitPx: number; reason: string };

// ---------------- #1 Donchian ----------------
/**
 * Entry: close candle TF tembus high/low N candle sebelumnya (onset). SL = 2×ATR14 TF itu (statis).
 * Keluar: close tembus low/high M candle sebelumnya (berlawanan), dicek tiap close candle TF.
 * SL dicek pakai candle 1 jam (SL duluan kalau satu candle kena SL & channel).
 */
function donchianTrades(sym: string, tf: Candle[], tfMs: number, h1: Candle[], N: number, M: number, start: number, end: number, entryFilter?: (i: number) => Dir | null): Trade[] {
  const a = atr(tf, 14);
  const out: Trade[] = [];
  const hi = (i: number, n: number) => Math.max(...tf.slice(i - n, i).map((c) => c.h));
  const lo = (i: number, n: number) => Math.min(...tf.slice(i - n, i).map((c) => c.l));
  let busyUntil = 0;
  let h1p = 0;
  for (let i = Math.max(N, M) + 1; i < tf.length; i++) {
    const T = tf[i].t + tfMs; // waktu close
    if (T < start || T >= end || T < busyUntil) continue;
    let dir: Dir | null = null;
    if (entryFilter) dir = entryFilter(i);
    else if (tf[i].c > hi(i, N) && tf[i - 1].c <= hi(i - 1, N)) dir = 1;
    else if (tf[i].c < lo(i, N) && tf[i - 1].c >= lo(i - 1, N)) dir = -1;
    if (!dir || !(a[i] > 0)) continue;
    const entry = tf[i].c;
    const sl = entry - dir * 2 * a[i];
    // jalan maju candle per candle TF; di dalamnya cek SL pakai candle 1 jam
    let exit: Trade | null = null;
    for (let k = i + 1; k < tf.length && !exit; k++) {
      const kStart = tf[k].t;
      const kEnd = kStart + tfMs;
      while (h1p < h1.length && h1[h1p].t < kStart) h1p++;
      for (let q = h1p; q < h1.length && h1[q].t < kEnd; q++) {
        if (dir === 1 ? h1[q].l <= sl : h1[q].h >= sl) {
          exit = { sym, dir, t: T, entry, slMove: 2 * a[i] / entry, exitT: h1[q].t + H, exitPx: sl, reason: 'SL' };
          break;
        }
      }
      if (exit) break;
      if (dir === 1 ? tf[k].c < lo(k, M) : tf[k].c > hi(k, M)) exit = { sym, dir, t: T, entry, slMove: (2 * a[i]) / entry, exitT: kEnd, exitPx: tf[k].c, reason: 'CHANNEL' };
    }
    if (!exit) {
      const last = tf[tf.length - 1];
      exit = { sym, dir, t: T, entry, slMove: (2 * a[i]) / entry, exitT: last.t + tfMs, exitPx: last.c, reason: 'END' };
    }
    h1p = 0;
    out.push(exit);
    busyUntil = exit.exitT;
  }
  return out;
}

function portfolio(trades: Trade[], start: number, end: number, maxOpen = 5, riskPct = 0.7) {
  trades = [...trades].sort((x, y) => x.t - y.t);
  let bal = 100, peak = 100, maxDD = 0;
  const open: (Trade & { notional: number })[] = [];
  const done: (Trade & { notional: number; pnl: number; balAfter: number })[] = [];
  const net = (x: Trade) => (x.dir * (x.exitPx - x.entry)) / x.entry - FEE - FEE * (x.exitPx / x.entry);
  const closeUntil = (t: number) => {
    open.sort((x, y) => x.exitT - y.exitT);
    while (open.length && open[0].exitT <= t) {
      const p = open.shift()!;
      const exitT = Math.min(p.exitT, end);
      const pnl = p.notional * net(p);
      bal += pnl;
      peak = Math.max(peak, bal);
      maxDD = Math.max(maxDD, (peak - bal) / peak);
      done.push({ ...p, exitT, pnl, balAfter: bal });
    }
  };
  for (const tr of trades) {
    if (tr.t < start || tr.t >= end) continue;
    closeUntil(tr.t);
    if (open.length >= maxOpen || open.some((o) => o.sym === tr.sym)) continue;
    open.push({ ...tr, notional: (bal * riskPct) / 100 / tr.slMove });
  }
  closeUntil(Infinity);
  return { done, ret: bal - 100, maxDD: maxDD * 100 };
}

// ---------------- #2 Momentum harian ----------------
/**
 * Tiap close harian (00:00 UTC): return L hari > 0 → long, < 0 → short. Posisi cuma diganti kalau arah berbalik.
 * Ukuran: qty = saldo × 0,1% / volatilitas harian 20 hari koin itu (tiap koin ±0,1% saldo per hari).
 * PnL ditandai harian (close ke close), fee 0,05% tiap buka & tutup. Funding tidak dihitung.
 * longOnly = pembanding "long semua koin terus".
 */
function tsmom(daily: Record<string, Candle[]>, L: number, start: number, end: number, longOnly = false) {
  let bal = 100, peak = 100, maxDD = 0, flips = 0;
  const pos: Record<string, { dir: Dir; qty: number } | undefined> = {};
  const idx: Record<string, Map<number, number>> = {};
  for (const s of COINS) idx[s] = new Map(daily[s].map((c, i) => [c.t, i]));
  const monthly: Record<string, number> = {};
  let monthStartBal = 100, curMonth = '';
  for (let d = start - DAY; d < end; d += DAY) {
    // d = awal hari; close hari d terjadi di d + DAY
    for (const s of COINS) {
      const i = idx[s].get(d);
      if (i === undefined || i < 1) continue;
      const c = daily[s];
      const p = pos[s];
      if (p && d >= start) bal += p.qty * p.dir * (c[i].c - c[i - 1].c);
    }
    if (d + DAY >= end) break;
    for (const s of COINS) {
      const i = idx[s].get(d);
      if (i === undefined || i < Math.max(L, 21)) continue;
      const c = daily[s];
      const r = c[i].c / c[i - L].c - 1;
      const want: Dir | 0 = longOnly ? 1 : r > 0 ? 1 : r < 0 ? -1 : 0;
      const p = pos[s];
      if (p && p.dir === want) continue;
      if (p) {
        bal -= FEE * p.qty * c[i].c;
        pos[s] = undefined;
      }
      if (!want || d + DAY < start) continue;
      const rets = [];
      for (let k = i - 19; k <= i; k++) rets.push(c[k].c / c[k - 1].c - 1);
      const mean = rets.reduce((x, y) => x + y, 0) / rets.length;
      const vol = Math.sqrt(rets.reduce((x, y) => x + (y - mean) ** 2, 0) / rets.length);
      if (!(vol > 0)) continue;
      const qty = (bal * 0.001) / vol / c[i].c;
      bal -= FEE * qty * c[i].c;
      pos[s] = { dir: want, qty };
      flips++;
    }
    if (d + DAY >= start) {
      peak = Math.max(peak, bal);
      maxDD = Math.max(maxDD, (peak - bal) / peak);
      const m = new Date(d + DAY).toISOString().slice(0, 7);
      if (m !== curMonth) {
        if (curMonth) monthly[curMonth] = +((bal / monthStartBal - 1) * 100).toFixed(1);
        curMonth = m;
        monthStartBal = bal;
      }
    }
  }
  // tutup semua di akhir periode
  for (const s of COINS) {
    const p = pos[s];
    if (!p) continue;
    const i = idx[s].get(end - DAY);
    if (i !== undefined) bal -= FEE * p.qty * daily[s][i].c;
  }
  if (curMonth) monthly[curMonth] = +((bal / monthStartBal - 1) * 100).toFixed(1);
  return { ret: bal - 100, maxDD: maxDD * 100, flips, monthly };
}

// ---------------- jalankan ----------------
type Row = { name: string; per: Record<string, string> };
const rows: Row[] = [];
const put = (name: string, period: string, text: string) => {
  let r = rows.find((x) => x.name === name);
  if (!r) rows.push((r = { name, per: {} }));
  r.per[period] = text;
};

for (const [pk, P] of Object.entries(PERIODS)) {
  const trade = P.months.slice(2);
  const start = Date.UTC(+trade[0].slice(0, 4), +trade[0].slice(5, 7) - 1, 1);
  const lm = trade[trade.length - 1];
  const end = Date.UTC(+lm.slice(0, 4), +lm.slice(5, 7), 1);
  console.log(`\n##### ${P.label}`);
  const h1: Record<string, Candle[]> = {}, h4: Record<string, Candle[]> = {}, d1: Record<string, Candle[]> = {};
  for (const s of COINS) {
    h1[s] = loadCsv(s, '1h', P.months);
    h4[s] = loadCsv(s, '4h', P.months);
    d1[s] = toDaily(h1[s]);
  }
  const fmt = (r: { ret: number; maxDD: number }, extra = '') => `${r.ret >= 0 ? '+' : ''}${r.ret.toFixed(1)}% (DD ${r.maxDD.toFixed(0)}%${extra})`;
  const don = (name: string, mk: (s: string) => Trade[]) => {
    const all = COINS.flatMap(mk);
    const r = portfolio(all, start, end);
    const wins = r.done.filter((x) => x.pnl > 0).length;
    const best = Math.max(...r.done.map((x) => (x.dir * (x.exitPx - x.entry)) / x.entry / x.slMove));
    console.log(`${name.padEnd(46)} n=${String(r.done.length).padStart(3)} wr=${((wins / Math.max(1, r.done.length)) * 100).toFixed(0)}% ret=${r.ret.toFixed(1)}% dd=${r.maxDD.toFixed(1)}% trade terbaik=${best.toFixed(1)}R`);
    put(name, pk, fmt(r, `, ${r.done.length} trade, WR ${((wins / Math.max(1, r.done.length)) * 100).toFixed(0)}%`));
  };
  don('1a Donchian harian 20/10', (s) => donchianTrades(s, d1[s], DAY, h1[s], 20, 10, start, end));
  don('1b Donchian harian 55/20', (s) => donchianTrades(s, d1[s], DAY, h1[s], 55, 20, start, end));
  don('1c Donchian 4H 55/20', (s) => donchianTrades(s, h4[s], 4 * H, h1[s], 55, 20, start, end));
  // pembanding: entry acak (arah acak, ±1 entry per 10 hari per koin), keluar pakai aturan 1a
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  don('R  Acak, keluar seperti 1a (SL 2×ATR, 10 hari)', (s) => donchianTrades(s, d1[s], DAY, h1[s], 20, 10, start, end, () => (rnd() < 0.1 ? (rnd() < 0.5 ? 1 : -1) : null)));

  for (const L of [7, 14, 30]) {
    const r = tsmom(d1, L, start, end);
    console.log(`2  Momentum ${L} hari`.padEnd(47), `ret=${r.ret.toFixed(1)}% dd=${r.maxDD.toFixed(1)}% ganti arah=${r.flips}`, JSON.stringify(r.monthly));
    put(`2 Momentum ${L} hari`, pk, fmt(r, `, ${r.flips}× ganti arah`));
  }
  const lo = tsmom(d1, 7, start, end, true);
  console.log('P  Long semua koin terus (ukuran sama)'.padEnd(47), `ret=${lo.ret.toFixed(1)}% dd=${lo.maxDD.toFixed(1)}%`);
  put('P Long semua koin terus (ukuran sama dgn #2)', pk, fmt(lo));
  const b = d1.BTCUSDT;
  const b0 = b.find((c) => c.t === start - DAY)!.c, b1 = b.find((c) => c.t === end - DAY)!.c;
  console.log(`P  Buy & hold BTC (1×)`.padEnd(47), `ret=${((b1 / b0 - 1) * 100).toFixed(1)}%`);
  put('P Buy & hold BTC (1×)', pk, `${b1 >= b0 ? '+' : ''}${((b1 / b0 - 1) * 100).toFixed(1)}%`);
}

console.log('\n| Strategi | ' + Object.values(PERIODS).map((p) => p.label).join(' | ') + ' |');
console.log('|---|' + Object.keys(PERIODS).map(() => '---:').join('|') + '|');
for (const r of rows) console.log(`| ${r.name} | ${Object.keys(PERIODS).map((k) => r.per[k] ?? '').join(' | ')} |`);
