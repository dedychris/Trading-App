import { getKlines, getTopSymbols, type Interval } from './binance';
import type { SymbolSeries } from './backtest';
import { btcTrendFrom, buildSeries, classify, evalTF, lastClosedIndex, TFS, type BtcTrend, type Setup, type TF, type TFState } from './signals';

// Jumlah candle per timeframe: cukup untuk sinyal live + histori backtest
// 15m ≈ 10 hari, 1h ≈ 41 hari, 4h ≈ 83 hari
export const SCAN_LIMITS: Record<TF, number> = { '15m': 1000, '1h': 1000, '4h': 500 };

export type ScanRow = {
  symbol: string;
  price: number;
  change24h: number;
  quoteVolume: number;
  tf: Record<TF, TFState | null>;
  setup: Setup | null;
};

export type ScanResult = {
  at: number;
  rows: ScanRow[];
  series: Record<string, SymbolSeries>;
  btc: { trend: BtcTrend; tf: Record<TF, TFState | null>; price: number; change24h: number } | null;
  failed: string[];
};

export function statesFrom(ss: SymbolSeries): Record<TF, TFState | null> {
  const out = {} as Record<TF, TFState | null>;
  for (const tf of TFS) {
    const s = ss[tf];
    out[tf] = s ? evalTF(s, lastClosedIndex(s)) : null;
  }
  return out;
}

export async function loadSymbolSeries(symbol: string, limits = SCAN_LIMITS): Promise<SymbolSeries> {
  const entries = await Promise.all(TFS.map(async (tf) => [tf, buildSeries(tf, await getKlines(symbol, tf as Interval, limits[tf]))] as const));
  return Object.fromEntries(entries) as SymbolSeries;
}

export async function runScan(onProgress: (done: number, total: number) => void): Promise<ScanResult> {
  const top = await getTopSymbols(40);
  if (!top.some((t) => t.symbol === 'BTCUSDT')) {
    top.unshift({ symbol: 'BTCUSDT', lastPrice: 0, priceChangePercent: 0, quoteVolume: 0 });
  }
  const series: Record<string, SymbolSeries> = {};
  const rows: ScanRow[] = [];
  const failed: string[] = [];
  let done = 0;
  onProgress(0, top.length);
  await Promise.all(
    top.map(async (t) => {
      try {
        const ss = await loadSymbolSeries(t.symbol);
        series[t.symbol] = ss;
        const tf = statesFrom(ss);
        rows.push({ symbol: t.symbol, price: t.lastPrice || ss['15m']!.candles.at(-1)!.c, change24h: t.priceChangePercent, quoteVolume: t.quoteVolume, tf, setup: classify(tf) });
      } catch {
        failed.push(t.symbol);
      } finally {
        onProgress(++done, top.length);
      }
    }),
  );
  if (failed.length === top.length) throw new Error('Semua request ke Binance gagal. Cek koneksi atau coba lagi.');
  const btcRow = rows.find((r) => r.symbol === 'BTCUSDT');
  return {
    at: Date.now(),
    rows: rows.sort((a, b) => b.quoteVolume - a.quoteVolume),
    series,
    btc: btcRow ? { trend: btcTrendFrom(btcRow.tf), tf: btcRow.tf, price: btcRow.price, change24h: btcRow.change24h } : null,
    failed,
  };
}

/** Analisa cepat satu koin (untuk snapshot saat entry/exit). */
export async function analyzeSymbol(symbol: string) {
  const ss = await loadSymbolSeries(symbol, { '15m': 300, '1h': 300, '4h': 300 });
  const tf = statesFrom(ss);
  return { tf, setup: classify(tf), price: ss['15m']!.candles.at(-1)!.c };
}
