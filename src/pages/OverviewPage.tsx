import { useState } from 'react';
import { MODE_TF } from '../../core/config';
import { unrealized } from '../../core/engine';
import type { Position } from '../../core/types';
import { api, getKey } from '../api';
import type { Ctx } from '../App';
import { EquityChart } from '../charts';
import { base, dateTime, duration, idr, pct, price, r, tone, usd } from '../fmt';

export function OverviewPage({ ctx }: { ctx: Ctx }) {
  const { view, prices } = ctx;
  const st = view.stats;
  const rate = view.idrRate;
  const openPnl = view.positions.reduce((s, p) => s + (prices[p.symbol] ? unrealized(p, prices[p.symbol]) : 0), 0);
  const equity = view.balance + openPnl;
  const change = equity - view.startBalance;
  const tf = MODE_TF[view.config.mode];
  return (
    <>
      <section className="card p-4">
        <div className="label">Saldo (termasuk posisi terbuka)</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <div className="num text-3xl font-bold">{idr(equity * rate)}</div>
          <div className="num text-sm text-mute">{usd(equity)} USDT</div>
        </div>
        <div className={`num mt-1 text-sm font-semibold ${tone(change)}`}>
          {idr(change * rate, true)} ({change >= 0 ? '+' : ''}
          {((change / view.startBalance) * 100).toFixed(1)}%) sejak {dateTime(view.startedAt)}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Trade selesai" value={String(st.n)} />
          <Stat label="Winrate" value={st.n ? pct(st.winrate) : '–'} />
          <Stat label="Total R" value={st.n ? r(st.totalR) : '–'} cls={tone(st.totalR)} />
          <Stat label="Drawdown maks" value={st.n ? `${st.maxDdPct.toFixed(1)}%` : '–'} />
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">Grafik saldo</h2>
          <span className="text-xs text-mute">per trade selesai</span>
        </div>
        <EquityChart points={view.equity.map((e) => ({ t: e.t, v: e.v * rate }))} format={(v) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}jt` : `${Math.round(v / 1000)}rb`)} label={dateTime} />
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="font-semibold">Posisi terbuka ({view.positions.length}/{view.config.maxOpen})</h2>
          <span className="text-xs text-mute">
            entry {tf.entry} · bias {tf.bias}
          </span>
        </div>
        {!view.positions.length && <div className="card p-4 text-sm text-mute">Belum ada posisi. Bot menilai semua koin tiap candle {tf.entry} close — alasannya ada di tab Keputusan.</div>}
        {view.positions.map((p) => (
          <PositionCard key={p.id} p={p} px={prices[p.symbol]} ctx={ctx} />
        ))}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Aktivitas bot</h2>
        <ul className="space-y-1.5 text-sm">
          {view.log.slice(0, 12).map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="num shrink-0 text-xs leading-5 text-mute">{dateTime(l.t)}</span>
              <span className={l.tone === 'bad' ? 'text-down' : l.tone === 'good' ? 'text-up' : ''}>{l.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Stat({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg bg-panel2 px-3 py-2">
      <div className="label">{label}</div>
      <div className={`num mt-0.5 text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function PositionCard({ p, px, ctx }: { p: Position; px?: number; ctx: Ctx }) {
  const [busy, setBusy] = useState(false);
  const rate = ctx.view.idrRate;
  const u = px ? unrealized(p, px) : null;
  const realized = p.fills.reduce((s, f) => s + f.pnl - f.fee, 0);
  const rNow = u !== null ? (u + realized - p.feeOpen) / p.riskUsd : null;
  const close = async () => {
    if (!getKey()) return ctx.toast('Isi kunci bot dulu di tab Setting', true);
    if (!confirm(`Tutup ${base(p.symbol)} ${p.dir} di harga pasar?`)) return;
    setBusy(true);
    try {
      ctx.setView(await api.close(p.id));
      ctx.toast('Posisi ditutup');
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`chip ${p.dir === 'LONG' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{p.dir === 'LONG' ? '▲ LONG' : '▼ SHORT'}</span>
          <span className="font-semibold">{base(p.symbol)}</span>
          <span className="chip bg-panel2 text-mute">{p.leverage}×</span>
          <span className="chip bg-panel2 text-mute">{p.setup}</span>
          {p.tp1Hit && <span className="chip bg-accent/15 text-accent">TP1 ✓</span>}
        </div>
        <div className={`num text-right text-sm font-semibold ${tone(u ?? 0)}`}>{rNow !== null ? r(rNow) : '–'}</div>
      </div>
      <div className="num mt-2 grid grid-cols-4 gap-2 text-xs">
        <Kv k="Entry" v={price(p.entry)} />
        <Kv k="Sekarang" v={px ? price(px) : '…'} />
        <Kv k={p.sl === p.initialSl ? 'SL' : 'SL (geser)'} v={price(p.sl)} />
        <Kv k={p.tp1Hit ? 'Trailing' : 'TP1 (1R)'} v={p.tp1Hit ? 'aktif' : price(p.tp1)} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-mute">
        <span>
          {u !== null ? <span className={tone(u)}>{idr(u * rate, true)}</span> : null} · risiko {idr(p.riskUsd * rate)} · {duration(Date.now() - p.openedAt)}
        </span>
        <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={close}>
          Tutup
        </button>
      </div>
      <div className="mt-1 text-xs text-mute">{p.note}</div>
    </div>
  );
}

const Kv = ({ k, v }: { k: string; v: string }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-mute">{k}</div>
    <div>{v}</div>
  </div>
);
