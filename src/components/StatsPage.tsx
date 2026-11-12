import { useMemo } from 'react';
import { insights } from '../lib/audit';
import { allPatterns, MIN_PATTERN_N, patternText } from '../lib/patterns';
import { fmtPct, fmtUsd } from '../lib/format';
import { SETUP_INFO, SETUP_ORDER } from '../lib/signals';
import { START_BALANCE } from '../lib/sim';
import { useApp } from '../store/app';
import { positionLedger, walletBalance } from '../store/book';
import { EquityChart } from './Chart';
import { Signed, Stat } from './ui';

export function StatsPage() {
  const book = useApp((s) => s.book);
  const s = useMemo(() => {
    const closed = Object.values(book.positions).filter((p) => p.status === 'closed');
    const nets = closed.map((p) => positionLedger(book, p.id).net);
    const wins = nets.filter((x) => x > 0);
    const losses = nets.filter((x) => x <= 0);
    let fee = 0;
    let funding = 0;
    for (const e of Object.values(book.ledger)) {
      if (e.kind === 'fee') fee += e.amt;
      if (e.kind === 'funding') funding += e.amt;
    }
    const entries = Object.values(book.ledger).sort((a, b) => a.t - b.t);
    let bal = START_BALANCE;
    const curve = [{ t: book.epochStartedAt, v: bal }];
    for (const e of entries) {
      bal += e.amt;
      curve.push({ t: e.t, v: bal });
    }
    let peak = START_BALANCE;
    let maxDd = 0;
    for (const p of curve) {
      peak = Math.max(peak, p.v);
      maxDd = Math.max(maxDd, ((peak - p.v) / peak) * 100);
    }
    const bySetup = SETUP_ORDER.map((k) => {
      const ps = closed.filter((p) => p.snapEntry?.setup?.key === k);
      const w = ps.filter((p) => positionLedger(book, p.id).net > 0).length;
      return { k, n: ps.length, w };
    }).filter((x) => x.n);
    const grossWin = wins.reduce((a, b) => a + b, 0);
    const grossLoss = -losses.reduce((a, b) => a + b, 0);
    return {
      n: closed.length,
      winrate: closed.length ? (wins.length / closed.length) * 100 : null,
      avgWin: wins.length ? grossWin / wins.length : null,
      avgLoss: losses.length ? -grossLoss / losses.length : null,
      pf: grossLoss ? grossWin / grossLoss : null,
      fee,
      funding,
      curve,
      maxDd,
      bySetup,
      tips: insights(book),
      patterns: allPatterns(book),
    };
  }, [book]);
  const wallet = walletBalance(book);
  const net = wallet - START_BALANCE;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Saldo" value={fmtUsd(wallet)} sub={<Signed v={net}>{fmtUsd(net, true)} ({fmtPct((net / START_BALANCE) * 100, 2, true)})</Signed>} />
        <Stat label="Winrate asli lu" value={s.winrate === null ? '—' : fmtPct(s.winrate, 1)} sub={`${s.n} trade`} />
        <Stat label="Rata-rata profit" value={<span className="text-up">{fmtUsd(s.avgWin, true)}</span>} sub={<>rugi <span className="text-down">{fmtUsd(s.avgLoss, true)}</span></>} />
        <Stat label="Profit factor" value={s.pf === null ? '—' : s.pf.toFixed(2)} sub={`max drawdown ${fmtPct(s.maxDd, 1)}`} />
        <Stat label="Total fee" value={<span className="text-down">{fmtUsd(s.fee)}</span>} />
        <Stat label="Total funding" value={<Signed v={s.funding}>{fmtUsd(s.funding, true)}</Signed>} />
      </div>
      <div className="card p-3">
        <div className="label mb-2">Grafik saldo</div>
        <EquityChart points={s.curve} />
      </div>
      {s.bySetup.length > 0 && (
        <div className="card p-3">
          <div className="label mb-2">Winrate per setup (trade lu)</div>
          <table className="w-full text-sm num">
            <tbody>
              {s.bySetup.map((x) => (
                <tr key={x.k} className="border-b border-line last:border-0">
                  <td className="py-1.5 font-sans">{SETUP_INFO[x.k].label}</td>
                  <td className="text-right">{x.w}/{x.n}</td>
                  <td className="w-20 text-right">{fmtPct((x.w / x.n) * 100, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {(['best', 'worst'] as const).map((kind) => {
          const rows = s.patterns[kind];
          return (
            <div key={kind} className="card p-3">
              <div className={`label mb-2 ${kind === 'best' ? '!text-up' : '!text-down'}`}>{kind === 'best' ? '✅ Pola terbaik lu — ulangi' : '⚠️ Pola terburuk lu — hindari'}</div>
              {rows.length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="py-1.5 pr-2">{patternText(r)}</td>
                        <td className="num whitespace-nowrap text-right">{kind === 'best' ? `TP ${r.wins}/${r.n}` : `SL ${r.n - r.wins}/${r.n}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-sm text-mute">Belum ada. Pola baru dihitung setelah kondisi yang sama terjadi minimal {MIN_PATTERN_N} kali ({s.patterns.total} trade selesai).</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="card p-3">
        <div className="label mb-2">Pola dari trade lu</div>
        {s.tips.length ? (
          <ul className="space-y-1.5 text-sm">{s.tips.map((t, i) => <li key={i}>💡 {t.text}</li>)}</ul>
        ) : (
          <div className="text-sm text-mute">Pola baru muncul setelah ada minimal 5 trade di tiap kelompok yang dibandingkan (misalnya 5 trade searah BTC dan 5 trade melawan BTC).</div>
        )}
      </div>
    </div>
  );
}
