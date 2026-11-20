import { describe, expect, it } from 'vitest';
import { aggregate } from '../core/backtest';
import { DEFAULT_CONFIG, type BotConfig } from '../core/config';
import { checkExits, newAccount, onBarClose, sizePosition, tryEnter, type Account } from '../core/engine';
import type { Evaluation } from '../core/strategy';

const cfg: BotConfig = { ...DEFAULT_CONFIG, slippagePct: 0 };
const BAR = 14_400_000;

function open(acc: Account, dir: 'LONG' | 'SHORT', price = 100, atr = 1, c: BotConfig = cfg) {
  const ev: Evaluation = { t: 0, bias: dir, dir, setup: 'pullback', close: price, atr, reason: 'tes' };
  const d = tryEnter(acc, c, { symbol: 'SOLUSDT', ev, price, t: 0, btcBias: null, barMs: BAR });
  expect(d.action).toBe('OPEN');
  return acc.positions[0];
}

describe('ukuran posisi', () => {
  it('rugi di SL (termasuk fee) = riskPct % saldo', () => {
    const acc = newAccount(1000);
    const s = sizePosition(acc, cfg, 100, 98, 5);
    if ('error' in s) throw new Error(s.error);
    expect(s.riskUsd).toBeCloseTo(10, 6);
    expect(s.margin).toBeLessThanOrEqual(300 + 1e-9);
  });
  it('di bawah minimal Binance: dinaikkan kalau risiko ≤ 2×, kalau tidak dilewati', () => {
    const acc = newAccount(9);
    const ok = sizePosition(acc, cfg, 100, 98, 5); // posisi alami ±4,5 USDT
    expect('error' in ok).toBe(false);
    const no = sizePosition(acc, cfg, 100, 98, 100); // BTC: minimal 100 USDT
    expect('error' in no).toBe(true);
  });
});

describe('exit', () => {
  it('SL kena → rugi ±1R, dan koin masuk jeda', () => {
    const acc = newAccount(1000);
    const p = open(acc, 'LONG');
    expect(p.sl).toBeCloseTo(98);
    const tr = checkExits(acc, cfg, p, 100.5, 97.9, 1000, BAR)!;
    expect(tr.exitKind).toBe('SL');
    expect(tr.r).toBeCloseTo(-1, 1);
    expect(acc.balance).toBeCloseTo(990, 0);
    expect(acc.cooldown.SOLUSDT).toBeGreaterThan(1000);
  });
  it('SL dan TP1 di bar yang sama → dianggap SL (konservatif)', () => {
    const acc = newAccount(1000);
    const p = open(acc, 'SHORT');
    const tr = checkExits(acc, cfg, p, 102.5, 97, 1000, BAR)!;
    expect(tr.exitKind).toBe('SL');
  });
  it('TP1 → setengah ditutup, SL pindah ke BE, sisanya trailing', () => {
    const acc = newAccount(1000);
    const p = open(acc, 'LONG');
    expect(checkExits(acc, cfg, p, 102.1, 99.5, 1000, BAR)).toBeNull();
    expect(p.tp1Hit).toBe(true);
    expect(p.qtyOpen).toBeCloseTo(p.qty / 2);
    expect(p.sl).toBeGreaterThan(100);
    // harga lari ke 110 → trailing 3×ATR = 107
    expect(checkExits(acc, cfg, p, 110, 106, 2000, BAR)).toBeNull();
    onBarClose(acc, cfg, p, 109, 1, 2000 + BAR, BAR);
    expect(p.sl).toBeCloseTo(107);
    const tr = checkExits(acc, cfg, p, 108, 106.5, 3000, BAR)!;
    expect(tr.exitKind).toBe('TRAIL');
    expect(tr.r).toBeGreaterThan(2);
  });
  it('time stop menutup posisi yang tidak ke mana-mana', () => {
    const c = { ...cfg, timeStopBars: 3 };
    const acc = newAccount(1000);
    const p = open(acc, 'LONG', 100, 1, c);
    expect(onBarClose(acc, c, p, 100.2, 1, 2 * BAR, BAR)).toBeNull();
    const tr = onBarClose(acc, c, p, 100.2, 1, 3 * BAR, BAR)!;
    expect(tr.exitKind).toBe('TIME');
  });
});

describe('rem risiko', () => {
  it('maks posisi searah & satu posisi per koin', () => {
    const acc = newAccount(1000);
    const ev = (dir: 'LONG' | 'SHORT'): Evaluation => ({ t: 0, bias: dir, dir, setup: 'breakout', close: 100, atr: 1, reason: 'tes' });
    const go = (sym: string, dir: 'LONG' | 'SHORT') => tryEnter(acc, cfg, { symbol: sym, ev: ev(dir), price: 100, t: 0, btcBias: null, barMs: BAR });
    expect(go('AUSDT', 'LONG').action).toBe('OPEN');
    expect(go('AUSDT', 'LONG').action).toBe('SKIP');
    expect(go('BUSDT', 'LONG').action).toBe('OPEN');
    expect(go('CUSDT', 'LONG').reason).toMatch(/searah/);
    expect(go('CUSDT', 'SHORT').action).toBe('OPEN');
    expect(go('DUSDT', 'SHORT').reason).toMatch(/maks 3/);
  });
  it('tidak melawan bias BTC', () => {
    const acc = newAccount(1000);
    const ev: Evaluation = { t: 0, bias: 'LONG', dir: 'LONG', setup: 'pullback', close: 100, atr: 1, reason: 'tes' };
    const d = tryEnter(acc, cfg, { symbol: 'SOLUSDT', ev, price: 100, t: 0, btcBias: 'SHORT', barMs: BAR });
    expect(d.action).toBe('SKIP');
  });
});

describe('aggregate', () => {
  it('4 candle 15m → 1 candle 1h, grup tidak lengkap dibuang', () => {
    const m = 900_000;
    const c = [0, 1, 2, 3, 4].map((k) => ({ t: k * m, o: k, h: k + 1, l: k - 1, c: k + 0.5, v: 1 }));
    const h = aggregate(c, m, 4 * m);
    expect(h).toEqual([{ t: 0, o: 0, h: 4, l: -1, c: 3.5, v: 4 }]);
  });
});
