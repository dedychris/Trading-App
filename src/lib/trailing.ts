// Trailing TP: begitu profit nyentuh TP, posisi tidak ditutup. Profit TP dikunci dan
// batas keluar ikut naik: batas = maks(TP, profit tertinggi − jarak trailing). Semua % dari margin.
import type { Dir } from './signals';

export type CloseKind = 'TP' | 'TRAIL' | 'SL' | 'LIQ';
export type TrailState = { active: boolean; peakRoe: number };
export type PosLike = { dir: Dir; entry: number; leverage: number; tp: number; sl: number; liq: number; tpPct: number; trailPct: number | null };

/** Profit/rugi (% dari margin, sebelum fee) kalau harga = `price`. */
export const roeAt = (dir: Dir, entry: number, lev: number, price: number) => ((dir === 'LONG' ? price - entry : entry - price) / entry) * lev * 100;
export const priceAtRoe = (dir: Dir, entry: number, lev: number, roe: number) => entry * (1 + ((dir === 'LONG' ? 1 : -1) * roe) / 100 / lev);
export const trailStopRoe = (tpPct: number, trailPct: number, peakRoe: number) => Math.max(tpPct, peakRoe - trailPct);

/**
 * Proses satu candle (atau satu tick: high = low = harga). Urutan konservatif:
 * sisi rugi dicek dulu (pakai batas sebelum candle ini), baru puncak baru dicatat.
 */
export function step(p: PosLike, st: TrailState, high: number, low: number): { exit: { reason: CloseKind; price: number } | null; st: TrailState } {
  const long = p.dir === 'LONG';
  const adverse = long ? low : high;
  const favorable = long ? high : low;
  const crossed = (level: number) => (long ? adverse <= level : adverse >= level);
  if (st.active && p.trailPct) {
    const stop = priceAtRoe(p.dir, p.entry, p.leverage, trailStopRoe(p.tpPct, p.trailPct, st.peakRoe));
    if (crossed(stop)) return { exit: { reason: 'TRAIL', price: stop }, st };
  } else {
    if (crossed(p.liq)) return { exit: { reason: 'LIQ', price: p.liq }, st };
    if (crossed(p.sl)) return { exit: { reason: 'SL', price: p.sl }, st };
  }
  const favRoe = roeAt(p.dir, p.entry, p.leverage, favorable);
  const tpHit = long ? favorable >= p.tp : favorable <= p.tp;
  if (!p.trailPct) return tpHit ? { exit: { reason: 'TP', price: p.tp }, st } : { exit: null, st };
  if (tpHit || st.active) return { exit: null, st: { active: true, peakRoe: Math.max(st.peakRoe, favRoe) } };
  return { exit: null, st };
}
