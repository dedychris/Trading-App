import { create } from 'zustand';
import type { ScanResult } from '../lib/scanner';
import { feeRate, liqPrice, pnl, SL_PCT, TP_PCT, tpSlPrices } from '../lib/sim';
import type { Dir } from '../lib/signals';
import { emptyBook, lockedMargin, migrateSettings, uid, walletBalance } from './book';
import type { Book, CloseReason, PendingOrder, Position, Settings, Snapshot } from './types';

const KEY = 'msp-book-v1';

function loadBook(): Book {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const b = JSON.parse(raw) as Book;
      const d = emptyBook();
      const s0 = { ...d.settings, ...b.settings };
      return { ...d, ...b, settings: migrateSettings({ ...s0, filters: { ...d.settings.filters, ...b.settings?.filters }, auto: { ...d.settings.auto, rulesV: undefined, ...b.settings?.auto } }) };
    }
  } catch {
    /* data rusak / storage diblokir */
  }
  return emptyBook();
}

export type AutoLog = { t: number; text: string; tone: 'good' | 'bad' | 'info' };
export type Toast = { id: string; text: string; tone: 'good' | 'bad' | 'info' };
export type ScanState = { status: 'idle' | 'running' | 'done' | 'error'; done: number; total: number; error?: string; result: ScanResult | null };
export type SyncState = { status: 'off' | 'signed-out' | 'syncing' | 'synced' | 'error'; email?: string; error?: string; at?: number };

type AppState = {
  book: Book;
  prices: Record<string, number>;
  priceStatus: 'live' | 'polling' | 'off';
  scan: ScanState;
  sync: SyncState;
  toasts: Toast[];
  detail: string | null; // simbol yang sedang dibuka
  autoLog: AutoLog[];
  autoDecision: Record<string, AutoLog>; // keputusan auto terakhir per koin (ditampilkan di kartu)
  autoRun: { lastAt?: number; nextAt?: number; running?: boolean };
  setBook: (b: Book) => void;
  updateSettings: (p: Partial<Settings>) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  openDetail: (s: string | null) => void;
};

export const useApp = create<AppState>((set, get) => ({
  book: loadBook(),
  prices: {},
  priceStatus: 'off',
  scan: { status: 'idle', done: 0, total: 0, result: null },
  sync: { status: 'off' },
  toasts: [],
  detail: null,
  autoLog: [],
  autoDecision: {},
  autoRun: {},
  setBook: (b) => set({ book: b }),
  updateSettings: (p) => {
    const b = get().book;
    set({ book: { ...b, settings: { ...b.settings, ...p, updatedAt: Date.now() } } });
  },
  toast: (text, tone = 'info') => {
    const id = uid();
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4500);
  },
  openDetail: (s) => set({ detail: s }),
}));

// Simpan ke localStorage setiap buku berubah
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useApp.subscribe((s, prev) => {
  if (s.book === prev.book) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(useApp.getState().book));
    } catch {
      /* storage penuh/diblokir */
    }
  }, 300);
});

const mutate = (fn: (b: Book) => Book) => useApp.setState({ book: fn(useApp.getState().book) });

export function availableBalance(b: Book) {
  return walletBalance(b) - lockedMargin(b);
}

export function marginFor(s: Settings, b: Book) {
  return s.marginMode === 'fixed' ? s.marginFixed : (walletBalance(b) * s.marginPercent) / 100;
}

export type OpenParams = { symbol: string; dir: Dir; leverage: number; margin: number; price: number; type: 'market' | 'limit'; snap: Snapshot | null; tpPct?: number; slPct?: number; trailPct?: number | null };

export function validateOrder(p: OpenParams, marketPrice: number | undefined): string | null {
  const b = useApp.getState().book;
  if (!(p.margin > 0)) return 'Margin harus lebih dari 0';
  if (!(p.leverage >= 1 && p.leverage <= 125)) return 'Leverage 1–125×';
  if (p.margin > availableBalance(b) + 1e-9) return `Saldo tersedia tidak cukup (${availableBalance(b).toFixed(2)} USDT)`;
  if (!(p.price > 0)) return 'Harga tidak valid';
  if (p.tpPct !== undefined && !(p.tpPct > 0)) return 'TP % harus lebih dari 0';
  if (p.slPct !== undefined && !(p.slPct > 0 && p.slPct < 100)) return 'SL % harus antara 0 dan 100 (100% = likuidasi)';
  if (p.trailPct !== undefined && p.trailPct !== null && !(p.trailPct > 0)) return 'Jarak trailing harus lebih dari 0';
  if (p.type === 'limit' && marketPrice) {
    if (p.dir === 'LONG' && p.price >= marketPrice) return 'Limit LONG harus di bawah harga sekarang (kalau di atas, pakai Market)';
    if (p.dir === 'SHORT' && p.price <= marketPrice) return 'Limit SHORT harus di atas harga sekarang (kalau di bawah, pakai Market)';
  }
  return null;
}

export function openPosition(p: { symbol: string; dir: Dir; leverage: number; margin: number; entry: number; entryType: 'market' | 'limit'; snap: Snapshot | null; id?: string; t?: number; tpPct?: number; slPct?: number; trailPct?: number | null; auto?: boolean }): Position {
  const t = p.t ?? Date.now();
  const id = p.id ?? uid();
  const tpPct = p.tpPct ?? TP_PCT;
  const slPct = p.slPct ?? SL_PCT;
  const { tp, sl } = tpSlPrices(p.dir, p.entry, p.leverage, tpPct, slPct);
  const qty = (p.margin * p.leverage) / p.entry;
  const pos: Position = {
    id,
    symbol: p.symbol,
    dir: p.dir,
    leverage: p.leverage,
    margin: p.margin,
    qty,
    entry: p.entry,
    tp,
    sl,
    liq: liqPrice(p.dir, p.entry, p.leverage),
    entryType: p.entryType,
    tpPct,
    slPct,
    trailPct: p.trailPct && p.trailPct > 0 ? p.trailPct : null,
    ...(p.auto ? { auto: true } : {}),
    openedAt: t,
    status: 'open',
    checkedUntil: t,
    fundingUntil: t,
    snapEntry: p.snap,
    updatedAt: Date.now(),
  };
  const bnb = useApp.getState().book.settings.bnb;
  const fee = qty * p.entry * feeRate(p.entryType === 'market' ? 'taker' : 'maker', bnb);
  mutate((b) => ({
    ...b,
    positions: { ...b.positions, [id]: pos },
    ledger: { ...b.ledger, [`${id}:fee-open`]: { id: `${id}:fee-open`, t, amt: -fee, kind: 'fee', posId: id } },
  }));
  return pos;
}

export function placeLimit(p: OpenParams): PendingOrder {
  const id = uid();
  const now = Date.now();
  const o: PendingOrder = { id, symbol: p.symbol, dir: p.dir, leverage: p.leverage, margin: p.margin, price: p.price, tpPct: p.tpPct, slPct: p.slPct, trailPct: p.trailPct ?? null, createdAt: now, status: 'pending', checkedUntil: now, snapEntry: p.snap, updatedAt: now };
  mutate((b) => ({ ...b, orders: { ...b.orders, [id]: o } }));
  return o;
}

export function cancelOrder(id: string) {
  mutate((b) => (b.orders[id]?.status === 'pending' ? { ...b, orders: { ...b.orders, [id]: { ...b.orders[id], status: 'cancelled', updatedAt: Date.now() } } } : b));
}

/** Order limit ke-fill → jadi posisi (id posisi = id order, supaya aman di-sync). */
export function fillOrder(id: string, t: number) {
  const o = useApp.getState().book.orders[id];
  if (!o || o.status !== 'pending') return null;
  mutate((b) => ({ ...b, orders: { ...b.orders, [id]: { ...o, status: 'filled', updatedAt: Date.now() } } }));
  return openPosition({ id, t, symbol: o.symbol, dir: o.dir, leverage: o.leverage, margin: o.margin, entry: o.price, entryType: 'limit', snap: o.snapEntry, tpPct: o.tpPct, slPct: o.slPct, trailPct: o.trailPct });
}

export function closePosition(id: string, exit: number, reason: CloseReason, t = Date.now()): Position | null {
  const p = useApp.getState().book.positions[id];
  if (!p || p.status !== 'open') return null;
  const bnb = useApp.getState().book.settings.bnb;
  const gross = reason === 'LIQ' ? -p.margin : pnl(p.dir, p.entry, exit, p.qty);
  const fee = reason === 'LIQ' ? 0 : exit * p.qty * feeRate('taker', bnb);
  const closed: Position = { ...p, status: 'closed', exit, reason, closedAt: t, checkedUntil: Math.max(p.checkedUntil, t), updatedAt: Date.now() };
  mutate((b) => ({
    ...b,
    positions: { ...b.positions, [id]: closed },
    ledger: {
      ...b.ledger,
      [`${id}:pnl`]: { id: `${id}:pnl`, t, amt: gross, kind: 'pnl', posId: id },
      ...(fee ? { [`${id}:fee-close`]: { id: `${id}:fee-close`, t, amt: -fee, kind: 'fee' as const, posId: id } } : {}),
    },
  }));
  return closed;
}

export function patchPosition(id: string, patch: Partial<Position>) {
  mutate((b) => (b.positions[id] ? { ...b, positions: { ...b.positions, [id]: { ...b.positions[id], ...patch, updatedAt: Date.now() } } } : b));
}
export function patchOrder(id: string, patch: Partial<PendingOrder>) {
  mutate((b) => (b.orders[id] ? { ...b, orders: { ...b.orders, [id]: { ...b.orders[id], ...patch, updatedAt: Date.now() } } } : b));
}

export function addFunding(posId: string, fundingTime: number, amt: number) {
  const key = `${posId}:fund:${fundingTime}`;
  mutate((b) => (b.ledger[key] ? b : { ...b, ledger: { ...b.ledger, [key]: { id: key, t: fundingTime, amt, kind: 'funding', posId } } }));
}

export function resetAccount() {
  const b = useApp.getState().book;
  const fresh = emptyBook(b.epoch + 1);
  useApp.setState({ book: { ...fresh, settings: { ...b.settings, updatedAt: Date.now() } } });
}
