import { describe, expect, it } from 'vitest';
import { priceAtRoe, roeAt, step, trailStopRoe, type PosLike } from '../src/lib/trailing';
import { tpSlPrices } from '../src/lib/sim';
import { mergeBooks, emptyBook } from '../src/store/book';

// LONG entry 100, 10×, TP +12% margin (harga 101.2), SL −6% (99.4), trailing 4%
const mk = (trailPct: number | null): PosLike => {
  const { tp, sl } = tpSlPrices('LONG', 100, 10, 12, 6);
  return { dir: 'LONG', entry: 100, leverage: 10, tp, sl, liq: 90.5, tpPct: 12, trailPct };
};

describe('trailing TP', () => {
  it('TP/SL custom: 12%/6% di 10× = harga ±1,2% / ±0,6%', () => {
    const { tp, sl } = tpSlPrices('LONG', 100, 10, 12, 6);
    expect(tp).toBeCloseTo(101.2);
    expect(sl).toBeCloseTo(99.4);
  });
  it('tanpa trailing: tutup di TP', () => {
    expect(step(mk(null), { active: false, peakRoe: 0 }, 101.5, 100.5).exit).toEqual({ reason: 'TP', price: expect.closeTo(101.2) });
  });
  it('dengan trailing: nyentuh TP tidak ditutup, profit dibiarkan jalan, keluar di puncak − jarak', () => {
    const p = mk(4);
    let r = step(p, { active: false, peakRoe: 0 }, 101.3, 100.9);
    expect(r.exit).toBeNull();
    expect(r.st.active).toBe(true);
    r = step(p, r.st, 102.0, 101.5); // puncak +20%
    expect(r.exit).toBeNull();
    expect(r.st.peakRoe).toBeCloseTo(20);
    expect(trailStopRoe(12, 4, r.st.peakRoe)).toBeCloseTo(16);
    r = step(p, r.st, 101.7, 101.5); // turun ke +15% → kena batas +16%
    expect(r.exit?.reason).toBe('TRAIL');
    expect(roeAt('LONG', 100, 10, r.exit!.price)).toBeCloseTo(16);
  });
  it('balik langsung setelah aktif → minimal tetap dapat TP awal', () => {
    const p = mk(4);
    const r1 = step(p, { active: false, peakRoe: 0 }, 101.25, 101.0);
    const r2 = step(p, r1.st, 101.1, 100.8);
    expect(r2.exit?.reason).toBe('TRAIL');
    expect(r2.exit!.price).toBeCloseTo(priceAtRoe('LONG', 100, 10, 12));
  });
  it('SHORT simetris & SL tetap jalan sebelum trailing aktif', () => {
    const { tp, sl } = tpSlPrices('SHORT', 100, 10, 12, 6);
    const p: PosLike = { dir: 'SHORT', entry: 100, leverage: 10, tp, sl, liq: 109.5, tpPct: 12, trailPct: 4 };
    expect(step(p, { active: false, peakRoe: 0 }, 100.7, 99.9).exit?.reason).toBe('SL');
    const r = step(p, { active: false, peakRoe: 0 }, 99.5, 98.5);
    expect(r.st.active).toBe(true);
    expect(r.st.peakRoe).toBeCloseTo(15);
  });
  it('sinkron: trailing aktif & puncak tertinggi dipertahankan', () => {
    const a = emptyBook();
    const b = structuredClone(a);
    const base = { id: 'p', status: 'open', checkedUntil: 0, fundingUntil: 0 } as never;
    a.positions.p = { ...(base as object), updatedAt: 5, trailActive: false, peakRoe: 0 } as never;
    b.positions.p = { ...(base as object), updatedAt: 1, trailActive: true, peakRoe: 18 } as never;
    const m = mergeBooks(a, b);
    expect(m.positions.p.trailActive).toBe(true);
    expect(m.positions.p.peakRoe).toBe(18);
  });
});
