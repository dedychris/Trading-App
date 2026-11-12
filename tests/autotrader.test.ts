import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TFState } from '../src/lib/signals';

const NOW = Date.now();
let fresh = true;
vi.mock('../src/store/scan', () => ({ doScan: vi.fn(async () => {}) }));
vi.mock('../src/lib/binance', () => ({ getDerivatives: vi.fn(async () => ({ fundingRate: 0.0001, longPct: 55, oiChange24h: 1, nextFundingTime: 0, markPrice: 1, openInterest: 1, longShortRatio: 1.2 })) }));
vi.mock('../src/lib/backtest', () => ({
  findSignals: () => [{ i: 1, t: fresh ? NOW - 20_000 : NOW - 3_600_000, dir: 'LONG', entry: 100, atrPct: 0.2, f: { volume: true, ema200: true, bollinger: true } }],
  winrate: () => ({ pct: 70, coin: { wins: 21, n: 30 }, pool: { wins: 200, n: 300 }, method: 'koin', periodDays: 10 }),
}));

const { useApp } = await import('../src/store/app');
const { runAutoOnce } = await import('../src/store/autotrader');
const { emptyBook } = await import('../src/store/book');

const st = (tf: '15m' | '1h' | '4h', adx = 30, bw = 0.05): TFState =>
  ({ tf, dir: 'LONG', qualifies: true, checks: { ema: true, rsi: true, macd: true, adx: true }, v: { close: 100, ema9: 101, ema21: 100, rsi: 55, macdHist: 1, adx, pdi: 30, mdi: 10, atrPct: 0.2, volRatio: 1.5, ema200: 90, bbMid: 99, bbWidth: bw, bbWidthAvg: 0.04 }, closeTime: NOW }) as TFState;

function setup(rows: { symbol: string; adx15?: number; bw1h?: number }[], btc: 'BULLISH' | 'BEARISH' = 'BULLISH') {
  const book = emptyBook();
  book.settings.auto = { ...book.settings.auto, enabled: true, leverage: 10, tpPct: 12, slPct: 6, trailOn: true, trailPct: 4, maxOpen: 2 };
  useApp.setState({
    book,
    autoLog: [],
    autoRun: {},
    prices: {},
    scan: {
      status: 'done', done: 1, total: 1,
      result: {
        at: NOW, failed: [], series: Object.fromEntries(rows.map((r) => [r.symbol, {}])),
        btc: { trend: btc, tf: { '15m': null, '1h': null, '4h': null }, price: 1, change24h: 0 },
        rows: rows.map((r) => ({ symbol: r.symbol, price: 100, change24h: 0, quoteVolume: 1, setup: { key: 'GOLD', dir: 'LONG' }, tf: { '15m': st('15m', r.adx15 ?? 30), '1h': st('1h', 30, r.bw1h ?? 0.05), '4h': st('4h') } })),
      },
    },
  } as never);
}
const flush = () => new Promise((r) => setTimeout(r, 20));
const open = () => Object.values(useApp.getState().book.positions).filter((p) => p.status === 'open');

describe('auto trading', () => {
  beforeEach(() => { fresh = true; });
  it('buka posisi Golden baru dengan setting auto (TP/SL/trailing, label AUTO), maks posisi dihormati', async () => {
    setup([{ symbol: 'AAAUSDT' }, { symbol: 'BBBUSDT' }, { symbol: 'CCCUSDT' }]);
    await runAutoOnce();
    await flush();
    const ps = open();
    expect(ps.length).toBe(2);
    expect(ps[0].auto).toBe(true);
    expect(ps[0].leverage).toBe(10);
    expect(ps[0].tpPct).toBe(12);
    expect(ps[0].trailPct).toBe(4);
    expect(ps[0].tp).toBeCloseTo(101.2);
    expect(useApp.getState().autoLog.some((l) => /maks 2/.test(l.text))).toBe(true);
    // jalan lagi di candle yang sama → tidak dobel
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(2);
  });
  it('lewati sideways, sinyal lama, dan yang melawan BTC', async () => {
    setup([{ symbol: 'AAAUSDT', adx15: 18 }, { symbol: 'BBBUSDT', bw1h: 0.01 }]);
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(0);
    const logs = useApp.getState().autoLog.map((l) => l.text).join('\n');
    expect(logs).toMatch(/sideways — ADX/);
    expect(logs).toMatch(/Bollinger 1H menyempit/);
    fresh = false;
    setup([{ symbol: 'AAAUSDT' }]);
    await runAutoOnce();
    expect(useApp.getState().autoLog[0].text).toMatch(/bukan sinyal baru/);
    fresh = true;
    setup([{ symbol: 'AAAUSDT' }], 'BEARISH');
    await runAutoOnce();
    expect(useApp.getState().autoLog[0].text).toMatch(/melawan arah BTC/);
  });
});
