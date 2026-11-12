import { useEffect, useState } from 'react';
import { CoinDetail } from './components/CoinDetail';
import { Header } from './components/Header';
import { HistoryPage } from './components/HistoryPage';
import { PositionsPage } from './components/PositionsPage';
import { ScannerPage } from './components/ScannerPage';
import { SettingsPage } from './components/SettingsPage';
import { StatsPage } from './components/StatsPage';
import { Toasts } from './components/ui';
import { useApp } from './store/app';

const PAGES = [
  { id: 'scan', label: 'Scanner', icon: '⚡' },
  { id: 'pos', label: 'Posisi', icon: '📈' },
  { id: 'hist', label: 'Riwayat', icon: '🧾' },
  { id: 'stats', label: 'Statistik', icon: '📊' },
  { id: 'set', label: 'Pengaturan', icon: '⚙️' },
] as const;
type PageId = (typeof PAGES)[number]['id'];

function readHash(): PageId {
  const h = location.hash.slice(1);
  return (PAGES.find((p) => p.id === h)?.id ?? 'scan') as PageId;
}

export default function App() {
  const [page, setPage] = useState<PageId>(readHash);
  const detail = useApp((s) => s.detail);
  const theme = useApp((s) => s.book.settings.theme);
  const nOpen = useApp((s) => Object.values(s.book.positions).filter((p) => p.status === 'open').length + Object.values(s.book.orders).filter((o) => o.status === 'pending').length);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#080b0a' : '#f4f6f5');
  }, [theme]);
  useEffect(() => {
    const h = () => setPage(readHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const go = (p: PageId) => {
    location.hash = p;
    setPage(p);
    window.scrollTo({ top: 0 });
  };

  const NavBtn = ({ p, mobile }: { p: (typeof PAGES)[number]; mobile?: boolean }) => (
    <button
      onClick={() => go(p.id)}
      className={
        mobile
          ? `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${page === p.id ? 'text-accent' : 'text-mute'}`
          : `relative rounded-lg px-3 py-1.5 text-sm font-semibold ${page === p.id ? 'bg-panel2 text-ink' : 'text-mute hover:text-ink'}`
      }
    >
      {mobile && <span className="text-lg leading-none">{p.icon}</span>}
      {p.label}
      {p.id === 'pos' && nOpen > 0 && <span className={`absolute ${mobile ? 'right-[22%] top-1' : '-right-1 -top-1'} rounded-full bg-accent px-1.5 text-[10px] text-black`}>{nOpen}</span>}
    </button>
  );

  return (
    <div className="min-h-screen pb-20 sm:pb-6">
      <Header />
      <nav className="mx-auto hidden max-w-6xl gap-1 px-4 pt-3 sm:flex">
        {PAGES.map((p) => <NavBtn key={p.id} p={p} />)}
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-4">
        {page === 'scan' && <ScannerPage />}
        {page === 'pos' && <PositionsPage />}
        {page === 'hist' && <HistoryPage />}
        {page === 'stats' && <StatsPage />}
        {page === 'set' && <SettingsPage />}
      </main>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-panel/95 backdrop-blur sm:hidden">
        {PAGES.map((p) => <NavBtn key={p.id} p={p} mobile />)}
      </nav>
      {detail && <CoinDetail symbol={detail} />}
      <Toasts />
    </div>
  );
}
