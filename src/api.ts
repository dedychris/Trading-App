import type { BotConfig } from '../core/config';
import type { PublicView } from '../server/runner';

export type View = PublicView;

const KEY = 'tb-bot-key';
export const getKey = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};
export const setKey = (k: string) => {
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* storage diblokir */
  }
};

async function call<T>(action: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/bot?action=${action}`, {
    method: body === undefined && action === 'state' ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-bot-key': getKey() },
    body: body === undefined && action === 'state' ? undefined : JSON.stringify(body ?? {}),
  });
  const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as T & { error?: string };
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export const api = {
  state: () => call<View>('state'),
  check: () => call<{ ok: boolean }>('check', {}),
  config: (config: Partial<BotConfig>) => call<View>('config', { config }),
  pause: () => call<View>('pause', {}),
  resume: () => call<View>('resume', {}),
  reset: (b: { balanceIdr?: number; balanceUsdt?: number }) => call<View>('reset', b),
  close: (id: string) => call<View>('close', { id }),
  tick: () => call<{ ok: boolean; lastError: string | null }>('tick', {}),
};

/** Harga live semua koin (lewat proxy Binance). */
export async function fetchPrices(): Promise<Record<string, number>> {
  const r = await fetch('/api/binance?p=/fapi/v1/ticker/price');
  if (!r.ok) throw new Error(`harga gagal (${r.status})`);
  const rows = (await r.json()) as { symbol: string; price: string }[];
  return Object.fromEntries(rows.map((x) => [x.symbol, +x.price]));
}

export type BacktestJson = {
  generatedAt: number;
  period: { from: number; to: number };
  coins: number;
  startBalance: number;
  best: string;
  years: string[];
  variants: { name: string; mode: string; n: number; winrate: number; avgR: number; totalR: number; pf: number | null; returnPct: number; maxDdPct: number; perYear: number[] }[];
  monthly: Record<string, number>;
  perCoin: { koin: string; trade: number; winrate: string; 'total R': number }[];
  small: { startUsdt: number; startIdr: number; n: number; winrate: number; returnPct: number; maxDdPct: number };
};
