// Mesin winrate: cari kapan setup yang sama pernah muncul di data historis Binance,
// lalu cek mana yang kena TP duluan dan mana yang kena SL duluan.
// TP & SL kena di candle yang sama = dihitung KALAH (konservatif).
import { INTERVAL_MS, type Interval } from './binance';
import { moves } from './sim';
import {
  SETUP_INFO,
  TFS,
  atrPass,
  evalTF,
  filterPass,
  setupHolds,
  type Dir,
  type FilterKey,
  type Series,
  type SetupKey,
  type TF,
  type TFState,
} from './signals';

export type Signal = {
  i: number; // index pada grid series
  t: number; // waktu close candle sinyal
  dir: Dir;
  entry: number;
  atrPct: number;
  f: { volume: boolean; ema200: boolean; bollinger: boolean };
};

export type SymbolSeries = Partial<Record<TF, Series>>;

/** Index candle HTF terakhir yang sudah close pada waktu `time`. Pointer maju (O(n)). */
function makeAligner(s: Series) {
  let p = 0;
  const ms = INTERVAL_MS[s.tf as Interval];
  return (time: number) => {
    const c = s.candles;
    while (p + 1 < c.length && c[p + 1].t + ms <= time) p++;
    return c[p] && c[p].t + ms <= time ? p : -1;
  };
}

const sigCache = new WeakMap<Series, Map<SetupKey, Signal[]>>();

/** Semua kemunculan (onset) setup di histori satu koin. */
export function findSignals(ss: SymbolSeries, key: SetupKey, now = Date.now()): Signal[] {
  const info = SETUP_INFO[key];
  const grid = ss[info.grid];
  if (!grid) return [];
  for (const tf of info.tfs) if (!ss[tf]) return [];
  let m = sigCache.get(grid);
  if (!m) sigCache.set(grid, (m = new Map()));
  const cached = m.get(key);
  if (cached) return cached;

  const gridMs = INTERVAL_MS[info.grid as Interval];
  const aligners = Object.fromEntries(info.tfs.filter((tf) => tf !== info.grid).map((tf) => [tf, makeAligner(ss[tf]!)])) as Partial<Record<TF, (t: number) => number>>;
  const out: Signal[] = [];
  let prevDir: Dir | null = null;
  const n = grid.candles.length;
  for (let i = 1; i < n; i++) {
    const closeT = grid.candles[i].t + gridMs;
    if (closeT > now) break; // candle masih berjalan
    const st: Partial<Record<TF, TFState | null>> = {};
    st[info.grid] = evalTF(grid, i);
    for (const tf of info.tfs) {
      if (tf === info.grid) continue;
      const idx = aligners[tf]!(closeT);
      st[tf] = idx >= 0 ? evalTF(ss[tf]!, idx) : null;
    }
    const dir = setupHolds(key, st);
    if (dir && dir !== prevDir) {
      const g = st[info.grid]!;
      out.push({
        i,
        t: closeT,
        dir,
        entry: grid.candles[i].c,
        atrPct: g.v.atrPct,
        f: { volume: filterPass('volume', g, dir), ema200: filterPass('ema200', g, dir), bollinger: filterPass('bollinger', g, dir) },
      });
    }
    prevDir = dir;
  }
  m.set(key, out);
  return out;
}

export type Outcome = 'WIN' | 'LOSS' | 'OPEN';

export function resolve(grid: Series, sig: Signal, leverage: number): Outcome {
  const m = moves(leverage);
  const tp = sig.dir === 'LONG' ? sig.entry * (1 + m.tp) : sig.entry * (1 - m.tp);
  const sl = sig.dir === 'LONG' ? sig.entry * (1 - m.sl) : sig.entry * (1 + m.sl);
  const c = grid.candles;
  const now = Date.now();
  const ms = INTERVAL_MS[grid.tf as Interval];
  for (let j = sig.i + 1; j < c.length; j++) {
    if (c[j].t + ms > now) break;
    const hitTp = sig.dir === 'LONG' ? c[j].h >= tp : c[j].l <= tp;
    const hitSl = sig.dir === 'LONG' ? c[j].l <= sl : c[j].h >= sl;
    if (hitSl) return 'LOSS';
    if (hitTp) return 'WIN';
  }
  return 'OPEN';
}

export type ActiveFilters = Partial<Record<FilterKey, boolean>>;

export function passesFilters(sig: Signal, filters: ActiveFilters, leverage: number) {
  if (filters.volume && !sig.f.volume) return false;
  if (filters.ema200 && !sig.f.ema200) return false;
  if (filters.bollinger && !sig.f.bollinger) return false;
  if (filters.atr && !atrPass(sig.atrPct, moves(leverage).sl * 100)) return false;
  return true;
}

export type Tally = { wins: number; n: number };

const tallyCache = new WeakMap<SymbolSeries, Map<string, Tally>>();

export function tally(ss: SymbolSeries, key: SetupKey, dir: Dir, leverage: number, filters: ActiveFilters): Tally {
  const grid = ss[SETUP_INFO[key].grid];
  if (!grid) return { wins: 0, n: 0 };
  const ck = `${key}|${dir}|${leverage}|${['volume', 'ema200', 'bollinger', 'atr'].filter((f) => filters[f as FilterKey]).join(',')}`;
  let cache = tallyCache.get(ss);
  if (!cache) tallyCache.set(ss, (cache = new Map()));
  const hitC = cache.get(ck);
  if (hitC) return hitC;
  let wins = 0;
  let n = 0;
  for (const s of findSignals(ss, key)) {
    if (s.dir !== dir || !passesFilters(s, filters, leverage)) continue;
    const o = resolve(grid, s, leverage);
    if (o === 'OPEN') continue;
    n++;
    if (o === 'WIN') wins++;
  }
  const res = { wins, n };
  cache.set(ck, res);
  return res;
}

export const MIN_SAMPLE = 20;

export type Winrate = {
  pct: number | null; // estimasi gabungan (opsi C)
  coin: Tally;
  pool: Tally;
  method: 'koin' | 'campuran' | 'gabungan' | 'kosong';
  periodDays: number;
};

/** Opsi C: angka per koin kalau sampel ≥ 20, kalau kurang ditarik ke rata-rata gabungan 40 koin. */
export function combine(coin: Tally, pool: Tally, periodDays: number): Winrate {
  const pPool = pool.n ? pool.wins / pool.n : null;
  if (coin.n >= MIN_SAMPLE) return { pct: (coin.wins / coin.n) * 100, coin, pool, method: 'koin', periodDays };
  if (pPool === null) return { pct: coin.n ? (coin.wins / coin.n) * 100 : null, coin, pool, method: coin.n ? 'koin' : 'kosong', periodDays };
  const pct = ((coin.wins + MIN_SAMPLE * pPool) / (coin.n + MIN_SAMPLE)) * 100;
  return { pct, coin, pool, method: coin.n ? 'campuran' : 'gabungan', periodDays };
}

export function winrate(all: Record<string, SymbolSeries>, symbol: string, key: SetupKey, dir: Dir, leverage: number, filters: ActiveFilters): Winrate {
  const coin = all[symbol] ? tally(all[symbol], key, dir, leverage, filters) : { wins: 0, n: 0 };
  const pool = { wins: 0, n: 0 };
  for (const sym of Object.keys(all)) {
    const t = tally(all[sym], key, dir, leverage, filters);
    pool.wins += t.wins;
    pool.n += t.n;
  }
  const grid = all[symbol]?.[SETUP_INFO[key].grid];
  const days = grid && grid.candles.length ? (Date.now() - grid.candles[0].t) / 86_400_000 : 0;
  return combine(coin, pool, Math.round(days));
}

/** Perbandingan winrate dengan / tanpa tiap filter (yang bisa di-backtest). */
export function filterComparison(all: Record<string, SymbolSeries>, symbol: string, key: SetupKey, dir: Dir, leverage: number) {
  const base = winrate(all, symbol, key, dir, leverage, {});
  const rows = (['volume', 'ema200', 'bollinger', 'atr'] as FilterKey[]).map((f) => ({
    filter: f,
    with: winrate(all, symbol, key, dir, leverage, { [f]: true }),
  }));
  return { base, rows };
}

export { TFS };
