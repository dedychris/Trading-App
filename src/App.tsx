import { useCallback, useEffect, useState } from 'react';
import { MODE_TF } from '../core/config';
import { TF_MS } from '../core/types';
import { api, fetchPrices, type View } from './api';
import { ago, time } from './fmt';
import { BacktestPage } from './pages/BacktestPage';
import { DecisionsPage } from './pages/DecisionsPage';
import { HistoryPage } from './pages/HistoryPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';

const PAGES = [
  { id: 'home', label: 'Ringkasan', icon: '📈' },
  { id: 'scan', label: 'Keputusan', icon: '🧠' },
  { id: 'hist', label: 'Riwayat', icon: '🧾' },
  { id: 'bt', label: 'Backtest', icon: '🧪' },
  { id: 'set', label: 'Setting', icon: '⚙️' },
] as const;
type PageId = (typeof PAGES)[number]['id'];
const readHash = () => (PAGES.find((p) => p.id === location.hash.slice(1))?.id ?? 'home') as PageId;

export type Ctx = { view: View; prices: Record<string, number>; setView: (v: View) => void; refresh: () => Promise<void>; toast: (t: string, bad?: boolean) => void };

export default function App() {
  const [page, setPage] = useState<PageId>(readHash);
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [toastMsg, setToast] = useState<{ t: string; bad: boolean } | null>(null);
  const [, setNow] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setView(await api.state());
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    const tickId = setInterval(() => setNow(Date.now()), 5_000);
    const onHash = () => setPage(readHash());
    window.addEventListener('hashchange', onHash);
    return () => {
      clearInterval(id);
      clearInterval(tickId);
      window.removeEventListener('hashchange', onHash);
    };
  }, [refresh]);
  const nPos = view?.positions.length ?? 0;
  useEffect(() => {
    if (!nPos) return;
    const load = () => fetchPrices().then(setPrices).catch(() => undefined);
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [nPos]);
  const toast = (t: string, bad = false) => {
    setToast({ t, bad });
    setTimeout(() => setToast(null), 3500);
  };

  const go = (p: PageId) => {
    location.hash = p;
    setPage(p);
    window.scrollTo(0, 0);
  };

  return (
    <div className="mx-auto min-h-screen max-w-3xl pb-24">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-bold tracking-tight">Trading Bot · Paper</h1>
            {view && <Status view={view} />}
          </div>
          <nav className="hidden gap-1 sm:flex">
            {PAGES.map((p) => (
              <button key={p.id} onClick={() => go(p.id)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${page === p.id ? 'bg-panel2 text-ink' : 'text-mute hover:text-ink'}`}>
                {p.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="space-y-4 px-4 pt-4">
        {err && !view && (
          <div className="card p-4 text-sm">
            <div className="font-semibold text-down">Gagal memuat data bot</div>
            <div className="mt-1 text-mute">{err}</div>
            <div className="mt-2 text-mute">Kalau baru deploy: cek SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, dan BOT_SECRET di Vercel (lihat README).</div>
          </div>
        )}
        {page === 'bt' && <BacktestPage />}
        {view && page !== 'bt' && (
          <>
            {page === 'home' && <OverviewPage ctx={{ view, prices, setView, refresh, toast }} />}
            {page === 'scan' && <DecisionsPage view={view} />}
            {page === 'hist' && <HistoryPage view={view} />}
            {page === 'set' && <SettingsPage ctx={{ view, prices, setView, refresh, toast }} />}
          </>
        )}
        {!view && !err && <div className="py-16 text-center text-sm text-mute">Memuat…</div>}
      </main>

      {toastMsg && <div className={`fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-semibold shadow-lg ${toastMsg.bad ? 'bg-down text-white' : 'bg-accent text-black'}`}>{toastMsg.t}</div>}

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-panel sm:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {PAGES.map((p) => (
            <button key={p.id} onClick={() => go(p.id)} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${page === p.id ? 'text-ink' : 'text-mute'}`}>
              <span className="text-lg leading-none">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Status({ view }: { view: View }) {
  const barMs = TF_MS[MODE_TF[view.config.mode].entry];
  const lag = Date.now() - view.lastRunAt;
  const [dot, text] = view.paused
    ? ['bg-warn', 'Pause']
    : !view.lastRunAt
      ? ['bg-down', 'Belum pernah jalan — cron belum disetel']
      : view.lastError
        ? ['bg-down', `Error: ${view.lastError}`]
        : lag > 180_000
          ? ['bg-warn', `Terlambat — cek terakhir ${ago(view.lastRunAt)}`]
          : ['bg-up pulse', `Aktif · cek ${ago(view.lastRunAt)}`];
  return (
    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-mute">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="truncate">
        {text}
        {!view.paused && view.lastRunAt > 0 && ` · scan berikutnya ${time(view.lastBarT + barMs + 15_000)} WIB`}
      </span>
    </div>
  );
}
