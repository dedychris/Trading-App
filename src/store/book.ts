// Buku trading: saldo dihitung dari ledger (append-only, id deterministik) supaya
// sinkron HP <-> laptop aman walaupun dua device menutup posisi yang sama.
import { START_BALANCE } from '../lib/sim';
import type { Book, Position, Settings } from './types';

export const defaultSettings = (): Settings => ({
  theme: typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  bnb: false,
  tpPct: 14,
  slPct: 7,
  trailOn: true,
  trailPct: 4,
  auto: { enabled: false, deviceId: null, leverage: 10, marginMode: 'fixed', marginFixed: 100, marginPercent: 2, tpPct: 14, slPct: 7, trailOn: true, trailPct: 4, maxOpen: 3, dailyLossPct: 5, freshCandles: 2, ignoreSmallSample: true, minSample: 10 },
  marginMode: 'fixed',
  marginFixed: 100,
  marginPercent: 5,
  leverage: 20,
  filters: { volume: false, ema200: false, bollinger: false, atr: false, sentiment: false },
  sound: true,
  notify: false,
  updatedAt: 0,
});

export const emptyBook = (epoch = 1): Book => ({
  epoch,
  epochStartedAt: Date.now(),
  positions: {},
  orders: {},
  ledger: {},
  settings: defaultSettings(),
});

export function walletBalance(b: Book) {
  let s = START_BALANCE;
  for (const e of Object.values(b.ledger)) s += e.amt;
  return s;
}

export function lockedMargin(b: Book) {
  let s = 0;
  for (const p of Object.values(b.positions)) if (p.status === 'open') s += p.margin;
  for (const o of Object.values(b.orders)) if (o.status === 'pending') s += o.margin;
  return s;
}

export function positionLedger(b: Book, posId: string) {
  let fee = 0;
  let funding = 0;
  let pnl = 0;
  for (const e of Object.values(b.ledger)) {
    if (e.posId !== posId) continue;
    if (e.kind === 'fee') fee += e.amt;
    else if (e.kind === 'funding') funding += e.amt;
    else pnl += e.amt;
  }
  return { fee, funding, pnl, net: fee + funding + pnl };
}

function newer<T extends { updatedAt: number }>(a: T, b: T) {
  return b.updatedAt > a.updatedAt ? b : a;
}

function mergePos(a: Position, b: Position): Position {
  if (a.status !== b.status) return a.status === 'closed' ? a : b;
  const w = newer(a, b);
  const merged: Position = { ...w, checkedUntil: Math.max(a.checkedUntil, b.checkedUntil), fundingUntil: Math.max(a.fundingUntil, b.fundingUntil) };
  // trailing: aktif di salah satu device = aktif; ambil profit tertinggi
  if (a.trailActive || b.trailActive) merged.trailActive = true;
  if (a.peakRoe !== undefined || b.peakRoe !== undefined) merged.peakRoe = Math.max(a.peakRoe ?? -Infinity, b.peakRoe ?? -Infinity);
  return merged;
}

const ORDER_RANK = { pending: 0, cancelled: 1, filled: 2 } as const;

/** Gabungkan dua versi buku (lokal & cloud). Idempoten & deterministik. */
export function mergeBooks(a: Book, b: Book): Book {
  if (a.epoch !== b.epoch) return a.epoch > b.epoch ? { ...a, settings: newer(a.settings, b.settings) } : { ...b, settings: newer(a.settings, b.settings) };
  const positions = { ...a.positions };
  for (const [id, p] of Object.entries(b.positions)) positions[id] = positions[id] ? mergePos(positions[id], p) : p;
  const orders = { ...a.orders };
  for (const [id, o] of Object.entries(b.orders)) {
    const cur = orders[id];
    if (!cur) orders[id] = o;
    else if (ORDER_RANK[o.status] !== ORDER_RANK[cur.status]) orders[id] = ORDER_RANK[o.status] > ORDER_RANK[cur.status] ? o : cur;
    else orders[id] = newer(cur, o);
  }
  return {
    epoch: a.epoch,
    epochStartedAt: Math.min(a.epochStartedAt, b.epochStartedAt),
    positions,
    orders,
    ledger: { ...a.ledger, ...b.ledger },
    settings: newer(a.settings, b.settings),
  };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
