import { describe, expect, it } from 'vitest';
import { csvExtra } from '../src/components/HistoryPage';
import type { Position } from '../src/store/types';

describe('CSV: kolom analisa', () => {
  it('indikator saat entry, SL vs ATR, dan telat dari sinyal', () => {
    const v = (rsi: number, adx: number, atrPct = 0.5) => ({ v: { rsi, adx, atrPct, volRatio: 1.3 } });
    const p = {
      leverage: 10, slPct: 7, entry: 100.2, openedAt: Date.UTC(2026, 10, 15, 0, 7, 25),
      snapEntry: { signalPrice: 100, signalT: Date.UTC(2026, 10, 15, 0, 0), tf: { '15m': v(41.2, 22.5, 0.7), '1h': v(45, 30), '4h': v(48, 18) } },
    } as unknown as Position;
    expect(csvExtra(p)).toEqual(['41.2', '22.5', '0.700', '1.30', '45.0', '30.0', '48.0', '18.0', '1.00', '100', '2026-11-15T00:00:00.000Z', '7.4', '0.200']);
    expect(csvExtra({ leverage: 10, entry: 1, openedAt: 0, snapEntry: null } as unknown as Position).every((x) => x === '')).toBe(true);
  });
});
