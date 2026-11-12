import { useState } from 'react';
import { auditTrade } from '../lib/audit';
import { matchPatterns, positionFeatures, patternText } from '../lib/patterns';
import { base, fmtDuration, fmtPct, fmtPrice, fmtTime, fmtUsd } from '../lib/format';
import { setupShort } from '../lib/signals';
import { useApp } from '../store/app';
import { positionLedger } from '../store/book';
import type { Book, Position } from '../store/types';
import { DirBadge, Empty, Signed } from './ui';

export function exportCsv(book: Book) {
  const rows = Object.values(book.positions)
    .filter((p) => p.status === 'closed')
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  const head = ['dibuka', 'ditutup', 'koin', 'arah', 'leverage', 'tipe', 'margin', 'entry', 'exit', 'tp', 'sl', 'alasan', 'auto', 'tp_pct', 'sl_pct', 'trailing_pct', 'profit_tertinggi_pct', 'pnl_kotor', 'fee', 'funding', 'pnl_bersih', 'roe_%', 'setup', 'btc', 'winrate_entry'];
  const lines = rows.map((p) => {
    const l = positionLedger(book, p.id);
    return [
      new Date(p.openedAt).toISOString(),
      new Date(p.closedAt!).toISOString(),
      p.symbol,
      p.dir,
      p.leverage,
      p.entryType,
      p.margin.toFixed(2),
      p.entry,
      p.exit,
      p.tp,
      p.sl,
      p.reason,
      p.auto ? 'ya' : 'tidak',
      p.tpPct ?? 14,
      p.slPct ?? 7,
      p.trailPct ?? '',
      p.peakRoe?.toFixed(2) ?? '',
      l.pnl.toFixed(4),
      l.fee.toFixed(4),
      l.funding.toFixed(4),
      l.net.toFixed(4),
      ((l.net / p.margin) * 100).toFixed(2),
      p.snapEntry?.setup?.key ?? '',
      p.snapEntry?.btcTrend ?? '',
      p.snapEntry?.winrate?.toFixed(1) ?? '',
    ].join(',');
  });
  const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `riwayat-trade-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function TradeRow({ p, book }: { p: Position; book: Book }) {
  const [open, setOpen] = useState(false);
  const l = positionLedger(book, p.id);
  const audit = open ? auditTrade(p) : [];
  const feats = open ? positionFeatures(p) : [];
  const pat = open ? matchPatterns(feats, book) : null;
  const reasonTone = p.reason === 'TP' || p.reason === 'TRAIL' ? 'bg-up/15 text-up' : p.reason === 'MANUAL' ? 'bg-panel2 text-mute' : 'bg-down/15 text-down';
  return (
    <div className="card">
      <button className="flex w-full items-center gap-2 p-3 text-left" onClick={() => setOpen(!open)}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold">{base(p.symbol)}</span>
            <DirBadge dir={p.dir} />
            <span className="chip bg-panel2">{p.leverage}×</span>
            <span className={`chip ${reasonTone}`}>{p.reason === 'TRAIL' ? 'TP ↗ trailing' : p.reason}</span>
            {p.auto && <span className="chip bg-accent/15 text-accent">🤖 AUTO</span>}
          </div>
          <div className="mt-0.5 text-[11px] text-mute">
            {fmtTime(p.closedAt)} · {fmtDuration((p.closedAt ?? 0) - p.openedAt)}
            {p.snapEntry?.setup && ` · ${setupShort(p.snapEntry.setup.key)}`}
          </div>
        </div>
        <div className="text-right">
          <Signed v={l.net} className="font-bold">{fmtUsd(l.net, true)}</Signed>
          <div className="text-[11px]"><Signed v={l.net}>{fmtPct((l.net / p.margin) * 100, 1, true)}</Signed></div>
        </div>
        <span className="text-mute">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-3">
          <div className="grid grid-cols-3 gap-2 text-xs num sm:grid-cols-6">
            <div><div className="text-mute">Entry</div>{fmtPrice(p.entry)}</div>
            <div><div className="text-mute">Exit</div>{fmtPrice(p.exit)}</div>
            <div><div className="text-mute">Margin</div>{fmtUsd(p.margin)}</div>
            <div><div className="text-mute">PnL kotor</div><Signed v={l.pnl}>{fmtUsd(l.pnl, true)}</Signed></div>
            <div><div className="text-mute">Fee</div>{fmtUsd(l.fee)}</div>
            <div><div className="text-mute">Funding</div><Signed v={l.funding}>{fmtUsd(l.funding, true)}</Signed></div>
          </div>
          <div>
            <div className="label mb-1">Audit — kenapa {l.net > 0 ? 'menang' : 'kalah'}?</div>
            <ul className="space-y-1 text-sm">
              {audit.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span>{a.tone === 'good' ? '✅' : a.tone === 'bad' ? '⚠️' : '•'}</span>
                  <span className={a.tone === 'bad' ? 'text-ink' : 'text-mute'}>{a.text}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 rounded-lg bg-panel2 p-2 text-xs">
              <div className="label mb-1">Pola trade ini (disimpan)</div>
              <div className="flex flex-wrap gap-1">
                {feats.map((f) => (
                  <span key={f.k} className="chip bg-panel text-mute">{f.label}</span>
                ))}
              </div>
              {pat?.bad && <div className="mt-1.5 text-down">⚠️ Pola yang sering kena SL: {patternText(pat.bad)} — SL {pat.bad.n - pat.bad.wins} dari {pat.bad.n} kali. Hindari pola ini.</div>}
              {pat?.good && <div className="mt-1 text-up">✅ Pola yang sering kena TP: {patternText(pat.good)} — TP {pat.good.wins} dari {pat.good.n} kali. Ulangi pola ini.</div>}
              {!pat?.bad && !pat?.good && <div className="mt-1.5 text-mute">Peringatan pola muncul setelah kondisi yang sama terjadi minimal 3 kali.</div>}
            </div>
            {!p.snapExit && <div className="mt-1 text-[11px] text-mute">Snapshot indikator saat exit belum tersedia.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function HistoryPage() {
  const book = useApp((s) => s.book);
  const closed = Object.values(book.positions)
    .filter((p) => p.status === 'closed')
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-mute">{closed.length} trade selesai · klik untuk lihat audit</div>
        <button className="btn-ghost" disabled={!closed.length} onClick={() => exportCsv(book)}>⬇ Export CSV</button>
      </div>
      {closed.length ? closed.map((p) => <TradeRow key={p.id} p={p} book={book} />) : <Empty>Belum ada trade yang selesai.</Empty>}
    </div>
  );
}
