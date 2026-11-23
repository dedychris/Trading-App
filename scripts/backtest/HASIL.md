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
