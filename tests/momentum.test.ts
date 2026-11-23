import { describe, expect, it } from 'vitest';
import type { Candle } from '../src/lib/binance';
import { DAY, momentumRun, momSignal } from '../src/lib/momentum';
import { emptyBook, mergeBooks, walletBalance } from '../src/store/book';
import type { Book } from '../src/store/types';

const T0 = Date.UTC(2026, 0, 1);
/** Candle harian: hari ke-d, close = f(d), sedikit goyang supaya volatilitas > 0. */
function series(days: number, f: (d: number) => number): Candle[] {
  return Array.from({ length: days }, (_, d) => {
    const c = f(d) * (1 + (d % 2 ? 0.01 : -0.01));
    return { t: T0 + d * DAY, o: c, h: c * 1.02, l: c * 0.98, c, v: 1 };
  });
}
const noMin = () => 5;
const book0 = (): Book => {
  const b = emptyBook(1, { startBalance: 1000 });
  b.settings.mom = { enabled: true, lookback: 30, volPct: 0.1, leverage: 2 };
  return b;
};
// 40 candle harian; candle terakhir yang sudah close: hari ke-39, close di T0 + 40 hari
const up = series(40, (d) => 100 + d);
const down = series(40, (d) => 200 - d);
const now = T0 + 40 * DAY + 5 * 60_000;

describe('auto Momentum harian', () => {
  it('sinyal: naik 30 hari → LONG, turun → SHORT', () => {
    expect(momSignal(up, 39, 30)?.dir).toBe('LONG');
    expect(momSignal(down, 39, 30)?.dir).toBe('SHORT');
    expect(momSignal(up, 10, 30)).toBeNull(); // data kurang
  });

  it('buka posisi di harga close harian, id deterministik, ukuran ikut volatilitas', () => {
    const r = momentumRun(book0(), { BTCUSDT: up, ETHUSDT: down }, now, noMin);
    const T = T0 + 40 * DAY;
    const btc = r.book.positions[`mom-BTCUSDT-${T}`];
    const eth = r.book.positions[`mom-ETHUSDT-${T}`];
    expect(btc).toMatchObject({ dir: 'LONG', entry: up[39].c, strategy: 'MOM', auto: true, leverage: 2, openedAt: T, status: 'open' });
    expect(eth).toMatchObject({ dir: 'SHORT', entry: down[39].c });
    const vol = momSignal(up, 39, 30)!.vol;
    expect(btc.qty * btc.entry).toBeCloseTo((1000 * 0.001) / vol, 6);
    expect(btc.margin).toBeCloseTo((btc.qty * btc.entry) / 2, 9);
    expect(r.book.ledger[`${btc.id}:fee-open`].amt).toBeCloseTo(-btc.qty * btc.entry * 0.0005, 9);
    expect(r.book.bot?.momLastT).toBe(T);
  });

  it('idempoten: dijalankan ulang tidak membuka dobel', () => {
    const r1 = momentumRun(book0(), { BTCUSDT: up }, now, noMin);
    const r2 = momentumRun(r1.book, { BTCUSDT: up }, now + 3_600_000, noMin);
    expect(r2.book).toBe(r1.book);
  });

  it('arah berbalik → tutup (FLIP) di close & buka arah baru; arah sama → dibiarkan', () => {
    const r1 = momentumRun(book0(), { BTCUSDT: up, ETHUSDT: down }, now, noMin);
    // hari ke-40: BTC turun ke 105, di bawah harga 30 hari lalu (±109), belum sampai likuidasi, ETH tetap turun
    const up2 = [...up, { t: T0 + 40 * DAY, o: 105, h: 106, l: 104, c: 105, v: 1 }];
    const down2 = series(41, (d) => 200 - d);
    const r2 = momentumRun(r1.book, { BTCUSDT: up2, ETHUSDT: down2 }, now + DAY, noMin);
    const T1 = T0 + 40 * DAY, T2 = T0 + 41 * DAY;
    const old = r2.book.positions[`mom-BTCUSDT-${T1}`];
    expect(old).toMatchObject({ status: 'closed', reason: 'FLIP', exit: 105, closedAt: T2 });
    expect(r2.book.ledger[`${old.id}:pnl`].amt).toBeCloseTo((105 - old.entry) * old.qty, 9);
    expect(r2.book.positions[`mom-BTCUSDT-${T2}`]).toMatchObject({ dir: 'SHORT', entry: 105, status: 'open' });
    expect(r2.book.positions[`mom-ETHUSDT-${T1}`].status).toBe('open');
    expect(r2.book.positions[`mom-ETHUSDT-${T2}`]).toBeUndefined();
    expect(r2.events.some((e) => e.text.includes('berbalik'))).toBe(true);
  });

  it('app & server menghasilkan buku yang sama → sinkron aman', () => {
    const a = momentumRun(book0(), { BTCUSDT: up, ETHUSDT: down }, now, noMin, 'app').book;
    const b = momentumRun(book0(), { BTCUSDT: up, ETHUSDT: down }, now + 60_000, noMin, 'server').book;
    const m = mergeBooks(a, b);
    expect(Object.keys(m.positions).sort()).toEqual(Object.keys(a.positions).sort());
    expect(walletBalance(m)).toBeCloseTo(walletBalance(a), 9);
    expect(m.bot?.momLastT).toBe(a.bot?.momLastT);
  });

  it('nilai posisi di bawah minimal Binance → dilewati dengan alasan', () => {
    const r = momentumRun(book0(), { BTCUSDT: up }, now, () => 1e9);
    expect(Object.keys(r.book.positions)).toHaveLength(0);
    expect(r.events[0].text).toContain('minimal Binance');
  });

  it('mati → tidak melakukan apa-apa', () => {
    const b = book0();
    b.settings.mom.enabled = false;
    expect(momentumRun(b, { BTCUSDT: up }, now, noMin).book).toBe(b);
  });

  it('likuidasi dicek pakai high/low candle harian', () => {
    const r1 = momentumRun(book0(), { BTCUSDT: up }, now, noMin);
    const p = Object.values(r1.book.positions)[0];
    const crash = [...up, { t: T0 + 40 * DAY, o: 130, h: 131, l: p.liq * 0.9, c: 139.5, v: 1 }];
    const r2 = momentumRun(r1.book, { BTCUSDT: crash }, now + DAY, noMin);
    expect(r2.book.positions[p.id]).toMatchObject({ status: 'closed', reason: 'LIQ', exit: p.liq });
    expect(r2.book.ledger[`${p.id}:pnl`].amt).toBeCloseTo(-p.margin, 9);
  });
});
