// Data pasar live dari Binance USDⓈ-M Futures (endpoint publik). Bot jalan di Vercel region Tokyo karena Binance memblokir IP Amerika.
import type { Candle } from '../core/types.js';

export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface Market {
  klines(symbol: string, interval: Interval, opts: { limit?: number; startTime?: number }): Promise<Candle[]>;
  price(symbol: string): Promise<number>;
  minNotional(): Promise<Record<string, number>>;
}

const BASE = 'https://fapi.binance.com';

async function getJson<T>(path: string): Promise<T> {
  let last: unknown;
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(BASE + path, { headers: { accept: 'application/json' } });
      if (r.ok) return (await r.json()) as T;
      last = new Error(`Binance ${r.status}: ${(await r.text()).slice(0, 160)}`);
      if (r.status === 451 || r.status === 400) break;
    } catch (e) {
      last = e;
    }
    await new Promise((res) => setTimeout(res, 300 * (k + 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export const binance: Market = {
  async klines(symbol, interval, { limit = 500, startTime }) {
    const q = new URLSearchParams({ symbol, interval, limit: String(limit) });
    if (startTime) q.set('startTime', String(startTime));
    const rows = await getJson<unknown[][]>(`/fapi/v1/klines?${q}`);
    return rows.map((r) => ({ t: +(r[0] as number), o: +(r[1] as string), h: +(r[2] as string), l: +(r[3] as string), c: +(r[4] as string), v: +(r[5] as string) }));
  },
  async price(symbol) {
    const j = await getJson<{ price: string }>(`/fapi/v1/ticker/price?symbol=${symbol}`);
    return +j.price;
  },
  async minNotional() {
    type F = { filterType: string; notional?: string };
    const info = await getJson<{ symbols: { symbol: string; filters?: F[] }[] }>('/fapi/v1/exchangeInfo');
    const out: Record<string, number> = {};
    for (const s of info.symbols) {
      const n = +(s.filters?.find((f) => f.filterType === 'MIN_NOTIONAL')?.notional ?? 0);
      if (n > 0) out[s.symbol] = n;
    }
    return out;
  },
};

/** Kurs USDT → Rupiah (Indodax), cadangan 16.500. */
export async function idrRate(): Promise<number> {
  try {
    const r = await fetch('https://indodax.com/api/ticker/usdtidr');
    const j = (await r.json()) as { ticker?: { last?: string } };
    const v = +(j.ticker?.last ?? 0);
    if (v > 1000) return v;
  } catch {
    /* pakai cadangan */
  }
  return 16_500;
}
