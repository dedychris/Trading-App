// Aturan sinyal: bias tren di TF besar (EMA50/200) + pemicu di TF entry (pullback ke EMA20 atau breakout + volume).
// Semua dinilai di candle yang SUDAH close. Entry dieksekusi di harga berikutnya (open candle setelahnya / harga live).
import { MODE_TF, type BotConfig } from './config.js';
import { atr, bollinger, ema, rsi, sma } from './indicators.js';
import { TF_MS, type Candle, type Dir, type SetupKind, type TF } from './types.js';

export type Prepared = {
  symbol: string;
  entryTf: TF;
  biasTf: TF;
  e: { c: Candle[]; emaF: number[]; emaS: number[]; rsi: number[]; atr: number[]; volAvg: number[]; bb: { mid: number[]; up: number[]; lo: number[] } };
  b: { c: Candle[]; emaF: number[]; emaS: number[] };
  biasIdx: Int32Array; // index candle bias terakhir yang sudah close saat candle entry i close
};

export function prepare(symbol: string, entry: Candle[], bias: Candle[], cfg: BotConfig): Prepared {
  const { entry: entryTf, bias: biasTf } = MODE_TF[cfg.mode];
  const ec = entry.map((x) => x.c);
  const bc = bias.map((x) => x.c);
  const biasIdx = new Int32Array(entry.length).fill(-1);
  const eMs = TF_MS[entryTf];
  const bMs = TF_MS[biasTf];
  let j = -1;
  for (let i = 0; i < entry.length; i++) {
    const closeT = entry[i].t + eMs;
    while (j + 1 < bias.length && bias[j + 1].t + bMs <= closeT) j++;
    biasIdx[i] = j;
  }
  return {
    symbol,
    entryTf,
    biasTf,
    e: { c: entry, emaF: ema(ec, cfg.emaFast), emaS: ema(ec, cfg.emaSlow), rsi: rsi(ec), atr: atr(entry, cfg.atrPeriod), volAvg: sma(entry.map((x) => x.v), 20), bb: bollinger(ec, cfg.bbPeriod, cfg.bbMult) },
    b: { c: bias, emaF: ema(bc, cfg.biasFast), emaS: ema(bc, cfg.biasSlow) },
    biasIdx,
  };
}

/** Bias tren TF besar: LONG kalau close > EMA50 > EMA200, SHORT kalau kebalikannya, selain itu netral. */
export function biasAt(p: Prepared, i: number): Dir | null {
  const j = p.biasIdx[i];
  if (j < 0) return null;
  const c = p.b.c[j].c;
  const f = p.b.emaF[j];
  const s = p.b.emaS[j];
  if (Number.isNaN(f) || Number.isNaN(s)) return null;
  if (c > f && f > s) return 'LONG';
  if (c < f && f < s) return 'SHORT';
  return null;
}

export type Evaluation = {
  t: number; // waktu close candle i
  bias: Dir | null;
  dir: Dir | null;
  setup?: SetupKind;
  close: number;
  atr: number;
  reason: string;
};

const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(1) : x.toFixed(2));

/** Cek pullback: tren lokal searah, harga sempat balik ke EMA20, lalu candle konfirmasi menutup searah. Return alasan gagal atau null kalau lolos. */
function pullbackFail(p: Prepared, i: number, dir: Dir, cfg: BotConfig): string | null {
  const { c, emaF, emaS, rsi: r, atr: a } = p.e;
  const x = c[i];
  const L = dir === 'LONG';
  if (L ? !(emaF[i] > emaS[i]) : !(emaF[i] < emaS[i])) return `EMA${cfg.emaFast} belum ${L ? 'di atas' : 'di bawah'} EMA${cfg.emaSlow}`;
  let touched = false;
  let broken = false;
  for (let k = i - 2; k <= i; k++) {
    if (L ? c[k].l <= emaF[k] + 0.1 * a[i] : c[k].h >= emaF[k] - 0.1 * a[i]) touched = true;
    if (L ? c[k].l < emaS[k] - 0.5 * a[i] : c[k].h > emaS[k] + 0.5 * a[i]) broken = true;
  }
  if (!touched) return `harga belum pullback ke EMA${cfg.emaFast}`;
  if (broken) return `pullback terlalu dalam (tembus EMA${cfg.emaSlow})`;
  if (L ? !(x.c > emaF[i]) : !(x.c < emaF[i])) return `close belum kembali ${L ? 'di atas' : 'di bawah'} EMA${cfg.emaFast}`;
  if (L ? !(x.c > x.o && x.c > c[i - 1].h) : !(x.c < x.o && x.c < c[i - 1].l)) return `belum ada candle konfirmasi (close ${L ? '> high' : '< low'} candle sebelumnya)`;
  const [lo, hi] = L ? [cfg.rsiLongMin, cfg.rsiLongMax] : [100 - cfg.rsiLongMax, 100 - cfg.rsiLongMin];
  if (!(r[i] >= lo && r[i] <= hi)) return `RSI ${r[i].toFixed(0)} di luar ${lo}–${hi}`;
  return null;
}

/** Cek breakout: close tembus high/low N candle, volume besar, close kuat, belum terlalu jauh dari EMA20. */
function breakoutFail(p: Prepared, i: number, dir: Dir, cfg: BotConfig): string | null {
  const { c, emaF, atr: a, volAvg } = p.e;
  const x = c[i];
  const L = dir === 'LONG';
  const n = cfg.breakoutLookback;
  let lvl = L ? -Infinity : Infinity;
  for (let k = i - n; k < i; k++) lvl = L ? Math.max(lvl, c[k].h) : Math.min(lvl, c[k].l);
  if (L ? !(x.c > lvl) : !(x.c < lvl)) return `belum tembus ${L ? 'high' : 'low'} ${n} candle (${fmt(lvl)})`;
  const vr = x.v / volAvg[i - 1];
  if (!(vr >= cfg.volMult)) return `volume ${vr.toFixed(1)}× < ${cfg.volMult}× rata-rata`;
  const range = x.h - x.l;
  const pos = range > 0 ? (x.c - x.l) / range : 0.5;
  if (L ? pos < 0.6 : pos > 0.4) return 'close candle breakout lemah (ekor panjang)';
  const ext = (L ? x.c - emaF[i] : emaF[i] - x.c) / a[i];
  if (ext > cfg.maxExtensionAtr) return `harga sudah ${ext.toFixed(1)}× ATR dari EMA${cfg.emaFast} (kejauhan)`;
  return null;
}

export function evaluate(p: Prepared, i: number, cfg: BotConfig): Evaluation {
  if (cfg.strategy === 'bbBounce') return evaluateBb(p, i, cfg);
  const x = p.e.c[i];
  const t = x.t + TF_MS[p.entryTf];
  const a = p.e.atr[i];
  const base = { t, close: x.c, atr: a };
  const warm = Math.max(cfg.emaSlow, cfg.breakoutLookback + 1, cfg.atrPeriod + 1, 21);
  if (i < warm || Number.isNaN(a) || Number.isNaN(p.e.emaS[i]) || Number.isNaN(p.e.rsi[i])) return { ...base, bias: null, dir: null, reason: 'data indikator belum cukup' };
  const bias = biasAt(p, i);
  if (!bias) return { ...base, bias, dir: null, reason: `bias ${p.biasTf} netral (harga, EMA${cfg.biasFast}, EMA${cfg.biasSlow} tidak berurutan)` };
  const why: string[] = [];
  if (cfg.pullback) {
    const f = pullbackFail(p, i, bias, cfg);
    if (!f) return { ...base, bias, dir: bias, setup: 'pullback', reason: `bias ${p.biasTf} ${bias} + pullback ke EMA${cfg.emaFast} terkonfirmasi` };
    why.push(`pullback: ${f}`);
  }
  if (cfg.breakout) {
    const f = breakoutFail(p, i, bias, cfg);
    if (!f) return { ...base, bias, dir: bias, setup: 'breakout', reason: `bias ${p.biasTf} ${bias} + breakout ${cfg.breakoutLookback} candle dengan volume` };
    why.push(`breakout: ${f}`);
  }
  return { ...base, bias, dir: null, reason: `bias ${bias} · ${why.join(' · ') || 'semua setup dimatikan'}` };
}

/**
 * Scalping pantulan Bollinger: candle ini / sebelumnya menyentuh band bawah (atas), lalu candle ini menutup
 * kembali di dalam band dan searah pantulan (hijau untuk LONG, merah untuk SHORT).
 */
function evaluateBb(p: Prepared, i: number, cfg: BotConfig): Evaluation {
  const { c, bb, atr: a } = p.e;
  const x = c[i];
  const t = x.t + TF_MS[p.entryTf];
  const base = { t, close: x.c, atr: a[i] };
  if (i < cfg.bbPeriod + 1 || Number.isNaN(bb.lo[i - 1])) return { ...base, bias: null, dir: null, reason: 'data indikator belum cukup' };
  const bias = biasAt(p, i);
  const touchLo = x.l <= bb.lo[i] || c[i - 1].l <= bb.lo[i - 1];
  const touchUp = x.h >= bb.up[i] || c[i - 1].h >= bb.up[i - 1];
  const longOk = touchLo && x.c > bb.lo[i] && x.c > x.o;
  const shortOk = touchUp && x.c < bb.up[i] && x.c < x.o;
  if (longOk === shortOk) return { ...base, bias, dir: null, reason: touchLo || touchUp ? 'menyentuh band tapi belum ada candle pantulan' : 'harga belum menyentuh band Bollinger' };
  const dir: Dir = longOk ? 'LONG' : 'SHORT';
  if (cfg.bbTrendFilter && bias !== dir) return { ...base, bias, dir: null, reason: `pantulan ${dir} tapi bias ${p.biasTf} ${bias ?? 'netral'}` };
  return { ...base, bias, dir, setup: 'bbBounce', reason: `pantulan dari band ${dir === 'LONG' ? 'bawah' : 'atas'} Bollinger` };
}
