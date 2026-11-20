import { useEffect, useState } from 'react';
import type { BacktestJson } from '../api';
import { BarsR } from '../charts';
import { date, pct, tone } from '../fmt';

export function BacktestPage() {
  const [bt, setBt] = useState<BacktestJson | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch('/backtest.json')
      .then((r) => r.json())
      .then(setBt)
      .catch((e) => setErr(String(e)));
  }, []);
  if (err) return <div className="card p-4 text-sm text-down">Hasil backtest tidak bisa dimuat: {err}</div>;
  if (!bt) return <div className="py-16 text-center text-sm text-mute">Memuat…</div>;
  const def = bt.variants[0];
  return (
    <>
      <section className="card p-4 text-sm">
        <h2 className="text-base font-semibold">Backtest data asli Binance</h2>
        <p className="mt-1 text-mute">
          {bt.coins} koin, candle {date(bt.period.from)} – {date(bt.period.to)}. Mesin yang sama dengan bot live: sinyal di candle close, entry di open candle berikutnya, fee taker/maker + slippage, SL dianggap kena duluan kalau SL & TP di candle yang sama. Risiko 1% saldo per trade.
        </p>
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3">
          <b>Jujur soal hasilnya:</b> setting default cuma sedikit untung dalam 2 tahun ({def.totalR > 0 ? '+' : ''}
          {def.totalR.toFixed(1)}R) dan <b>rugi di tahun pertama</b> ({def.perYear[0]?.toFixed(1)}R). Belum ada bukti edge yang kuat. Strategi intraday 15m (gaya app lama) rugi besar bahkan sebelum fee. Paper trading ini untuk menguji ke depan, bukan jaminan profit.
        </div>
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-semibold">Perbandingan varian (modal {bt.startBalance} USDT)</h2>
        <table className="num w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-mute">
            <tr>
              <th className="py-1 font-semibold">Varian</th>
              <th className="text-right font-semibold">Trade</th>
              <th className="text-right font-semibold">Winrate</th>
              <th className="text-right font-semibold">Rata R</th>
              {bt.years.map((y) => (
                <th key={y} className="text-right font-semibold">
                  R {y}
                </th>
              ))}
              <th className="text-right font-semibold">DD maks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {bt.variants.map((v, i) => (
              <tr key={v.name} className={i === 0 ? 'font-semibold' : ''}>
                <td className="py-1.5 pr-2 font-sans">{v.name}</td>
                <td className="text-right">{v.n}</td>
                <td className="text-right">{pct(v.winrate)}</td>
                <td className={`text-right ${tone(v.avgR)}`}>{v.avgR.toFixed(2)}</td>
                {v.perYear.map((y, k) => (
                  <td key={k} className={`text-right ${tone(y)}`}>
                    {y > 0 ? '+' : ''}
                    {y.toFixed(1)}
                  </td>
                ))}
                <td className="text-right">{v.maxDdPct.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold">R per bulan — setting default</h2>
        <p className="mb-2 text-xs text-mute">Hijau = bulan untung, merah = bulan rugi.</p>
        <BarsR data={Object.entries(bt.monthly).map(([k, v]) => ({ k, v }))} />
      </section>

      <section className="card p-4 text-sm">
        <h2 className="font-semibold">Modal kecil (Rp {bt.small.startIdr.toLocaleString('id-ID')})</h2>
        <p className="mt-1 text-mute">
          {bt.small.n} trade, winrate {pct(bt.small.winrate)}, hasil {bt.small.returnPct >= 0 ? '+' : ''}
          {bt.small.returnPct.toFixed(0)}%, drawdown maks {bt.small.maxDdPct.toFixed(0)}%. Dengan modal sekecil ini, 1% risiko sering di bawah minimal order Binance (5 USDT; BTC 100, ETH 20). Posisi dinaikkan ke minimal selama risikonya ≤ 3% saldo, jadi risiko nyata per trade sering 2–3%, dan BTC/ETH hampir selalu dilewati.
        </p>
      </section>
    </>
  );
}
