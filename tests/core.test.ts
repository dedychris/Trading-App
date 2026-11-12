import { describe, expect, it } from 'vitest';
import { adx, ema, rsi, sma } from '../src/lib/indicators';
import { moves, previewOrder, tpSlPrices } from '../src/lib/sim';
import { buildSeries, classify, evalTF, type TFState } from '../src/lib/signals';
import { combine, findSignals, resolve } from '../src/lib/backtest';
import { emptyBook, mergeBooks, walletBalance } from '../src/store/book';
import type { Candle } from '../src/lib/binance';

const mk = (closes: number[], step = 900_000, t0 = Date.UTC(2026, 0, 1)): Candle[] =>
  closes.map((c, i) => ({ t: t0 + i * step, o: i ? closes[i - 1] : c, h: Math.max(c, i ? closes[i - 1] : c) * 1.001, l: Math.min(c, i ? closes[i - 1] : c) * 0.999, c, v: 100 }));

describe('indikator', () => {
  it('SMA & EMA seed', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([NaN, 1.5, 2.5, 3.5]);
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
    expect(e[4]).toBeCloseTo(4);
  });
  it('RSI: naik terus = 100, turun terus = 0', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(up).at(-1)).toBe(100);
    const dn = up.slice().reverse();
    expect(rsi(dn).at(-1)).toBeCloseTo(0);
  });
  it('RSI Wilder cocok dengan contoh klasik StockCharts (≈70,46 tanpa pembulatan)', () => {
    const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(c)[14]).toBeCloseTo(70.46, 2);
  });
  it('ADX tinggi saat tren kuat', () => {
    const c = mk(Array.from({ length: 120 }, (_, i) => 100 * 1.004 ** i));
    const a = adx(c);
    expect(a.adx.at(-1)!).toBeGreaterThan(40);
    expect(a.pdi.at(-1)!).toBeGreaterThan(a.mdi.at(-1)!);
  });
});

describe('simulasi', () => {
  it('TP/SL dari margin: 20× → 0,7% / 0,35%', () => {
    const m = moves(20);
    expect(m.tp).toBeCloseTo(0.007);
    expect(m.sl).toBeCloseTo(0.0035);
    const p = tpSlPrices('SHORT', 100, 10);
    expect(p.tp).toBeCloseTo(98.6);
    expect(p.sl).toBeCloseTo(100.7);
  });
  it('fee market 20×: buka+tutup ≈ 2% margin', () => {
    const pv = previewOrder({ dir: 'LONG', entry: 100, leverage: 20, margin: 100, entryType: 'market', bnb: false });
    expect(pv.feeOpen).toBeCloseTo(1);
    expect(pv.netWin).toBeCloseTo(14 - 1 - 1.007, 2);
    expect(pv.netLoss).toBeCloseTo(-7 - 1 - 0.9965, 2);
    expect(pv.breakevenWinrate).toBeGreaterThan(33.3);
  });
});

describe('sinyal & backtest', () => {
  it('klasifikasi grup', () => {
    const q = (dir: 'LONG' | 'SHORT', ok = true) => ({ dir, qualifies: ok }) as TFState;
    expect(classify({ '15m': q('LONG'), '1h': q('LONG'), '4h': q('LONG') })).toEqual({ key: 'GOLD', dir: 'LONG' });
    expect(classify({ '15m': q('LONG', false), '1h': q('LONG'), '4h': q('LONG', false) })).toEqual({ key: '3TF', dir: 'LONG' });
    expect(classify({ '15m': q('SHORT'), '1h': q('LONG'), '4h': q('LONG') })).toEqual({ key: '1H4H', dir: 'LONG' });
    expect(classify({ '15m': q('SHORT'), '1h': q('SHORT', false), '4h': q('LONG') })).toEqual({ key: '15M1H', dir: 'SHORT' });
    expect(classify({ '15m': q('SHORT', false), '1h': q('LONG'), '4h': q('SHORT') })).toEqual({ key: '15M4H', dir: 'SHORT' });
    expect(classify({ '15m': q('SHORT'), '1h': q('LONG', false), '4h': q('SHORT', false) })).toEqual({ key: '15M4H', dir: 'SHORT' });
    // cuma satu TF qualify & dua TF lain berlawanan → tidak tampil
    expect(classify({ '15m': q('SHORT'), '1h': q('LONG', false), '4h': q('LONG', false) })).toBeNull();
    expect(classify({ '15m': q('LONG', false), '1h': q('LONG', false), '4h': q('LONG', false) })).toBeNull();
  });
  it('TP & SL di candle yang sama dihitung KALAH', () => {
    const candles: Candle[] = [
      { t: 0, o: 100, h: 100, l: 100, c: 100, v: 1 },
      { t: 900_000, o: 100, h: 102, l: 98, c: 100, v: 1 },
    ];
    const s = buildSeries('15m', candles);
    expect(resolve(s, { i: 0, t: 900_000, dir: 'LONG', entry: 100, atrPct: 0, f: { volume: true, ema200: true, bollinger: true } }, 10)).toBe('LOSS');
  });
  it('findSignals hanya catat onset & evalTF jalan di data nyata-ish', () => {
    const closes = Array.from({ length: 400 }, (_, i) => 100 + 10 * Math.sin(i / 25) + i * 0.02);
    const ss = { '15m': buildSeries('15m', mk(closes)) };
    const sigs = findSignals(ss, 'S15M', Date.UTC(2027, 0, 1));
    for (let k = 1; k < sigs.length; k++) expect(sigs[k].i).toBeGreaterThan(sigs[k - 1].i);
    expect(evalTF(ss['15m']!, 399)).not.toBeNull();
  });
  it('winrate campuran (opsi C)', () => {
    expect(combine({ wins: 15, n: 20 }, { wins: 50, n: 100 }, 10).pct).toBe(75);
    const c = combine({ wins: 3, n: 4 }, { wins: 50, n: 100 }, 10);
    expect(c.method).toBe('campuran');
    expect(c.pct).toBeCloseTo(((3 + 20 * 0.5) / 24) * 100);
  });
});

describe('sinkron', () => {
  it('ledger digabung tanpa dobel & posisi closed menang', () => {
    const a = emptyBook();
    const b = structuredClone(a);
    const pos = { id: 'p1', status: 'open', updatedAt: 1, checkedUntil: 0, fundingUntil: 0 } as never;
    a.positions.p1 = { ...(pos as object), status: 'closed', updatedAt: 1 } as never;
    b.positions.p1 = { ...(pos as object), updatedAt: 5 } as never;
    a.ledger['p1:pnl'] = { id: 'p1:pnl', t: 1, amt: 50, kind: 'pnl', posId: 'p1' };
    b.ledger['p1:pnl'] = { id: 'p1:pnl', t: 1, amt: 50, kind: 'pnl', posId: 'p1' };
    const m = mergeBooks(a, b);
    expect(m.positions.p1.status).toBe('closed');
    expect(walletBalance(m)).toBe(10_050);
    expect(mergeBooks(m, m)).toEqual(m);
    const reset = emptyBook(2);
    expect(mergeBooks(m, reset).epoch).toBe(2);
  });
});
