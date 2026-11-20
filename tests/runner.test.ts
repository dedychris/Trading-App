// Tes bot live (server/runner.ts) dengan pasar tiruan.
// Bagian "replay" memutar bot di data historis asli (folder DATA_DIR hasil scripts/download-data.sh) dan membandingkan dengan backtest.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../core/backtest';
import { DEFAULT_CONFIG } from '../core/config';
import { TF_MS, type Candle } from '../core/types';
import { mockMarket } from '../server/mock-market';
import { newState, tick } from '../server/runner';

describe('tick', () => {
  it('mengelola SL pakai candle 1m dan mencatat trade', async () => {
    const t0 = Date.UTC(2026, 0, 1);
    const flat: Candle[] = Array.from({ length: 400 * 16 }, (_, k) => ({ t: t0 - 400 * 16 * 900_000 + k * 900_000, o: 100, h: 100.5, l: 99.5, c: 100, v: 10 }));
    const clock = { now: t0 };
    const m = mockMarket({ BTCUSDT: flat, SOLUSDT: flat }, clock);
    const s = newState({ coins: ['SOLUSDT'] }, 1000, 16000, t0);
    s.acc.positions.push({ id: 'x', symbol: 'SOLUSDT', dir: 'LONG', setup: 'pullback', openedAt: t0 - 3_600_000, signalT: 0, entry: 101, qty: 5, qtyOpen: 5, sl: 99.8, initialSl: 99.8, tp1: 103, tp2: 0, tp1Hit: false, peak: 101, riskUsd: 6, leverage: 2, margin: 250, feeOpen: 0.25, fills: [], note: '' });
    s.exitCursor = t0 - 3_600_000;
    await tick(s, m, t0);
    expect(s.acc.positions.length).toBe(0);
    expect(s.acc.trades[0].exitKind).toBe('SL');
    expect(s.log[0].text).toMatch(/Tutup SOL/);
  });
});

const DATA = process.env.DATA_DIR;
describe.skipIf(!DATA || !existsSync(DATA))('replay data asli', () => {
  it('bot live buka posisi dan hasilnya sejalan dengan backtest', async () => {
    const data: Record<string, Candle[]> = {};
    for (const f of readdirSync(DATA!).filter((f) => f.endsWith('.csv')).sort()) {
      const s = f.split('-')[0];
      const arr = (data[s] ??= []);
      for (const l of readFileSync(join(DATA!, f), 'utf8').split('\n')) {
        if (!l || l.startsWith('open')) continue;
        const p = l.split(',');
        arr.push({ t: +p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] });
      }
    }
    const coins = ['SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'LINKUSDT', 'TRXUSDT', 'NEARUSDT'];
    const cfg = { ...DEFAULT_CONFIG, coins };
    const from = Date.UTC(2026, 4, 1);
    const to = Date.UTC(2026, 7, 1);
    const clock = { now: from };
    const m = mockMarket(data, clock);
    const s = newState(cfg, 1000, 16000, from);
    // tick tiap 15 menit (bot asli tiap menit; candle 1m di antaranya tetap diproses dari cursor)
    for (let t = from + 20_000; t < to; t += 900_000) {
      clock.now = t;
      await tick(s, m, t);
    }
    const bt = runBacktest(data, cfg, 1000, { from: from - TF_MS['4h'], to: to - TF_MS['4h'] });
    const live = s.acc.trades.length + s.acc.positions.length;
    const btN = bt.acc.trades.length + bt.acc.positions.length;
    console.log(`replay: live ${live} posisi (${s.acc.trades.length} selesai), backtest ${btN}`);
    expect(s.lastError).toBeNull();
    expect(live).toBeGreaterThan(5);
    expect(Math.abs(live - btN)).toBeLessThanOrEqual(Math.max(3, btN * 0.2));
  }, 120_000);
});
