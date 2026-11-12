import { useEffect, useState, type ReactNode } from 'react';
import { FILTER_INFO, FILTER_KEYS } from '../lib/signals';
import { FEE, START_BALANCE } from '../lib/sim';
import { requestNotifyPermission } from '../lib/notify';
import { resetAccount, useApp } from '../store/app';
import { signInGoogle, signOut, syncConfigured, syncNow } from '../store/sync';
import { fmtTime } from '../lib/format';

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
          <div className="text-xs text-mute">TP +14% / SL −7% dari margin (tetap). Funding fee pakai rate asli Binance.</div>
        </div>
      </Section>

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
