import { describe, expect, it } from 'vitest';
import { features, matchPatterns, allPatterns } from '../src/lib/patterns';
import { emptyBook } from '../src/store/book';
import type { TFState } from '../src/lib/signals';
import type { Position } from '../src/store/types';

const st = (adx: number, vol: number) =>
  ({ tf: '15m', dir: 'LONG', qualifies: true, checks: {}, v: { adx, rsi: 50, volRatio: vol, atrPct: 0.2, close: 1 }, closeTime: 0 }) as unknown as TFState;

function trade(id: string, reason: 'TP' | 'SL', adx: number, vol: number, btc: 'BEARISH' | 'BULLISH'): Position {
  return {
    id, symbol: 'ETHUSDT', dir: 'LONG', leverage: 20, margin: 100, qty: 1, entry: 1, tp: 1, sl: 1, liq: 1, entryType: 'market',
    openedAt: 0, status: 'closed', reason, exit: 1, closedAt: 1, checkedUntil: 0, fundingUntil: 0, updatedAt: 0,
    snapEntry: { t: 0, price: 1, tf: { '15m': st(adx, vol) }, setup: { key: '15M1H', dir: 'LONG' }, btcTrend: btc, funding: null, longPct: null, oiChange24h: null, winrate: null, winrateN: null },
  };
}

describe('pola', () => {
  it('pola SL yang berulang ≥3 kali memunculkan peringatan, pola TP ditandai', () => {
    const b = emptyBook();
    ['a', 'b', 'c'].forEach((id) => (b.positions[id] = trade(id, 'SL', 15, 0.5, 'BEARISH')));
    ['d', 'e', 'f'].forEach((id) => (b.positions[id] = trade(id, 'TP', 35, 2, 'BULLISH')));
    const badSig = features({ setupKey: '15M1H', dir: 'LONG', tf: { '15m': st(15, 0.5) }, btcTrend: 'BEARISH', leverage: 20, symbol: 'SOLUSDT' });
    const m = matchPatterns(badSig, b);
    expect(m.bad?.n).toBe(3);
    expect(m.bad?.wins).toBe(0);
    expect(m.good).toBeNull();
    const goodSig = features({ setupKey: '15M1H', dir: 'LONG', tf: { '15m': st(35, 2) }, btcTrend: 'BULLISH', leverage: 20, symbol: 'SOLUSDT' });
    expect(matchPatterns(goodSig, b).good?.wins).toBe(3);
    const all = allPatterns(b);
    expect(all.best.length).toBeGreaterThan(0);
    expect(all.worst.length).toBeGreaterThan(0);
  });
  it('kurang dari 3 kali → belum dianggap pola', () => {
    const b = emptyBook();
    ['a', 'b'].forEach((id) => (b.positions[id] = trade(id, 'SL', 15, 0.5, 'BEARISH')));
    const sig = features({ setupKey: '15M1H', dir: 'LONG', tf: { '15m': st(15, 0.5) }, btcTrend: 'BEARISH', leverage: 20 });
    expect(matchPatterns(sig, b)).toEqual({ bad: null, good: null });
  });
});
