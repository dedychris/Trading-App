import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getDerivatives, type Derivs } from '../lib/binance';
import { filterComparison } from '../lib/backtest';
import { loadSymbolSeries, statesFrom } from '../lib/scanner';
import { btcConflict, classify, FILTER_INFO, RULES, sentimentPass, SETUP_INFO, TFS, type Dir, type TF } from '../lib/signals';
import { estMaxLeverage, previewOrder } from '../lib/sim';
import { base, fmtNum, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { availableBalance, marginFor, openPosition, placeLimit, useApp, validateOrder } from '../store/app';
import type { Snapshot } from '../store/types';
import type { SymbolSeries } from '../lib/backtest';
import { PriceChart } from './Chart';
import { DirBadge, Modal, Signed, WinratePill } from './ui';
import { useMyWinrate, useWinrate } from './hooks';

export function CoinDetail({ symbol }: { symbol: string }) {
  const close = () => useApp.getState().openDetail(null);
  const scanSeries = useApp((s) => s.scan.result?.series[symbol]);
  const [series, setSeries] = useState<SymbolSeries | undefined>(scanSeries);
  const [err, setErr] = useState<string | null>(null);
  const [derivs, setDerivs] = useState<Derivs | null>(null);
  const [chartTf, setChartTf] = useState<TF>('1h');
  const live = useApp((s) => s.prices[symbol]);

  useEffect(() => {
    if (!series) loadSymbolSeries(symbol).then(setSeries).catch((e) => setErr((e as Error).message));
    getDerivatives(symbol).then(setDerivs).catch(() => setDerivs(null));
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const states = useMemo(() => (series ? statesFrom(series) : null), [series]);
  const setup = useMemo(() => (states ? classify(states) : null), [states]);
  const price = live ?? series?.['15m']?.candles.at(-1)?.c ?? 0;

  return (
    <Modal
      onClose={close}
      title={
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{base(symbol)}</span>
          <span className="text-xs text-mute">USDT Perp</span>
          {setup && <DirBadge dir={setup.dir} />}
          {setup && <span className="chip bg-accent/15 text-accent">{SETUP_INFO[setup.key].short}</span>}
          <span className="num ml-auto text-sm sm:ml-2">{fmtPrice(price)}</span>
        </div>
      }
    >
      {err && <div className="p-4 text-sm text-down">Gagal ambil data Binance: {err}</div>}
      {!series && !err && <div className="p-8 text-center text-sm text-mute">Memuat data Binance…</div>}
      {series && states && (
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_380px]">
          <div className="min-w-0 space-y-4">
            <div className="card p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="label">Chart</div>
                <div className="seg">
                  {TFS.map((tf) => (
                    <button key={tf} data-on={chartTf === tf} onClick={() => setChartTf(tf)}>
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
              {series[chartTf] && <PriceChart series={series[chartTf]!} />}
            </div>
            <IndicatorTable states={states} />
            <DerivsCard d={derivs} dir={setup?.dir} />
            {setup && <FilterCompare symbol={symbol} />}
          </div>
          <OrderForm symbol={symbol} price={price} defaultDir={setup?.dir ?? 'LONG'} states={states} derivs={derivs} />
        </div>
      )}
    </Modal>
  );
}

function IndicatorTable({ states }: { states: ReturnType<typeof statesFrom> }) {
  const Check = ({ ok }: { ok: boolean }) => <span className={ok ? 'text-up' : 'text-down'}>{ok ? '✓' : '✗'}</span>;
  return (
    <div className="card overflow-x-auto p-3">
      <div className="label mb-2">Indikator (candle terakhir yang sudah close)</div>
      <table className="w-full whitespace-nowrap text-xs sm:text-sm">
        <thead className="text-left text-[11px] text-mute">
          <tr>
            <th className="py-1 pr-2">TF</th>
            <th className="pr-2">Arah</th>
            <th className="pr-2">EMA9/21</th>
            <th className="pr-2">RSI14</th>
            <th className="pr-2">MACD</th>
            <th className="pr-2">ADX14</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody className="num">
          {TFS.map((tf) => {
            const s = states[tf];
            if (!s) return (
              <tr key={tf}><td className="py-1.5">{tf}</td><td colSpan={6} className="text-mute">data kurang</td></tr>
            );
            const [lo, hi] = s.dir === 'SHORT' ? RULES.rsiShort : RULES.rsiLong;
            return (
              <tr key={tf} className="border-t border-line">
                <td className="py-1.5 pr-2 font-semibold">{tf}</td>
                <td className="pr-2">{s.dir ? <span className={s.dir === 'LONG' ? 'text-up' : 'text-down'}>{s.dir === 'LONG' ? '▲' : '▼'}<span className="hidden sm:inline"> {s.dir}</span></span> : '–'}</td>
                <td className="pr-2"><Check ok={s.checks.ema} /> {s.dir === 'LONG' ? '9 > 21' : s.dir === 'SHORT' ? '9 < 21' : '='}</td>
                <td className="pr-2"><Check ok={s.checks.rsi} /> {fmtNum(s.v.rsi)} <span className="hidden text-[10px] text-mute sm:inline">({lo}–{hi})</span></td>
                <td className="pr-2"><Check ok={s.checks.macd} /> {s.v.macdHist > 0 ? '+' : ''}{s.v.macdHist.toPrecision(3)}</td>
                <td className="pr-2"><Check ok={s.checks.adx} /> {fmtNum(s.v.adx)}</td>
                <td>{s.qualifies ? <span className="chip bg-accent/15 text-accent">✓<span className="hidden sm:inline"> QUALIFY</span></span> : <span className="text-mute text-xs">–</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-mute sm:grid-cols-4">
        {(['15m', '1h'] as TF[]).map((tf) => {
          const s = states[tf];
          if (!s) return null;
          return (
            <div key={tf} className="contents">
              <div>Vol ratio {tf}: <span className="num text-ink">{fmtNum(s.v.volRatio, 2)}×</span></div>
              <div>ATR {tf}: <span className="num text-ink">{fmtPct(s.v.atrPct)}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DerivsCard({ d, dir }: { d: Derivs | null; dir?: Dir }) {
  if (!d) return <div className="card p-3 text-sm text-mute">Memuat funding / Open Interest…</div>;
  const pass = dir ? sentimentPass(dir, d.fundingRate, d.longPct) : null;
  return (
    <div className="card p-3">
      <div className="label mb-2">Funding · Open Interest · Long/Short (Binance)</div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-[11px] text-mute">Funding rate</div>
          <Signed v={-d.fundingRate}>{fmtPct(d.fundingRate * 100, 4)}</Signed>
          <div className="text-[10px] text-mute">berikutnya {new Date(d.nextFundingTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div>
          <div className="text-[11px] text-mute">OI 24 jam</div>
          <Signed v={d.oiChange24h ?? 0}>{fmtPct(d.oiChange24h, 1, true)}</Signed>
        </div>
        <div>
          <div className="text-[11px] text-mute">Akun long</div>
          <span className="num">{fmtPct(d.longPct, 1)}</span>
        </div>
        <div>
          <div className="text-[11px] text-mute">Rasio L/S</div>
          <span className="num">{fmtNum(d.longShortRatio, 2)}</span>
        </div>
      </div>
      {dir && <div className={`mt-2 text-xs ${pass ? 'text-up' : 'text-warn'}`}>{pass ? `✓ Sentimen belum terlalu ramai untuk ${dir}` : `⚠️ Pasar sudah ramai di sisi ${dir} (funding/akun ${dir === 'LONG' ? 'long' : 'short'} tinggi)`}</div>}
    </div>
  );
}

function FilterCompare({ symbol }: { symbol: string }) {
  const all = useApp((s) => s.scan.result?.series);
  const lev = useApp((s) => s.book.settings.leverage);
  const states = useMemo(() => (all?.[symbol] ? statesFrom(all[symbol]) : null), [all, symbol]);
  const setup = states ? classify(states) : null;
  const cmp = useMemo(() => (all && setup ? filterComparison(all, symbol, setup.key, setup.dir, lev) : null), [all, symbol, setup?.key, setup?.dir, lev]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cmp || !setup) return null;
  const pct = (x: { pool: { wins: number; n: number } }) => (x.pool.n ? fmtPct((x.pool.wins / x.pool.n) * 100, 0) : '—');
  return (
    <div className="card p-3">
      <div className="label mb-1">Indikator mana yang berguna? (backtest {SETUP_INFO[setup.key].short} {setup.dir}, {lev}×)</div>
      <div className="mb-2 text-xs text-mute">Winrate gabungan 40 koin dengan dan tanpa tiap filter. Kalau angkanya naik, filternya berguna.</div>
      <table className="w-full text-sm num">
        <tbody>
          <tr className="border-b border-line">
            <td className="py-1">Tanpa filter</td>
            <td className="text-right">{pct(cmp.base)}</td>
            <td className="text-right text-mute text-xs">{cmp.base.pool.n} kejadian</td>
          </tr>
          {cmp.rows.map((r) => {
            const b = cmp.base.pool.n ? cmp.base.pool.wins / cmp.base.pool.n : 0;
            const w = r.with.pool.n ? r.with.pool.wins / r.with.pool.n : 0;
            const d = (w - b) * 100;
            return (
              <tr key={r.filter} className="border-b border-line last:border-0">
                <td className="py-1">+ {FILTER_INFO[r.filter].label}</td>
                <td className="text-right">
                  {pct(r.with)} {r.with.pool.n > 0 && <Signed v={d} className="text-xs">({d >= 0 ? '+' : ''}{d.toFixed(0)})</Signed>}
                </td>
                <td className="text-right text-mute text-xs">{r.with.pool.n} kejadian</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrderForm({ symbol, price, defaultDir, states, derivs }: { symbol: string; price: number; defaultDir: Dir; states: ReturnType<typeof statesFrom>; derivs: Derivs | null }) {
  const book = useApp((s) => s.book);
  const settings = book.settings;
  const btc = useApp((s) => s.scan.result?.btc);
  const [dir, setDir] = useState<Dir>(defaultDir);
  const [type, setType] = useState<'market' | 'limit'>('market');
  const [limitPx, setLimitPx] = useState('');
  const [lev, setLev] = useState(settings.leverage);
  const [mode, setMode] = useState(settings.marginMode);
  const [fixed, setFixed] = useState(String(settings.marginFixed));
  const [percent, setPercent] = useState(String(settings.marginPercent));
  const [confirm, setConfirm] = useState(false);

  const setup = classify(states);
  const key = setup?.dir === dir ? setup.key : undefined;
  const margin = mode === 'fixed' ? +fixed : marginFor({ ...settings, marginMode: 'percent', marginPercent: +percent }, book);
  const entry = type === 'market' ? price : +limitPx;
  const pv = entry > 0 && margin > 0 ? previewOrder({ dir, entry, leverage: lev, margin, entryType: type, bnb: settings.bnb }) : null;
  const wr = useWinrate(symbol, key, dir, lev);
  const mine = useMyWinrate(key, dir);
  const maxLev = estMaxLeverage(symbol);
  const g15 = states['15m'];
  const slTight = pv && g15 && pv.slMovePct < g15.v.atrPct;
  const conflict = btc && symbol !== 'BTCUSDT' && btcConflict(btc.trend, dir);
  const sentimentBad = derivs && !sentimentPass(dir, derivs.fundingRate, derivs.longPct);

  const submit = () => {
    const params = { symbol, dir, leverage: lev, margin, price: entry, type, snap: null as Snapshot | null };
    const err = validateOrder(params, price);
    if (err) {
      useApp.getState().toast(err, 'bad');
      setConfirm(false);
      return;
    }
    const snap: Snapshot = {
      t: Date.now(),
      price,
      tf: states,
      setup,
      btcTrend: btc?.trend ?? null,
      funding: derivs?.fundingRate ?? null,
      longPct: derivs?.longPct ?? null,
      oiChange24h: derivs?.oiChange24h ?? null,
      winrate: wr?.pct ?? null,
      winrateN: wr?.coin.n ?? null,
      breakevenWinrate: pv?.breakevenWinrate,
    };
    if (type === 'market') {
      openPosition({ symbol, dir, leverage: lev, margin, entry: price, entryType: 'market', snap });
      useApp.getState().toast(`Posisi ${base(symbol)} ${dir} ${lev}× dibuka di ${fmtPrice(price)}`, 'good');
    } else {
      placeLimit({ ...params, snap });
      useApp.getState().toast(`Order limit ${base(symbol)} ${dir} di ${fmtPrice(entry)} dipasang`, 'info');
    }
    setConfirm(false);
  };

  return (
    <div className="card h-fit space-y-3 p-3 lg:sticky lg:top-2">
      <div className="seg">
        <button data-on={dir === 'LONG'} onClick={() => setDir('LONG')} className={dir === 'LONG' ? '!text-up' : ''}>▲ LONG</button>
        <button data-on={dir === 'SHORT'} onClick={() => setDir('SHORT')} className={dir === 'SHORT' ? '!text-down' : ''}>▼ SHORT</button>
      </div>
      <div className="seg">
        <button data-on={type === 'market'} onClick={() => setType('market')}>Market</button>
        <button data-on={type === 'limit'} onClick={() => { setType('limit'); if (!limitPx) setLimitPx(String(price)); }}>Limit</button>
      </div>
      {type === 'limit' && (
        <label className="block">
          <span className="label">Harga limit</span>
          <input className="input mt-1" inputMode="decimal" value={limitPx} onChange={(e) => setLimitPx(e.target.value.replace(',', '.'))} />
          <span className="text-[11px] text-mute">Fee maker 0,02%. Order nunggu sampai harga nyentuh angka ini.</span>
        </label>
      )}
      <div>
        <div className="flex items-center justify-between">
          <span className="label">Leverage</span>
          <div className="flex items-center gap-1">
            <input className="input w-16 !py-1 text-right" inputMode="numeric" value={lev} onChange={(e) => setLev(Math.max(1, Math.min(125, Math.round(+e.target.value || 1))))} />
            <span className="text-sm">×</span>
          </div>
        </div>
        <input type="range" min={1} max={125} value={lev} onChange={(e) => setLev(+e.target.value)} className="mt-2 w-full" />
        <div className="flex justify-between text-[10px] text-mute num"><span>1×</span><span>25×</span><span>50×</span><span>75×</span><span>100×</span><span>125×</span></div>
        {lev > maxLev && <div className="mt-1 text-xs text-warn">⚠️ Leverage maksimal {base(symbol)} di Binance kira-kira {maxLev}× (perkiraan).</div>}
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="label">Margin</span>
          <div className="seg !p-0 text-xs">
            <button data-on={mode === 'fixed'} onClick={() => setMode('fixed')} className="!py-1 !text-xs">USDT</button>
            <button data-on={mode === 'percent'} onClick={() => setMode('percent')} className="!py-1 !text-xs">% saldo</button>
          </div>
        </div>
        {mode === 'fixed' ? (
          <input className="input mt-1" inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value.replace(',', '.'))} />
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <input className="input" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(',', '.'))} />
            <span className="num whitespace-nowrap text-sm text-mute">= {fmtUsd(margin)} USDT</span>
          </div>
        )}
        <div className="mt-1 text-[11px] text-mute num">Tersedia {fmtUsd(availableBalance(book))} USDT</div>
      </div>

      {pv && (
        <div className="space-y-1.5 rounded-lg bg-panel2 p-3 text-sm">
          <Row k="Entry" v={fmtPrice(pv.entry)} />
          <Row k={`TP (+14% margin)`} v={<span className="text-up">{fmtPrice(pv.tp)} <span className="text-xs">({dir === 'LONG' ? '+' : '−'}{fmtNum(pv.tpMovePct, 2)}%)</span></span>} />
          <Row k={`SL (−7% margin)`} v={<span className="text-down">{fmtPrice(pv.sl)} <span className="text-xs">({dir === 'LONG' ? '−' : '+'}{fmtNum(pv.slMovePct, 2)}%)</span></span>} />
          <Row k="Likuidasi (perkiraan)" v={<span className="text-warn">{fmtPrice(pv.liq)} <span className="text-xs">(~{fmtNum(pv.liqMovePct, 1)}%)</span></span>} />
          <Row k="Nilai posisi" v={`${fmtUsd(pv.notional)} USDT`} />
          <Row k={`Fee buka + tutup${settings.bnb ? ' (BNB −10%)' : ''}`} v={`${fmtUsd(pv.feeOpen + pv.feeClose)} USDT`} />
          <div className="my-1 border-t border-line" />
          <Row k="Kalau kena TP" v={<span className="text-up font-semibold">{fmtUsd(pv.netWin, true)} USDT ({fmtPct(pv.netWinPct, 1, true)})</span>} />
          <Row k="Kalau kena SL" v={<span className="text-down font-semibold">{fmtUsd(pv.netLoss, true)} USDT ({fmtPct(pv.netLossPct, 1, true)})</span>} />
          <Row k="Winrate minimal biar impas" v={fmtPct(pv.breakevenWinrate, 0)} />
        </div>
      )}

      <div className="rounded-lg border border-line p-3">
        <div className="flex items-center justify-between">
          <span className="label">Winrate di {lev}×</span>
          <WinratePill pct={wr?.pct ?? null} compact />
        </div>
        {key && wr ? (
          <div className="mt-1.5 space-y-0.5 text-xs text-mute">
            <div>Koin ini: <span className="num text-ink">{wr.coin.n ? `${wr.coin.wins}/${wr.coin.n} (${fmtPct((wr.coin.wins / wr.coin.n) * 100, 0)})` : 'belum ada kejadian'}</span></div>
            <div>Gabungan 40 koin: <span className="num text-ink">{wr.pool.n ? `${wr.pool.wins}/${wr.pool.n} (${fmtPct((wr.pool.wins / wr.pool.n) * 100, 0)})` : '—'}</span></div>
            <div>Metode: {wr.method === 'koin' ? 'data koin ini (sampel ≥ 20)' : wr.method === 'campuran' ? 'campuran — sampel koin < 20, ditarik ke rata-rata gabungan' : wr.method === 'gabungan' ? 'gabungan (koin ini belum pernah)' : '—'} · histori ±{wr.periodDays} hari</div>
            <div>Trade lu ({SETUP_INFO[key].short} {dir}): <span className="num text-ink">{mine.n ? `${mine.w}/${mine.n} (${fmtPct((mine.w / mine.n) * 100, 0)})` : 'belum ada'}</span></div>
            {pv && wr.pct !== null && (
              <div className={wr.pct >= pv.breakevenWinrate ? 'text-up' : 'text-down'}>
                {wr.pct >= pv.breakevenWinrate ? '✓ Di atas winrate impas' : '✗ Di bawah winrate impas — secara statistik rugi'}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-1 text-xs text-mute">{useApp.getState().scan.result ? `Tidak ada sinyal ${dir} di koin ini sekarang — winrate tidak dihitung.` : 'Scan dulu untuk menghitung winrate.'}</div>
        )}
      </div>

      <div className="space-y-1 text-xs">
        {conflict && <div className="text-warn">⚠️ BTC sedang {btc!.trend} — {dir} melawan arah BTC.</div>}
        {slTight && <div className="text-warn">⚠️ Jarak SL {fmtNum(pv!.slMovePct, 2)}% lebih sempit dari ATR 15m ({fmtNum(g15!.v.atrPct, 2)}%). Rawan kena SL karena goyangan biasa — pertimbangkan leverage ≤ {Math.max(1, Math.floor(7 / g15!.v.atrPct))}×.</div>}
        {sentimentBad && settings.filters.sentiment && <div className="text-warn">⚠️ Tidak lolos filter Funding/Long-Short.</div>}
        {setup && setup.dir !== dir && <div className="text-warn">⚠️ Sinyal saat ini {setup.dir}, lu pilih {dir}.</div>}
        {!setup && <div className="text-mute">Koin ini tidak qualify di timeframe manapun saat ini.</div>}
      </div>

      {!confirm ? (
        <button className={`${dir === 'LONG' ? 'btn-up' : 'btn-down'} w-full py-3 text-base`} disabled={!pv} onClick={() => setConfirm(true)}>
          {type === 'market' ? 'Open' : 'Pasang limit'} {dir} {lev}×
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-center text-sm">
            Yakin {dir} {base(symbol)} {lev}× margin {fmtUsd(margin)} USDT?
            <div className="text-xs text-mute">Kalau kena SL, lu rugi ±{fmtUsd(-(pv?.netLoss ?? 0))} USDT</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={() => setConfirm(false)}>Batal</button>
            <button className={dir === 'LONG' ? 'btn-up' : 'btn-down'} onClick={submit}>Konfirmasi</button>
          </div>
        </div>
      )}
      <div className="text-center text-[10px] text-mute">Paper trading — uang virtual. Winrate = statistik histori, bukan jaminan.</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-mute text-xs">{k}</span>
      <span className="num text-right">{v}</span>
    </div>
  );
}
