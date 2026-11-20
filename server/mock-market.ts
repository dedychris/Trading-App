// Pasar tiruan dari candle 15m historis — untuk tes dan replay (scripts/replay.ts).
import { aggregate } from '../core/backtest.js';
import { TF_MS, type Candle, type TF } from '../core/types.js';
import type { Interval, Market } from './market.js';

const MIN = 60_000;

/** Pasar tiruan dari candle 15m: TF lain digabung, 1m dipecah (high di menit ke-5, low di menit ke-10, atau sebaliknya). */
export function mockMarket(data: Record<string, Candle[]>, clock: { now: number }): Market {
  const cache: Record<string, Candle[]> = {};
  const tfCandles = (sym: string, tf: TF) => (cache[`${sym}${tf}`] ??= aggregate(data[sym], TF_MS['15m'], TF_MS[tf]));
  const idx15 = Object.fromEntries(Object.entries(data).map(([s, c]) => [s, new Map(c.map((x, i) => [x.t, i]))]));
  const minuteBars = (sym: string, from: number, to: number) => {
    const out: Candle[] = [];
    for (let t = Math.floor(from / 900_000) * 900_000; t < to; t += 900_000) {
      const i = idx15[sym].get(t);
      if (i === undefined) continue;
      const x = data[sym][i];
      const up = x.c >= x.o;
      for (let k = 0; k < 15; k++) {
        const bt = t + k * MIN;
        if (bt < from || bt + MIN > to) continue;
        const p = k < 5 ? x.o : k === 5 ? (up ? x.l : x.h) : k < 10 ? (x.o + x.c) / 2 : k === 10 ? (up ? x.h : x.l) : x.c;
        out.push({ t: bt, o: p, h: p, l: p, c: p, v: x.v / 15 });
      }
    }
    return out;
  };
  return {
    async klines(sym, interval: Interval, { limit = 500, startTime }) {
      if (interval === '1m') return minuteBars(sym, startTime ?? clock.now - limit * MIN, Math.min(clock.now, (startTime ?? 0) + limit * MIN)).slice(0, limit);
      const ms = TF_MS[interval as TF];
      return tfCandles(sym, interval as TF).filter((x) => x.t + ms <= clock.now).slice(-limit);
    },
    async price(sym) {
      const t = Math.floor(clock.now / 900_000) * 900_000;
      const i = idx15[sym].get(t);
      return i === undefined ? NaN : data[sym][i].o;
    },
    async minNotional() {
      return {};
    },
  };
}

