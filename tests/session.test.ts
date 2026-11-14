import { beforeEach, describe, expect, it } from 'vitest';
import { minNotional, setSymbolRules } from '../src/lib/binance';
import { fmtIdr, fmtUsd, parseIdr } from '../src/lib/format';
import { tradeIndex } from '../src/lib/patterns';
import { useApp, startNewSession, validateOrder, openPosition, closePosition } from '../src/store/app';
import { emptyBook, learningTrades, mergeBooks, migrateSettings, walletBalance, AUTO_RULES_V } from '../src/store/book';
import type { Book } from '../src/store/types';

const RATE = 16_500;

beforeEach(() => {
  useApp.setState({ book: emptyBook(), prices: {} });
  setSymbolRules({ BTCUSDT: [100, 0.001], SOLUSDT: [5, 0.01] });
});

function tradeAndClose(symbol: string, entry: number, exit: number, margin = 100, lev = 10) {
  const p = openPosition({ symbol, dir: 'LONG', leverage: lev, margin, entry, entryType: 'market', snap: null });
  return closePosition(p.id, exit, exit >= entry ? 'TP' : 'SL')!;
}

describe('saldo awal bebas', () => {
  it('sesi lama tanpa angka = 10.000 USDT', () => {
    expect(walletBalance(emptyBook())).toBe(10_000);
  });
  it('mulai sesi baru Rp 150.000 → saldo USDT dari kurs, riwayat lama masuk arsip', () => {
    tradeAndClose('SOLUSDT', 100, 101.4);
    tradeAndClose('SOLUSDT', 100, 99.3);
    const before = useApp.getState().book;
    expect(Object.keys(before.positions)).toHaveLength(2);
    const r = startNewSession({ startBalance: 150_000 / RATE, startIdr: 150_000, idrRate: RATE });
    const b = useApp.getState().book;
    expect(r.archived).toBe(2);
    expect(b.epoch).toBe(2);
    expect(walletBalance(b)).toBeCloseTo(9.0909, 3);
    expect(b.startIdr).toBe(150_000);
    expect(Object.keys(b.positions)).toHaveLength(0);
    expect(Object.keys(b.ledger)).toHaveLength(0);
    // arsip utuh: saldo akhir sesi lama bisa dihitung ulang
    const a = b.archives!['1'];
    expect(Object.keys(a.positions)).toHaveLength(2);
    expect(a.startBalance).toBe(10_000);
    expect(walletBalance({ ...emptyBook(), ledger: a.ledger })).toBeCloseTo(walletBalance(before), 6);
    // tetap dipakai belajar pola
    expect(learningTrades(b)).toHaveLength(2);
    expect(tradeIndex(b)).toHaveLength(2);
    expect(b.settings).toEqual(expect.objectContaining({ marginMode: before.settings.marginMode }));
  });
  it('posisi terbuka ditutup di harga live saat sesi baru, order pending dibatalkan', () => {
    openPosition({ symbol: 'SOLUSDT', dir: 'LONG', leverage: 10, margin: 100, entry: 100, entryType: 'market', snap: null });
    useApp.setState({ prices: { SOLUSDT: 102 } });
    const r = startNewSession({ startBalance: 10 });
    expect(r.closed).toBe(1);
    const a = useApp.getState().book.archives!['1'];
    const p = Object.values(a.positions)[0];
    expect(p.status).toBe('closed');
    expect(p.exit).toBe(102);
    expect(p.reason).toBe('MANUAL');
  });
});

describe('sinkron dengan arsip', () => {
  it('device lama (sesi 1) yang belum tahu sesi baru: trade-nya ikut masuk arsip, tidak hilang', () => {
    tradeAndClose('SOLUSDT', 100, 101.4);
    const stale: Book = structuredClone(useApp.getState().book);
    startNewSession({ startBalance: 9 });
    const fresh = useApp.getState().book;
    // device lama menutup trade lain setelah sesi baru dimulai di device ini
    useApp.setState({ book: stale });
    tradeAndClose('SOLUSDT', 100, 99.3);
    const stale2 = useApp.getState().book;
    const m = mergeBooks(fresh, stale2);
    expect(m.epoch).toBe(2);
    expect(walletBalance(m)).toBe(9);
    expect(Object.keys(m.archives!['1'].positions)).toHaveLength(2);
    expect(mergeBooks(m, stale2)).toEqual(m);
    expect(mergeBooks(m, m)).toEqual(m);
    expect(mergeBooks(stale2, fresh).archives).toEqual(m.archives);
  });
  it('saldo awal & kurs ikut tersinkron', () => {
    const a = emptyBook(3, { startBalance: 9, startIdr: 150_000, idrRate: RATE });
    const m = mergeBooks(a, { ...structuredClone(a), startBalance: undefined, startIdr: undefined, idrRate: undefined });
    expect(m.startBalance).toBe(9);
    expect(m.idrRate).toBe(RATE);
  });
});

describe('minimal order Binance', () => {
  it('nilai posisi minimal = maks(MIN_NOTIONAL, qty minimal × harga)', () => {
    expect(minNotional('SOLUSDT', 150)).toBe(5);
    expect(minNotional('BTCUSDT', 95_000)).toBe(100);
    expect(minNotional('BTCUSDT', 150_000)).toBe(150);
    expect(minNotional('XYZUSDT', 1)).toBe(5); // aturan belum termuat → 5 USDT
  });
  it('order di bawah minimal ditolak, di atasnya lolos', () => {
    useApp.setState({ book: emptyBook(2, { startBalance: 9 }) });
    const base = { symbol: 'SOLUSDT', dir: 'LONG' as const, price: 150, type: 'market' as const, snap: null };
    expect(validateOrder({ ...base, leverage: 5, margin: 0.9 }, 150)).toMatch(/minimal Binance/);
    expect(validateOrder({ ...base, leverage: 10, margin: 0.9 }, 150)).toBeNull();
    expect(validateOrder({ ...base, symbol: 'BTCUSDT', leverage: 10, margin: 0.9 }, 150)).toMatch(/minimal Binance/);
  });
});

describe('format Rupiah & USDT kecil', () => {
  it('parse input Rupiah', () => {
    expect(parseIdr('150.000')).toBe(150_000);
    expect(parseIdr('Rp 150.000')).toBe(150_000);
    expect(parseIdr('150000')).toBe(150_000);
    expect(parseIdr('150rb')).toBe(150_000);
    expect(parseIdr('1,5jt')).toBe(1_500_000);
    expect(parseIdr('1.500.000')).toBe(1_500_000);
    expect(parseIdr('abc')).toBeNaN();
  });
  it('format', () => {
    expect(fmtIdr(150_000)).toBe('Rp 150.000');
    expect(fmtIdr(-74.25, true)).toBe('−Rp 74');
    expect(fmtUsd(10_000)).toBe('10,000.00');
    expect(fmtUsd(9.0909)).toBe('9.09');
    expect(fmtUsd(0.9)).toBe('0.900');
    expect(fmtUsd(0.0045, true)).toBe('+0.0045');
    expect(fmtUsd(-0.00001)).toBe('0.0000');
  });
});

describe('migrasi setting v3', () => {
  it('margin manual & auto jadi 10% saldo', () => {
    const s = emptyBook().settings;
    const old = { ...s, marginMode: 'fixed' as const, marginFixed: 100, auto: { ...s.auto, marginMode: 'fixed' as const, marginFixed: 100, rulesV: 2 } };
    const m = migrateSettings(old);
    expect(m.marginMode).toBe('percent');
    expect(m.marginPercent).toBe(10);
    expect(m.auto.marginMode).toBe('split'); // compounding, modal dibagi rata ke maks posisi
    expect(m.auto.rulesV).toBe(AUTO_RULES_V);
    expect(migrateSettings(m)).toEqual(m); // tidak migrasi ulang
  });
});
