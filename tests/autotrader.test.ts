import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TFState } from '../src/lib/signals';

const NOW = Date.now();
let fresh = true;
let sigAge = 20_000;
let wrMock = { pct: 70, coin: { wins: 21, n: 30 }, pool: { wins: 200, n: 300 }, method: 'koin', periodDays: 10 };
vi.mock('../src/store/scan', () => ({ doScan: vi.fn(async () => {}) }));
let minN = 5;
vi.mock('../src/lib/binance', () => ({ minNotional: () => minN, getDerivatives: vi.fn(async () => ({ fundingRate: 0.0001, longPct: 55, oiChange24h: 1, nextFundingTime: 0, markPrice: 1, openInterest: 1, longShortRatio: 1.2 })) }));
vi.mock('../src/lib/backtest', () => ({
  findSignals: () => [{ i: 1, t: fresh ? Date.now() - sigAge : Date.now() - 3_600_000, dir: 'LONG', entry: 100, atrPct: 0.2, f: { volume: true, ema200: true, bollinger: true } }],
  winrate: () => wrMock,
}));

const { useApp } = await import('../src/store/app');
const { runAutoOnce } = await import('../src/store/autotrader');
const { emptyBook } = await import('../src/store/book');

const st = (tf: '15m' | '1h' | '4h', adx = 30, bw = 0.05): TFState =>
  ({ tf, dir: 'LONG', qualifies: true, checks: { ema: true, rsi: true, macd: true, adx: true }, v: { close: 100, ema9: 101, ema21: 100, rsi: 55, macdHist: 1, adx, pdi: 30, mdi: 10, atrPct: 0.2, volRatio: 1.5, ema200: 90, bbMid: 99, bbWidth: bw, bbWidthAvg: 0.04 }, closeTime: NOW }) as TFState;

function setup(rows: { symbol: string; adx15?: number; bw1h?: number }[], btc: 'BULLISH' | 'BEARISH' = 'BULLISH', auto: Record<string, unknown> = {}, prep?: (b: ReturnType<typeof emptyBook>) => void) {
  const book = emptyBook();
  prep?.(book);
  book.settings.auto = { ...book.settings.auto, ...auto, enabled: true, leverage: 10, tpPct: 12, slPct: 6, trailOn: true, trailPct: 4, maxOpen: 2 };
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
  beforeEach(() => {
    fresh = true;
    sigAge = 20_000;
    minN = 5;
    wrMock = { pct: 70, coin: { wins: 21, n: 30 }, pool: { wins: 200, n: 300 }, method: 'koin', periodDays: 10 };
  });
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
  it('sideways tidak memblokir; lewati sinyal lama dan yang melawan BTC', async () => {
    setup([{ symbol: 'AAAUSDT', adx15: 10 }, { symbol: 'BBBUSDT', bw1h: 0.01 }]);
    await runAutoOnce();
    await flush();
    expect(open().map((p) => p.symbol).sort()).toEqual(['AAAUSDT', 'BBBUSDT']);
    fresh = false;
    setup([{ symbol: 'AAAUSDT' }]);
    await runAutoOnce();
    expect(useApp.getState().autoLog[0].text).toMatch(/batas 2 candle/);
    expect(useApp.getState().autoDecision.AAAUSDT.text).toMatch(/^dilewati: sinyal sudah berjalan/);
    fresh = true;
    setup([{ symbol: 'AAAUSDT' }], 'BEARISH');
    await runAutoOnce();
    expect(useApp.getState().autoLog[0].text).toMatch(/melawan arah BTC/);
  });
  it('sinyal yang muncul 1 candle lalu masih boleh di-entry', async () => {
    sigAge = 15 * 60_000 + 20_000;
    setup([{ symbol: 'AAAUSDT' }]);
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(1);
    expect(useApp.getState().autoDecision.AAAUSDT.text).toMatch(/^dibuka/);
  });
  it('syarat winrate mati (default) → winrate rendah tetap entry', async () => {
    wrMock = { pct: 5, coin: { wins: 2, n: 40 }, pool: { wins: 10, n: 200 }, method: 'koin', periodDays: 10 };
    setup([{ symbol: 'AAAUSDT' }]);
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(1);
    expect(useApp.getState().autoLog[0].text).toMatch(/info saja/);
  });
  it('koin yang sudah 3× kena SL hari ini dilewati; 2× masih boleh', async () => {
    const sl = (n: number) => (b: ReturnType<typeof emptyBook>) => {
      for (let i = 0; i < n; i++) b.positions[`x${i}`] = { id: `x${i}`, symbol: 'AAAUSDT', status: 'closed', reason: i === 0 ? 'LIQ' : 'SL', closedAt: Date.now() - 60_000 } as never;
      b.positions.old = { id: 'old', symbol: 'AAAUSDT', status: 'closed', reason: 'SL', closedAt: Date.now() - 3 * 86_400_000 } as never;
    };
    setup([{ symbol: 'AAAUSDT' }], 'BULLISH', {}, sl(3));
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(0);
    expect(useApp.getState().autoLog[0].text).toMatch(/sudah 3× kena SL hari ini/);
    setup([{ symbol: 'AAAUSDT' }], 'BULLISH', {}, sl(2));
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(1);
  });
  it('setting lama dimigrasi: stop rugi −15%, syarat winrate mati, maks 3 SL per koin', async () => {
    const { migrateSettings, defaultSettings } = await import('../src/store/book');
    const old = defaultSettings();
    old.auto = { ...old.auto, dailyLossPct: 5, requireWinrate: true, rulesV: undefined };
    const m = migrateSettings(old);
    expect(m.auto).toMatchObject({ dailyLossPct: 15, requireWinrate: false, maxSlPerCoinDay: 3, rulesV: 5, marginMode: 'percent', marginPercent: 10 });
    expect(migrateSettings({ ...m, auto: { ...m.auto, dailyLossPct: 8 } }).auto.dailyLossPct).toBe(8);
  });
  it('syarat winrate nyala: winrate rendah tapi sampel < 10 → diabaikan & tetap entry; sampel besar → dilewati', async () => {
    wrMock = { pct: 20, coin: { wins: 0, n: 0 }, pool: { wins: 1, n: 5 }, method: 'gabungan', periodDays: 10 };
    setup([{ symbol: 'AAAUSDT' }], 'BULLISH', { requireWinrate: true });
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(1);
    expect(useApp.getState().autoLog[0].text).toMatch(/winrate diabaikan \(sampel 5 < 10\)/);
    wrMock = { pct: 20, coin: { wins: 0, n: 0 }, pool: { wins: 10, n: 50 }, method: 'gabungan', periodDays: 10 };
    setup([{ symbol: 'AAAUSDT' }], 'BULLISH', { requireWinrate: true });
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(0);
    expect(useApp.getState().autoLog[0].text).toMatch(/\(50 kejadian\) di bawah winrate impas/);
  });
  it('compounding "bagi rata": modal 9 USDT dibagi ke maks posisi, cuan ikut jadi modal', async () => {
    const { autoMargin } = await import('../src/store/autotrader');
    setup([{ symbol: 'AAAUSDT' }, { symbol: 'BBBUSDT' }, { symbol: 'CCCUSDT' }], 'BULLISH', { marginMode: 'split' }, (b) => { b.startBalance = 9; });
    await runAutoOnce();
    await flush();
    const ps = open();
    expect(ps.length).toBe(2);
    const b = useApp.getState().book;
    const locked = ps.reduce((x, p) => x + p.margin, 0);
    expect(locked).toBeGreaterThan(8.9); // hampir seluruh saldo terpakai (sisa = fee buka)
    expect(locked + 1e-9).toBeLessThanOrEqual(9);
    const { walletBalance } = await import('../src/store/book');
    expect(walletBalance(b) - locked).toBeGreaterThanOrEqual(-1e-9); // saldo tersedia tidak minus
    // saldo naik 10% → jatah per posisi ikut naik
    const bigger = { ...b, positions: {}, ledger: { ...b.ledger, x: { id: 'x', t: 1, amt: 0.9, kind: 'pnl' as const, posId: 'x' } } };
    expect(autoMargin(b.settings.auto, bigger)).toBeGreaterThan(4.9);
  });
  it('default margin auto = 10% saldo', async () => {
    setup([{ symbol: 'AAAUSDT' }], 'BULLISH', {}, (b) => { b.startBalance = 9; });
    await runAutoOnce();
    await flush();
    expect(open()[0].margin).toBeCloseTo(0.9, 9);
  });
  it('harga sudah lari > 50% jarak SL dari harga sinyal → dilewati; masih dekat → entry + harga sinyal tersimpan', async () => {
    // SL 6% margin di 10× = 0,6% harga → batas ±0,3%
    setup([{ symbol: 'AAAUSDT' }]);
    useApp.setState({ prices: { AAAUSDT: 100.4 } });
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(0);
    expect(useApp.getState().autoLog[0].text).toMatch(/harga sudah lari \+0\.40% dari harga sinyal/);
    setup([{ symbol: 'AAAUSDT' }]);
    useApp.setState({ prices: { AAAUSDT: 99.8 } });
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(1);
    expect(open()[0].snapEntry).toMatchObject({ signalPrice: 100 });
    setup([{ symbol: 'AAAUSDT' }], 'BULLISH', { maxDriftPct: 0 });
    useApp.setState({ prices: { AAAUSDT: 103 } });
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(1); // 0 = cek mati
  });
  it('stop rugi harian ikut menghitung risiko posisi terbuka', async () => {
    const { openRisk } = await import('../src/store/autotrader');
    // saldo awal hari ini 10.000, sudah rugi 1.300 (13%), batas 15% → sisa ruang 200
    const prep = (openMargin: number) => (b: ReturnType<typeof emptyBook>) => {
      b.ledger.loss = { id: 'loss', t: Date.now() - 60_000, amt: -1300, kind: 'pnl', posId: 'z' };
      if (openMargin) b.positions.o = { id: 'o', symbol: 'ZZZUSDT', dir: 'LONG', leverage: 10, margin: openMargin, qty: (openMargin * 10) / 100, entry: 100, tp: 101.2, sl: 99.4, liq: 90.5, entryType: 'market', openedAt: 0, status: 'open', checkedUntil: 0, fundingUntil: 0, snapEntry: null, updatedAt: 0, auto: false };
    };
    // posisi terbuka margin 3000 → kalau SL ≈ −198 → total −1498 → sinyal baru (margin 10% saldo) bisa lewat batas
    setup([{ symbol: 'AAAUSDT' }], 'BULLISH', { dailyLossPct: 15 }, prep(3000));
    expect(openRisk(useApp.getState().book)).toBeCloseTo(-180 - 99.4 * 300 * 0.0005, 6);
    await runAutoOnce();
    await flush();
    expect(open().filter((p) => p.auto).length).toBe(0);
    expect(useApp.getState().autoLog[0].text).toMatch(/bisa lewat batas −15%/);
    // posisi terbuka sendiri sudah memakan sisa ruang → tahan seluruh run
    setup([{ symbol: 'AAAUSDT' }], 'BULLISH', { dailyLossPct: 15 }, prep(3500));
    await runAutoOnce();
    expect(useApp.getState().autoLog[0].text).toMatch(/^Tahan dulu/);
    // tanpa posisi terbuka & margin kecil → masih entry
    setup([{ symbol: 'AAAUSDT' }], 'BULLISH', { dailyLossPct: 15, marginMode: 'fixed', marginFixed: 100 }, prep(0));
    await runAutoOnce();
    await flush();
    expect(open().filter((p) => p.auto).length).toBe(1);
  });
  it('nilai posisi di bawah minimal Binance → dilewati dengan alasan', async () => {
    minN = 100;
    setup([{ symbol: 'AAAUSDT' }], 'BULLISH', { marginMode: 'split' }, (b) => { b.startBalance = 9; });
    await runAutoOnce();
    await flush();
    expect(open().length).toBe(0);
    expect(useApp.getState().autoLog[0].text).toMatch(/di bawah minimal Binance 100\.00 USDT/);
  });
});
