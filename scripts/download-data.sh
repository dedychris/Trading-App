#!/usr/bin/env bash
# Download candle 15m Binance USDⓈ-M Futures (arsip resmi data.binance.vision) untuk backtest.
# Pakai: [COINS="BNB"] [TF=5m] scripts/download-data.sh <folder-output> [bulan...]
set -euo pipefail
OUT=${1:-data}
shift || true
MONTHS=${@:-"2025-11 2025-12 2026-01 2026-02 2026-03 2026-04 2026-05 2026-06 2026-07 2026-08 2026-09 2026-10"}
COINS=${COINS:-"BTC ETH BNB SOL XRP DOGE ADA TRX LINK AVAX SUI TON DOT LTC BCH XLM HBAR NEAR UNI APT"}
TF=${TF:-15m}
mkdir -p "$OUT"
for c in $COINS; do
  for m in $MONTHS; do
    f="$OUT/${c}USDT-${TF}-$m.csv"
    [ -s "$f" ] && continue
    url="https://data.binance.vision/data/futures/um/monthly/klines/${c}USDT/${TF}/${c}USDT-${TF}-$m.zip"
    tmp=$(mktemp -d)
    if curl -sf -m 60 -o "$tmp/a.zip" "$url"; then
      unzip -o -q "$tmp/a.zip" -d "$tmp" && mv "$tmp"/*.csv "$f"
    else
      echo "gagal: $c $m"
    fi
    rm -rf "$tmp"
  done
  echo "selesai $c"
done
