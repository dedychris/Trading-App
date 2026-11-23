// Runner auto Momentum di app: selama app terbuka, cek tiap menit apakah ada close candle harian baru
// (07:00 WIB). Bot server (scripts/bot/momentum-bot.ts) menjalankan fungsi yang sama saat app tertutup;
// hasilnya identik (id posisi deterministik) dan digabung lewat sinkron Supabase.
import { getKlines, minNotional } from '../lib/binance';
import { beep, systemNotify } from '../lib/notify';
import { lastDailyClose, MOM_COINS, momCandlesNeeded, momentumRun, type MomEvent } from '../lib/momentum';
import { useApp } from './app';
import { deviceId } from './autotrader';

const SETTLE = 60_000; // tunggu 1 menit setelah candle close supaya data Binance final

function logEvents(events: MomEvent[]) {
  if (!events.length) return;
  const st = useApp.getState();
  useApp.setState({ momLog: [...events.map((e) => ({ t: e.t, text: e.text, tone: e.tone })).reverse(), ...st.momLog].slice(0, 100) });
  const s = st.book.settings;
  const trades = events.filter((e) => e.tone !== 'info' || e.symbol);
  if (!trades.length) return;
  const opened = events.filter((e) => e.text.startsWith('📈')).length;
  const flipped = events.filter((e) => e.text.includes('berbalik')).length;
  const text = `📈 Momentum: ${opened} posisi dibuka, ${flipped} ditutup karena arah berbalik`;
  st.toast(text, 'info');
  if (s.sound && (opened || flipped)) beep('info');
  if (s.notify && (opened || flipped)) systemNotify('Auto Momentum', text);
}

let running = false;
export async function runMomentumOnce(force = false) {
  const st = useApp.getState();
  const m = st.book.settings.mom;
  if (!m?.enabled || running) return;
  const now = Date.now();
  const latest = lastDailyClose(now);
  if (!force && (st.book.bot?.momLastT ?? 0) >= latest) return;
  if (now < latest + SETTLE) return;
  running = true;
  useApp.setState({ momRun: { ...useApp.getState().momRun, running: true } });
  try {
    const n = momCandlesNeeded(m.lookback);
    const daily: Record<string, Awaited<ReturnType<typeof getKlines>>> = {};
    await Promise.all(MOM_COINS.map(async (s) => (daily[s] = await getKlines(s, '1d', n).catch(() => []))));
    const r = momentumRun(useApp.getState().book, daily, Date.now(), minNotional, `app-${deviceId()}`);
    if (r.book !== useApp.getState().book) useApp.setState({ book: r.book });
    logEvents(r.events);
    useApp.setState({ momRun: { lastAt: Date.now(), running: false } });
  } catch (e) {
    useApp.setState({ momRun: { lastAt: Date.now(), running: false, error: (e as Error).message } });
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startMomentum() {
  if (timer) return;
  timer = setInterval(() => void runMomentumOnce(), 60_000);
  // tunggu sinkron Supabase sebentar supaya tidak memproses ulang yang sudah dikerjakan server
  setTimeout(() => void runMomentumOnce(), 8_000);
  useApp.subscribe((s, prev) => {
    if (s.book.settings.mom?.enabled && !prev.book.settings.mom?.enabled) void runMomentumOnce();
  });
}
