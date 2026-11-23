// Simulasi portfolio 6 bulan (Mei–Okt 2026) pakai data historis Binance Futures (data.binance.vision).
// 1) bash scripts/backtest/download.sh   (± 270 MB zip → CSV di scripts/backtest/data, tidak di-commit)
// 2) npx vite-node scripts/backtest/sim6m.ts
// Semua strategi risiko sama per trade (0,7% saldo = margin 10% × SL 7% di app), compounding,
// maks 3 posisi, 1 posisi per koin, stop rugi harian 15%, maks 3 SL/koin/hari, filter arah BTC.
// TP/SL dicek pakai candle 1 menit; TP & SL di menit yang sama = SL (konservatif).
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSeries, evalTF, SETUP_INFO, btcTrendFrom, btcConflict, type Dir, type Series, type TF, type SetupKey } from '../../src/lib/signals';
import { findSignals, type SymbolSeries } from '../../src/lib/backtest';
import { step, type TrailState } from '../../src/lib/trailing';
import type { Candle } from '../../src/lib/binance';

const DIR = process.env.BT_DIR ?? new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const COINS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'LINKUSDT', 'AVAXUSDT', 'SUIUSDT', 'TONUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'XLMUSDT', 'HBARUSDT', 'NEARUSDT', 'UNIUSDT', 'APTUSDT'];
// BT_PERIOD=1 (default): Mei–Okt 2026 · BT_PERIOD=2: Nov 2025–Apr 2026 (periode uji ulang)
const PERIODS: Record<string, string[]> = {
  '1': ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
  '2': ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'],
};
const ALL_MONTHS = PERIODS[process.env.BT_PERIOD ?? '1'];
const TRADE_MONTHS = ALL_MONTHS.slice(2); // 2 bulan pertama = pemanasan indikator
const monthStart = (m: string) => Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1);
const START = monthStart(TRADE_MONTHS[0]);
const lastM = TRADE_MONTHS.at(-1)!;
const END = Date.UTC(+lastM.slice(0, 4), +lastM.slice(5, 7), 1); // awal bulan setelah bulan terakhir
const DAYS = (END - START) / 86_400_000;
console.log(`Periode ${TRADE_MONTHS[0]} s/d ${TRADE_MONTHS.at(-1)} (${DAYS} hari)`);
const MS = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 } as const;
const FEE = 0.0005; // taker Binance, entry & exit (sama seperti app)
const WIB = 7 * 3_600_000;
const DAY = 86_400_000;

function loadCsv(sym: string, iv: string, months: string[]): Candle[] {
  const out: Candle[] = [];
  for (const m of months) {
    const txt = readFileSync(`${DIR}/data/csv/${sym}-${iv}-${m}.csv`, 'utf8');
    for (const line of txt.split('\n')) {
      if (!line || line[0] === 'o') continue;
      const p = line.split(',');
      out.push({ t: +p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] });
    }
  }
  return out;
}

type M1 = { t: Float64Array; o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array };
function loadM1(sym: string): M1 {
  const cs = loadCsv(sym, '1m', TRADE_MONTHS);
  const n = cs.length;
  const r: M1 = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  cs.forEach((x, i) => {
    r.t[i] = x.t; r.o[i] = x.o; r.h[i] = x.h; r.l[i] = x.l; r.c[i] = x.c;
  });
  return r;
}
const lowerBound = (a: Float64Array, x: number) => {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
};

/** index candle TF terakhir yang sudah close pada waktu `time` */
function idxAt(s: Series, time: number) {
  const ms = MS[s.tf];
  const c = s.candles;
  let lo = 0, hi = c.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].t + ms <= time) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

// ---------------- data ----------------
console.time('load');
const SS: Record<string, SymbolSeries> = {};
const M1S: Record<string, M1> = {};
for (const sym of COINS) {
  SS[sym] = { '15m': buildSeries('15m', loadCsv(sym, '15m', ALL_MONTHS)), '1h': buildSeries('1h', loadCsv(sym, '1h', ALL_MONTHS)), '4h': buildSeries('4h', loadCsv(sym, '4h', ALL_MONTHS)) };
  M1S[sym] = loadM1(sym);
}
console.timeEnd('load');

function btcTrendAt(t: number) {
  const b = SS.BTCUSDT;
  return btcTrendFrom({ '1h': evalTF(b['1h']!, idxAt(b['1h']!, t)), '4h': evalTF(b['4h']!, idxAt(b['4h']!, t)) });
}

// ---------------- trade ----------------
type Exit = { exitT: number; exitPx: number; reason: string };
type Plan = {
  sym: string; dir: Dir; t: number; tag: string; rank: number;
  sl: number; tp: number; // harga
  trail?: { lev: number; tpPct: number; trailPct: number }; // trailing ala app
  beAtR?: number; // geser SL ke entry (+fee) setelah profit N×R
  timeStopMin?: number;
  trendExit?: TF; // keluar kalau candle TF ini close melewati EMA21 berlawanan arah
  trailAtrMult?: number; // setelah 1R, SL ikut ATR (chandelier) pakai ATR grid sinyal
  atrRef?: number;
};
type Trade = Plan & { entry: number; slMove: number } & Exit;

function runTrade(p: Plan): Trade | null {
  const m = M1S[p.sym];
  let i = lowerBound(m.t, p.t);
  if (i >= m.t.length) return null;
  const entry = m.o[i];
  const long = p.dir === 'LONG';
  // jarak SL/TP (%) dihitung dari harga sinyal, lalu dipasang di harga entry sebenarnya (open menit berikutnya)
  const slMove = Math.abs(entryRef(p) - p.sl) / entryRef(p);
  const tpMove = Math.abs(p.tp - entryRef(p)) / entryRef(p);
  let sl = long ? entry * (1 - slMove) : entry * (1 + slMove);
  const sl0 = sl;
  const tp = long ? entry * (1 + tpMove) : entry * (1 - tpMove);
  const endT = p.timeStopMin ? p.t + p.timeStopMin * 60_000 : Infinity;
  const base = { ...p, entry, slMove };
  if (p.trail) {
    const lev = p.trail.lev;
    const pos = { dir: p.dir, entry, leverage: lev, tp, sl, liq: long ? entry * (1 - 1 / lev) : entry * (1 + 1 / lev), tpPct: p.trail.tpPct, trailPct: p.trail.trailPct };
    let st: TrailState = { active: false, peakRoe: 0 };
    for (; i < m.t.length; i++) {
      const r = step(pos, st, m.h[i], m.l[i]);
      if (r.exit) return { ...base, exitT: m.t[i] + 60_000, exitPx: r.exit.price, reason: r.exit.reason };
      st = r.st;
    }
    return { ...base, exitT: m.t[m.t.length - 1], exitPx: m.c[m.t.length - 1], reason: 'END' };
  }
  let be = false;
  const te = p.trendExit ? SS[p.sym][p.trendExit]! : null;
  const teMs = p.trendExit ? MS[p.trendExit] : 0;
  let best = entry;
  for (; i < m.t.length; i++) {
    if (m.t[i] >= endT) return { ...base, exitT: m.t[i], exitPx: m.o[i], reason: 'TIME' };
    if (te && m.t[i] > p.t && m.t[i] % teMs === 0) {
      const k = idxAt(te, m.t[i]);
      const cc = te.candles[k].c, e = te.ema21[k];
      if (long ? cc < e : cc > e) return { ...base, exitT: m.t[i], exitPx: m.o[i], reason: 'TREND' };
    }
    if (p.trailAtrMult && p.atrRef) {
      best = long ? Math.max(best, m.h[i]) : Math.min(best, m.l[i]);
      const moved = long ? best - entry : entry - best;
      if (moved >= slMove * entry) {
        const ns = long ? best - p.trailAtrMult * p.atrRef : best + p.trailAtrMult * p.atrRef;
        if (long ? ns > sl : ns < sl) sl = ns;
      }
    }
    const adv = long ? m.l[i] : m.h[i];
    const fav = long ? m.h[i] : m.l[i];
    if (long ? adv <= sl : adv >= sl) return { ...base, exitT: m.t[i] + 60_000, exitPx: sl, reason: be ? 'BE' : sl !== sl0 ? 'TRAIL' : 'SL' };
    if (long ? fav >= tp : fav <= tp) return { ...base, exitT: m.t[i] + 60_000, exitPx: tp, reason: 'TP' };
    if (p.beAtR && !be) {
      const trig = long ? entry * (1 + slMove * p.beAtR) : entry * (1 - slMove * p.beAtR);
      if (long ? fav >= trig : fav <= trig) { be = true; sl = long ? entry * (1 + 2 * FEE) : entry * (1 - 2 * FEE); }
    }
  }
  return { ...base, exitT: m.t[m.t.length - 1], exitPx: m.c[m.t.length - 1], reason: 'END' };
}
// harga referensi sinyal disimpan di plan lewat closure (lihat mk())
const REF = new WeakMap<Plan, number>();
const entryRef = (p: Plan) => REF.get(p)!;
function mk(p: Plan, ref: number) { REF.set(p, ref); return p; }

let FEE_IN = FEE, FEE_TP = FEE, FEE_SL = FEE;
const gross = (tr: Trade) => (tr.dir === 'LONG' ? tr.exitPx - tr.entry : tr.entry - tr.exitPx) / tr.entry;
const feeOf = (tr: Trade) => FEE_IN + (tr.reason === 'TP' ? FEE_TP : FEE_SL) * (tr.exitPx / tr.entry);
const netRet = (tr: Trade) => gross(tr) - feeOf(tr);

// ---------------- portfolio ----------------
type Cfg = { riskPct: number; maxOpen: number; dailyLossPct: number; maxSlPerCoinDay: number; btcFilter: boolean };
const DEF: Cfg = { riskPct: 0.7, maxOpen: 3, dailyLossPct: 15, maxSlPerCoinDay: 3, btcFilter: true };

type Done = Trade & { notional: number; pnl: number; balAfter: number };
function portfolio(plans: Plan[], cfg = DEF) {
  plans = [...plans].sort((a, b) => a.t - b.t || b.rank - a.rank);
  let bal = 100; // % saldo awal
  const open: (Trade & { notional: number })[] = [];
  const done: Done[] = [];
  const slCount = new Map<string, number>();
  const dayPnl = new Map<number, number>();
  const dayKey = (t: number) => Math.floor((t + WIB) / DAY);
  let peak = 100, maxDD = 0, skipped = 0;
  const closeUntil = (t: number) => {
    open.sort((a, b) => a.exitT - b.exitT);
    while (open.length && open[0].exitT <= t) {
      const p = open.shift()!;
      const pnl = p.notional * netRet(p);
      bal += pnl;
      peak = Math.max(peak, bal);
      maxDD = Math.max(maxDD, (peak - bal) / peak);
      const dk = dayKey(p.exitT);
      dayPnl.set(dk, (dayPnl.get(dk) ?? 0) + pnl);
      if (p.reason === 'SL' || p.reason === 'LIQ') slCount.set(`${p.sym}|${dk}`, (slCount.get(`${p.sym}|${dk}`) ?? 0) + 1);
      done.push({ ...p, pnl, balAfter: bal });
    }
  };
  for (const pl of plans) {
    if (pl.t < START || pl.t >= END) continue;
    closeUntil(pl.t);
    if (open.length >= cfg.maxOpen || open.some((o) => o.sym === pl.sym)) { skipped++; continue; }
    const dk = dayKey(pl.t);
    if ((slCount.get(`${pl.sym}|${dk}`) ?? 0) >= cfg.maxSlPerCoinDay) { skipped++; continue; }
    if (cfg.btcFilter && pl.sym !== 'BTCUSDT' && btcConflict(btcTrendAt(pl.t), pl.dir)) { skipped++; continue; }
    const tr = runTrade(pl);
    if (!tr || tr.slMove <= 0) continue;
    const notional = (bal * cfg.riskPct) / 100 / tr.slMove;
    const risk = (o: { notional: number; slMove: number }) => -o.notional * (o.slMove + 2 * FEE);
    const dayStart = bal - (dayPnl.get(dk) ?? 0);
    const openRisk = open.reduce((s, o) => s + risk(o), 0);
    if ((dayPnl.get(dk) ?? 0) + openRisk + risk({ notional, slMove: tr.slMove }) < (-cfg.dailyLossPct / 100) * dayStart) { skipped++; continue; }
    open.push({ ...tr, notional });
  }
  closeUntil(Infinity);
  return { done, bal, maxDD, skipped };
}

function stats(name: string, r: ReturnType<typeof portfolio>) {
  const d = r.done;
  const wins = d.filter((x) => x.pnl > 0);
  const losses = d.filter((x) => x.pnl <= 0);
  const gw = wins.reduce((s, x) => s + x.pnl, 0);
  const gl = -losses.reduce((s, x) => s + x.pnl, 0);
  const fees = d.reduce((s, x) => s + x.notional * feeOf(x), 0);
  const gW = d.reduce((s, x) => s + Math.max(0, x.notional * gross(x)), 0), gL = -d.reduce((s, x) => s + Math.min(0, x.notional * gross(x)), 0);
  const avgR = d.reduce((s, x) => s + gross(x) / x.slMove, 0) / Math.max(1, d.length);
  const avgFeeR = d.reduce((s, x) => s + feeOf(x) / x.slMove, 0) / Math.max(1, d.length);
  const holdH = d.reduce((s, x) => s + (x.exitT - x.t), 0) / Math.max(1, d.length) / 3_600_000;
  const byMonth: Record<string, number> = {};
  let balPrev = 100;
  for (const m of TRADE_MONTHS) {
    const last = d.filter((x) => new Date(x.exitT).toISOString().slice(0, 7) === m).at(-1);
    const b = last ? last.balAfter : balPrev;
    byMonth[m] = (b / balPrev - 1) * 100;
    balPrev = b;
  }
  const reasons: Record<string, number> = {};
  for (const x of d) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
  // hasil per kondisi tren BTC (1H + 4H) saat entry, dalam R bersih (1R = risiko 1 trade)
  const regime: Record<string, { n: number; R: number }> = {};
  for (const x of d) {
    const k = btcTrendAt(x.t);
    regime[k] ??= { n: 0, R: 0 };
    regime[k].n++;
    regime[k].R += netRet(x) / x.slMove;
  }
  for (const k of Object.keys(regime)) regime[k].R = +regime[k].R.toFixed(1);
  const avgSl = (d.reduce((s, x) => s + x.slMove, 0) / Math.max(1, d.length)) * 100;
  return {
    name,
    trades: d.length,
    perDay: +(d.length / DAYS).toFixed(2),
    winrate: +((wins.length / Math.max(1, d.length)) * 100).toFixed(1),
    pf: +(gl ? gw / gl : 0).toFixed(2),
    pfGross: +(gL ? gW / gL : 0).toFixed(2),
    avgR: +avgR.toFixed(3),
    feeR: +avgFeeR.toFixed(3),
    ret: +(r.bal - 100).toFixed(1),
    maxDD: +(r.maxDD * 100).toFixed(1),
    feesPct: +fees.toFixed(1),
    avgSlPct: +avgSl.toFixed(2),
    holdH: +holdH.toFixed(1),
    byMonth: Object.fromEntries(Object.entries(byMonth).map(([k, v]) => [k, +v.toFixed(1)])),
    reasons,
    skipped: r.skipped,
    regime,
  };
}

// ================= STRATEGI =================
const sig = (sym: string, key: SetupKey) => findSignals(SS[sym], key, END + 30 * DAY);

// A. Auto app sekarang: Golden/3TF/1H+15M/4H+1H, 10×, TP 14% SL 7% margin, trailing 4%.
function planA(keys: SetupKey[], trail = true, lev = 10, tpPct = 14, slPct = 7): Plan[] {
  const out: Plan[] = [];
  for (const sym of COINS)
    for (const key of keys)
      for (const s of sig(sym, key)) {
        const tpM = tpPct / 100 / lev, slM = slPct / 100 / lev;
        const L = s.dir === 'LONG';
        out.push(mk({ sym, dir: s.dir, t: s.t, tag: key, rank: SETUP_INFO[key].rank, sl: L ? s.entry * (1 - slM) : s.entry * (1 + slM), tp: L ? s.entry * (1 + tpM) : s.entry * (1 - tpM), trail: trail ? { lev, tpPct, trailPct: 4 } : undefined }, s.entry));
      }
  // satu sinyal per koin per waktu (ambil grup tertinggi)
  const seen = new Map<string, Plan>();
  for (const p of out) { const k = `${p.sym}|${p.t}`; const q = seen.get(k); if (!q || p.rank > q.rank) seen.set(k, p); }
  return [...seen.values()];
}

// ATR-based TP/SL untuk swing
function planATR(key: SetupKey, slAtr: number, rr: number, opts: { beAtR?: number; timeStopMin?: number } = {}): Plan[] {
  const out: Plan[] = [];
  for (const sym of COINS) {
    const g = SS[sym][SETUP_INFO[key].grid]!;
    for (const s of sig(sym, key)) {
      const a = g.atr[s.i];
      if (!(a > 0)) continue;
      const d = a * slAtr;
      const L = s.dir === 'LONG';
      out.push(mk({ sym, dir: s.dir, t: s.t, tag: key, rank: 1, sl: L ? s.entry - d : s.entry + d, tp: L ? s.entry + d * rr : s.entry - d * rr, ...opts }, s.entry));
    }
  }
  return out;
}

// D. Scalping 15m dengan arah dari 4H + 1H (pullback lalu lanjut tren)
type ScalpOpt = { trendExit?: TF; volMin?: number; strict4h?: boolean; trailAtrMult?: number; rr: number; beAtR?: number; timeStopMin?: number; lookback?: number; adx1h?: number; maxSlAtr?: number; minSlPct?: number };
function planScalp(o: ScalpOpt): Plan[] {
  const out: Plan[] = [];
  const LB = o.lookback ?? 8;
  for (const sym of COINS) {
    const s15 = SS[sym]['15m']!, s1 = SS[sym]['1h']!, s4 = SS[sym]['4h']!;
    const c = s15.candles;
    let cool = -1;
    for (let i = 210; i < c.length; i++) {
      const T = c[i].t + MS['15m'];
      if (T < START || T >= END) continue;
      if (i <= cool) continue;
      const h4 = evalTF(s4, idxAt(s4, T));
      const h1 = evalTF(s1, idxAt(s1, T));
      if (!h4 || !h1 || !h4.dir || h4.dir !== h1.dir) continue;
      if (h1.v.adx < (o.adx1h ?? 20)) continue;
      if (o.strict4h && !h4.qualifies) continue;
      const dir = h1.dir;
      const L = dir === 'LONG';
      // 1H harga di sisi tren
      if (L ? h1.v.close < h1.v.ema21 : h1.v.close > h1.v.ema21) continue;
      const e9 = s15.ema9, e21 = s15.ema21, rs = s15.rsi, hist = s15.macdHist, at = s15.atr[i];
      if (!(at > 0)) continue;
      // pullback: dalam LB candle terakhir ada yang menyentuh EMA21 15m
      let touched = false;
      for (let j = i - LB; j < i; j++) if (L ? c[j].l <= e21[j] : c[j].h >= e21[j]) touched = true;
      if (!touched) continue;
      // trigger: close tembus high/low candle sebelumnya, di atas EMA9 & EMA21, RSI 50–70 (short 30–50), MACD hist membaik
      const trig = L
        ? c[i].c > c[i - 1].h && c[i].c > e9[i] && c[i].c > e21[i] && rs[i] >= 50 && rs[i] <= 70 && hist[i] > hist[i - 1]
        : c[i].c < c[i - 1].l && c[i].c < e9[i] && c[i].c < e21[i] && rs[i] <= 50 && rs[i] >= 30 && hist[i] < hist[i - 1];
      if (!trig) continue;
      if (o.volMin && !(s15.volRatio[i] >= o.volMin)) continue;
      // SL di bawah swing low pullback (− 0,2 ATR)
      let ext = L ? Infinity : -Infinity;
      for (let j = i - LB; j <= i; j++) ext = L ? Math.min(ext, c[j].l) : Math.max(ext, c[j].h);
      const entry = c[i].c;
      let dist = Math.abs(entry - ext) + 0.2 * at;
      dist = Math.max(dist, 0.5 * at, ((o.minSlPct ?? 0.3) / 100) * entry);
      if (dist > (o.maxSlAtr ?? 2.5) * at) continue; // terlalu jauh, lewati
      out.push(mk({ sym, dir, t: T, tag: 'SCALP', rank: 1, sl: L ? entry - dist : entry + dist, tp: L ? entry + dist * o.rr : entry - dist * o.rr, beAtR: o.beAtR, timeStopMin: o.timeStopMin, trendExit: o.trendExit, trailAtrMult: o.trailAtrMult, atrRef: s1.atr[idxAt(s1, T)] }, entry));
      cool = i + 4;
    }
  }
  return out;
}

const results: ReturnType<typeof stats>[] = [];
const extra: Record<string, unknown> = {};
const run = (name: string, plans: Plan[], cfg = DEF) => {
  const r = portfolio(plans, cfg);
  const s = stats(name, r);
  results.push(s);
  console.log(`${name.padEnd(58)} n=${String(s.trades).padStart(4)} wr=${String(s.winrate).padStart(5)}% pf=${String(s.pf).padStart(4)} ret=${String(s.ret).padStart(7)}% pfGross=${s.pfGross} R/trade=${s.avgR} feeR=${s.feeR} dd=${String(s.maxDD).padStart(5)}% fee=${s.feesPct}% sl=${s.avgSlPct}% hold=${s.holdH}h`);
  return r;
};

console.log('\n=== A. Auto app sekarang (grid 15m) ===');
const rA = run('A  Auto sekarang (Golden/3TF/1H+15M/4H+1H) 10x 14/7 trail4', planA(['GOLD', '3TF', '15M1H', '1H4H']));
run('A2 Sama, tanpa trailing', planA(['GOLD', '3TF', '15M1H', '1H4H'], false));
run('A3 Cuma Golden + 3TF (15m, searah 1H&4H)', planA(['GOLD', '3TF']));
run('A4 Cuma 1H+15M', planA(['15M1H']));
// breakdown per setup (standalone, tanpa batas posisi)
for (const k of ['GOLD', '3TF', '15M1H', '1H4H'] as SetupKey[]) run(`   [solo] ${k}`, planA([k]), { ...DEF, maxOpen: 99 });

console.log('\n=== B. Swing 1H (4H+1H searah, entry candle 1H close) ===');
run('B0 4H+1H, TP/SL app 14/7 @10x (1,4%/0,7%) trail', planA(['1H4H']));
run('B1 4H+1H, SL 1,5×ATR1h, TP 2R', planATR('1H4H', 1.5, 2));
run('B2 4H+1H, SL 1,5×ATR1h, TP 3R', planATR('1H4H', 1.5, 3));
run('B3 4H+1H, SL 2×ATR1h, TP 2R', planATR('1H4H', 2, 2));
run('B4 4H+1H, SL 1,5×ATR1h, TP 2R, BE @1R', planATR('1H4H', 1.5, 2, { beAtR: 1 }));

console.log('\n=== C. Swing 4H (4H qualify penuh, entry candle 4H close) ===');
run('C1 4H, SL 1,5×ATR4h, TP 2R', planATR('S4H', 1.5, 2));
run('C2 4H, SL 1,5×ATR4h, TP 3R', planATR('S4H', 1.5, 3));
run('C3 4H, SL 1×ATR4h, TP 2R', planATR('S4H', 1, 2));

console.log('\n=== D. Scalping 15m, arah dari 4H+1H (pullback → lanjut) ===');
run('D1 TP 1,5R', planScalp({ rr: 1.5 }));
run('D2 TP 2R', planScalp({ rr: 2 }));
run('D3 TP 1,5R, time stop 6 jam', planScalp({ rr: 1.5, timeStopMin: 360 }));
run('D4 TP 2R, BE @1R, time stop 6 jam', planScalp({ rr: 2, beAtR: 1, timeStopMin: 360 }));
run('D5 TP 1,5R, ADX1h≥25, time stop 6 jam', planScalp({ rr: 1.5, adx1h: 25, timeStopMin: 360 }));
run('D6 TP 2R, ADX1h≥25, time stop 6 jam', planScalp({ rr: 2, adx1h: 25, timeStopMin: 360 }));
run('D7 TP 1,5R, tanpa filter BTC, time stop 6 jam', planScalp({ rr: 1.5, timeStopMin: 360 }), { ...DEF, btcFilter: false });

console.log('\n=== R. Pembanding: entry ACAK di 15m (arah acak), TP 1,4% SL 0,7% ===');
function planRandom(seed: number, every: number): Plan[] {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out: Plan[] = [];
  for (const sym of COINS) {
    const c = SS[sym]['15m']!.candles;
    for (let i = 300; i < c.length; i++) {
      if (rnd() > 1 / every) continue;
      const T = c[i].t + MS['15m'];
      const dir: Dir = rnd() < 0.5 ? 'LONG' : 'SHORT';
      const L = dir === 'LONG', e = c[i].c;
      out.push(mk({ sym, dir, t: T, tag: 'RND', rank: 1, sl: L ? e * 0.993 : e * 1.007, tp: L ? e * 1.014 : e * 0.986 }, e));
    }
  }
  return out;
}
run('R1 Acak (koin & arah acak), TP 1,4% SL 0,7%', planRandom(7, 60), { ...DEF, btcFilter: false });
run('R2 Acak, seed lain', planRandom(99, 60), { ...DEF, btcFilter: false });
run('R3 Acak tapi searah tren 4H+1H (filter BTC)', planRandom(7, 60).filter((p) => { const s = SS[p.sym]; const h4 = evalTF(s['4h']!, idxAt(s['4h']!, p.t)); const h1 = evalTF(s['1h']!, idxAt(s['1h']!, p.t)); return h4?.dir === p.dir && h1?.dir === p.dir; }));

console.log('\n=== E. 15m tapi fee lebih murah (limit/maker: entry 0,02%, TP 0,02%, SL taker 0,05%) ===');
FEE_IN = 0.0002; FEE_TP = 0.0002; FEE_SL = 0.0005;
run('E1 = A (auto sekarang) dengan fee maker', planA(['GOLD', '3TF', '15M1H', '1H4H']));
run('E2 = D1 scalp pullback TP 1,5R dengan fee maker', planScalp({ rr: 1.5 }));
run('E3 = D2 scalp pullback TP 2R dengan fee maker', planScalp({ rr: 2 }));
run('E4 = C2 swing 4H 3R dengan fee maker', planATR('S4H', 1.5, 3));
run('E5 = B3 swing 1H 2×ATR 2R dengan fee maker', planATR('1H4H', 2, 2));
FEE_IN = FEE; FEE_TP = FEE; FEE_SL = FEE;

console.log('\n=== F. 15m entry, SL/TP lebih lebar (ATR 15m) ===');
run('F1 sinyal 15m app (Golden/3TF/1H+15M), SL 2×ATR15m, TP 2R', [...planATR('GOLD', 2, 2), ...planATR('3TF', 2, 2), ...planATR('15M1H', 2, 2)]);
run('F2 sinyal 15m app, SL 3×ATR15m, TP 2R', [...planATR('GOLD', 3, 2), ...planATR('3TF', 3, 2), ...planATR('15M1H', 3, 2)]);
run('F3 scalp pullback, SL min 0,6%, TP 2R', planScalp({ rr: 2, minSlPct: 0.6 }));

console.log('\n=== G. Entry 15m, target ikut tren 1H/4H ("sniper entry, swing exit") ===');
run('G1 scalp pullback, TP 3R', planScalp({ rr: 3 }));
run('G2 scalp pullback, TP 4R', planScalp({ rr: 4 }));
run('G3 scalp pullback, tanpa TP, keluar saat 1H close lewat EMA21', planScalp({ rr: 50, trendExit: '1h' }));
run('G4 scalp pullback, TP 4R + keluar saat 1H lewat EMA21', planScalp({ rr: 4, trendExit: '1h' }));
run('G5 scalp pullback, tanpa TP, trailing 2×ATR1h setelah 1R', planScalp({ rr: 50, trailAtrMult: 2 }));
run('G6 = G3 + 4H qualify penuh', planScalp({ rr: 50, trendExit: '1h', strict4h: true }));
run('G7 = G3 + volume ≥1,5×', planScalp({ rr: 50, trendExit: '1h', volMin: 1.5 }));
run('G8 = G5 + volume ≥1,5×', planScalp({ rr: 50, trailAtrMult: 2, volMin: 1.5 }));
run('G9 = G2 (TP 4R) + volume ≥1,5×', planScalp({ rr: 4, volMin: 1.5 }));
FEE_IN = 0.0002; FEE_TP = 0.0002; FEE_SL = 0.0005;
run('G3m = G3 fee maker', planScalp({ rr: 50, trendExit: '1h' }));
run('G5m = G5 fee maker', planScalp({ rr: 50, trailAtrMult: 2 }));
run('G7m = G7 fee maker', planScalp({ rr: 50, trendExit: '1h', volMin: 1.5 }));
FEE_IN = FEE; FEE_TP = FEE; FEE_SL = FEE;

console.log('\n=== H. Uji ketahanan G7 (parameter tetangga & separuh koin) ===');
for (const v of [1.2, 1.3, 1.5, 1.7, 2.0]) run(`H vol≥${v} trendExit 1h`, planScalp({ rr: 50, trendExit: '1h', volMin: v }));
run('H vol≥1,5 lookback 6', planScalp({ rr: 50, trendExit: '1h', volMin: 1.5, lookback: 6 }));
run('H vol≥1,5 lookback 12', planScalp({ rr: 50, trendExit: '1h', volMin: 1.5, lookback: 12 }));
run('H vol≥1,5 maxOpen 5', planScalp({ rr: 50, trendExit: '1h', volMin: 1.5 }), { ...DEF, maxOpen: 5 });
const g7 = planScalp({ rr: 50, trendExit: '1h', volMin: 1.5 });
run('H koin ganjil (BTC,BNB,XRP,...)', g7.filter((p) => COINS.indexOf(p.sym) % 2 === 0));
run('H koin genap (ETH,SOL,DOGE,...)', g7.filter((p) => COINS.indexOf(p.sym) % 2 === 1));
run('H LONG saja', g7.filter((p) => p.dir === 'LONG'));
run('H SHORT saja', g7.filter((p) => p.dir === 'SHORT'));

console.log('\n=== T. Tambah filter tren 1H + 4H (arah trade harus sama dengan EMA9/21 di 1H DAN 4H) ===');
const trendOk = (p: Plan) => {
  const s = SS[p.sym];
  const h1 = evalTF(s['1h']!, idxAt(s['1h']!, p.t));
  const h4 = evalTF(s['4h']!, idxAt(s['4h']!, p.t));
  return h1?.dir === p.dir && h4?.dir === p.dir;
};
const T = (pl: Plan[]) => pl.filter(trendOk);
const show = (name: string, pl: Plan[], cfg = DEF) => {
  run(name, pl, cfg);
  const r = results.at(-1)!;
  console.log('      per tren BTC (n, R bersih):', JSON.stringify(r.regime), ' per bulan:', JSON.stringify(r.byMonth));
};
show('T-A  Auto sekarang', planA(['GOLD', '3TF', '15M1H', '1H4H']));
show('T-A+ Auto sekarang + tren 1H+4H', T(planA(['GOLD', '3TF', '15M1H', '1H4H'])));
show('T-B3 Swing 1H SL 2×ATR TP 2R (sudah 4H+1H searah)', planATR('1H4H', 2, 2));
show('T-B4 Swing 1H SL 1,5×ATR TP 2R BE 1R', planATR('1H4H', 1.5, 2, { beAtR: 1 }));
show('T-C2 Swing 4H SL 1,5×ATR TP 3R', planATR('S4H', 1.5, 3));
show('T-C2+ Swing 4H + tren 1H+4H', T(planATR('S4H', 1.5, 3)));
show('T-C1+ Swing 4H TP 2R + tren 1H+4H', T(planATR('S4H', 1.5, 2)));
show('T-D1 Scalp 15m pullback TP 1,5R (sudah 4H+1H)', planScalp({ rr: 1.5 }));
show('T-G3 Entry 15m, exit tren 1H (sudah 4H+1H)', planScalp({ rr: 50, trendExit: '1h' }));
show('T-G7 = G3 + volume ≥1,5×', planScalp({ rr: 50, trendExit: '1h', volMin: 1.5 }));
show('T-G7b = G3 + volume ≥1,7×', planScalp({ rr: 50, trendExit: '1h', volMin: 1.7 }));
show('T-G7 LONG saja', planScalp({ rr: 50, trendExit: '1h', volMin: 1.5 }).filter((p) => p.dir === 'LONG'));
show('T-R  Acak + tren 1H+4H', T(planRandom(7, 60)));
FEE_IN = 0.0002; FEE_TP = 0.0002; FEE_SL = 0.0005;
show('T-C2m Swing 4H + tren 1H+4H, fee maker', T(planATR('S4H', 1.5, 3)));
show('T-G7m G7 fee maker', planScalp({ rr: 50, trendExit: '1h', volMin: 1.5 }));
FEE_IN = FEE; FEE_TP = FEE; FEE_SL = FEE;

void rA;
writeFileSync(`${DIR}/data/results-p${process.env.BT_PERIOD ?? '1'}.json`, JSON.stringify({ results, extra }, null, 1));
console.log('\nper bulan:');
for (const r of results) console.log(r.name.padEnd(58), JSON.stringify(r.byMonth), JSON.stringify(r.reasons));
