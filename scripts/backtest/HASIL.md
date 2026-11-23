# Hasil simulasi 6 bulan (Mei–Okt 2026)

Data: Binance Futures USDⓈ-M (data.binance.vision), 20 koin `CORE_COINS`, TP/SL dicek pakai candle 1 menit.
Aturan sama untuk semua strategi: risiko 0,7% saldo per trade (= margin 10% × SL 7% di app), compounding,
maks 3 posisi, 1 per koin, stop rugi harian 15%, maks 3 SL/koin/hari, tidak melawan arah BTC, fee taker 0,05% masuk & keluar.
Kondisi pasar: datar (BTC +1,6%, ETH −0,1%, SOL +15%).

| Strategi | Trade | Winrate | Hasil 6 bln | Max DD | PF sebelum fee | Fee per trade (R) |
|---|---:|---:|---:|---:|---:|---:|
| A. Auto app sekarang (15m, TP 1,4% / SL 0,7%, trailing) | 2.805 | 33% | **−89,5%** | 89,5% | 1,06 | 0,14 |
| R. Entry **acak** (TP 1,4% / SL 0,7%) | 2.006 | 32% | −92,8% | 93,6% | 0,99 | 0,14 |
| B3. Swing 1H (4H+1H searah), SL 2×ATR1h, TP 2R | 501 | 35% | −12,1% | 36,3% | 1,05 | 0,07 |
| B4. Swing 1H, SL 1,5×ATR1h, TP 2R, BE di 1R | 1.059 | 40% | −10,9% | 46,1% | 1,15 | 0,09 |
| C2. Swing 4H, SL 1,5×ATR4h, TP 3R | 159 | 26% | −1,4% | 18,4% | 1,04 | 0,04 |
| C2 + fee maker (limit) | 159 | 26% | +0,3% | 17,6% | 1,04 | 0,03 |
| D1. Scalping 15m pullback searah 4H+1H, TP 1,5R | 1.853 | 42% | −73,6% | 77,7% | 1,09 | 0,15 |
| G3. Entry 15m pullback, exit saat 1H close lewat EMA21 | 1.026 | 20% | −31,9% | 69,6% | 1,16 | 0,15 |
| G7. = G3 + volume ≥ 1,5× | 575 | 18% | +15,6% | 53,6% | 1,24 | 0,14 |

Kesimpulan:
- Sinyal 15m app sekarang ≈ entry acak sebelum fee (PF 1,06 vs 0,99). Fee 0,14R per trade yang bikin habis.
- Semua strategi punya edge kotor kecil (+0,04 s/d +0,26R per trade). Makin jarang & makin lebar SL, makin kecil porsi fee.
- G7 satu-satunya yang plus, tapi rapuh: volume ≥1,3× → −15%, ≥1,7× → +32%, ≥2× → −35%; LONG +103%, SHORT −46%. Belum layak dipakai.

Rincian per bulan & semua varian: jalankan `npx vite-node scripts/backtest/sim6m.ts`.

## Uji ulang: Nov 2025–Apr 2026 + filter tren 1H+4H

`BT_PERIOD=2 npx vite-node scripts/backtest/sim6m.ts` (data: `MONTHS="2025-09 2025-10 2025-11 2025-12 2026-01 2026-02" bash scripts/backtest/download.sh`).
Kondisi pasar periode 2: turun tajam (BTC −30%, ETH −41%, SOL −56%).
"+ tren 1H+4H" = arah trade wajib sama dengan EMA9/21 di 1H **dan** 4H.

| Strategi | Mei–Okt 2026 | Nov 2025–Apr 2026 |
|---|---:|---:|
| Auto sekarang (15m) | −89,5% | −98,1% |
| Auto sekarang + tren 1H+4H | −90,8% | −96,8% |
| Swing 1H (4H+1H searah), SL 2×ATR, TP 2R | −12,1% | −39,6% |
| Swing 4H, SL 1,5×ATR, TP 3R | −1,4% | **+2,1%** |
| Swing 4H + tren 1H+4H | −2,4% | −19,8% |
| Scalping 15m pullback, TP 1,5R | −73,6% | −92,1% |
| Entry 15m, exit tren 1H, volume ≥1,5× (G7) | +15,6% | **−64,1%** |
| G7 LONG saja | +103,4% | −50,9% |

Kesimpulan:
- G7 (satu-satunya yang plus di periode 1) gagal total di periode 2 → hasil kebetulan, bukan edge.
- Filter tren 1H+4H tidak menolong: auto 15m tetap hancur, swing 4H malah jadi lebih jelek di periode 2.
- Semua strategi 15m rugi besar di kedua periode. Hanya swing 4H (tanpa filter tambahan) yang konsisten di sekitar impas
  (−1,4% dan +2,1%, drawdown 16–18%), tapi itu artinya belum ada keuntungan nyata.

## Uji "skip kalau BTC netral" (periode 3: Mei–Okt 2025)

`BT_PERIOD=3` (data: `MONTHS="2025-03 2025-04 2025-05 2025-06 2025-07 2025-08" bash scripts/backtest/download.sh`).
Aturan dikunci sebelum melihat periode 3: Swing 4H (SL 1,5×ATR4h, TP 3R) + tidak entry kalau BTC 1H & 4H tidak searah.

| Strategi | Mei–Okt 2025 | Nov 2025–Apr 2026 | Mei–Okt 2026 | Total 18 bulan |
|---|---:|---:|---:|---:|
| Swing 4H TP 3R | −9,6% | +2,1% | −1,4% | −9% |
| Swing 4H TP 3R + skip BTC netral | **+8,1%** | −9,6% | −19,2% | −21% |
| Swing 1H 2×ATR TP 2R + skip BTC netral | +15,1% | −32,8% | +13,1% | −12% |
| Auto sekarang | −85,3% | −98,1% | −89,5% | ≈ −100% |
| Auto sekarang + skip BTC netral | −61,6% | −94,0% | −76,8% | ≈ −100% |

Kesimpulan: lolos di periode 3, tapi gagal di dua periode lain begitu dipakai sebagai aturan sungguhan
(slot yang kosong terisi trade lain yang lebih jelek). Tidak ada strategi yang untung konsisten selama 18 bulan.

## Uji #1 Donchian breakout & #2 momentum harian

`npx vite-node scripts/backtest/trend.ts` (butuh data ketiga periode). Aturan dikunci sebelum melihat hasil:
- #1 Donchian: entry close tembus high/low N candle, SL 2×ATR14 (statis), keluar saat close tembus low/high M candle.
  Risiko 0,7% saldo per trade, maks 5 posisi, 1 per koin, SL dicek candle 1 jam.
- #2 Momentum: tiap 00:00 UTC, return N hari > 0 → long, < 0 → short; ganti cuma kalau arah berbalik.
  Ukuran posisi = saldo × 0,1% / volatilitas harian 20 hari. Funding tidak dihitung.

| Strategi | Mei–Okt 2025 | Nov 2025–Apr 2026 | Mei–Okt 2026 | Total 18 bulan |
|---|---:|---:|---:|---:|
| 1a Donchian harian 20/10 | −4,1% | +1,0% | +7,2% | +3,8% |
| 1b Donchian harian 55/20 | +1,9% | +0,9% | −1,7% | +1,0% |
| 1c Donchian 4H 55/20 | +5,7% | −18,9% | +49,5% | +28% |
| Acak, keluar seperti 1a | −14,8% | +2,5% | +11,1% | −3% |
| 2 Momentum 7 hari | +3,8% | −7,9% | +26,8% | +21% |
| 2 Momentum 14 hari | −16,2% | +4,8% | +10,4% | −3% |
| 2 Momentum 30 hari | +4,3% | −10,0% | +19,2% | +12% |
| Long semua koin terus (ukuran sama dgn #2) | +12,2% | −24,2% | +9,1% | −6% |
| Buy & hold BTC | +16,4% | −30,4% | +1,6% | −18% |

Kesimpulan:
- Tidak ada yang lolos syarat "plus di ketiga periode".
- Donchian harian (1a/1b) hasilnya kecil dan tidak beda jauh dari entry acak → belum ada bukti edge.
- Donchian 4H dan momentum 7/30 hari total 18 bulan plus, tapi rugi di periode turun (Nov 2025–Apr 2026).
  Hasil Donchian 4H di Mei–Okt 2026 banyak dari 1–2 koin yang naik ±380% (UNI, NEAR).
- Di periode turun, momentum jauh lebih tahan dibanding long terus (−8%/−10% vs −24%) karena bisa short.
