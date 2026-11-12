import { useState } from 'react';
import { base, fmtDuration, fmtNum, fmtPct, fmtPrice, fmtUsd, fmtSet } from '../lib/format';
import { pnl, TP_PCT } from '../lib/sim';
import { priceAtRoe, trailStopRoe } from '../lib/trailing';
import { cancelOrder, useApp } from '../store/app';
import { positionLedger } from '../store/book';
import { manualClose } from '../store/engine';
import type { Position } from '../store/types';
import { DirBadge, Empty, Signed } from './ui';
import { useFlash } from './hooks';

function PositionCard({ p }: { p: Position }) {
  const px = useApp((s) => s.prices[p.symbol]);
  const book = useApp((s) => s.book);
  const open = useApp((s) => s.openDetail);
  const [confirm, setConfirm] = useState(false);
  const led = positionLedger(book, p.id);
  const u = px ? pnl(p.dir, p.entry, px, p.qty) : 0;
  const roe = (u / p.margin) * 100;
  const fPx = useFlash(px);
  const fU = useFlash(px ? u : null);
  const toTp = px ? (Math.abs(p.tp - px) / px) * 100 : null;
  const toSl = px ? (Math.abs(p.sl - px) / px) * 100 : null;
  // posisi harga di antara SL (0%) dan TP (100%)
  const prog = px ? Math.max(0, Math.min(100, ((p.dir === 'LONG' ? px - p.sl : p.sl - px) / Math.abs(p.tp - p.sl)) * 100)) : 50;
  return (
    <div className="card p-3">
      <div className="flex items-center gap-2">
        <button className="text-base font-bold hover:text-accent" onClick={() => open(p.symbol)}>{base(p.symbol)}</button>
        <DirBadge dir={p.dir} />
        <span className="chip bg-panel2">{p.leverage}×</span>
        {p.entryType === 'limit' && <span className="chip bg-panel2 text-mute">limit</span>}
        {p.auto && <span className="chip bg-accent/15 text-accent">🤖 AUTO</span>}
        <span className="ml-auto text-[11px] text-mute">{fmtDuration(Date.now() - p.openedAt)}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <div className="text-[11px] text-mute">PnL belum terealisasi</div>
          <span key={fU.key} className={`inline-block px-0.5 ${fU.cls}`}><Signed v={u} className="text-xl font-bold">{fmtUsd(u, true)}</Signed></span>
          <Signed v={roe} className="ml-2 text-sm">{fmtPct(roe, 2, true)}</Signed>
        </div>
        <div className="text-right text-xs text-mute num">
          <div>fee {fmtUsd(led.fee)}</div>
          <div>funding <Signed v={led.funding}>{fmtUsd(led.funding, true)}</Signed></div>
        </div>
      </div>
      <div className="mt-3">
        <div className="relative h-1.5 rounded-full bg-gradient-to-r from-down/60 via-panel2 to-up/60">
          <div className="absolute -top-1 h-3.5 w-1 rounded bg-ink" style={{ left: `calc(${prog}% - 2px)` }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] num">
          <span className="text-down">SL {fmtPrice(p.sl)} <span className="text-mute">({fmtNum(toSl, 2)}%)</span></span>
          <span className="text-up">TP{p.trailPct ? ' ↗' : ''} {fmtPrice(p.tp)} <span className="text-mute">({fmtNum(toTp, 2)}%)</span></span>
        </div>
      </div>
      {p.trailPct ? (
        <div className={`mt-2 rounded-md px-2 py-1 text-[11px] ${p.trailActive ? 'bg-up/10 text-up' : 'bg-panel2 text-mute'}`}>
          {p.trailActive ? (
            <>
              🎯 Trailing aktif · profit tertinggi <b className="num">+{fmtNum(p.peakRoe, 1)}%</b> · keluar kalau turun ke{' '}
              <b className="num">+{fmtNum(trailStopRoe(p.tpPct ?? TP_PCT, p.trailPct, p.peakRoe ?? 0), 1)}%</b> (harga {fmtPrice(priceAtRoe(p.dir, p.entry, p.leverage, trailStopRoe(p.tpPct ?? TP_PCT, p.trailPct, p.peakRoe ?? 0)))})
            </>
          ) : (
            <>↗ Trailing TP: aktif setelah +{fmtSet(p.tpPct ?? TP_PCT)}%, lalu ikut naik dengan jarak {fmtSet(p.trailPct)}%</>
          )}
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-4 gap-2 text-[11px] num">
        <div><div className="text-mute">Entry</div>{fmtPrice(p.entry)}</div>
        <div><div className="text-mute">Harga</div><span key={fPx.key} className={`-mx-0.5 inline-block px-0.5 ${fPx.cls}`}>{fmtPrice(px)}</span></div>
        <div><div className="text-mute">Margin</div>{fmtUsd(p.margin)}</div>
        <div><div className="text-mute">Likuidasi</div><span className="text-warn">{fmtPrice(p.liq)}</span></div>
      </div>
      <div className="mt-3">
        {!confirm ? (
          <button className="btn-ghost w-full" onClick={() => setConfirm(true)}>Tutup posisi (market)</button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={() => setConfirm(false)}>Batal</button>
            <button className="btn-down" onClick={() => manualClose(p.id)}>Ya, tutup di {fmtPrice(px)}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PositionsPage() {
  const book = useApp((s) => s.book);
  const prices = useApp((s) => s.prices);
  const [tab, setTab] = useState<'open' | 'pending'>('open');
  const open = Object.values(book.positions).filter((p) => p.status === 'open').sort((a, b) => b.openedAt - a.openedAt);
  const pending = Object.values(book.orders).filter((o) => o.status === 'pending').sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="space-y-3">
      <div className="seg max-w-sm">
        <button data-on={tab === 'open'} onClick={() => setTab('open')}>Posisi ({open.length})</button>
        <button data-on={tab === 'pending'} onClick={() => setTab('pending')}>Order Pending ({pending.length})</button>
      </div>
      {tab === 'open' &&
        (open.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{open.map((p) => <PositionCard key={p.id} p={p} />)}</div>
        ) : (
          <Empty>Belum ada posisi terbuka. Buka koin dari Scanner untuk mulai paper trading.</Empty>
        ))}
      {tab === 'pending' &&
        (pending.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pending.map((o) => {
              const px = prices[o.symbol];
              return (
                <div key={o.id} className="card p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{base(o.symbol)}</span>
                    <DirBadge dir={o.dir} />
                    <span className="chip bg-panel2">{o.leverage}×</span>
                    <span className="chip bg-panel2 text-mute">limit</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs num">
                    <div><div className="text-mute">Harga limit</div>{fmtPrice(o.price)}</div>
                    <div><div className="text-mute">Harga sekarang</div>{fmtPrice(px)}</div>
                    <div><div className="text-mute">Jarak</div>{px ? fmtPct((Math.abs(px - o.price) / px) * 100) : '—'}</div>
                  </div>
                  <div className="mt-1 text-xs text-mute num">Margin {fmtUsd(o.margin)} USDT (dikunci)</div>
                  <button className="btn-ghost mt-3 w-full" onClick={() => cancelOrder(o.id)}>Batalkan order</button>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>Tidak ada order limit yang menunggu.</Empty>
        ))}
    </div>
  );
}
