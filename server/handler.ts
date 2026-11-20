// HTTP handler bot: dipakai Vercel Function (api/bot.ts) dan dev server Vite.
//   GET  /api/bot?action=state                → data untuk dashboard (publik, read-only)
//   GET  /api/bot?action=tick&key=SECRET      → jalankan satu tick (dipanggil cron tiap menit)
//   POST /api/bot?action=check|config|pause|resume|reset|close  (header x-bot-key: SECRET)
import type { BotConfig } from '../core/config.js';
import { binance, idrRate, type Market } from './market.js';
import { applyConfig, manualClose, newState, publicView, resetSession, tick, type BotState } from './runner.js';
import { storeFromEnv, type Store } from './store.js';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });

async function loadOrInit(store: Store) {
  const { state, version } = await store.load();
  if (state) return { state, version };
  const rate = await idrRate();
  return { state: newState(null, 150_000 / rate, rate), version: 0 };
}

/** load → ubah → simpan, ulangi sekali kalau bentrok dengan proses lain. */
async function mutate(store: Store, fn: (s: BotState) => Promise<BotState> | BotState) {
  for (let k = 0; k < 3; k++) {
    const { state, version } = await loadOrInit(store);
    const next = await fn(state);
    if (await store.save(next, version)) return next;
  }
  throw new Error('state sedang diubah proses lain, coba lagi');
}

export async function handleBot(req: Request, deps: { store?: Store; market?: Market; secret?: string } = {}): Promise<Response> {
  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') ?? 'state';
  const secret = deps.secret ?? process.env.BOT_SECRET ?? '';
  const m = deps.market ?? binance;
  let store: Store;
  try {
    store = deps.store ?? storeFromEnv();
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  const key = req.headers.get('x-bot-key') ?? url.searchParams.get('key') ?? '';
  const authed = !!secret && key === secret;
  try {
    if (action === 'state') {
      const { state } = await loadOrInit(store);
      return json(publicView(state));
    }
    if (!secret) return json({ error: 'BOT_SECRET belum diisi di environment variables' }, 500);
    if (!authed) return json({ error: 'kunci bot salah' }, 401);
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
    switch (action) {
      case 'check':
        return json({ ok: true });
      case 'tick': {
        const { state, version } = await loadOrInit(store);
        const next = await tick(state, m);
        const saved = await store.save(next, version);
        return json({ ok: saved, skipped: !saved, positions: next.acc.positions.length, lastError: next.lastError, ms: next.lastRunMs });
      }
      case 'config': {
        const s = await mutate(store, (s) => applyConfig(s, (body.config ?? {}) as Partial<BotConfig>));
        return json(publicView(s));
      }
      case 'pause':
      case 'resume': {
        const s = await mutate(store, (s) => {
          s.paused = action === 'pause';
          s.log.unshift({ t: Date.now(), text: s.paused ? '⏸️ Bot di-pause.' : '▶️ Bot jalan lagi.', tone: 'info' });
          if (!s.paused) {
            // jangan proses candle yang lewat selama pause
            s.exitCursor = Math.floor(Date.now() / 60_000) * 60_000;
          }
          return s;
        });
        return json(publicView(s));
      }
      case 'reset': {
        const rate = Number(body.idrRate) > 1000 ? Number(body.idrRate) : await idrRate();
        const bal = Number(body.balanceUsdt) > 0 ? Number(body.balanceUsdt) : Number(body.balanceIdr) > 0 ? Number(body.balanceIdr) / rate : NaN;
        if (!(bal > 0)) return json({ error: 'saldo awal tidak valid' }, 400);
        const s = await mutate(store, (s) => resetSession(s, m, bal, rate));
        return json(publicView(s));
      }
      case 'close': {
        const id = String(body.id ?? '');
        const s = await mutate(store, (s) => manualClose(s, m, id));
        return json(publicView(s));
      }
      default:
        return json({ error: `action tidak dikenal: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
