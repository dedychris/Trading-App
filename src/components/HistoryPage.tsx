import { useMemo, useState } from 'react';
import { auditTrade } from '../lib/audit';
import { matchPatterns, positionFeatures, patternText } from '../lib/patterns';
import { base, fmtDuration, fmtIdr, fmtPct, fmtPrice, fmtTime, fmtUsd } from '../lib/format';
import { setupShort } from '../lib/signals';
import { useApp } from '../store/app';
import { archiveAsBook, archiveList, positionLedger, startBalanceOf, walletBalance } from '../store/book';
import type { Book, Position } from '../store/types';
import { DirBadge, Empty, Idr, Signed } from './ui';

export function exportCsv(book: Book, label = '') {
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
  a.download = `riwayat-trade${label ? `-${label}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** `book` = buku sesi trade ini (bisa arsip), `learn` = buku lengkap untuk pencocokan pola. */
function TradeRow({ p, book, learn }: { p: Position; book: Book; learn: Book }) {
  const [open, setOpen] = useState(false);
  const l = positionLedger(book, p.id);
  const audit = open ? auditTrade(p) : [];
  const feats = open ? positionFeatures(p) : [];
  const pat = open ? matchPatterns(feats, learn) : null;
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
          <Idr v={l.net} sign rate={book.idrRate ?? 0} prefix="" className="block text-[11px] text-mute" />
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
  const archives = archiveList(book);
  const [sel, setSel] = useState<string>('now');
  const arch = sel === 'now' ? null : archives.find((a) => String(a.epoch) === sel) ?? null;
  const view = useMemo(() => (arch ? archiveAsBook(arch, book.settings) : book), [arch, book]);
  const closed = Object.values(view.positions)
    .filter((p) => p.status === 'closed')
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const sessionLabel = (x: { epoch: number; startBalance?: number; startIdr?: number; startedAt: number }) =>
    `Sesi ${x.epoch} · ${x.startIdr ? fmtIdr(x.startIdr) : `${fmtUsd(startBalanceOf(x))} USDT`} · ${new Date(x.startedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })}`;
  const end = walletBalance(view);
  const start = startBalanceOf(view);
  const wins = closed.filter((p) => positionLedger(view, p.id).net > 0).length;
  return (
    <div className="space-y-3">
      {archives.length > 0 && (
        <div className="card space-y-2 p-3">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="label">Sesi</span>
            <select className="input !py-1 min-w-0 flex-1" value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="now">Sesi sekarang · {sessionLabel({ ...book, startedAt: book.epochStartedAt })}</option>
              {archives.map((a) => (
                <option key={a.epoch} value={String(a.epoch)}>📦 Arsip {sessionLabel(a)}</option>
              ))}
            </select>
          </label>
          {arch && (
            <div className="text-xs text-mute num">
              {fmtTime(arch.startedAt)} → {fmtTime(arch.endedAt)} · {closed.length} trade · winrate {closed.length ? fmtPct((wins / closed.length) * 100, 0) : '—'} · saldo {fmtUsd(start)} → {fmtUsd(end)} USDT{' '}
              <Signed v={end - start}>({fmtUsd(end - start, true)}, {fmtPct(((end - start) / start) * 100, 1, true)})</Signed>
              <div>Arsip ini tetap dipakai untuk peringatan pola ⚠️/✅ dan "Trade lu" di form order.</div>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-sm text-mute">{closed.length} trade selesai · klik untuk lihat audit</div>
        <button className="btn-ghost" disabled={!closed.length} onClick={() => exportCsv(view, arch ? `sesi${arch.epoch}` : '')}>⬇ Export CSV</button>
      </div>
      {closed.length ? closed.map((p) => <TradeRow key={p.id} p={p} book={view} learn={book} />) : <Empty>Belum ada trade yang selesai.</Empty>}
    </div>
  );
}
