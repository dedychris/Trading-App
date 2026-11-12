// Logika sinyal Momentum Scanner (strategi lama: EMA9/21, RSI14, MACD, ADX14),
// dengan perbaikan: RSI SHORT 35–60, ADX & EMA rumus standar, definisi grup yang konsisten.
import type { Candle, Interval } from './binance';
import { INTERVAL_MS } from './binance';
import { adx, atr, bollinger, ema, macd, rsi, sma } from './indicators';

export type Dir = 'LONG' | 'SHORT';
export const TFS = ['15m', '1h', '4h'] as const;
export type TF = (typeof TFS)[number];

export const RULES = {
  rsiLong: [40, 65] as const,
  rsiShort: [35, 60] as const,
  adxMin: 20,
  volRatioMin: 1.2,
};

export type Series = {
  tf: TF;
  candles: Candle[];
  ema9: number[];
  ema21: number[];
  ema200: number[];
  rsi: number[];
  macdLine: number[];
  macdSig: number[];
  macdHist: number[];
  adx: number[];
  pdi: number[];
  mdi: number[];
  atr: number[];
  bbMid: number[];
  bbUpper: number[];
  bbLower: number[];
  bbWidth: number[];
  bbWidthAvg: number[];
  volRatio: number[];
};

export function buildSeries(tf: TF, candles: Candle[]): Series {
  const closes = candles.map((c) => c.c);
  const vols = candles.map((c) => c.v);
  const m = macd(closes);
  const a = adx(candles);
  const bb = bollinger(closes);
  const volAvg = sma(vols, 20);
  return {
    tf,
    candles,
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    ema200: ema(closes, 200),
    rsi: rsi(closes),
    macdLine: m.line,
    macdSig: m.signal,
    macdHist: m.hist,
    adx: a.adx,
    pdi: a.pdi,
    mdi: a.mdi,
    atr: atr(candles),
    bbMid: bb.mid,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    bbWidth: bb.width,
    bbWidthAvg: sma(bb.width.map((x) => (Number.isNaN(x) ? 0 : x)), 20),
    volRatio: vols.map((v, i) => (i > 0 && volAvg[i - 1] > 0 ? v / volAvg[i - 1] : NaN)),
  };
}

export type TFState = {
  tf: TF;
  dir: Dir | null; // arah tren EMA9 vs EMA21
  qualifies: boolean;
  checks: { ema: boolean; rsi: boolean; macd: boolean; adx: boolean };
  v: { close: number; ema9: number; ema21: number; rsi: number; macdHist: number; adx: number; pdi: number; mdi: number; atrPct: number; volRatio: number; ema200: number; bbMid: number; bbWidth: number; bbWidthAvg: number };
  closeTime: number;
};

export function evalTF(s: Series, i: number): TFState | null {
  if (i < 0 || i >= s.candles.length) return null;
  const e9 = s.ema9[i];
  const e21 = s.ema21[i];
  const r = s.rsi[i];
  const h = s.macdHist[i];
  const ad = s.adx[i];
  if ([e9, e21, r, h, ad].some((x) => Number.isNaN(x))) return null;
  const dir: Dir | null = e9 > e21 ? 'LONG' : e9 < e21 ? 'SHORT' : null;
  const [lo, hi] = dir === 'SHORT' ? RULES.rsiShort : RULES.rsiLong;
  const checks = {
    ema: dir !== null,
    rsi: r >= lo && r <= hi,
    macd: dir === 'LONG' ? h > 0 : dir === 'SHORT' ? h < 0 : false,
    adx: ad >= RULES.adxMin,
  };
  const c = s.candles[i];
  return {
    tf: s.tf,
    dir,
    qualifies: checks.ema && checks.rsi && checks.macd && checks.adx,
    checks,
    v: {
      close: c.c,
      ema9: e9,
      ema21: e21,
      rsi: r,
      macdHist: h,
      adx: ad,
      pdi: s.pdi[i],
      mdi: s.mdi[i],
      atrPct: (s.atr[i] / c.c) * 100,
      volRatio: s.volRatio[i],
      ema200: s.ema200[i],
      bbMid: s.bbMid[i],
      bbWidth: s.bbWidth[i],
      bbWidthAvg: s.bbWidthAvg[i],
    },
    closeTime: c.t + INTERVAL_MS[s.tf as Interval],
  };
}

// ---- Grup setup ----
// ⭐ Golden  = 4H, 1H, 15M semuanya QUALIFY penuh dan arahnya sama.
// Grup lain = arah tren (EMA9/21) searah di TF-TF itu, minimal satu TF qualify penuh.
export type SetupKey = 'GOLD' | '3TF' | '1H4H' | '15M1H' | '15M4H' | 'S15M' | 'S1H' | 'S4H';
export const SETUP_INFO: Record<SetupKey, { label: string; short: string; grid: TF; tfs: TF[]; rank: number; strict?: boolean }> = {
  GOLD: { label: '⭐ Golden — 4H + 1H + 15M qualify semua', short: '⭐ Golden', grid: '15m', tfs: ['15m', '1h', '4h'], rank: 9, strict: true },
  '3TF': { label: '3TF searah — 4H + 1H + 15M', short: '3TF searah', grid: '15m', tfs: ['15m', '1h', '4h'], rank: 8 },
  '1H4H': { label: '4H + 1H searah', short: '4H+1H', grid: '1h', tfs: ['1h', '4h'], rank: 7 },
  '15M1H': { label: '1H + 15M searah', short: '1H+15M', grid: '15m', tfs: ['15m', '1h'], rank: 6 },
  '15M4H': { label: '4H + 15M searah', short: '4H+15M', grid: '15m', tfs: ['15m', '4h'], rank: 5 },
  // grup lama (hanya untuk riwayat trade lama, tidak ditampilkan di scanner)
  S4H: { label: 'Hanya 4H', short: '4H', grid: '4h', tfs: ['4h'], rank: 1, strict: true },
  S1H: { label: 'Hanya 1H', short: '1H', grid: '1h', tfs: ['1h'], rank: 1, strict: true },
  S15M: { label: 'Hanya 15M', short: '15M', grid: '15m', tfs: ['15m'], rank: 1, strict: true },
};
export const SETUP_ORDER: SetupKey[] = ['GOLD', '3TF', '1H4H', '15M1H', '15M4H'];
export const setupShort = (k: string) => SETUP_INFO[k as SetupKey]?.short ?? k;

export type Setup = { key: SetupKey; dir: Dir };

/** Klasifikasi eksklusif untuk tampilan scanner (grup tertinggi yang terpenuhi). */
export function classify(st: Partial<Record<TF, TFState | null>>): Setup | null {
  for (const key of SETUP_ORDER) {
    const d = setupHolds(key, st);
    if (d) return { key, dir: d };
  }
  return null;
}

/** Apakah kondisi setup terpenuhi (non-eksklusif) — dipakai juga oleh backtest. */
export function setupHolds(key: SetupKey, st: Partial<Record<TF, TFState | null>>): Dir | null {
  const info = SETUP_INFO[key];
  let dir: Dir | null = null;
  let anyQualify = false;
  for (const tf of info.tfs) {
    const s = st[tf];
    if (!s || !s.dir) return null;
    if (dir && s.dir !== dir) return null;
    if (info.strict && !s.qualifies) return null;
    dir = s.dir;
    if (s.qualifies) anyQualify = true;
  }
  return anyQualify ? dir : null;
}

// ---- Filter tambahan ----
export type FilterKey = 'volume' | 'ema200' | 'bollinger' | 'atr' | 'sentiment';
export const FILTER_INFO: Record<FilterKey, { label: string; desc: string; backtest: boolean }> = {
  volume: { label: 'Volume Ratio', desc: `Volume candle ≥ ${RULES.volRatioMin}× rata-rata 20 candle`, backtest: true },
  ema200: { label: 'EMA200', desc: 'LONG di atas EMA200, SHORT di bawah EMA200', backtest: true },
  bollinger: { label: 'Bollinger Bands', desc: 'Harga di sisi yang benar dari middle band + band sedang melebar (lepas dari squeeze)', backtest: true },
  atr: { label: 'ATR', desc: 'Jarak SL minimal 1× ATR14, supaya tidak kena SL cuma karena goyangan biasa', backtest: true },
  sentiment: { label: 'Funding / OI / Long-Short', desc: 'LONG: funding < 0,05% & akun long < 70%. SHORT kebalikannya. Data live saja (tidak ada di backtest)', backtest: false },
};
export const FILTER_KEYS = Object.keys(FILTER_INFO) as FilterKey[];

export function filterPass(key: Exclude<FilterKey, 'sentiment' | 'atr'>, st: TFState, dir: Dir): boolean {
  const v = st.v;
  switch (key) {
    case 'volume':
      return v.volRatio >= RULES.volRatioMin;
    case 'ema200':
      if (Number.isNaN(v.ema200)) return false;
      return dir === 'LONG' ? v.close > v.ema200 : v.close < v.ema200;
    case 'bollinger':
      if (Number.isNaN(v.bbMid)) return false;
      return (dir === 'LONG' ? v.close > v.bbMid : v.close < v.bbMid) && v.bbWidth > v.bbWidthAvg;
  }
}

export function atrPass(atrPct: number, slMovePct: number) {
  return slMovePct >= atrPct;
}

export function sentimentPass(dir: Dir, fundingRate: number | null, longPct: number | null) {
  if (fundingRate === null) return false;
  if (dir === 'LONG') return fundingRate < 0.0005 && (longPct === null || longPct < 70);
  return fundingRate > -0.0005 && (longPct === null || longPct > 30);
}

/** Index candle terakhir yang sudah close (candle terakhir dari Binance masih berjalan). */
export function lastClosedIndex(s: Series, now = Date.now()): number {
  const n = s.candles.length;
  if (!n) return -1;
  const last = s.candles[n - 1];
  return last.t + INTERVAL_MS[s.tf as Interval] <= now ? n - 1 : n - 2;
}

export type BtcTrend = 'BULLISH' | 'BEARISH' | 'NETRAL';
export function btcTrendFrom(st: Partial<Record<TF, TFState | null>>): BtcTrend {
  const h1 = st['1h']?.dir;
  const h4 = st['4h']?.dir;
  if (h1 === 'LONG' && h4 === 'LONG') return 'BULLISH';
  if (h1 === 'SHORT' && h4 === 'SHORT') return 'BEARISH';
  return 'NETRAL';
}
export function btcConflict(trend: BtcTrend, dir: Dir) {
  return (trend === 'BEARISH' && dir === 'LONG') || (trend === 'BULLISH' && dir === 'SHORT');
}
