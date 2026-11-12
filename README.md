# Momentum Scanner Pro

Paper trading semi-otomatis untuk **Binance Futures USDⓈ-M**: data **100% live dari Binance**, uang virtual 10.000 USDT, winrate dari **backtest data historis asli**. Bisa dibuka di HP (install sebagai app/PWA) dan laptop, data sinkron lewat Supabase.

> Ini simulasi buat belajar & menguji strategi. Winrate = statistik histori, bukan jaminan profit.

## Fitur
- **Scanner**: tombol Scan Now, top 40 koin USDT-M Perp berdasarkan volume. Analisa 15M/1H/4H (EMA9/21, RSI14, MACD, ADX14 Wilder). Grup:
  - ⭐ **Golden**: 4H + 1H + 15M qualify penuh semua, arah sama.
  - **3TF searah**, **4H+1H searah**, **1H+15M searah**, **4H+15M searah**: arah tren (EMA9/21) sama di TF itu, minimal satu TF qualify penuh. Chip TF: ✓ qualify penuh · ~ searah · ✗ berlawanan.
  - Tiap kartu langsung menampilkan **Entry (harga live), TP, SL** di leverage yang dipilih lewat input leverage cepat di atas daftar.
  - RSI LONG 40–65, SHORT 35–60. Sinyal dihitung dari candle yang sudah close.
- **Konteks BTC**: peringatan ⚠️ kalau LONG altcoin saat BTC bearish (dan sebaliknya).
- **Winrate (opsi C + D)**: per koin kalau ≥ 20 kejadian, kalau kurang ditarik ke rata-rata gabungan 40 koin. Dihitung ulang tiap ganti leverage. TP & SL di candle yang sama = kalah. Ditambah winrate trade lu sendiri.
- **Filter tambahan (on/off)**: Volume Ratio, EMA200, ATR, Bollinger Bands, Funding/OI/Long-Short. Ada perbandingan winrate dengan vs tanpa tiap filter.
- **Form order**: LONG/SHORT, Market/Limit, leverage 1–125× bebas, margin nominal tetap atau % saldo. Preview: harga TP (+14%)/SL (−7%) dari margin, jarak %, likuidasi (perkiraan), fee, PnL bersih, winrate minimal biar impas.
- **Simulasi realistis**: fee Binance (taker 0,05%, maker 0,02%, diskon BNB −10% on/off), funding fee pakai rate asli Binance, TP/SL/likuidasi dicek pakai harga live + candle 1 menit saat app dibuka lagi.
- **Posisi** (PnL live, tutup manual, boleh dobel posisi di koin yang sama) + **Order Pending**.
- **Riwayat + Audit**: snapshot indikator saat entry & exit, analisa kenapa menang/kalah. Export CSV.
- **Belajar dari pola**: tiap trade menyimpan pola kondisi saat entry (setup, arah, BTC, ADX, RSI, volume, SL vs ATR, leverage). Kalau sinyal baru mirip pola yang ≥ 3 kali sering kena SL, muncul peringatan ⚠️; kalau mirip pola yang sering kena TP, ditandai ✅. Hanya peringatan, tidak memblokir order.
- **Statistik**: grafik saldo, winrate asli, rata-rata profit/rugi, profit factor, drawdown, total fee & funding, pola dari trade lu.
- **Pengaturan**: mode terang/gelap, alert suara & notifikasi, reset saldo ke 10.000 USDT.

## Jalankan di laptop
```bash
npm install
npm run dev
```
Buka http://localhost:5173. Dev server sudah termasuk proxy Binance (`/api/binance`).

Test: `npm test` (unit test indikator, TP/SL, backtest, sinkron).

## Deploy gratis ke Vercel
1. Jadikan repo **private**: GitHub → repo → Settings → Danger Zone → Change visibility → Private.
2. Daftar di https://vercel.com pakai akun GitHub → **Add New → Project** → pilih repo `trading-app` → **Deploy** (setting default, Vite terdeteksi otomatis).
3. Proxy Binance (`api/binance.ts`) otomatis jalan di region **Tokyo** (`vercel.json`), karena Binance memblokir server Amerika.
4. Buka link Vercel di HP → Chrome menu ⋮ → **Install app**.

## Aktifkan sinkron HP ↔ laptop (Supabase + login Google)
1. **Supabase**: buat project gratis di https://supabase.com. Buka **SQL Editor**, paste isi `supabase/schema.sql`, Run.
2. **Google Cloud Console** (https://console.cloud.google.com): buat project → **APIs & Services → OAuth consent screen** (External, isi nama app & email) → **Credentials → Create Credentials → OAuth client ID** (Web application). Di *Authorized redirect URIs* isi: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase → **Authentication → Providers → Google** → aktifkan, paste Client ID & Client Secret.
4. Supabase → **Authentication → URL Configuration** → *Site URL* = link Vercel lu, tambahkan juga di *Redirect URLs* (plus `http://localhost:5173` untuk lokal).
5. Supabase → **Project Settings → API**: salin *Project URL* dan *anon public key*. Masukkan di Vercel → Project → **Settings → Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   
   Lalu **Redeploy**.
6. Di app: Pengaturan → **Login dengan Google** (di HP dan laptop pakai akun yang sama).

Catatan: project Supabase gratis di-pause kalau 7 hari tidak dipakai sama sekali; bisa dihidupkan lagi dari dashboard.

## Struktur
```
api/binance.ts          Vercel function (proxy Binance, region Tokyo)
src/lib/indicators.ts   EMA, RSI, MACD, ADX, ATR, Bollinger (rumus standar)
src/lib/signals.ts      aturan sinyal, grup setup, filter
src/lib/backtest.ts     mesin winrate dari data historis
src/lib/sim.ts          TP/SL, fee, likuidasi, preview order
src/store/              state, mesin simulasi, sinkron Supabase
src/components/         halaman UI
supabase/schema.sql     tabel + Row Level Security
```
