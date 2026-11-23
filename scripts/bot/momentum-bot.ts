// Bot server auto Momentum (paper trading) — jalan otomatis lewat GitHub Actions (.github/workflows/momentum-bot.yml),
// jadi posisi tetap dibuka/ditutup walau app tidak dibuka. Logika sama persis dengan app (src/lib/momentum.ts).
//
// Env (GitHub → repo → Settings → Secrets and variables → Actions):
//   SUPABASE_URL               Project URL Supabase (sama dengan VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY  Supabase → Project Settings → API → service_role (RAHASIA, jangan taruh di app/Vercel publik)
//   APP_URL                    link app Vercel, mis. https://nama-app.vercel.app (data Binance lewat proxy Tokyo-nya,
//                              karena server GitHub di Amerika diblokir Binance)
// Opsional: DRY_RUN=1 → cuma tampilkan apa yang akan dilakukan, tidak menulis ke Supabase.
import { createClient } from '@supabase/supabase-js';
import type { Candle } from '../../src/lib/binance';
import { lastDailyClose, MOM_COINS, momCandlesNeeded, momentumRun } from '../../src/lib/momentum';
import { mergeBooks, normalizeBook } from '../../src/store/book';
import type { Book } from '../../src/store/types';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`env ${k} belum diisi (lihat komentar di atas file ini)`);
  return v.replace(/\/+$/, '');
};
const DRY = process.env.DRY_RUN === '1';

async function binance<T>(app: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const q = new URLSearchParams({ p: path, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${app}/api/binance?${q}`);
      if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return (await r.json()) as T;
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
  throw last;
}

async function main() {
  const app = env('APP_URL');
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const now = Date.now();
  const latest = lastDailyClose(now);
  console.log(`Momentum bot ${new Date(now).toISOString()} · candle harian terakhir close ${new Date(latest).toISOString()}${DRY ? ' · DRY RUN' : ''}`);

  const { data: rows, error } = await sb.from('books').select('user_id, data');
  if (error) throw new Error(`Supabase: ${error.message}`);
  const todo = (rows ?? [])
    .map((r) => ({ user: r.user_id as string, book: normalizeBook(r.data as Book) }))
    .filter((x) => x.book.settings.mom?.enabled && (x.book.bot?.momLastT ?? 0) < latest);
  console.log(`${rows?.length ?? 0} buku, ${todo.length} perlu diproses`);
  if (!todo.length) return;

  // aturan order minimal Binance (MIN_NOTIONAL & qty minimal)
  const info = await binance<{ rules?: Record<string, [number, number]> }>(app, '/fapi/v1/exchangeInfo').catch(() => ({ rules: undefined }));
  const minNotional = (s: string, price: number) => {
    const r = info.rules?.[s];
    return r ? Math.max(r[0] || 0, (r[1] || 0) * price) : 5;
  };
  const maxLookback = Math.max(...todo.map((x) => x.book.settings.mom.lookback));
  const daily: Record<string, Candle[]> = {};
  for (const s of MOM_COINS) {
    try {
      const rows = await binance<number[][]>(app, '/fapi/v1/klines', { symbol: s, interval: '1d', limit: momCandlesNeeded(maxLookback), compact: 1 });
      daily[s] = rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
    } catch (e) {
      console.log(`  ${s}: gagal ambil candle (${(e as Error).message}) — dilewati`);
    }
  }

  for (const { user, book } of todo) {
    const r = momentumRun(book, daily, Date.now(), minNotional, 'server');
    for (const e of r.events) console.log(`  [${user.slice(0, 8)}] ${e.text}`);
    if (r.book === book) {
      console.log(`  [${user.slice(0, 8)}] belum bisa diproses (data candle belum lengkap)`);
      continue;
    }
    if (DRY) continue;
    // gabung dengan versi terbaru di cloud (bisa saja app baru menulis), lalu simpan
    const { data: cur } = await sb.from('books').select('data').eq('user_id', user).maybeSingle();
    const merged = cur?.data ? mergeBooks(r.book, normalizeBook(cur.data as Book)) : r.book;
    const { error: e2 } = await sb.from('books').upsert({ user_id: user, data: merged, updated_at: new Date().toISOString() });
    if (e2) throw new Error(`Supabase simpan gagal: ${e2.message}`);
    console.log(`  [${user.slice(0, 8)}] tersimpan`);
  }
}

main().catch((e) => {
  console.error(`GAGAL: ${(e as Error).message}`);
  process.exit(1);
});
