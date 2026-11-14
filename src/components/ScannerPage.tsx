import { useMemo } from 'react';
import { type ScanRow } from '../lib/scanner';
import { doScan } from '../store/scan';
import { autoAllowedHere } from '../store/autotrader';
import { btcConflict, FILTER_INFO, filterPass, SETUP_INFO, SETUP_ORDER, TFS, type SetupKey } from '../lib/signals';
import { atrPass } from '../lib/signals';
import { moves, tpSlPrices } from '../lib/sim';
import { base, fmtCompact, fmtNum, fmtPct, fmtPrice, fmtTime, fmtSet } from '../lib/format';
import { useApp } from '../store/app';
import { DirBadge, Empty, Signed, WinratePill } from './ui';
import { useWinrate } from './hooks';
import { PatternAlert } from './PatternAlert';

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
  const autoOn = useApp((s) => s.book.settings.auto.enabled);
  const decision = useApp((s) => s.autoDecision[row.symbol]);
  const setup = row.setup!;
  const wr = useWinrate(row.symbol, setup.key, setup.dir, settings.leverage);
  const grid = row.tf[SETUP_INFO[setup.key].grid];
  const failed: string[] = [];
  if (grid) {
    if (settings.filters.volume && !filterPass('volume', grid, setup.dir)) failed.push('Volume');
    if (settings.filters.ema200 && !filterPass('ema200', grid, setup.dir)) failed.push('EMA200');
    if (settings.filters.bollinger && !filterPass('bollinger', grid, setup.dir)) failed.push('Bollinger');
    if (settings.filters.atr && !atrPass(grid.v.atrPct, moves(settings.leverage, settings.tpPct, settings.slPct).sl * 100)) failed.push('ATR');
  }
  const conflict = btc && row.symbol !== 'BTCUSDT' && btcConflict(btc.trend, setup.dir);
  const entry = live ?? row.price;
  const lv = tpSlPrices(setup.dir, entry, settings.leverage, settings.tpPct, settings.slPct);
  const m = moves(settings.leverage, settings.tpPct, settings.slPct);
  const sign = setup.dir === 'LONG' ? 1 : -1;
  return (
    <button onClick={() => open(row.symbol)} className={`card w-full p-3 text-left transition hover:border-accent/60 ${setup.key === 'GOLD' ? 'border-accent/70 ring-1 ring-accent/30' : ''} ${failed.length ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2">
        <div className="text-base font-bold">{setup.key === 'GOLD' && <span title="Golden: 4H + 1H + 15M qualify semua">⭐ </span>}{base(row.symbol)}{row.source === 'volume' && <span className="chip ml-1 bg-panel2 align-middle text-[10px] font-normal text-mute" title="Bukan list market cap besar — masuk karena top 5 volume Binance">🔥 top vol</span>}</div>
        <DirBadge dir={setup.dir} />
        <div className="ml-auto text-right">
          <WinratePill pct={wr?.pct ?? null} compact />
          {wr && (
            <div className="mt-0.5 text-[10px] text-mute num" title="Jumlah kejadian setup yang sama di histori: koin ini / gabungan semua koin">
              koin {wr.coin.n} · gabungan {wr.pool.n}
            </div>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-baseline gap-2 text-sm">
        <span className="num">{fmtPrice(live ?? row.price)}</span>
        <Signed v={row.change24h} className="text-xs">{fmtPct(row.change24h, 2, true)}</Signed>
        <span className="ml-auto text-[11px] text-mute">vol {fmtCompact(row.quoteVolume)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(['4h', '1h', '15m'] as const).map((tf) => {
          const s = row.tf[tf];
          const same = s?.dir === setup.dir;
          const q = same && s?.qualifies;
          return (
            <span
              key={tf}
              title={q ? 'qualify penuh' : same ? 'arah searah, belum qualify penuh' : 'tidak searah'}
              className={`chip ${q ? 'bg-accent/15 text-accent' : same ? 'bg-warn/10 text-warn' : 'bg-panel2 text-mute line-through'}`}
            >
              {q ? '✓' : same ? '~' : '✗'} {tf}
            </span>
          );
        })}
        <span className="chip bg-panel2 text-mute">RSI {fmtNum(grid?.v.rsi, 0)}</span>
        <span className="chip bg-panel2 text-mute">ADX {fmtNum(grid?.v.adx, 0)}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-panel2 px-2 py-1.5 text-[11px] num">
        <div>
          <div className="text-mute">Entry</div>
          <div className="font-semibold">{fmtPrice(entry)}</div>
        </div>
        <div>
          <div className="text-mute">TP {settings.trailOn ? '↗ trailing' : ''}</div>
          <div className="font-semibold text-up">{fmtPrice(lv.tp)}</div>
          <div className="text-[10px] text-mute">{fmtPct(sign * m.tp * 100, 2, true)}</div>
        </div>
        <div>
          <div className="text-mute">SL</div>
          <div className="font-semibold text-down">{fmtPrice(lv.sl)}</div>
          <div className="text-[10px] text-mute">{fmtPct(-sign * m.sl * 100, 2, true)}</div>
        </div>
      </div>
      {(conflict || failed.length > 0) && (
        <div className="mt-2 space-y-0.5 text-[11px]">
          {conflict && <div className="text-warn">⚠️ BTC {btc!.trend} — melawan arah BTC</div>}
          {failed.length > 0 && <div className="text-mute">✗ Tidak lolos filter: {failed.join(', ')}</div>}
        </div>
      )}
      {autoOn && decision && (
        <div className={`mt-1.5 rounded-md px-2 py-1 text-[11px] ${decision.tone === 'good' ? 'bg-up/10 text-up' : 'bg-panel2 text-mute'}`}>
          🤖 {decision.text}
        </div>
      )}
      <div className="mt-1.5">
        <PatternAlert compact symbol={row.symbol} setupKey={setup.key} dir={setup.dir} tf={row.tf} leverage={settings.leverage} />
      </div>
    </button>
  );
}

function AutoBanner() {
  const a = useApp((s) => s.book.settings.auto);
  const run = useApp((s) => s.autoRun);
  const last = useApp((s) => s.autoLog[0]);
  if (!a.enabled) return null;
  const here = autoAllowedHere();
  return (
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-1 border-accent/50 p-3 text-sm">
      <span className="chip bg-accent text-black">🤖 AUTO ON</span>
      {here ? (
        <span className="text-mute">
          {run.running ? 'Lagi scan & cek sinyal…' : run.nextAt ? `Scan otomatis berikutnya ${new Date(run.nextAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : 'Menyiapkan…'}
          {' '}· ⭐ Golden, 3TF, 1H+15M{a.with4h1h ? ', 4H+1H' : ''} · {a.leverage}× · TP {a.tpPct}% / SL {a.slPct}%{a.trailOn ? ` · trailing ${a.trailPct}%` : ''}
        </span>
      ) : (
        <span className="text-mute">Auto trading jalan di device lain (diatur di Pengaturan).</span>
      )}
      {here && last && <span className={`w-full text-xs ${last.tone === 'good' ? 'text-up' : last.tone === 'bad' ? 'text-down' : 'text-mute'}`}>Terakhir: {last.text}</span>}
    </div>
  );
}

function LeverageBar() {
  const lev = useApp((s) => s.book.settings.leverage);
  const update = useApp((s) => s.updateSettings);
  const tp = useApp((s) => s.book.settings.tpPct);
  const sl = useApp((s) => s.book.settings.slPct);
  const trail = useApp((s) => (s.book.settings.trailOn ? s.book.settings.trailPct : null));
  const m = moves(lev, tp, sl);
  const set = (v: number) => update({ leverage: Math.max(1, Math.min(125, Math.round(v) || 1)) });
  return (
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
      <span className="label">Leverage</span>
      <div className="flex items-center gap-1">
        <input className="input w-16 !py-1 text-right" inputMode="numeric" aria-label="Leverage" value={lev} onChange={(e) => set(+e.target.value)} />
        <span className="text-sm">×</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {[5, 10, 15, 20, 25, 50].map((v) => (
          <button key={v} className={`chip ${v === lev ? 'bg-accent text-black' : 'bg-panel2 text-mute hover:text-ink'}`} onClick={() => set(v)}>
            {v}×
          </button>
        ))}
      </div>
      <span className="text-xs text-mute">
        TP +{fmtSet(tp)}% / SL −{fmtSet(sl)}% margin = harga ±{fmtNum(m.tp * 100, 2)}% / ±{fmtNum(m.sl * 100, 2)}%{trail ? ` · trailing ${fmtSet(trail)}%` : ''} · ubah TP/SL di Pengaturan
      </span>
    </div>
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
        <button className="btn-primary px-5 py-2.5 text-base" onClick={() => doScan()} disabled={scan.status === 'running'}>
          {scan.status === 'running' ? `Scanning… ${scan.done}/${scan.total || 40}` : '⚡ Scan Now'}
        </button>
        <div className="text-xs text-mute">
          20 koin market cap besar + 5 top volume Binance · 15M / 1H / 4H · candle yang sudah close · ✓ qualify penuh · ~ searah · ✗ berlawanan
          {scan.result && <div>Scan terakhir {fmtTime(scan.result.at)} · {total} koin qualify · winrate dihitung di leverage {settings.leverage}×</div>}
        </div>
      </div>
      <AutoBanner />
      <LeverageBar />
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
          Tekan <b>Scan Now</b> untuk scan 20 koin market cap besar + 5 koin volume tertinggi Binance Futures.
          <br />
          Winrate tiap sinyal dihitung dari backtest data historis asli (TP/SL sesuai Pengaturan, % dari margin).
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

