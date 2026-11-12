// Audit trade dari data nyata saat entry & exit (pengganti "adaptive rules" template di zip).
import { btcConflict, RULES, TFS, type TFState } from './signals';
import { fmtDuration, fmtNum, fmtPct } from './format';
import { moves } from './sim';
import type { Book, Position } from '../store/types';
import { positionLedger } from '../store/book';

export type AuditPoint = { tone: 'good' | 'bad' | 'info'; text: string };

export function auditTrade(p: Position): AuditPoint[] {
  const out: AuditPoint[] = [];
  const e = p.snapEntry;
  const won = p.reason === 'TP' || (p.reason === 'MANUAL' && (p.exit ?? 0) !== 0 && (p.dir === 'LONG' ? p.exit! > p.entry : p.exit! < p.entry));
  if (p.closedAt) out.push({ tone: 'info', text: `Durasi posisi ${fmtDuration(p.closedAt - p.openedAt)}, ditutup karena ${p.reason === 'TP' ? 'TP kena' : p.reason === 'SL' ? 'SL kena' : p.reason === 'LIQ' ? 'likuidasi' : 'ditutup manual'}.` });
  if (!e) {
    out.push({ tone: 'info', text: 'Tidak ada snapshot indikator saat entry (order dibuka tanpa data scan).' });
    return out;
  }
  if (e.setup) {
    const aligned = e.setup.dir === p.dir;
    out.push({ tone: aligned ? 'info' : 'bad', text: aligned ? `Setup saat entry: ${e.setup.key} ${e.setup.dir}.` : `Lu entry ${p.dir} padahal sinyal saat itu ${e.setup.dir} — melawan sinyal.` });
  } else out.push({ tone: 'bad', text: 'Saat entry tidak ada timeframe yang qualify — entry tanpa sinyal.' });

  for (const tf of TFS) {
    const s = e.tf[tf] as TFState | null | undefined;
    if (!s) continue;
    const v = s.v;
    if (v.adx < 25) out.push({ tone: 'bad', text: `ADX ${tf} cuma ${fmtNum(v.adx)} — tren lemah, gampang bolak-balik.` });
    else if (v.adx >= 30) out.push({ tone: 'good', text: `ADX ${tf} ${fmtNum(v.adx)} — tren kuat.` });
    const [lo, hi] = p.dir === 'SHORT' ? RULES.rsiShort : RULES.rsiLong;
    if (p.dir === 'LONG' && v.rsi > hi - 3) out.push({ tone: 'bad', text: `RSI ${tf} ${fmtNum(v.rsi)} sudah dekat batas atas ${hi} — rawan kemahalan.` });
    if (p.dir === 'SHORT' && v.rsi < lo + 3) out.push({ tone: 'bad', text: `RSI ${tf} ${fmtNum(v.rsi)} sudah dekat batas bawah ${lo} — rawan mantul.` });
  }
  const grid = e.tf['15m'];
  if (grid) {
    const slMove = moves(p.leverage).sl * 100;
    if (slMove < grid.v.atrPct) out.push({ tone: 'bad', text: `Jarak SL ${fmtPct(slMove)} lebih sempit dari ATR 15m (${fmtPct(grid.v.atrPct)}) — goyangan normal saja bisa kena SL. Coba leverage lebih kecil.` });
    if (grid.v.volRatio < RULES.volRatioMin) out.push({ tone: 'bad', text: `Volume 15m cuma ${fmtNum(grid.v.volRatio, 2)}× rata-rata — momentum kurang konfirmasi.` });
    if (!Number.isNaN(grid.v.ema200) && (p.dir === 'LONG' ? grid.v.close < grid.v.ema200 : grid.v.close > grid.v.ema200)) out.push({ tone: 'bad', text: `Harga ${p.dir === 'LONG' ? 'di bawah' : 'di atas'} EMA200 15m — melawan tren besar.` });
  }
  if (e.btcTrend && btcConflict(e.btcTrend, p.dir)) out.push({ tone: 'bad', text: `BTC sedang ${e.btcTrend} saat lu ${p.dir} — melawan arah BTC.` });
  else if (e.btcTrend && e.btcTrend !== 'NETRAL') out.push({ tone: 'good', text: `Searah dengan BTC (${e.btcTrend}).` });
  if (e.funding !== null) {
    if (p.dir === 'LONG' && e.funding >= 0.0005) out.push({ tone: 'bad', text: `Funding ${fmtPct(e.funding * 100, 4)} — pasar sudah kebanyakan long.` });
    if (p.dir === 'SHORT' && e.funding <= -0.0005) out.push({ tone: 'bad', text: `Funding ${fmtPct(e.funding * 100, 4)} — pasar sudah kebanyakan short.` });
  }
  if (e.winrate !== null && e.breakevenWinrate !== undefined) {
    const ok = e.winrate >= e.breakevenWinrate;
    out.push({ tone: ok ? 'good' : 'bad', text: `Winrate historis saat entry ${fmtPct(e.winrate, 0)}${e.winrateN ? ` (${e.winrateN} kejadian)` : ''}, butuh ≥ ${fmtPct(e.breakevenWinrate, 0)} untuk impas setelah fee.` });
  }
  const x = p.snapExit;
  if (x) {
    const h1 = x.tf['1h'];
    if (h1?.dir && h1.dir !== p.dir) out.push({ tone: won ? 'info' : 'bad', text: `Saat exit, tren 1H sudah berbalik ke ${h1.dir}.` });
  }
  return out;
}

export type Insight = { text: string; tone: 'good' | 'bad' };
type Bucket = { w: number; n: number };

/** Insight dari riwayat trade lu sendiri (opsi D) — muncul setelah sampel cukup. */
export function insights(book: Book): Insight[] {
  const closed = Object.values(book.positions).filter((p) => p.status === 'closed');
  const isWin = (p: Position) => positionLedger(book, p.id).net > 0;
  const groups: Record<string, Record<string, Bucket>> = {};
  const add = (dim: string, k: string, w: boolean) => {
    groups[dim] ??= {};
    groups[dim][k] ??= { w: 0, n: 0 };
    groups[dim][k].n++;
    if (w) groups[dim][k].w++;
  };
  for (const p of closed) {
    const w = isWin(p);
    const e = p.snapEntry;
    add('Arah', p.dir, w);
    add('Leverage', p.leverage <= 10 ? '≤10×' : p.leverage <= 25 ? '11–25×' : '>25×', w);
    if (e?.setup) add('Setup', e.setup.key, w);
    if (e?.btcTrend) add('BTC', btcConflict(e.btcTrend, p.dir) ? 'melawan BTC' : 'searah/netral BTC', w);
    const g = e?.tf['15m'];
    if (g) {
      add('Volume', g.v.volRatio >= RULES.volRatioMin ? 'volume kuat' : 'volume lemah', w);
      add('ATR', moves(p.leverage).sl * 100 >= g.v.atrPct ? 'SL ≥ ATR' : 'SL < ATR', w);
    }
  }
  const out: Insight[] = [];
  for (const [dim, b] of Object.entries(groups)) {
    const entries = Object.entries(b).filter(([, x]) => x.n >= 5);
    if (entries.length < 2) continue;
    entries.sort((a, c) => c[1].w / c[1].n - a[1].w / a[1].n);
    const [bk, bv] = entries[0];
    const [wk, wv] = entries[entries.length - 1];
    const diff = (bv.w / bv.n - wv.w / wv.n) * 100;
    if (diff >= 15) {
      out.push({ tone: 'good', text: `${dim}: trade "${bk}" menang ${bv.w}/${bv.n} (${fmtPct((bv.w / bv.n) * 100, 0)}) vs "${wk}" ${wv.w}/${wv.n} (${fmtPct((wv.w / wv.n) * 100, 0)}).` });
    }
  }
  return out;
}
