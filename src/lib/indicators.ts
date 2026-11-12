// Indikator teknikal dengan rumus standar (sama dengan chart Binance/TradingView).
// Semua fungsi mengembalikan array sepanjang input; nilai warm-up = NaN.
import type { Candle } from './binance';

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA, di-seed dengan SMA periode pertama (seperti TradingView). */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI Wilder. */
export function rsi(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => ef[i] - es[i]);
  const firstValid = line.findIndex((x) => !Number.isNaN(x));
  const sig = new Array<number>(closes.length).fill(NaN);
  if (firstValid >= 0) {
    const s = ema(line.slice(firstValid), signal);
    for (let i = 0; i < s.length; i++) sig[firstValid + i] = s[i];
  }
  const hist = line.map((x, i) => x - sig[i]);
  return { line, signal: sig, hist };
}

/** True range + ATR Wilder. */
export function atr(c: Candle[], period = 14): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length <= period) return out;
  const tr = c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c))));
  let a = 0;
  for (let i = 1; i <= period; i++) a += tr[i];
  a /= period;
  out[period] = a;
  for (let i = period + 1; i < c.length; i++) {
    a = (a * (period - 1) + tr[i]) / period;
    out[i] = a;
  }
  return out;
}

/** ADX, +DI, −DI dengan smoothing Wilder. */
export function adx(c: Candle[], period = 14) {
  const n = c.length;
  const adxOut = new Array<number>(n).fill(NaN);
  const pdiOut = new Array<number>(n).fill(NaN);
  const mdiOut = new Array<number>(n).fill(NaN);
  if (n <= period * 2) return { adx: adxOut, pdi: pdiOut, mdi: mdiOut };
  let trS = 0;
  let pS = 0;
  let mS = 0;
  const dx: number[] = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const up = c[i].h - c[i - 1].h;
    const dn = c[i - 1].l - c[i].l;
    const pdm = up > dn && up > 0 ? up : 0;
    const mdm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    if (i <= period) {
      trS += tr;
      pS += pdm;
      mS += mdm;
    } else {
      trS = trS - trS / period + tr;
      pS = pS - pS / period + pdm;
      mS = mS - mS / period + mdm;
    }
    if (i >= period) {
      const pdi = trS ? (100 * pS) / trS : 0;
      const mdi = trS ? (100 * mS) / trS : 0;
      pdiOut[i] = pdi;
      mdiOut[i] = mdi;
      dx[i] = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
    }
  }
  let a = 0;
  for (let i = period; i < period * 2; i++) a += dx[i];
  a /= period;
  adxOut[period * 2 - 1] = a;
  for (let i = period * 2; i < n; i++) {
    a = (a * (period - 1) + dx[i]) / period;
    adxOut[i] = a;
  }
  return { adx: adxOut, pdi: pdiOut, mdi: mdiOut };
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array<number>(closes.length).fill(NaN);
  const lower = new Array<number>(closes.length).fill(NaN);
  const width = new Array<number>(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
    width[i] = mid[i] ? (upper[i] - lower[i]) / mid[i] : NaN;
  }
  return { mid, upper, lower, width };
}
