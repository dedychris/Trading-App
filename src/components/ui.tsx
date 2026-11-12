import { useEffect, type ReactNode } from 'react';
import type { Dir } from '../lib/signals';
import { useApp } from '../store/app';
import { fmtPct } from '../lib/format';

export function DirBadge({ dir, size = 'sm' }: { dir: Dir; size?: 'sm' | 'md' }) {
  return (
    <span className={`chip ${size === 'md' ? 'text-xs px-2 py-1' : ''} ${dir === 'LONG' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
      {dir === 'LONG' ? '▲' : '▼'} {dir}
    </span>
  );
}

export function Signed({ v, children, className = '' }: { v: number; children: ReactNode; className?: string }) {
  return <span className={`num ${v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-mute'} ${className}`}>{children}</span>;
}

export function WinratePill({ pct, n, compact }: { pct: number | null; n?: number; compact?: boolean }) {
  if (pct === null) return <span className="chip bg-panel2 text-mute">winrate: belum ada data</span>;
  const tone = pct >= 60 ? 'bg-up/15 text-up' : pct >= 45 ? 'bg-warn/15 text-warn' : 'bg-down/15 text-down';
  return (
    <span className={`chip ${tone}`} title="Winrate historis (backtest data Binance asli)">
      🎯 {fmtPct(pct, 0)}
      {!compact && n !== undefined && <span className="font-normal opacity-80">({n})</span>}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-3">
      <div className="label">{label}</div>
      <div className="mt-1 text-lg font-bold num">{value}</div>
      {sub && <div className="text-xs text-mute mt-0.5">{sub}</div>}
    </div>
  );
}

export function Modal({ onClose, children, title }: { onClose: () => void; children: ReactNode; title: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex w-full max-w-5xl flex-col bg-bg sm:max-h-[94vh] sm:rounded-2xl sm:border sm:border-line" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">{title}</div>
          <button className="btn-ghost h-9 w-9 !p-0" onClick={onClose} aria-label="Tutup">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto max-w-md rounded-lg border px-4 py-2 text-sm font-medium shadow-lg ${t.tone === 'good' ? 'border-up/40 bg-panel text-up' : t.tone === 'bad' ? 'border-down/40 bg-panel text-down' : 'border-line bg-panel text-ink'}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card p-8 text-center text-sm text-mute">{children}</div>;
}
