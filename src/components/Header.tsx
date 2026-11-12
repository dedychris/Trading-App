import { useApp } from '../store/app';
import { lockedMargin, walletBalance } from '../store/book';
import { pnl } from '../lib/sim';
import { fmtUsd } from '../lib/format';
import { Signed } from './ui';

export function useEquity() {
  const book = useApp((s) => s.book);
  const prices = useApp((s) => s.prices);
  const wallet = walletBalance(book);
  let upnl = 0;
  for (const p of Object.values(book.positions)) {
    if (p.status !== 'open') continue;
    const px = prices[p.symbol];
    if (px) upnl += pnl(p.dir, p.entry, px, p.qty);
  }
  return { wallet, upnl, equity: wallet + upnl, available: wallet - lockedMargin(book) };
}

export function Header() {
  const { equity, upnl, available } = useEquity();
  const priceStatus = useApp((s) => s.priceStatus);
  const sync = useApp((s) => s.sync);
  const theme = useApp((s) => s.book.settings.theme);
  const update = useApp((s) => s.updateSettings);
  const dot = priceStatus === 'live' ? 'bg-up' : priceStatus === 'polling' ? 'bg-warn' : 'bg-down';
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <div className="leading-tight">
            <div className="text-sm font-bold">Momentum Scanner <span className="text-accent">Pro</span></div>
            <div className="flex items-center gap-1.5 text-[10px] text-mute">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot} ${priceStatus === 'live' ? 'pulse' : ''}`} />
              {priceStatus === 'live' ? 'Binance live' : priceStatus === 'polling' ? 'Binance (polling)' : 'offline'}
              {sync.status === 'synced' && <span title="Tersinkron">· ☁️ sinkron</span>}
              {sync.status === 'syncing' && <span>· ☁️ …</span>}
              {sync.status === 'error' && <span className="text-down">· ☁️ gagal</span>}
            </div>
          </div>
        </div>
        <div className="ml-auto text-right leading-tight">
          <div className="text-[10px] uppercase tracking-wider text-mute">Equity (paper)</div>
          <div className="num text-sm font-bold">{fmtUsd(equity)} <span className="text-mute font-normal">USDT</span></div>
          <div className="text-[10px] text-mute num">
            tersedia {fmtUsd(available)} · uPnL <Signed v={upnl}>{fmtUsd(upnl, true)}</Signed>
          </div>
        </div>
        <button className="btn-ghost h-9 w-9 !p-0" onClick={() => update({ theme: theme === 'dark' ? 'light' : 'dark' })} aria-label="Ganti tema" title="Mode terang/gelap">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  );
}
