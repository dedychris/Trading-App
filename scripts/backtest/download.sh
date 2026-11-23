#!/usr/bin/env bash
# Download candle Binance Futures USDⓈ-M (1m, 15m, 1h, 4h) Mar–Okt 2026 dari data.binance.vision
# (Mar–Apr = pemanasan indikator, Mei–Okt = 6 bulan simulasi). Hasil: scripts/backtest/data/csv/*.csv
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data/zip data/csv
COINS="BTCUSDT ETHUSDT BNBUSDT SOLUSDT XRPUSDT DOGEUSDT ADAUSDT TRXUSDT LINKUSDT AVAXUSDT SUIUSDT TONUSDT DOTUSDT LTCUSDT BCHUSDT XLMUSDT HBARUSDT NEARUSDT UNIUSDT APTUSDT"
MONTHS="2026-03 2026-04 2026-05 2026-06 2026-07 2026-08 2026-09 2026-10"
for c in $COINS; do for iv in 1m 15m 1h 4h; do for m in $MONTHS; do
  echo "https://data.binance.vision/data/futures/um/monthly/klines/$c/$iv/$c-$iv-$m.zip"
done; done; done | (cd data/zip && xargs -P 16 -n 1 curl -s -f -O --retry 3)
for f in data/zip/*.zip; do unzip -o -q "$f" -d data/csv; done
echo "OK: $(ls data/csv | wc -l) file CSV"
