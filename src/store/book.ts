// Buku trading: saldo dihitung dari ledger (append-only, id deterministik) supaya
// sinkron HP <-> laptop aman walaupun dua device menutup posisi yang sama.
import { pnl, START_BALANCE } from '../lib/sim';
import type { ArchivedSession, Book, LedgerEntry, Position, Settings } from './types';

export const AUTO_RULES_V = 4;

export const defaultSettings = (): Settings => ({
  theme: typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  bnb: false,
  tpPct: 14,
  slPct: 7,
  trailOn: true,
  trailPct: 4,
  auto: { enabled: true, deviceId: null, leverage: 10, marginMode: 'percent', marginFixed: 1, marginPercent: 10, tpPct: 14, slPct: 7, trailOn: true, trailPct: 4, maxOpen: 3, dailyLossPct: 15, freshCandles: 2, ignoreSmallSample: true, minSample: 10, with4h1h: true, wakeLock: true, requireWinrate: false, maxSlPerCoinDay: 3, maxDriftPct: 50, rulesV: AUTO_RULES_V },
  marginMode: 'percent',
  marginFixed: 1,
  marginPercent: 10,
  leverage: 20,
  filters: { volume: false, ema200: false, bollinger: false, atr: false, sentiment: false },
  sound: true,
  notify: false,
  updatedAt: 0,
});

/**
 * Lengkapi setting auto yang kurang + migrasi aturan lama.
 * v2: stop rugi −15%, syarat winrate mati, maks 3 SL per koin/hari.
 * v3: modal kecil (mis. Rp 150 ribu) + compounding: margin manual = 10% saldo,
 *     margin auto = saldo dibagi rata ke maks posisi (cuan langsung ikut jadi modal).
 * v4: "bagi rata" terlalu berisiko (1 SL ≈ −2,7% saldo, 3 posisi searah = seluruh saldo satu taruhan)
 *     → margin auto 10% saldo (tetap compounding).
 */
export function migrateSettings(s: Settings): Settings {
  const d = defaultSettings().auto;
  let a = { ...d, ...s.auto };
  const v = s.auto?.rulesV ?? 1;
  if (v >= AUTO_RULES_V) return { ...s, auto: a };
  let out = s;
  if (v < 2) a = { ...a, dailyLossPct: 15, requireWinrate: false, maxSlPerCoinDay: 3 };
  if (v < 3) {
    a = { ...a, marginMode: 'split', marginPercent: 10 };
    out = { ...out, marginMode: 'percent', marginPercent: 10 };
  }
  if (v < 4 && a.marginMode === 'split') a = { ...a, marginMode: 'percent', marginPercent: 10 };
  return { ...out, auto: { ...a, rulesV: AUTO_RULES_V }, updatedAt: Date.now() };
}

export type SessionStart = { startBalance?: number; startIdr?: number; idrRate?: number };

export const emptyBook = (epoch = 1, start: SessionStart = {}): Book => ({
  epoch,
  epochStartedAt: Date.now(),
  ...(start.startBalance !== undefined ? { startBalance: start.startBalance } : {}),
  ...(start.startIdr !== undefined ? { startIdr: start.startIdr } : {}),
  ...(start.idrRate !== undefined ? { idrRate: start.idrRate } : {}),
  positions: {},
  orders: {},
  ledger: {},
  settings: defaultSettings(),
});

/** Saldo awal sesi ini (USDT). Sesi lama tanpa angka = 10.000. */
export const startBalanceOf = (b: { startBalance?: number }) => b.startBalance ?? START_BALANCE;

export function walletBalance(b: Book) {
  let s = startBalanceOf(b);
  for (const e of Object.values(b.ledger)) s += e.amt;
  return s;
}

/** Ambil trade yang sudah selesai + ledger-nya dari sesi ini, untuk disimpan di arsip. */
export function sessionArchive(b: Book, endedAt = Date.now()): ArchivedSession {
  const positions: Record<string, Position> = {};
  for (const [id, p] of Object.entries(b.positions)) if (p.status === 'closed') positions[id] = p;
  const ledger: Record<string, LedgerEntry> = {};
  for (const [id, e] of Object.entries(b.ledger)) if (positions[e.posId]) ledger[id] = e;
  return {
    epoch: b.epoch,
    startedAt: b.epochStartedAt,
    endedAt,
    startBalance: startBalanceOf(b),
    ...(b.startIdr !== undefined ? { startIdr: b.startIdr } : {}),
    ...(b.idrRate !== undefined ? { idrRate: b.idrRate } : {}),
    positions,
    ledger,
  };
}

/** Arsip dalam bentuk Book (read-only) supaya fungsi ledger/riwayat bisa dipakai ulang. */
export function archiveAsBook(a: ArchivedSession, settings: Settings): Book {
  return { epoch: a.epoch, epochStartedAt: a.startedAt, startBalance: a.startBalance, startIdr: a.startIdr, idrRate: a.idrRate, positions: a.positions, orders: {}, ledger: a.ledger, settings };
}

/** Arsip urut terbaru dulu. */
export const archiveList = (b: Book) => Object.values(b.archives ?? {}).sort((x, y) => y.epoch - x.epoch);

export type LearnTrade = { p: Position; net: number };
const learnCache = new WeakMap<Book, LearnTrade[]>();
/** Semua trade selesai untuk bahan belajar pola: sesi sekarang + semua arsip. */
export function learningTrades(b: Book): LearnTrade[] {
  const hit = learnCache.get(b);
  if (hit) return hit;
  const out: LearnTrade[] = [];
  const add = (positions: Record<string, Position>, ledger: Record<string, LedgerEntry>) => {
    const net: Record<string, number> = {};
    for (const e of Object.values(ledger)) net[e.posId] = (net[e.posId] ?? 0) + e.amt;
    for (const p of Object.values(positions)) if (p.status === 'closed') out.push({ p, net: net[p.id] ?? 0 });
  };
  add(b.positions, b.ledger);
  for (const a of Object.values(b.archives ?? {})) add(a.positions, a.ledger);
  learnCache.set(b, out);
  return out;
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

/**
 * Dua device menutup posisi yang sama → pakai yang ketutup DULUAN (di pasar posisi sudah tutup,
 * gerakan sesudahnya tidak berlaku). Seri → yang terakhir diubah, lalu exit terkecil (deterministik).
 */
function firstClosed(a: Position, b: Position): Position {
  const ca = a.closedAt ?? Infinity;
  const cb = b.closedAt ?? Infinity;
  if (ca !== cb) return ca < cb ? a : b;
  if (a.updatedAt !== b.updatedAt) return newer(a, b);
  return (b.exit ?? 0) < (a.exit ?? 0) ? b : a;
}

function mergePos(a: Position, b: Position): Position {
  if (a.status !== b.status) return a.status === 'closed' ? a : b;
  if (a.status === 'closed') {
    const w = firstClosed(a, b);
    return { ...w, checkedUntil: Math.max(a.checkedUntil, b.checkedUntil), fundingUntil: Math.max(a.fundingUntil, b.fundingUntil) };
  }
  const w = newer(a, b);
  const merged: Position = { ...w, checkedUntil: Math.max(a.checkedUntil, b.checkedUntil), fundingUntil: Math.max(a.fundingUntil, b.fundingUntil) };
  // trailing: aktif di salah satu device = aktif; ambil profit tertinggi
  if (a.trailActive || b.trailActive) merged.trailActive = true;
  if (a.peakRoe !== undefined || b.peakRoe !== undefined) merged.peakRoe = Math.max(a.peakRoe ?? -Infinity, b.peakRoe ?? -Infinity);
  return merged;
}

const ORDER_RANK = { pending: 0, cancelled: 1, filled: 2 } as const;

function mergePositions(a: Record<string, Position>, b: Record<string, Position>) {
  const positions = { ...a };
  for (const [id, p] of Object.entries(b)) positions[id] = positions[id] ? mergePos(positions[id], p) : p;
  return positions;
}

/**
 * Samakan ledger dengan posisi yang dipakai: PnL & fee tutup harus berasal dari exit yang sama.
 * (Bug lama: posisi diambil dari device A tapi PnL dari device B → exit +86% tapi saldo cuma +14%.)
 * Idempoten: posisi yang sudah cocok tidak diubah.
 */
export function reconcileLedger(positions: Record<string, Position>, ledger: Record<string, LedgerEntry>): Record<string, LedgerEntry> {
  let out = ledger;
  for (const p of Object.values(positions)) {
    if (p.status !== 'closed' || p.exit === undefined) continue;
    const k = `${p.id}:pnl`;
    const cur = ledger[k];
    if (!cur) continue;
    const want = p.reason === 'LIQ' ? -p.margin : pnl(p.dir, p.entry, p.exit, p.qty);
    if (Math.abs(cur.amt - want) <= 1e-9 * Math.max(1, Math.abs(want))) continue;
    if (out === ledger) out = { ...ledger };
    const t = p.closedAt ?? cur.t;
    out[k] = { ...cur, amt: want, t };
    const fk = `${p.id}:fee-close`;
    const f = ledger[fk];
    if (p.reason === 'LIQ') delete out[fk];
    else if (p.closeFee !== undefined) out[fk] = { id: fk, t, amt: -p.closeFee, kind: 'fee', posId: p.id };
    else if (f) {
      // data lama tanpa closeFee: fee tutup sebanding harga exit (exit lama dihitung balik dari PnL lama)
      const oldExit = p.entry + ((p.dir === 'LONG' ? 1 : -1) * cur.amt) / p.qty;
      if (oldExit > 0) out[fk] = { ...f, t, amt: (f.amt * p.exit) / oldExit };
    }
  }
  return out;
}

/** Samakan ledger sesi sekarang + semua arsip (dipakai saat load & sinkron). */
export function reconcileBook(b: Book): Book {
  const ledger = reconcileLedger(b.positions, b.ledger);
  let archives = b.archives;
  for (const [k, a] of Object.entries(b.archives ?? {})) {
    const l = reconcileLedger(a.positions, a.ledger);
    if (l !== a.ledger) archives = { ...archives, [k]: { ...a, ledger: l } };
  }
  return ledger === b.ledger && archives === b.archives ? b : { ...b, ledger, ...(archives ? { archives } : {}) };
}

function mergeArchive(a: ArchivedSession | undefined, b: ArchivedSession): ArchivedSession {
  if (!a) return b;
  return {
    ...a,
    startedAt: Math.min(a.startedAt, b.startedAt),
    endedAt: Math.max(a.endedAt, b.endedAt),
    positions: mergePositions(a.positions, b.positions),
    ledger: { ...a.ledger, ...b.ledger },
  };
}

function mergeArchives(a: Book['archives'], b: Book['archives']) {
  const out: Record<string, ArchivedSession> = { ...(a ?? {}) };
  for (const [k, x] of Object.entries(b ?? {})) out[k] = mergeArchive(out[k], x);
  return out;
}

/** Gabungkan dua versi buku (lokal & cloud). Idempoten & deterministik. */
export function mergeBooks(a: Book, b: Book): Book {
  const archives = mergeArchives(a.archives, b.archives);
  const withArch = (x: Book): Book => (Object.keys(archives).length ? { ...x, archives } : x);
  if (a.epoch !== b.epoch) {
    const [win, lose] = a.epoch > b.epoch ? [a, b] : [b, a];
    // device yang belum tahu ada sesi baru: trade selesainya ikut masuk arsip sesi lamanya
    const k = String(lose.epoch);
    if (archives[k]) archives[k] = mergeArchive(archives[k], sessionArchive(lose, archives[k].endedAt));
    return reconcileBook({ ...withArch(win), settings: migrateSettings(newer(a.settings, b.settings)) });
  }
  const positions = mergePositions(a.positions, b.positions);
  const orders = { ...a.orders };
  for (const [id, o] of Object.entries(b.orders)) {
    const cur = orders[id];
    if (!cur) orders[id] = o;
    else if (ORDER_RANK[o.status] !== ORDER_RANK[cur.status]) orders[id] = ORDER_RANK[o.status] > ORDER_RANK[cur.status] ? o : cur;
    else orders[id] = newer(cur, o);
  }
  const startBalance = a.startBalance ?? b.startBalance;
  const startIdr = a.startIdr ?? b.startIdr;
  const idrRate = a.idrRate ?? b.idrRate;
  return reconcileBook(withArch({
    epoch: a.epoch,
    epochStartedAt: Math.min(a.epochStartedAt, b.epochStartedAt),
    ...(startBalance !== undefined ? { startBalance } : {}),
    ...(startIdr !== undefined ? { startIdr } : {}),
    ...(idrRate !== undefined ? { idrRate } : {}),
    positions,
    orders,
    ledger: { ...a.ledger, ...b.ledger },
    settings: migrateSettings(newer(a.settings, b.settings)),
  }));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
