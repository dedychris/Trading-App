# Momentum Scanner Pro

Paper trading semi-otomatis untuk **Binance Futures USDⓈ-M**: data **100% live dari Binance**, uang virtual dengan **saldo awal bebas** (misal Rp 150.000), winrate dari **backtest data historis asli**. Bisa dibuka di HP (install sebagai app/PWA) dan laptop, data sinkron lewat Supabase.

> Ini simulasi buat belajar & menguji strategi. Winrate = statistik histori, bukan jaminan profit.

## Fitur
- **Scanner**: tombol Scan Now, **20 koin market cap besar** (list tetap `CORE_COINS` di `src/lib/binance.ts`: BTC, ETH, BNB, SOL, XRP, DOGE, ADA, TRX, LINK, AVAX, SUI, TON, DOT, LTC, BCH, XLM, HBAR, NEAR, UNI, APT) **+ 5 koin volume tertinggi** Binance di luar list itu (stablecoin dibuang, ditandai 🔥 top vol). Analisa 15M/1H/4H (EMA9/21, RSI14, MACD, ADX14 Wilder). Grup:
  - ⭐ **Golden**: 4H + 1H + 15M qualify penuh semua, arah sama.
  - **3TF searah**, **4H+1H searah**, **1H+15M searah**, **4H+15M searah**: arah tren (EMA9/21) sama di TF itu, minimal satu TF qualify penuh. Chip TF: ✓ qualify penuh · ~ searah · ✗ berlawanan.
  - Tiap kartu langsung menampilkan **Entry (harga live), TP, SL** di leverage yang dipilih lewat input leverage cepat di atas daftar.
  - RSI LONG 40–65, SHORT 35–60. Sinyal dihitung dari candle yang sudah close.
- **Konteks BTC**: peringatan ⚠️ kalau LONG altcoin saat BTC bearish (dan sebaliknya).
- **Winrate (opsi C + D)**: per koin kalau ≥ 20 kejadian, kalau kurang ditarik ke rata-rata gabungan semua koin. Dihitung ulang tiap ganti leverage. TP & SL di candle yang sama = kalah. Ditambah winrate trade lu sendiri.
- **Filter tambahan (on/off)**: Volume Ratio, EMA200, ATR, Bollinger Bands, Funding/OI/Long-Short. Ada perbandingan winrate dengan vs tanpa tiap filter.
- **Form order**: LONG/SHORT, Market/Limit, leverage 1–125× bebas, margin nominal tetap atau % saldo. Preview: harga TP (+14%)/SL (−7%) dari margin, jarak %, likuidasi (perkiraan), fee, PnL bersih, winrate minimal biar impas.
- **Simulasi realistis**: fee Binance (taker 0,05%, maker 0,02%, diskon BNB −10% on/off), funding fee pakai rate asli Binance, TP/SL/likuidasi dicek pakai harga live + candle 1 menit saat app dibuka lagi.
- **Posisi** (PnL live, tutup manual, boleh dobel posisi di koin yang sama) + **Order Pending**.
- **TP/SL bisa diatur** (% dari margin): default di Pengaturan, bisa diubah per order. Winrate dihitung ulang sesuai TP/SL.
- **Trailing TP**: nyentuh TP → posisi tidak ditutup, profit TP dikunci, batas keluar = maks(TP, profit tertinggi − jarak trailing). Form order menampilkan rata-rata hasil backtest TP tetap vs trailing.
- **📈 Auto Momentum harian (paper trading, default nyala)**: tiap 07:00 WIB (candle harian Binance close), untuk 20 koin `CORE_COINS`: harga naik dibanding 30 hari lalu → LONG, turun → SHORT (bisa 7/14/30 hari). Posisi cuma diganti kalau arah berbalik (riwayat: *arah berbalik*), tanpa TP/SL, leverage 1×. Ukuran posisi ikut volatilitas: tiap koin ±0,1% saldo per hari. Backtest 4 periode × 6 bulan: +4,3% · −10,0% · +19,2% · +47,7%, drawdown terburuk 24% — rugi saat pasar turun tajam (`scripts/backtest/HASIL.md`). Logika di `src/lib/momentum.ts`, dipakai app & bot server, hasilnya identik (id posisi deterministik) jadi aman disinkron.
  - **Jalan terus walau app ditutup**: bot GitHub Actions (`.github/workflows/momentum-bot.yml`) tiap hari 07:04 WIB + jadwal cadangan. Setup sekali (lihat bagian *Bot server Momentum* di bawah).
- **🤖 Auto trading (simulasi)**: **default mati** sejak backtest 18 bulan (`scripts/backtest/HASIL.md`) menunjukkan strategi ini rugi di semua periode; bisa dinyalakan manual di Pengaturan. Kalau aktif: langsung scan saat app dibuka lalu tiap candle 15m close, buka posisi untuk sinyal ⭐ Golden / 3TF searah / 1H+15M searah / 4H+1H (bisa dimatikan) yang baru muncul. Syarat: tidak melawan BTC, koin belum kena SL 3× hari ini, harga belum lari > 50% jarak SL dari harga sinyal (entry telat, mis. saat app baru dibuka), lolos filter aktif. Syarat winrate ≥ impas bisa dinyalakan (default mati). Setting terpisah (leverage, margin, TP/SL, trailing), maks posisi, 1 posisi per koin, stop rugi harian −15% yang ikut menghitung posisi terbuka kalau semuanya kena SL (reset 00:00 WIB), log alasan entry/lewati. Layar dijaga tetap nyala (Wake Lock) selama auto aktif. Jalan selama app terbuka.
- **Riwayat + Audit**: snapshot indikator saat entry & exit, analisa kenapa menang/kalah. Export CSV (termasuk RSI/ADX/ATR 15m·1H·4H saat entry, SL vs ATR, harga & jam sinyal, telat berapa menit dan selisih harga entry dari sinyal).
- **Belajar dari pola**: tiap trade menyimpan pola kondisi saat entry (setup, arah, BTC, ADX, RSI, volume, SL vs ATR, leverage). Kalau sinyal baru mirip pola yang ≥ 3 kali sering kena SL, muncul peringatan ⚠️; kalau mirip pola yang sering kena TP, ditandai ✅. Hanya peringatan, tidak memblokir order.
- **Statistik**: grafik saldo, winrate asli, rata-rata profit/rugi, profit factor, drawdown, total fee & funding, pola dari trade lu.
- **Saldo awal bebas + sesi**: Pengaturan → Akun paper trading → *Mulai sesi baru*. Isi dalam Rupiah (dikonversi pakai kurs live USDT/IDR Indodax, bisa diubah manual) atau USDT. Hitungan tetap USDT; saldo, margin & PnL juga tampil dalam Rupiah (kurs dikunci selama sesi).
- **Arsip sesi lama**: mulai sesi baru **tidak menghapus** riwayat. Posisi terbuka ditutup di harga live, order pending dibatalkan, trade selesai disimpan di arsip (Riwayat → pilih sesi, bisa export CSV). Arsip tetap dipakai untuk peringatan pola ⚠️/✅, insight, dan "Trade lu" di form order. Statistik & grafik saldo hanya sesi sekarang.
- **Compounding**: margin dihitung dari saldo sekarang, jadi cuan langsung ikut jadi modal. Auto & manual default 10% saldo. Mode *Bagi rata* (saldo ÷ maks posisi) masih ada tapi berisiko: posisi searah jadi satu taruhan besar.
- **Minimal order Binance**: nilai posisi (margin × leverage) harus ≥ MIN_NOTIONAL & qty minimal dari exchangeInfo (umumnya 5 USDT, BTC/ETH lebih besar). Order di bawahnya ditolak, auto melewati dengan alasan.
- **Pengaturan**: mode terang/gelap, alert suara & notifikasi, saldo awal & sesi baru.

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

## Bot server Momentum (GitHub Actions)
Supaya auto Momentum tetap jalan walau app tidak dibuka:
1. Merge branch ke `main` (jadwal otomatis GitHub cuma jalan dari branch utama).
2. GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**, isi 3 secret:
   - `SUPABASE_URL` — sama dengan `VITE_SUPABASE_URL`.
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API → `service_role` (**rahasia**, jangan dipasang di Vercel/app).
   - `APP_URL` — link app Vercel lu (data Binance diambil lewat proxy Tokyo-nya; server GitHub di Amerika diblokir Binance).
3. GitHub → **Actions → Auto Momentum (paper trading) → Run workflow** untuk tes. Log-nya menampilkan posisi yang dibuka/ditutup.

Bot membaca & menulis buku trading di tabel `books` Supabase (semua akun yang auto Momentum-nya nyala), digabung dengan versi app pakai aturan sinkron yang sama. App yang sedang terbuka juga menjalankan logika yang sama, jadi tidak ada posisi dobel.

## Struktur
```
api/binance.ts          Vercel function (proxy Binance, region Tokyo)
src/lib/indicators.ts   EMA, RSI, MACD, ADX, ATR, Bollinger (rumus standar)
src/lib/signals.ts      aturan sinyal, grup setup, filter
src/lib/backtest.ts     mesin winrate dari data historis
src/lib/sim.ts          TP/SL, fee, likuidasi, preview order
src/lib/momentum.ts     auto Momentum harian (dipakai app & bot server)
scripts/bot/            bot server Momentum (GitHub Actions)
scripts/backtest/       simulasi data historis + HASIL.md
src/store/              state, mesin simulasi, sinkron Supabase
src/components/         halaman UI
supabase/schema.sql     tabel + Row Level Security
```
