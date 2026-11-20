// Putar bot live (server/runner.ts) di data historis dan simpan state-nya ke .bot-state.json,
// supaya dashboard lokal (npm run dev) bisa dicoba tanpa Supabase.
// Pakai: npx tsx scripts/replay.ts <folder-data> [YYYY-MM-DD dari] [YYYY-MM-DD sampai]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Candle } from '../core/types.js';
import { mockMarket } from '../server/mock-market.js';
import { newState, tick } from '../server/runner.js';

const [dir = 'data', a = '2026-08-01', b = '2026-10-31'] = process.argv.slice(2);
const data: Record<string, Candle[]> = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()) {
  const s = f.split('-')[0];
  const arr = (data[s] ??= []);
  for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!l || l.startsWith('open')) continue;
    const p = l.split(',');
    arr.push({ t: +p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] });
  }
}
const from = Date.parse(a);
const to = Date.parse(b);
const clock = { now: from };
const m = mockMarket(data, clock);
const rate = 16_500;
const s = newState(null, 150_000 / rate, rate, from);
for (let t = from + 20_000; t < to; t += 900_000) {
  clock.now = t;
  await tick(s, m, t);
}
s.lastRunAt = Date.now();
writeFileSync('.bot-state.json', JSON.stringify({ state: s, version: 1 }));
console.log(`Replay ${a} → ${b}: ${s.acc.trades.length} trade selesai, ${s.acc.positions.length} posisi terbuka, saldo ${s.acc.balance.toFixed(2)} USDT (awal ${s.acc.startBalance.toFixed(2)}). Disimpan ke .bot-state.json`);
