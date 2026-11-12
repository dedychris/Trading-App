import { useEffect, useState, type ReactNode } from 'react';
import { FILTER_INFO, FILTER_KEYS } from '../lib/signals';
import { FEE, START_BALANCE } from '../lib/sim';
import { requestNotifyPermission } from '../lib/notify';
import { resetAccount, useApp } from '../store/app';
import { signInGoogle, signOut, syncConfigured, syncNow } from '../store/sync';
import { fmtNum, fmtPct, fmtTime, fmtUsd } from '../lib/format';
import { previewOrder } from '../lib/sim';
import { deviceId, todayPnl } from '../store/autotrader';
import { Signed } from './ui';

function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; desc?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-xs text-mute">{desc}</div>}
      </div>
      <input type="checkbox" className="peer sr-only" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="label mb-2">{title}</h2>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function NumInput({ value, onChange, max = 1000 }: { value: number; onChange: (v: number) => void; max?: number }) {
  const [str, setStr] = useState(String(value));
  useEffect(() => setStr(String(value)), [value]);
  return (
    <input
      className="input w-20 !py-1"
      inputMode="decimal"
      value={str}
      onChange={(e) => {
        const v = e.target.value.replace(',', '.');
        setStr(v);
        const n = +v;
        if (n > 0 && n <= max) onChange(n);
      }}
    />
  );
}

function AutoSection() {
  const a = useApp((x) => x.book.settings.auto);
  const bnb = useApp((x) => x.book.settings.bnb);
  const logs = useApp((x) => x.autoLog);
  const run = useApp((x) => x.autoRun);
  const update = useApp((x) => x.updateSettings);
  const set = (p: Partial<typeof a>) => update({ auto: { ...a, ...p } });
  const me = deviceId();
  const margin = a.marginMode === 'fixed' ? a.marginFixed : 100;
  const pv = previewOrder({ dir: 'LONG', entry: 100, leverage: a.leverage, margin, entryType: 'market', bnb, tpPct: a.tpPct, slPct: a.slPct });
  const today = todayPnl();
  return (
    <section className="card p-4 lg:col-span-2">
      <h2 className="label mb-2">🤖 Auto trading (simulasi)</h2>
      <div className="grid gap-x-6 lg:grid-cols-2">
        <div className="divide-y divide-line">
          <Toggle
            on={a.enabled}
            onChange={(v) => set({ enabled: v })}
            label={<>Auto trading {a.enabled ? <span className="chip ml-1 bg-accent text-black">ON</span> : <span className="chip ml-1 bg-panel2 text-mute">OFF</span>}</>}
            desc="Tiap candle 15m close: scan otomatis, lalu buka posisi untuk sinyal ⭐ Golden / 3TF searah yang baru muncul. Cuma jalan selama app terbuka."
          />
          <Toggle
            on={a.deviceId === me}
            onChange={(v) => set({ deviceId: v ? me : null })}
            label="Jalankan cuma di device ini"
            desc={a.deviceId && a.deviceId !== me ? 'Sekarang auto dikunci ke device lain.' : 'Kalau mati, auto jalan di semua device yang sedang membuka app (aman: posisi tidak dobel).'}
          />
          <div className="space-y-3 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">Leverage</span>
              <NumInput value={a.leverage} onChange={(v) => set({ leverage: Math.min(125, Math.round(v)) })} max={125} />
              <span className="text-xs text-mute">×</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">Margin</span>
              <div className="seg">
                <button data-on={a.marginMode === 'fixed'} onClick={() => set({ marginMode: 'fixed' })} className="!py-1 !text-xs">USDT</button>
                <button data-on={a.marginMode === 'percent'} onClick={() => set({ marginMode: 'percent' })} className="!py-1 !text-xs">% saldo</button>
              </div>
              {a.marginMode === 'fixed' ? <NumInput value={a.marginFixed} onChange={(v) => set({ marginFixed: v })} max={1e9} /> : <NumInput value={a.marginPercent} onChange={(v) => set({ marginPercent: v })} max={100} />}
              <span className="text-xs text-mute">{a.marginMode === 'fixed' ? 'USDT' : '% saldo'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">TP / SL</span>
              <span className="text-xs text-up">+</span>
              <NumInput value={a.tpPct} onChange={(v) => set({ tpPct: v })} />
              <span className="text-xs text-down">−</span>
              <NumInput value={a.slPct} onChange={(v) => set({ slPct: v })} max={99} />
              <span className="text-xs text-mute">% margin</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">Trailing TP</span>
              <input type="checkbox" checked={a.trailOn} onChange={(e) => set({ trailOn: e.target.checked })} aria-label="Trailing auto" />
              {a.trailOn && (<><span className="text-xs text-mute">jarak</span><NumInput value={a.trailPct} onChange={(v) => set({ trailPct: v })} /><span className="text-xs text-mute">%</span></>)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">Sinyal baru</span>
              <span className="text-xs text-mute">muncul maks</span>
              <NumInput value={a.freshCandles} onChange={(v) => set({ freshCandles: Math.max(1, Math.round(v)) })} max={8} />
              <span className="text-xs text-mute">candle 15m terakhir (2 = ≤ 30 menit)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">Winrate</span>
              <input type="checkbox" checked={a.ignoreSmallSample} onChange={(e) => set({ ignoreSmallSample: e.target.checked })} aria-label="Abaikan winrate sampel kecil" />
              <span className="text-xs">abaikan syarat winrate kalau sampel &lt;</span>
              <NumInput value={a.minSample} onChange={(v) => set({ minSample: Math.round(v) })} max={200} />
              <span className="text-xs text-mute">kejadian</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">Maks posisi auto</span>
              <NumInput value={a.maxOpen} onChange={(v) => set({ maxOpen: Math.round(v) })} max={20} />
              <span className="text-xs text-mute">(1 posisi per koin)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28">Stop rugi harian</span>
              <span className="text-xs">−</span>
              <NumInput value={a.dailyLossPct} onChange={(v) => set({ dailyLossPct: v })} max={100} />
              <span className="text-xs text-mute">% saldo · reset 00:00 WIB</span>
            </div>
          </div>
        </div>
        <div className="space-y-3 py-2 text-sm">
          <div className="rounded-lg bg-panel2 p-3 text-xs">
            <div className="label mb-1">Hitungan per trade ({a.leverage}×{a.marginMode === 'fixed' ? `, margin ${fmtUsd(margin)}` : ', per 100 USDT margin'})</div>
            <div>Harga harus gerak: TP <b className="num">{fmtNum(pv.tpMovePct, 2)}%</b> · SL <b className="num">{fmtNum(pv.slMovePct, 2)}%</b></div>
            <div>Fee buka + tutup ±<b className="num">{fmtUsd(pv.feeOpen + pv.feeClose)}</b> USDT ({fmtNum(((pv.feeOpen + pv.feeClose) / margin) * 100, 1)}% margin)</div>
            <div>Bersih kalau TP <span className="text-up num">{fmtUsd(pv.netWin, true)}</span> · kalau SL <span className="text-down num">{fmtUsd(pv.netLoss, true)}</span></div>
            <div>Winrate minimal biar impas: <b className="num">{fmtPct(pv.breakevenWinrate, 0)}</b></div>
            {pv.netWin <= (pv.feeOpen + pv.feeClose) * 2 && <div className="mt-1 text-warn">⚠️ TP terlalu kecil dibanding fee.</div>}
          </div>
          <div className="text-xs text-mute">
            Syarat entry: sinyal muncul ≤ {a.freshCandles} candle terakhir · winrate ≥ impas{a.ignoreSmallSample ? ` (diabaikan kalau sampel < ${a.minSample})` : ''} · tidak melawan BTC · tidak sideways (ADX 15m & 1H ≥ 25, Bollinger 1H tidak menyempit) · tidak ada peringatan pola SL · lolos filter aktif.
          </div>
          <div className="text-xs">
            PnL hari ini: <Signed v={today.pnl}>{fmtUsd(today.pnl, true)} USDT</Signed>
            {a.enabled && run.nextAt && <> · scan berikutnya {new Date(run.nextAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</>}
          </div>
          <div>
            <div className="label mb-1">Log auto (kenapa entry / dilewati)</div>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-2 text-xs">
              {logs.length ? logs.map((l, i) => (
                <div key={i} className={l.tone === 'good' ? 'text-up' : l.tone === 'bad' ? 'text-down' : 'text-mute'}>
                  <span className="num">{new Date(l.t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span> {l.text}
                </div>
              )) : <div className="text-mute">Belum ada aktivitas.</div>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type BIPEvent = Event & { prompt: () => Promise<void> };
let deferredInstall: BIPEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as BIPEvent;
});

export function SettingsPage() {
  const s = useApp((x) => x.book.settings);
  const update = useApp((x) => x.updateSettings);
  const sync = useApp((x) => x.sync);
  const [confirmReset, setConfirmReset] = useState(false);
  const [canInstall, setCanInstall] = useState(Boolean(deferredInstall));
  useEffect(() => {
    const h = () => setCanInstall(true);
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Tampilan">
        <div className="py-2">
          <div className="seg max-w-xs">
            <button data-on={s.theme === 'light'} onClick={() => update({ theme: 'light' })}>☀️ Terang</button>
            <button data-on={s.theme === 'dark'} onClick={() => update({ theme: 'dark' })}>🌙 Gelap</button>
          </div>
        </div>
      </Section>

      <Section title="Trading (default form order)">
        <div className="space-y-3 py-2">
          <label className="block">
            <span className="text-sm font-medium">Leverage default</span>
            <span className="block text-xs text-mute">Dipakai juga untuk menghitung winrate di kartu Scanner.</span>
            <input className="input mt-1 max-w-[120px]" inputMode="numeric" value={s.leverage} onChange={(e) => update({ leverage: Math.max(1, Math.min(125, Math.round(+e.target.value || 1))) })} />
          </label>
          <div>
            <span className="text-sm font-medium">Ukuran margin per trade</span>
            <div className="seg mt-1 max-w-xs">
              <button data-on={s.marginMode === 'fixed'} onClick={() => update({ marginMode: 'fixed' })}>Nominal tetap</button>
              <button data-on={s.marginMode === 'percent'} onClick={() => update({ marginMode: 'percent' })}>% saldo</button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              {s.marginMode === 'fixed' ? (
                <><input className="input max-w-[140px]" inputMode="decimal" value={s.marginFixed} onChange={(e) => update({ marginFixed: +e.target.value.replace(',', '.') || 0 })} /><span className="text-sm text-mute">USDT</span></>
              ) : (
                <><input className="input max-w-[100px]" inputMode="decimal" value={s.marginPercent} onChange={(e) => update({ marginPercent: +e.target.value.replace(',', '.') || 0 })} /><span className="text-sm text-mute">% dari saldo</span></>
              )}
            </div>
            <div className="mt-1 text-xs text-mute">
              {s.marginMode === 'fixed' ? 'Tiap trade selalu pakai nominal yang sama, mau saldo naik atau turun.' : 'Margin ikut menyesuaikan saldo: saldo turun → margin ikut kecil. Lebih aman.'}
            </div>
          </div>
          <Toggle on={s.bnb} onChange={(v) => update({ bnb: v })} label="Bayar fee pakai BNB (diskon 10%)" desc={`Taker ${(FEE.taker * 100).toFixed(2)}% → ${(FEE.taker * 90).toFixed(3)}%, maker ${(FEE.maker * 100).toFixed(2)}% → ${(FEE.maker * 90).toFixed(3)}%`} />
          <div>
            <span className="text-sm font-medium">TP / SL default (% dari margin)</span>
            <span className="block text-xs text-mute">Bisa diubah lagi per order di form order. Winrate ikut dihitung ulang.</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-up">TP +</span>
              <NumInput value={s.tpPct} onChange={(v) => update({ tpPct: v })} />
              <span className="text-xs text-down">SL −</span>
              <NumInput value={s.slPct} onChange={(v) => update({ slPct: v })} max={99} />
              <span className="text-xs text-mute">%</span>
            </div>
          </div>
          <Toggle on={s.trailOn} onChange={(v) => update({ trailOn: v })} label="Trailing TP (default)" desc="Nyentuh TP → posisi nggak ditutup. Profit TP dikunci, batas keluar ikut naik selama profit naik." />
          {s.trailOn && (
            <div className="flex items-center gap-2 text-sm">
              <span>Jarak trailing</span>
              <NumInput value={s.trailPct} onChange={(v) => update({ trailPct: v })} />
              <span className="text-xs text-mute">% dari margin — keluar kalau profit turun segini dari puncaknya</span>
            </div>
          )}
          <div className="text-xs text-mute">Funding fee pakai rate asli Binance.</div>
        </div>
      </Section>

      <AutoSection />

      <Section title="Filter indikator tambahan">
        {FILTER_KEYS.map((k) => (
          <Toggle key={k} on={s.filters[k]} onChange={(v) => update({ filters: { ...s.filters, [k]: v } })} label={FILTER_INFO[k].label} desc={FILTER_INFO[k].desc} />
        ))}
        <div className="pt-2 text-xs text-mute">Filter yang aktif ikut menyaring winrate. Perbandingan "dengan vs tanpa filter" ada di detail tiap koin.</div>
      </Section>

      <Section title="Alert">
        <Toggle on={s.sound} onChange={(v) => update({ sound: v })} label="Suara" desc="Bunyi saat TP/SL kena, order limit ke-fill, scan selesai" />
        <Toggle
          on={s.notify}
          onChange={async (v) => {
            if (v && !(await requestNotifyPermission())) {
              useApp.getState().toast('Izin notifikasi ditolak browser', 'bad');
              return;
            }
            update({ notify: v });
          }}
          label="Notifikasi"
          desc="Muncul di notifikasi HP/laptop selama app terbuka. Install app dulu supaya lebih andal di Android."
        />
      </Section>

      <Section title="Sinkron HP ↔ laptop">
        <div className="space-y-2 py-2 text-sm">
          {!syncConfigured && (
            <div className="text-mute">
              Belum aktif. Isi <code className="num">VITE_SUPABASE_URL</code> dan <code className="num">VITE_SUPABASE_ANON_KEY</code> di Vercel (lihat README). Sekarang data disimpan di browser ini saja.
            </div>
          )}
          {syncConfigured && sync.status === 'signed-out' && (
            <button className="btn-primary" onClick={signInGoogle}>Login dengan Google</button>
          )}
          {syncConfigured && sync.email && (
            <>
              <div>Login sebagai <b>{sync.email}</b></div>
              <div className="text-xs text-mute">
                Status: {sync.status === 'synced' ? `tersinkron ${fmtTime(sync.at)}` : sync.status === 'syncing' ? 'menyinkron…' : sync.status === 'error' ? `gagal — ${sync.error}` : sync.status}
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={syncNow}>Sinkron sekarang</button>
                <button className="btn-ghost" onClick={signOut}>Logout</button>
              </div>
            </>
          )}
        </div>
      </Section>

      <Section title="Install sebagai app">
        <div className="space-y-2 py-2 text-sm">
          {canInstall ? (
            <button className="btn-primary" onClick={async () => { await deferredInstall?.prompt(); deferredInstall = null; setCanInstall(false); }}>📲 Install app</button>
          ) : (
            <div className="text-mute">Di Chrome Android: menu ⋮ → <b>Install app</b> / <b>Tambahkan ke layar utama</b>.</div>
          )}
        </div>
      </Section>

      <Section title="Akun paper trading">
        <div className="space-y-2 py-2">
          <div className="text-sm text-mute">Reset menghapus semua posisi, order, dan riwayat, lalu saldo kembali ke {START_BALANCE.toLocaleString('id-ID')} USDT. Pengaturan tetap.</div>
          {!confirmReset ? (
            <button className="btn-ghost text-down" onClick={() => setConfirmReset(true)}>Reset saldo ke {START_BALANCE.toLocaleString('id-ID')} USDT</button>
          ) : (
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setConfirmReset(false)}>Batal</button>
              <button className="btn-down" onClick={() => { resetAccount(); setConfirmReset(false); useApp.getState().toast('Akun direset', 'info'); }}>Ya, hapus semua & reset</button>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
