import { useState } from 'react';
import { stats } from '../../core/engine';
import type { Trade } from '../../core/types';
import type { View } from '../api';
import { base, dateTime, duration, idr, pct, price, r, tone } from '../fmt';

export function HistoryPage({ view }: { view: View }) {
  const sessions = [
    { id: 'now', label: `Sesi sekarang (${dateTime(view.startedAt)})`, trades: view.trades, rate: view.idrRate, start: view.startBalance },
    ...view.archive.map((a, i) => ({ id: String(i), label: `Arsip ${dateTime(a.startedAt)} → ${dateTime(a.endedAt)}`, trades: a.trades, rate: a.idrRate, start: a.startBalance })).reverse(),
  ];
  const [sel, setSel] = useState('now');
  const s = sessions.find((x) => x.id === sel) ?? sessions[0];
  const st = stats(s.trades, s.start);
  const trades = [...s.trades].reverse();
  return (
    <>
      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <select className="input w-auto" value={sel} onChange={(e) => setSel(e.target.value)}>
            {sessions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <button className="btn-ghost" disabled={!trades.length} onClick={() => exportCsv(s.trades, s.rate)}>
            Export CSV
          </button>
        </div>
        <div className="num mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            Trade <b>{st.n}</b>
          </div>
          <div>
            Winrate <b>{st.n ? pct(st.winrate) : '–'}</b>
          </div>
          <div>
            Rata menang <b className="text-up">{st.n ? r(st.avgWinR) : '–'}</b>
          </div>
          <div>
            Rata kalah <b className="text-down">{st.n ? r(st.avgLossR) : '–'}</b>
          </div>
          <div>
            Profit factor <b>{st.n ? (Number.isFinite(st.pf) ? st.pf.toFixed(2) : '∞') : '–'}</b>
          </div>
          <div>
            Total fee <b>{idr(st.fees * s.rate)}</b>
          </div>
          <div className="col-span-2">Exit: {Object.entries(st.byExit).map(([k, v]) => `${k} ${v}`).join(' · ') || '–'}</div>
        </div>
      </section>
      <section className="space-y-2">
        {!trades.length && <div className="card p-4 text-sm text-mute">Belum ada trade selesai.</div>}
        {trades.map((t) => (
          <div key={t.id} className="card p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`chip ${t.dir === 'LONG' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{t.dir}</span>
                <b>{base(t.symbol)}</b>
                <span className="chip bg-panel2 text-mute">{t.setup}</span>
                <span className="chip bg-panel2 text-mute">{t.exitKind}</span>
              </div>
              <div className={`num font-semibold ${tone(t.pnl)}`}>{r(t.r)}</div>
            </div>
            <div className="num mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-mute">
              <span>
                {price(t.entry)} → {price(t.exit)} · {t.leverage}×
              </span>
              <span className={tone(t.pnl)}>{idr(t.pnl * s.rate, true)}</span>
              <span>
                {dateTime(t.openedAt)} · {duration(t.closedAt - t.openedAt)}
              </span>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function exportCsv(trades: Trade[], rate: number) {
  const head = ['buka_wib', 'tutup_wib', 'koin', 'arah', 'setup', 'exit', 'entry', 'harga_keluar', 'leverage', 'margin_usdt', 'risiko_usdt', 'pnl_usdt', 'pnl_rp', 'fee_usdt', 'R', 'alasan'];
  const rows = trades.map((t) => [dateTime(t.openedAt), dateTime(t.closedAt), t.symbol, t.dir, t.setup, t.exitKind, t.entry, t.exit, t.leverage, t.margin.toFixed(4), t.riskUsd.toFixed(4), t.pnl.toFixed(4), Math.round(t.pnl * rate), t.fees.toFixed(4), t.r.toFixed(3), t.note]);
  const csv = [head, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `trades-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}
