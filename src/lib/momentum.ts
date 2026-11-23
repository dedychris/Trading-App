// 📈 Auto Momentum harian (paper trading) — aturan sama persis dengan backtest scripts/backtest/trend.ts (#2):
// tiap close candle harian Binance (00:00 UTC = 07:00 WIB), untuk tiap koin: return N hari > 0 → LONG, < 0 → SHORT.
// Posisi cuma diganti kalau arah berbalik (alasan tutup FLIP). Tanpa TP/SL.
// Ukuran: qty = saldo × volPct% / volatilitas harian 20 hari / harga  (tiap koin ± volPct% saldo per hari).
// Fungsi murni (tanpa store) supaya app (browser) dan bot server (GitHub Actions) menghasilkan buku yang identik:
// id posisi deterministik `mom-<koin>-<waktu close>`, harga entry/exit = harga close candle harian.
import { CORE_COINS, type Candle } from './binance';
import { feeRate, liqPrice, pnl } from './sim';
import { lockedMargin, walletBalance } from '../store/book';
import type { Book, LedgerEntry, Position } from '../store/types';

export const MOM_COINS = CORE_COINS;
export const DAY = 86_400_000;
/** Kalau bot telat lebih dari ini, candle yang terlewat tidak diulang (cuma candle terakhir yang diproses). */
const MAX_CATCHUP = 7 * DAY;

export type MomEvent = { t: number; text: string; tone: 'good' | 'bad' | 'info'; symbol?: string };
export type MomSignal = { dir: 'LONG' | 'SHORT' | null; ret: number; vol: number; price: number };

/** Waktu close candle harian terakhir yang sudah selesai (= awal hari UTC sekarang). */
export const lastDailyClose = (now: number) => Math.floor(now / DAY) * DAY;
export const nextDailyClose = (now: number) => lastDailyClose(now) + DAY;

/** Sinyal di candle harian index i: return `lookback` hari & volatilitas 20 hari (close ke close). */
export function momSignal(c: Candle[], i: number, lookback: number): MomSignal | null {
  if (i < Math.max(lookback, 21) || i >= c.length) return null;
  const ret = c[i].c / c[i - lookback].c - 1;
  const rets: number[] = [];
  for (let k = i - 19; k <= i; k++) rets.push(c[k].c / c[k - 1].c - 1);
  const mean = rets.reduce((x, y) => x + y, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((x, y) => x + (y - mean) ** 2, 0) / rets.length);
  if (!(vol > 0) || !Number.isFinite(ret)) return null;
  return { dir: ret > 0 ? 'LONG' : ret < 0 ? 'SHORT' : null, ret, vol, price: c[i].c };
}

const wallet = walletBalance;
const locked = lockedMargin;

function closePos(b: Book, p: Position, exit: number, reason: 'FLIP' | 'LIQ', t: number, now: number): Book {
  const gross = reason === 'LIQ' ? -p.margin : pnl(p.dir, p.entry, exit, p.qty);
  const fee = reason === 'LIQ' ? 0 : exit * p.qty * feeRate('taker', b.settings.bnb);
  const closed: Position = { ...p, status: 'closed', exit, reason, closedAt: t, closeFee: fee, checkedUntil: Math.max(p.checkedUntil, t), updatedAt: now };
  const ledger: Record<string, LedgerEntry> = { ...b.ledger, [`${p.id}:pnl`]: { id: `${p.id}:pnl`, t, amt: gross, kind: 'pnl', posId: p.id } };
  if (fee) ledger[`${p.id}:fee-close`] = { id: `${p.id}:fee-close`, t, amt: -fee, kind: 'fee', posId: p.id };
  return { ...b, positions: { ...b.positions, [p.id]: closed }, ledger };
}

function openPos(b: Book, x: { id: string; symbol: string; dir: 'LONG' | 'SHORT'; qty: number; price: number; leverage: number; t: number; now: number }): Book {
  const notional = x.qty * x.price;
  const liq = liqPrice(x.dir, x.price, x.leverage);
  const pos: Position = {
    id: x.id,
    symbol: x.symbol,
    dir: x.dir,
    leverage: x.leverage,
    margin: notional / x.leverage,
    qty: x.qty,
    entry: x.price,
    // tanpa TP; "SL" = harga likuidasi (engine juga mengabaikan TP/SL untuk strategi MOM)
    tp: x.dir === 'LONG' ? x.price * 1000 : 0,
    sl: liq,
    liq,
    entryType: 'market',
    trailPct: null,
    auto: true,
    strategy: 'MOM',
    openedAt: x.t,
    status: 'open',
    checkedUntil: x.t,
    fundingUntil: x.t,
    snapEntry: null,
    updatedAt: x.now,
  };
  const fee = notional * feeRate('taker', b.settings.bnb);
  return {
    ...b,
    positions: { ...b.positions, [x.id]: pos },
    ledger: { ...b.ledger, [`${x.id}:fee-open`]: { id: `${x.id}:fee-open`, t: x.t, amt: -fee, kind: 'fee', posId: x.id } },
  };
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const coin = (s: string) => s.replace(/USDT$/, '');

/** Proses satu close candle harian (waktu T). */
export function momentumStep(book: Book, daily: Record<string, Candle[]>, T: number, minNotional: (symbol: string, price: number) => number, now: number): { book: Book; events: MomEvent[]; processed: boolean } {
  const s = book.settings.mom;
  const events: MomEvent[] = [];
  let b = book;
  let processed = false;
  const sig: Record<string, MomSignal | null> = {};
  for (const sym of MOM_COINS) {
    const c = daily[sym];
    if (!c?.length) continue;
    const i = c.findIndex((x) => x.t + DAY === T);
    if (i < 0) continue;
    processed = true;
    sig[sym] = momSignal(c, i, s.lookback);
    // likuidasi sejak terakhir dicek (pakai high/low candle harian, konservatif)
    for (const p of Object.values(b.positions)) {
      if (p.symbol !== sym || p.status !== 'open' || p.strategy !== 'MOM' || p.openedAt >= T) continue;
      for (const k of c) {
        if (k.t + DAY <= p.checkedUntil || k.t + DAY > T) continue;
        if (p.dir === 'LONG' ? k.l <= p.liq : k.h >= p.liq) {
          b = closePos(b, p, p.liq, 'LIQ', Math.max(p.checkedUntil, k.t + DAY - 60_000), now);
          events.push({ t: T, tone: 'bad', symbol: sym, text: `💀 Momentum ${coin(sym)} ${p.dir} kena likuidasi di ${fmt(p.liq, 4)}` });
          break;
        }
      }
      if (b.positions[p.id].status === 'open') b = { ...b, positions: { ...b.positions, [p.id]: { ...b.positions[p.id], checkedUntil: Math.max(p.checkedUntil, T), updatedAt: now } } };
    }
  }
  if (!processed) return { book, events, processed };
  // 1) tutup posisi yang arahnya berbalik
  for (const sym of MOM_COINS) {
    const g = sig[sym];
    if (!g) continue;
    for (const p of Object.values(b.positions)) {
      if (p.symbol !== sym || p.status !== 'open' || p.strategy !== 'MOM' || p.openedAt >= T) continue;
      if (p.dir === g.dir) continue;
      b = closePos(b, p, g.price, 'FLIP', T, now);
      const net = pnl(p.dir, p.entry, g.price, p.qty) - (p.entry + g.price) * p.qty * feeRate('taker', b.settings.bnb);
      events.push({ t: T, tone: net >= 0 ? 'good' : 'bad', symbol: sym, text: `Momentum ${coin(sym)}: arah ${s.lookback} hari berbalik → tutup ${p.dir} di ${fmt(g.price, 4)} (${net >= 0 ? '+' : ''}${fmt(net)} USDT)` });
    }
  }
  // 2) buka posisi baru untuk koin yang belum punya posisi momentum
  const rate = feeRate('taker', b.settings.bnb);
  for (const sym of MOM_COINS) {
    const g = sig[sym];
    if (!g?.dir) continue;
    if (Object.values(b.positions).some((p) => p.symbol === sym && p.status === 'open' && p.strategy === 'MOM')) continue;
    const id = `mom-${sym}-${T}`;
    if (b.positions[id]) continue; // sudah dibuka (device / server lain)
    const qty = (wallet(b) * s.volPct) / 100 / g.vol / g.price;
    const notional = qty * g.price;
    const minN = minNotional(sym, g.price);
    if (!(qty > 0)) continue;
    if (notional < minN) {
      events.push({ t: T, tone: 'info', symbol: sym, text: `Lewati ${coin(sym)} ${g.dir}: nilai posisi ${fmt(notional)} USDT di bawah minimal Binance ${fmt(minN)} USDT (saldo terlalu kecil untuk koin ini)` });
      continue;
    }
    const need = notional / s.leverage + notional * rate;
    const avail = wallet(b) - locked(b);
    if (need > avail + 1e-9) {
      events.push({ t: T, tone: 'bad', symbol: sym, text: `Lewati ${coin(sym)} ${g.dir}: saldo tersedia ${fmt(avail)} USDT tidak cukup untuk margin ${fmt(notional / s.leverage)} USDT` });
      continue;
    }
    b = openPos(b, { id, symbol: sym, dir: g.dir, qty, price: g.price, leverage: s.leverage, t: T, now });
    events.push({ t: T, tone: 'good', symbol: sym, text: `📈 Momentum buka ${g.dir} ${coin(sym)} di ${fmt(g.price, 4)} · return ${s.lookback} hari ${g.ret >= 0 ? '+' : ''}${fmt(g.ret * 100, 1)}% · nilai posisi ${fmt(notional)} USDT (${s.leverage}×)` });
  }
  return { book: b, events, processed };
}

/**
 * Proses semua close harian yang belum diproses sampai sekarang (maks 7 hari ke belakang; kalau lebih lama
 * atau baru pertama kali, cuma candle terakhir). Idempoten: memanggil ulang tidak membuka posisi dobel.
 */
export function momentumRun(book: Book, daily: Record<string, Candle[]>, now: number, minNotional: (symbol: string, price: number) => number, by = 'app'): { book: Book; events: MomEvent[] } {
  if (!book.settings.mom?.enabled) return { book, events: [] };
  const latest = lastDailyClose(now);
  const last = book.bot?.momLastT;
  if (last !== undefined && last >= latest) return { book, events: [] };
  const times: number[] = [];
  if (last === undefined || latest - last > MAX_CATCHUP) times.push(latest);
  else for (let T = last + DAY; T <= latest; T += DAY) times.push(T);
  let b = book;
  const events: MomEvent[] = [];
  let done: number | undefined;
  for (const T of times) {
    const r = momentumStep(b, daily, T, minNotional, now);
    if (!r.processed) break; // data candle belum lengkap → coba lagi nanti
    b = r.book;
    events.push(...r.events);
    done = T;
  }
  if (done === undefined) return { book, events: [] };
  if (!events.length) events.push({ t: done, tone: 'info', text: `Momentum ${new Date(done).toISOString().slice(0, 10)}: tidak ada perubahan arah` });
  return { book: { ...b, bot: { ...b.bot, momLastT: done, momRunAt: now, momRunBy: by } }, events };
}

/** Jumlah candle harian yang perlu diambil per koin. */
export const momCandlesNeeded = (lookback: number) => Math.max(lookback, 21) + 12;
