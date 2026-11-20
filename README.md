# Trading Bot (paper trading)

Bot paper trading **Binance USDⓈ-M Futures** yang jalan **24 jam di server**: Vercel Function region Tokyo, dipanggil tiap menit oleh cron Supabase. HP atau laptop cuma buat dashboard: lihat saldo, posisi, alasan tiap keputusan, riwayat, backtest, dan ubah setting.

> Simulasi uang virtual buat menguji strategi. **Backtest 2 tahun belum menunjukkan edge yang kuat** (lihat tab Backtest), jadi ini bukan jaminan profit.

## Kenapa dibuat ulang (pelajaran dari app lama)
1. **Auto cuma jalan selama app kebuka di layar.** Layar HP mati = browser membekukan app = bot berhenti. Sekarang bot jalan di server.
2. **TP/SL dari % margin** (SL 0,7% harga di 10×) itu lebih kecil dari goyangan normal candle 15m. Sekarang SL dari **ATR** (ikut volatilitas koin), dan ukuran posisi dari **risiko % saldo**. Leverage cuma hasil hitungan.
3. **Strategi intraday 15m nggak punya edge.** Di backtest 2 tahun hasilnya −0,14R/trade, bahkan tanpa fee pun minus. Sekarang default-nya entry 4H + bias harian.
4. **Nggak ketahuan kenapa nggak entry.** Sekarang tiap koin di tiap candle punya alasan: BUKA / LEWAT (+ rem mana yang nahan) / TUNGGU (+ syarat mana yang belum terpenuhi).

## Cara kerja
Tiap menit cron memanggil `/api/bot?action=tick`:
1. **Kelola posisi**: cek SL / TP1 / trailing pakai candle 1 menit yang sudah close (kalau SL & TP kena di menit yang sama, dianggap SL).
2. **Tiap candle 4H close** (00, 04, 08, … UTC = 07, 11, 15, … WIB), semua koin dinilai, lalu yang lolos dibuka di harga live.
3. State disimpan di Supabase (`bot_kv`). Dashboard membaca lewat `/api/bot?action=state`.

Mesin yang dipakai bot live (`core/`) sama persis dengan yang dipakai backtest. Ada tes replay yang memutar bot live di data historis, dan hasilnya sejalan dengan backtest.

## Variabel strategi (default)
| Grup | Variabel | Default |
|---|---|---|
| A. Koin | 20 koin market cap besar | BTC, ETH, BNB, SOL, XRP, DOGE, ADA, TRX, LINK, AVAX, SUI, TON, DOT, LTC, BCH, XLM, HBAR, NEAR, UNI, APT |
| B. Bias tren | TF harian: close > EMA20 > EMA50 = LONG, kebalikannya SHORT, selain itu netral (tidak trade). Altcoin tidak melawan bias BTC | |
| C. Pemicu (TF 4H) | **Pullback**: EMA20 searah EMA50, harga sempat menyentuh EMA20 dalam 3 candle, lalu candle konfirmasi menutup melewati high/low candle sebelumnya, RSI 45–70 (SHORT 30–55). **Breakout**: close tembus high/low 20 candle, volume ≥ 1,5× rata-rata, close kuat, maks 2,5 ATR dari EMA20 | |
| D. Stop loss | 2 × ATR(14) 4H | |
| E. Ukuran posisi | Risiko **1% saldo** per trade (sudah termasuk fee). Leverage dihitung sendiri (maks 25×), margin maks 30% saldo. Kalau di bawah minimal order Binance, dinaikkan ke minimal selama risikonya ≤ 3% saldo | |
| F. Keluar | TP1 di 1R: tutup 50%, SL ke impas. Sisanya trailing 3 × ATR, tanpa TP2 (profit dibiarkan lari) | |
| G. Rem risiko | Maks 3 posisi, maks 2 searah, satu posisi per koin, stop entry hari itu kalau rugi ≤ −3R, jeda 8 candle setelah SL | |
| Biaya | Taker 0,05%, maker 0,02% (TP), slippage 0,02% | |

Semua bisa diubah di tab **Setting** (butuh kunci bot).

## Deploy (sekali saja)
1. **Supabase**: project yang sudah ada boleh. SQL Editor → paste `supabase/schema.sql` → ganti `NAMA-APP` dan `ISI_BOT_SECRET` → Run.
2. **Vercel** → Project → Settings → **Environment Variables**:
   - `SUPABASE_URL`: Supabase → Project Settings → API → Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: di halaman yang sama, *service_role* key (**rahasia**, jangan taruh di kode atau env yang diawali `VITE_`)
   - `BOT_SECRET`: password bebas buatan lu, sama dengan yang ditulis di SQL cron
   
   Lalu **Redeploy**.
3. Buka app → tab **Setting** → isi kunci bot (= `BOT_SECRET`). Dalam 1–2 menit status di atas harusnya jadi **● Aktif**. Saldo awal otomatis Rp 150.000, bisa diganti lewat *Mulai sesi baru*.

Cek cron dari Supabase SQL: `select status_code, left(content,200), created from net._http_response order by created desc limit 10;`

## Lokal
```bash
npm install
npm run dev            # dashboard + bot lokal (state di .bot-state.json, kunci bot: "lokal")
npm test               # unit test mesin & bot
```
Backtest dengan data asli:
```bash
scripts/download-data.sh data [bulan...]             # default 12 bulan terakhir; bisa isi mis. 2020-01 2020-02 ...
npx tsx scripts/backtest.ts data --modal 200000 --out public/backtest.json
npx tsx scripts/replay.ts data 2026-07-01 2026-10-31  # putar bot live di data historis → .bot-state.json untuk dashboard lokal
DATA_DIR=data npm test                                # + tes replay
```

## Struktur
```
core/        strategi, mesin akun & exit, backtest (dipakai bersama bot, backtest, dashboard)
server/      tick bot, data Binance, penyimpanan Supabase, HTTP handler
api/bot.ts   Vercel Function bot · api/binance.ts proxy harga untuk dashboard
src/         dashboard (React)
scripts/     download data, backtest, replay
supabase/    tabel + cron
```
