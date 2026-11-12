// Sinkron HP <-> laptop lewat Supabase (login Google). Opsional: tanpa env var, app jalan lokal saja.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useApp } from './app';
import { mergeBooks } from './book';
import type { Book } from './types';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY_ = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const syncConfigured = Boolean(URL_ && KEY_);
let sb: SupabaseClient | null = null;
let userId: string | null = null;
let lastPushed = '';
let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

const setSync = (p: Partial<ReturnType<typeof useApp.getState>['sync']>) => useApp.setState({ sync: { ...useApp.getState().sync, ...p } });

export async function initSync() {
  if (!syncConfigured) {
    setSync({ status: 'off' });
    return;
  }
  sb = createClient(URL_!, KEY_!, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
  const { data } = await sb.auth.getSession();
  await onSession(data.session?.user ?? null);
  sb.auth.onAuthStateChange((_e, session) => {
    if ((session?.user?.id ?? null) !== userId) onSession(session?.user ?? null);
  });
  useApp.subscribe((s, prev) => {
    if (s.book !== prev.book && userId && !applyingRemote) schedulePush();
  });
  window.addEventListener('focus', () => userId && pullAndMerge());
}

async function onSession(user: { id: string; email?: string } | null) {
  userId = user?.id ?? null;
  if (!user) {
    setSync({ status: 'signed-out', email: undefined });
    return;
  }
  setSync({ status: 'syncing', email: user.email });
  await pullAndMerge();
  sb!
    .channel('book-' + user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'books', filter: `user_id=eq.${user.id}` }, (payload) => {
      const remote = (payload.new as { data?: Book })?.data;
      if (remote) applyRemote(remote);
    })
    .subscribe();
}

function applyRemote(remote: Book) {
  const local = useApp.getState().book;
  const merged = mergeBooks(local, remote);
  const mj = JSON.stringify(merged);
  if (mj !== JSON.stringify(local)) {
    applyingRemote = true;
    useApp.setState({ book: merged });
    applyingRemote = false;
  }
  if (mj !== JSON.stringify(remote)) schedulePush();
  else lastPushed = mj;
}

async function pullAndMerge() {
  if (!sb || !userId) return;
  try {
    const { data, error } = await sb.from('books').select('data').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (data?.data) applyRemote(data.data as Book);
    else await push();
    setSync({ status: 'synced', at: Date.now(), error: undefined });
  } catch (e) {
    setSync({ status: 'error', error: (e as Error).message });
  }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1500);
}

async function push() {
  if (!sb || !userId) return;
  const book = useApp.getState().book;
  const j = JSON.stringify(book);
  if (j === lastPushed) return;
  setSync({ status: 'syncing' });
  try {
    // ambil versi cloud dulu, gabungkan, baru tulis — supaya tidak menimpa perubahan device lain
    const { data } = await sb.from('books').select('data').eq('user_id', userId).maybeSingle();
    const merged = data?.data ? mergeBooks(book, data.data as Book) : book;
    const { error } = await sb.from('books').upsert({ user_id: userId, data: merged, updated_at: new Date().toISOString() });
    if (error) throw error;
    lastPushed = JSON.stringify(merged);
    if (lastPushed !== j) {
      applyingRemote = true;
      useApp.setState({ book: merged });
      applyingRemote = false;
    }
    setSync({ status: 'synced', at: Date.now(), error: undefined });
  } catch (e) {
    setSync({ status: 'error', error: (e as Error).message });
  }
}

export async function signInGoogle() {
  if (!sb) return;
  await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
}

export async function signOut() {
  await sb?.auth.signOut();
}

export async function syncNow() {
  await pullAndMerge();
  await push();
}
