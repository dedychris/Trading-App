// Pola trade: "sidik jari" kondisi saat entry. Dipakai untuk memperingatkan pola yang
// sering kena SL dan menandai pola yang sering kena TP, dari riwayat trade lu sendiri.
import { btcConflict, RULES, SETUP_INFO, setupShort, type BtcTrend, type Dir, type SetupKey, type TF, type TFState } from './signals';
import { moves } from './sim';
import { positionLedger } from '../store/book';
import type { Book, Position } from '../store/types';

export const MIN_PATTERN_N = 3;
export type Feat = { k: string; label: string };

export function features(i: { setupKey?: SetupKey | null; dir: Dir; tf: Partial<Record<TF, TFState | null>>; btcTrend: BtcTrend | null; leverage: number; symbol?: string; slPct?: number }): Feat[] {
  const out: Feat[] = [];
  out.push(i.setupKey ? { k: `setup=${i.setupKey}`, label: setupShort(i.setupKey) } : { k: 'setup=none', label: 'tanpa sinyal' });
  out.push({ k: `dir=${i.dir}`, label: i.dir });
  if (i.btcTrend && i.symbol !== 'BTCUSDT') {
    if (btcConflict(i.btcTrend, i.dir)) out.push({ k: 'btc=lawan', label: 'lawan BTC' });
    else if (i.btcTrend === 'NETRAL') out.push({ k: 'btc=netral', label: 'BTC netral' });
    else out.push({ k: 'btc=searah', label: 'searah BTC' });
  }
  const grid = i.tf[i.setupKey ? SETUP_INFO[i.setupKey]?.grid ?? '15m' : '15m'];
  if (grid) {
    const v = grid.v;
    out.push(v.adx >= 25 ? { k: 'adx=kuat', label: 'ADX kuat' } : { k: 'adx=lemah', label: 'ADX lemah' });
    const [lo, hi] = i.dir === 'SHORT' ? RULES.rsiShort : RULES.rsiLong;
    const edge = i.dir === 'LONG' ? v.rsi > hi - 3 || v.rsi < lo : v.rsi < lo + 3 || v.rsi > hi;
    out.push(edge ? { k: 'rsi=tepi', label: 'RSI di tepi zona' } : { k: 'rsi=tengah', label: 'RSI di tengah zona' });
    if (Number.isFinite(v.volRatio)) out.push(v.volRatio >= RULES.volRatioMin ? { k: 'vol=kuat', label: 'volume kuat' } : { k: 'vol=lemah', label: 'volume lemah' });
    if (Number.isFinite(v.atrPct)) out.push(moves(i.leverage, undefined, i.slPct).sl * 100 >= v.atrPct ? { k: 'atr=ok', label: 'SL ≥ ATR' } : { k: 'atr=sempit', label: 'SL < ATR (sempit)' });
  }
  out.push(i.leverage <= 10 ? { k: 'lev=low', label: 'leverage ≤10×' } : i.leverage <= 25 ? { k: 'lev=mid', label: 'leverage 11–25×' } : { k: 'lev=high', label: 'leverage >25×' });
  return out;
}

export function positionFeatures(p: Position): Feat[] {
  const e = p.snapEntry;
  const key = e?.setup && e.setup.dir === p.dir ? (e.setup.key as SetupKey) : null;
  return features({ setupKey: key, dir: p.dir, tf: e?.tf ?? {}, btcTrend: e?.btcTrend ?? null, leverage: p.leverage, symbol: p.symbol, slPct: p.slPct });
}

/** TP = menang, SL/likuidasi = kalah, tutup manual = dilihat dari PnL bersih. */
export function isWin(book: Book, p: Position) {
  if (p.reason === 'TP' || p.reason === 'TRAIL') return true;
  if (p.reason === 'SL' || p.reason === 'LIQ') return false;
  return positionLedger(book, p.id).net > 0;
}

type Trade = { keys: Set<string>; win: boolean };
const idxCache = new WeakMap<Book, Trade[]>();
export function tradeIndex(book: Book): Trade[] {
  const hit = idxCache.get(book);
  if (hit) return hit;
  const out = Object.values(book.positions)
    .filter((p) => p.status === 'closed')
    .map((p) => ({ keys: new Set(positionFeatures(p).map((f) => f.k)), win: isWin(book, p) }));
  idxCache.set(book, out);
  return out;
}

export type PatternStat = { feats: Feat[]; wins: number; n: number; winRate: number };

function combos<T>(arr: T[], maxSize: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, cur: T[]) => {
    if (cur.length) out.push(cur);
    if (cur.length === maxSize) return;
    for (let i = start; i < arr.length; i++) rec(i + 1, [...cur, arr[i]]);
  };
  rec(0, []);
  return out;
}

function statFor(feats: Feat[], trades: Trade[]): PatternStat {
  let wins = 0;
  let n = 0;
  for (const t of trades) {
    if (feats.every((f) => t.keys.has(f.k))) {
      n++;
      if (t.win) wins++;
    }
  }
  return { feats, wins, n, winRate: n ? wins / n : 0 };
}

// lebih spesifik (banyak kondisi) & lebih banyak sampel = lebih meyakinkan
const rank = (a: PatternStat, b: PatternStat, better: (x: PatternStat) => number) =>
  better(b) - better(a) || b.feats.length - a.feats.length || b.n - a.n;

/** Cari pola SL terburuk & pola TP terbaik yang cocok dengan kondisi sinyal ini. */
export function matchPatterns(feats: Feat[], book: Book): { bad: PatternStat | null; good: PatternStat | null } {
  const trades = tradeIndex(book);
  if (trades.length < MIN_PATTERN_N) return { bad: null, good: null };
  const stats = combos(feats, 3)
    .map((c) => statFor(c, trades))
    .filter((s) => s.n >= MIN_PATTERN_N);
  const bad = stats.filter((s) => s.winRate <= 0.4).sort((a, b) => rank(a, b, (x) => 1 - x.winRate))[0] ?? null;
  const good = stats.filter((s) => s.winRate >= 0.6).sort((a, b) => rank(a, b, (x) => x.winRate))[0] ?? null;
  return { bad, good };
}

/** Semua pola dari riwayat (untuk halaman Statistik). */
export function allPatterns(book: Book) {
  const trades = tradeIndex(book);
  const closed = Object.values(book.positions).filter((p) => p.status === 'closed');
  const seen = new Map<string, Feat[]>();
  for (const p of closed) for (const c of combos(positionFeatures(p), 3)) seen.set(c.map((f) => f.k).join('&'), c);
  const stats = [...seen.values()].map((c) => statFor(c, trades)).filter((s) => s.n >= MIN_PATTERN_N);
  const best = stats.filter((s) => s.winRate >= 0.6).sort((a, b) => rank(a, b, (x) => x.winRate)).slice(0, 6);
  const worst = stats.filter((s) => s.winRate <= 0.4).sort((a, b) => rank(a, b, (x) => 1 - x.winRate)).slice(0, 6);
  return { best, worst, total: trades.length };
}

export const patternText = (s: PatternStat) => s.feats.map((f) => f.label).join(' + ');
