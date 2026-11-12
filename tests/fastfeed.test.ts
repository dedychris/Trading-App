import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/notify', () => ({ beep: vi.fn(), systemNotify: vi.fn() }));
vi.mock('../src/lib/scanner', () => ({ analyzeSymbol: vi.fn(async () => { throw new Error('offline'); }) }));
vi.mock('../src/lib/binance', () => ({
  getFundingHistory: vi.fn(async () => []),
  getKlinesRange: vi.fn(async () => []),
  subscribePrices: vi.fn(() => () => {}),
  subscribeTrades: vi.fn(() => () => {}),
}));

const { useApp, openPosition } = await import('../src/store/app');
const { emptyBook } = await import('../src/store/book');
const { onTrade, flushTrades, onPrices, fastSymbols } = await import('../src/store/engine');

describe('harga realtime (aggTrade)', () => {
  beforeEach(() => {
    useApp.setState({ book: emptyBook(), prices: {}, detail: null } as never);
  });

  it('koin dengan posisi / detail terbuka masuk jalur cepat', () => {
    openPosition({ symbol: 'BNBUSDT', dir: 'SHORT', leverage: 20, margin: 100, entry: 673.65, entryType: 'market', snap: null, tpPct: 14, slPct: 7, trailPct: null });
    useApp.setState({ detail: 'SOLUSDT' } as never);
    expect(fastSymbols()).toEqual(['BNBUSDT', 'SOLUSDT']);
  });

  it('trade di-batch, harga tampil = trade terakhir, miniTicker lama tidak menimpa', () => {
    onTrade('ETHUSDT', 3000);
    onTrade('ETHUSDT', 3001.5);
    flushTrades();
    expect(useApp.getState().prices.ETHUSDT).toBe(3001.5);
    onPrices({ ETHUSDT: 2999, XRPUSDT: 2 }); // miniTicker (lebih lambat) datang belakangan
    expect(useApp.getState().prices.ETHUSDT).toBe(3001.5);
    expect(useApp.getState().prices.XRPUSDT).toBe(2);
  });

  it('SL kena walau harga sempat menyentuh lalu balik dalam satu batch', () => {
    const p = openPosition({ symbol: 'ADAUSDT', dir: 'LONG', leverage: 10, margin: 100, entry: 1, entryType: 'market', snap: null, tpPct: 14, slPct: 7, trailPct: null });
    onTrade('ADAUSDT', 1.001);
    onTrade('ADAUSDT', p.sl - 0.0005); // spike ke bawah SL
    onTrade('ADAUSDT', 1.002); // lalu balik
    flushTrades();
    const after = useApp.getState().book.positions[p.id];
    expect(after.status).toBe('closed');
    expect(after.reason).toBe('SL');
  });
});
