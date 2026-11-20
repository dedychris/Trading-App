import { useEffect, useState } from 'react';
import { DEFAULT_CONFIG, type BotConfig } from '../../core/config';
import { api, getKey, setKey } from '../api';
import type { Ctx } from '../App';
import { idr } from '../fmt';

type NumKey = { [K in keyof BotConfig]-?: BotConfig[K] extends number ? K : never }[keyof BotConfig];
type BoolKey = { [K in keyof BotConfig]-?: BotConfig[K] extends boolean ? K : never }[keyof BotConfig];
type Field = { k: NumKey; label: string; hint?: string; step?: number; pct?: boolean } | { k: BoolKey; label: string; hint?: string; bool: true };

const GROUPS: { title: string; fields: Field[] }[] = [
  { title: 'B. Arah tren (bias)', fields: [
    { k: 'biasFast', label: 'EMA cepat TF bias' },
    { k: 'biasSlow', label: 'EMA lambat TF bias' },
    { k: 'btcFilter', label: 'Altcoin tidak melawan bias BTC', bool: true },
  ] },
  { title: 'C. Pemicu entry', fields: [
    { k: 'pullback', label: 'Setup pullback ke EMA', bool: true },
    { k: 'breakout', label: 'Setup breakout + volume', bool: true },
    { k: 'emaFast', label: 'EMA pullback' },
    { k: 'emaSlow', label: 'EMA tren lokal' },
    { k: 'rsiLongMin', label: 'RSI LONG min (SHORT = 100 − max)' },
    { k: 'rsiLongMax', label: 'RSI LONG max (SHORT = 100 − min)' },
    { k: 'breakoutLookback', label: 'Breakout: tembus high/low N candle' },
    { k: 'volMult', label: 'Breakout: volume ≥ N× rata-rata', step: 0.1 },
    { k: 'maxExtensionAtr', label: 'Breakout: maks jarak dari EMA (× ATR)', step: 0.1 },
  ] },
  { title: 'D. Stop loss', fields: [{ k: 'slAtr', label: 'SL = N × ATR(14)', step: 0.1 }] },
  { title: 'E. Ukuran posisi', fields: [
    { k: 'riskPct', label: 'Risiko per trade (% saldo) = 1R', step: 0.1 },
    { k: 'maxLeverage', label: 'Leverage maksimal' },
    { k: 'maxMarginPct', label: 'Margin 1 posisi maks (% saldo)' },
    { k: 'minOrderMaxRiskPct', label: 'Minimal order Binance: boleh naik sampai risiko N % saldo', step: 0.5 },
  ] },
  { title: 'F. Target & keluar', fields: [
    { k: 'tp1R', label: 'TP1 di N × R', step: 0.1 },
    { k: 'tp1Frac', label: 'Bagian ditutup di TP1 (0–1, 0 = tanpa TP1)', step: 0.1 },
    { k: 'tp2R', label: 'TP2 di N × R (0 = tanpa, ikut trailing)', step: 0.1 },
    { k: 'trailAtr', label: 'Trailing stop N × ATR (0 = mati)', step: 0.1 },
    { k: 'trailAlways', label: 'Trailing sejak entry (bukan setelah TP1)', bool: true },
    { k: 'timeStopBars', label: 'Time stop: tutup setelah N candle (0 = mati)' },
  ] },
  { title: 'G. Rem risiko', fields: [
    { k: 'maxOpen', label: 'Maks posisi terbuka' },
    { k: 'maxSameDir', label: 'Maks posisi searah' },
    { k: 'dailyLossR', label: 'Stop hari ini kalau rugi ≤ −N R' },
    { k: 'cooldownBars', label: 'Jeda koin setelah SL (candle)' },
  ] },
];

export function SettingsPage({ ctx }: { ctx: Ctx }) {
  const { view, setView, toast } = ctx;
  const [key, setK] = useState(getKey());
  const [ok, setOk] = useState<boolean | null>(null);
  const [cfg, setCfg] = useState<BotConfig>(view.config);
  const [coins, setCoins] = useState(view.config.coins.map((c) => c.replace(/USDT$/, '')).join(', '));
  const [rp, setRp] = useState('150000');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCfg(view.config);
    setCoins(view.config.coins.map((c) => c.replace(/USDT$/, '')).join(', '));
  }, [view.config]);
  useEffect(() => {
    if (getKey()) api.check().then(() => setOk(true), () => setOk(false));
  }, []);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    if (!getKey()) return toast('Isi kunci bot dulu', true);
    setBusy(true);
    try {
      const v = await fn();
      if (v && typeof v === 'object' && 'config' in v) setView(v as typeof view);
      else await ctx.refresh();
      toast(msg);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const dirty = JSON.stringify({ ...cfg, coins: parseCoins(coins) }) !== JSON.stringify(view.config);

  return (
    <>
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Kunci bot</h2>
        <p className="text-sm text-mute">Nilai BOT_SECRET di Vercel. Dibutuhkan untuk ubah setting, pause, tutup posisi, dan reset. Disimpan di browser ini saja.</p>
        <div className="flex gap-2">
          <input className="input" type="password" value={key} onChange={(e) => setK(e.target.value)} placeholder="BOT_SECRET" />
          <button
            className="btn-primary"
            onClick={async () => {
              setKey(key.trim());
              try {
                await api.check();
                setOk(true);
                toast('Kunci benar');
              } catch (e) {
                setOk(false);
                toast((e as Error).message, true);
              }
            }}
          >
            Simpan
          </button>
        </div>
        {ok !== null && <div className={`text-sm ${ok ? 'text-up' : 'text-down'}`}>{ok ? '✓ Kunci benar' : '✗ Kunci salah'}</div>}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Kontrol</h2>
        <div className="flex flex-wrap gap-2">
          {view.paused ? (
            <button className="btn-primary" disabled={busy} onClick={() => run(api.resume, 'Bot jalan lagi')}>
              ▶️ Jalankan bot
            </button>
          ) : (
            <button className="btn-ghost" disabled={busy} onClick={() => run(api.pause, 'Bot di-pause')}>
              ⏸️ Pause
            </button>
          )}
          <button className="btn-ghost" disabled={busy} onClick={() => run(api.tick, 'Tick selesai')}>
            Jalankan 1 tick sekarang
          </button>
        </div>
      </section>

      <section className="card space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Strategi</h2>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setCfg({ ...DEFAULT_CONFIG }); setCoins(DEFAULT_CONFIG.coins.map((c) => c.replace(/USDT$/, '')).join(', ')); }}>
            Kembalikan default
          </button>
        </div>
        <div>
          <div className="label mb-1">Mode (TF entry / TF bias)</div>
          <div className="seg">
            {(['position', 'swing', 'intraday'] as const).map((m) => (
              <button key={m} data-on={cfg.mode === m} onClick={() => setCfg({ ...cfg, mode: m })}>
                {m === 'position' ? '4H / 1D' : m === 'swing' ? '1H / 4H' : '15m / 1H'}
              </button>
            ))}
          </div>
          {cfg.mode !== 'position' && <p className="mt-1 text-xs text-warn">Di backtest 2 tahun, mode ini rugi (lihat tab Backtest).</p>}
        </div>
        <div>
          <div className="label mb-1">A. Koin</div>
          <textarea className="input h-20" value={coins} onChange={(e) => setCoins(e.target.value)} />
        </div>
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="label mb-2">{g.title}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.fields.map((f) =>
                'bool' in f ? (
                  <label key={f.k} className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-sm">
                    <input type="checkbox" checked={cfg[f.k]} onChange={(e) => setCfg({ ...cfg, [f.k]: e.target.checked })} />
                    {f.label}
                  </label>
                ) : (
                  <label key={f.k} className="text-sm">
                    <span className="text-mute">{f.label}</span>
                    <input className="input mt-1" type="number" step={f.step ?? 1} value={cfg[f.k]} onChange={(e) => setCfg({ ...cfg, [f.k]: e.target.value === '' ? 0 : +e.target.value })} />
                  </label>
                ),
              )}
            </div>
          </div>
        ))}
        <button className="btn-primary w-full" disabled={busy || !dirty} onClick={() => run(() => api.config({ ...cfg, coins: parseCoins(coins) }), 'Setting disimpan')}>
          Simpan setting
        </button>
        <p className="text-xs text-mute">Setting berlaku untuk sinyal berikutnya. Posisi yang sudah terbuka tetap pakai SL/TP saat dibuka (trailing ikut setting baru).</p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Sesi baru</h2>
        <p className="text-sm text-mute">
          Posisi terbuka ditutup di harga pasar, riwayat sesi ini disimpan di arsip, saldo mulai lagi. Saldo sekarang: {idr(view.balance * view.idrRate)}.
        </p>
        <label className="text-sm">
          <span className="text-mute">Saldo awal (Rupiah)</span>
          <input className="input mt-1" type="number" value={rp} onChange={(e) => setRp(e.target.value)} />
        </label>
        <button className="btn-down w-full" disabled={busy} onClick={() => confirm(`Mulai sesi baru dengan ${idr(+rp)}?`) && run(() => api.reset({ balanceIdr: +rp }), 'Sesi baru dimulai')}>
          Mulai sesi baru
        </button>
      </section>
    </>
  );
}

function parseCoins(s: string) {
  return s
    .split(/[\s,]+/)
    .map((x) => x.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean)
    .map((x) => (x.endsWith('USDT') ? x : `${x}USDT`));
}
