import { useState } from 'react';
import { MODE_TF } from '../../core/config';
import type { Decision } from '../../core/types';
import type { View } from '../api';
import { base, dateTime } from '../fmt';

const BADGE: Record<Decision['action'], [string, string]> = {
  OPEN: ['BUKA', 'bg-up/15 text-up'],
  SKIP: ['LEWAT', 'bg-warn/15 text-warn'],
  WAIT: ['TUNGGU', 'bg-panel2 text-mute'],
};

export function DecisionsPage({ view }: { view: View }) {
  const tf = MODE_TF[view.config.mode];
  const scan = [...view.scan].sort((a, b) => order(a) - order(b));
  const [more, setMore] = useState(false);
  const hist = more ? view.decisions : view.decisions.slice(0, 25);
  return (
    <>
      <section className="card p-4">
        <h2 className="font-semibold">Scan terakhir</h2>
        <p className="mt-1 text-sm text-mute">
          {view.scanAt ? `Candle ${tf.entry} close ${dateTime(view.lastBarT)} WIB, dinilai ${dateTime(view.scanAt)}.` : `Belum ada scan. Scan pertama jalan saat candle ${tf.entry} berikutnya close.`} Tiap koin selalu punya alasan: kenapa dibuka, dilewati, atau masih ditunggu.
        </p>
        <ul className="mt-3 divide-y divide-line">
          {scan.map((d) => (
            <Row key={d.symbol} d={d} />
          ))}
        </ul>
      </section>
      <section className="card p-4">
        <h2 className="font-semibold">Riwayat sinyal</h2>
        <p className="mt-1 text-sm text-mute">Semua sinyal yang muncul, dibuka maupun dilewati (rem risiko).</p>
        {!view.decisions.length && <p className="mt-3 text-sm text-mute">Belum ada sinyal.</p>}
        <ul className="mt-3 divide-y divide-line">
          {hist.map((d, i) => (
            <Row key={i} d={d} showTime />
          ))}
        </ul>
        {!more && view.decisions.length > hist.length && (
          <button className="btn-ghost mt-2 w-full" onClick={() => setMore(true)}>
            Tampilkan semua ({view.decisions.length})
          </button>
        )}
      </section>
    </>
  );
}

const order = (d: Decision) => (d.action === 'OPEN' ? 0 : d.action === 'SKIP' ? 1 : 2);

function Row({ d, showTime }: { d: Decision; showTime?: boolean }) {
  const [label, cls] = BADGE[d.action];
  return (
    <li className="flex gap-3 py-2 text-sm">
      <div className="w-16 shrink-0">
        <div className="font-semibold">{base(d.symbol)}</div>
        <span className={`chip mt-0.5 ${cls}`}>{label}</span>
      </div>
      <div className="min-w-0">
        {d.dir && (
          <div className="text-xs font-semibold">
            {d.dir} · {d.setup}
          </div>
        )}
        <div className="text-mute">{d.reason}</div>
        {showTime && <div className="num text-xs text-mute">{dateTime(d.t)}</div>}
      </div>
    </li>
  );
}
