// Penyimpanan state bot. Produksi: tabel Supabase `bot_kv` lewat REST (service role key, hanya di server).
// Lokal/dev tanpa Supabase: file JSON.
import type { BotState } from './runner.js';

export interface Store {
  load(): Promise<{ state: BotState | null; version: number }>;
  /** Simpan kalau versi belum berubah sejak load. false = ada proses lain yang menyimpan duluan. */
  save(state: BotState, version: number): Promise<boolean>;
}

export function supabaseStore(url: string, key: string, row = 'main'): Store {
  const base = `${url.replace(/\/$/, '')}/rest/v1/bot_kv`;
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  return {
    async load() {
      const r = await fetch(`${base}?key=eq.${row}&select=value,version`, { headers });
      if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const rows = (await r.json()) as { value: BotState; version: number }[];
      return rows.length ? { state: rows[0].value, version: rows[0].version } : { state: null, version: 0 };
    },
    async save(state, version) {
      const body = JSON.stringify({ value: state, version: version + 1, updated_at: new Date().toISOString() });
      if (version === 0) {
        const r = await fetch(base, { method: 'POST', headers: { ...headers, prefer: 'return=representation,resolution=ignore-duplicates' }, body: JSON.stringify({ key: row, value: state, version: 1 }) });
        if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
        return ((await r.json()) as unknown[]).length > 0;
      }
      const r = await fetch(`${base}?key=eq.${row}&version=eq.${version}`, { method: 'PATCH', headers: { ...headers, prefer: 'return=representation' }, body });
      if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return ((await r.json()) as unknown[]).length > 0;
    },
  };
}

export function fileStore(path: string): Store {
  return {
    async load() {
      const fs = await import('node:fs/promises');
      try {
        const j = JSON.parse(await fs.readFile(path, 'utf8')) as { state: BotState; version: number };
        return j;
      } catch {
        return { state: null, version: 0 };
      }
    },
    async save(state, version) {
      const fs = await import('node:fs/promises');
      const cur = await this.load();
      if (cur.version !== version) return false;
      await fs.writeFile(path, JSON.stringify({ state, version: version + 1 }));
      return true;
    },
  };
}

export function storeFromEnv(env: Record<string, string | undefined> = process.env): Store {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return supabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  if (env.VERCEL) throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum diisi di Vercel → Settings → Environment Variables');
  return fileStore(env.BOT_STATE_FILE ?? '.bot-state.json');
}
