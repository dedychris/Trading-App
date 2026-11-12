import { useMemo } from 'react';
import { runScan, type ScanRow } from '../lib/scanner';
import { btcConflict, FILTER_INFO, filterPass, SETUP_INFO, SETUP_ORDER, TFS, type SetupKey } from '../lib/signals';
import { atrPass } from '../lib/signals';
import { moves } from '../lib/sim';
import { base, fmtCompact, fmtNum, fmtPct, fmtPrice, fmtTime } from '../lib/format';
import { beep, systemNotify } from '../lib/notify';
import { useApp } from '../store/app';
import { DirBadge, Empty, Signed, WinratePill } from './ui';
import { useWinrate } from './hooks';

export async function doScan() {
  const set = useApp.setState;
  const st = useApp.getState();
  if (st.scan.status === 'running') return;
  set({ scan: { ...st.scan, status: 'running', done: 0, total: 0, error: undefined } });
  try {
    const result = await runScan((done, total) => set({ scan: { ...useApp.getState().scan, done, total } }));
    set({ scan: { status: 'done', done: result.rows.length, total: result.rows.length, result } });
    const n3 = result.rows.filter((r) => r.setup?.key === '3TF').length;
    const s = useApp.getState().book.settings;
    if (s.sound) beep('info');
    if (s.notify && n3) systemNotify('Scan selesai', `${n3} koin 3TF Sepakat`);
    if (result.failed.length) useApp.getState().toast(`${result.failed.length} koin gagal dimuat: ${result.failed.slice(0, 5).join(', ')}`, 'bad');
  } catch (e) {
    set({ scan: { ...useApp.getState().scan, status: 'error', error: (e as Error).message } });
  }
}

function BtcCard() {
  const btc = useApp((s) => s.scan.result?.btc);
  const live = useApp((s) => s.prices['BTCUSDT']);
  if (!btc) return null;
  const tone = btc.trend === 'BULLISH' ? 'text-up' : btc.trend === 'BEARISH' ? 'text-down' : 'text-warn';
  return (
    <div className="card flex flex-wrap items-center gap-x-5 gap-y-2 p-3">
      <div>
        <div className="label">Konteks BTC</div>
        <div className={`text-lg font-bold ${tone}`}>{btc.trend === 'BULLISH' ? '▲ BULLISH' : btc.trend === 'BEARISH' ? '▼ BEARISH' : '◆ NETRAL'}</div>
      </div>
      <div className="num text-sm">
        {fmtPrice(live ?? btc.price)} <Signed v={btc.change24h}>{fmtPct(btc.change24h, 2, true)}</Signed>
      </div>
      <div className="flex gap-1.5">
        {TFS.map((tf) => {
          const s = btc.tf[tf];
          return (
            <span key={tf} className={`chip ${s?.dir === 'LONG' ? 'bg-up/15 text-up' : s?.dir === 'SHORT' ? 'bg-down/15 text-down' : 'bg-panel2 text-mute'}`}>
              {tf} {s?.dir === 'LONG' ? '▲' : s?.dir === 'SHORT' ? '▼' : '–'} ADX {fmtNum(s?.v.adx, 0)}
            </span>
          );
        })}
      </div>
      <div className="w-full text-xs text-mute sm:w-auto sm:flex-1 sm:text-right">
        {btc.trend === 'BEARISH' ? 'Sinyal LONG altcoin dikasih peringatan ⚠️' : btc.trend === 'BULLISH' ? 'Sinyal SHORT altcoin dikasih peringatan ⚠️' : 'BTC belum searah di 1H & 4H'}
      </div>
    </div>
  );
}

function CoinCard({ row }: { row: ScanRow }) {
  const open = useApp((s) => s.openDetail);
  const settings = useApp((s) => s.book.settings);
  const btc = useApp((s) => s.scan.result?.btc);
  const live = useApp((s) => s.prices[row.symbol]);
  const setup = row.setup!;
  const wr = useWinrate(row.symbol, setup.key, setup.dir, settings.leverage);
  const grid = row.tf[SETUP_INFO[setup.key].grid];
  const failed: string[] = [];
  if (grid) {
    if (settings.filters.volume && !filterPass('volume', grid, setup.dir)) failed.push('Volume');
    if (settings.filters.ema200 && !filterPass('ema200', grid, setup.dir)) failed.push('EMA200');
    if (settings.filters.bollinger && !filterPass('bollinger', grid, setup.dir)) failed.push('Bollinger');
    if (settings.filters.atr && !atrPass(grid.v.atrPct, moves(settings.leverage).sl * 100)) failed.push('ATR');
  }
  const conflict = btc && row.symbol !== 'BTCUSDT' && btcConflict(btc.trend, setup.dir);
  return (
    <button onClick={() => open(row.symbol)} className={`card w-full p-3 text-left transition hover:border-accent/60 ${failed.length ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2">
        <div className="text-base font-bold">{base(row.symbol)}</div>
        <DirBadge dir={setup.dir} />
        <div className="ml-auto">
          <WinratePill pct={wr?.pct ?? null} n={wr?.coin.n} />
        </div>
      </div>
      <div className="mt-1 flex items-baseline gap-2 text-sm">
        <span className="num">{fmtPrice(live ?? row.price)}</span>
        <Signed v={row.change24h} className="text-xs">{fmtPct(row.change24h, 2, true)}</Signed>
        <span className="ml-auto text-[11px] text-mute">vol {fmtCompact(row.quoteVolume)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {TFS.map((tf) => {
          const s = row.tf[tf];
          const q = s?.qualifies && s.dir === setup.dir;
          return (
            <span key={tf} className={`chip ${q ? 'bg-accent/15 text-accent' : 'bg-panel2 text-mute'}`}>
              {q ? '✓' : '·'} {tf}
            </span>
          );
        })}
        <span className="chip bg-panel2 text-mute">RSI {fmtNum(grid?.v.rsi, 0)}</span>
        <span className="chip bg-panel2 text-mute">ADX {fmtNum(grid?.v.adx, 0)}</span>
      </div>
      {(conflict || failed.length > 0) && (
        <div className="mt-2 space-y-0.5 text-[11px]">
          {conflict && <div className="text-warn">⚠️ BTC {btc!.trend} — melawan arah BTC</div>}
          {failed.length > 0 && <div className="text-mute">✗ Tidak lolos filter: {failed.join(', ')}</div>}
        </div>
      )}
    </button>
  );
}

export function ScannerPage() {
  const scan = useApp((s) => s.scan);
  const settings = useApp((s) => s.book.settings);
  const groups = useMemo(() => {
    const rows = (scan.result?.rows ?? []).filter((r) => r.setup);
    const g = new Map<SetupKey, ScanRow[]>();
    for (const k of SETUP_ORDER) g.set(k, []);
    for (const r of rows) g.get(r.setup!.key)!.push(r);
    return g;
  }, [scan.result]);
  const total = [...groups.values()].reduce((a, b) => a + b.length, 0);
  const activeFilters = (Object.keys(settings.filters) as (keyof typeof settings.filters)[]).filter((k) => settings.filters[k]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary px-5 py-2.5 text-base" onClick={doScan} disabled={scan.status === 'running'}>
          {scan.status === 'running' ? `Scanning… ${scan.done}/${scan.total || 40}` : '⚡ Scan Now'}
        </button>
        <div className="text-xs text-mute">
          Top 40 USDT-M Perp Binance · 15M / 1H / 4H · candle yang sudah close
          {scan.result && <div>Scan terakhir {fmtTime(scan.result.at)} · {total} koin qualify · winrate dihitung di leverage {settings.leverage}×</div>}
        </div>
      </div>
      {scan.status === 'running' && (
        <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
          <div className="h-full bg-accent transition-all" style={{ width: `${scan.total ? (scan.done / scan.total) * 100 : 3}%` }} />
        </div>
      )}
      {scan.status === 'error' && <div className="card border-down/50 p-3 text-sm text-down">Gagal scan: {scan.error}</div>}
      <BtcCard />
      {activeFilters.length > 0 && (
        <div className="text-xs text-mute">
          Filter aktif: {activeFilters.map((f) => FILTER_INFO[f].label).join(', ')} — koin yang tidak lolos diredupkan.
          {settings.filters.sentiment && ' (Filter funding/OI dicek saat buka detail koin.)'}
        </div>
      )}
      {!scan.result && scan.status !== 'running' && (
        <Empty>
          Tekan <b>Scan Now</b> untuk scan 40 koin teratas Binance Futures.
          <br />
          Winrate tiap sinyal dihitung dari backtest data historis asli (TP +14% / SL −7% dari margin).
        </Empty>
      )}
      {scan.result && total === 0 && <Empty>Tidak ada koin yang qualify saat ini. Coba scan lagi nanti.</Empty>}
      {SETUP_ORDER.map((k) => {
        const rows = groups.get(k)!;
        if (!rows.length) return null;
        return (
          <section key={k}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
              {SETUP_INFO[k].label} <span className="chip bg-panel2 text-mute">{rows.length}</span>
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => (
                <CoinCard key={r.symbol} row={r} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

