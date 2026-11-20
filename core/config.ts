// Semua variabel strategi di satu tempat. Bot, backtest, dan dashboard memakai tipe yang sama.
import type { TF } from './types.js';

export type Mode = 'intraday' | 'swing' | 'position';
export const MODE_TF: Record<Mode, { entry: TF; bias: TF }> = {
  intraday: { entry: '15m', bias: '1h' },
  swing: { entry: '1h', bias: '4h' },
  position: { entry: '4h', bias: '1d' },
};

export type BotConfig = {
  // A. Koin
  coins: string[];
  // B. Arah tren (bias) di TF besar
  mode: Mode;
  biasFast: number; // EMA cepat TF bias
  biasSlow: number; // EMA lambat TF bias
  btcFilter: boolean; // altcoin tidak boleh melawan bias BTC
  // C. Pemicu entry di TF entry
  pullback: boolean;
  breakout: boolean;
  emaFast: number; // EMA pullback (20)
  emaSlow: number; // EMA tren lokal (50)
  rsiLongMin: number;
  rsiLongMax: number;
  breakoutLookback: number; // tembus high/low N candle
  volMult: number; // volume candle breakout ≥ volMult × rata-rata 20
  maxExtensionAtr: number; // breakout: jarak close dari EMA20 maks N × ATR (hindari kejar harga)
  // D. Stop loss
  atrPeriod: number;
  slAtr: number; // SL = slAtr × ATR
  // E. Ukuran posisi
  riskPct: number; // % saldo yang dirisikokan per trade (1R)
  maxLeverage: number;
  maxMarginPct: number; // margin satu posisi maks % saldo
  minOrderMaxRiskPct: number; // kalau posisi di bawah minimal order Binance: boleh dinaikkan ke minimal selama risikonya ≤ N % saldo
  // F. Target & keluar
  tp1R: number;
  tp1Frac: number; // bagian posisi yang ditutup di TP1 (0 = tanpa TP1)
  tp2R: number; // 0 = tanpa TP2 (biarkan profit lari, keluar lewat trailing)
  trailAtr: number; // SL mengikuti harga terbaik − trailAtr × ATR (0 = mati)
  trailAlways: boolean; // true = trailing jalan sejak entry; false = baru setelah TP1
  beBufferPct: number; // SL pindah ke entry ± buffer (tutup fee) setelah TP1
  timeStopBars: number; // tutup kalau TP1 belum kena setelah N candle
  // G. Rem risiko
  maxOpen: number;
  maxSameDir: number;
  dailyLossR: number; // stop entry baru hari ini kalau rugi terealisasi ≤ −N R
  cooldownBars: number; // jeda entry di koin yang baru kena SL
  // Biaya
  takerFee: number;
  makerFee: number;
  slippagePct: number;
};

export const DEFAULT_COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'TRX', 'LINK', 'AVAX', 'SUI', 'TON', 'DOT', 'LTC', 'BCH', 'XLM', 'HBAR', 'NEAR', 'UNI', 'APT'].map((c) => `${c}USDT`);

// Default = varian paling stabil di backtest 2 tahun (Nov 2024–Okt 2025 & Nov 2025–Okt 2026), lihat scripts/backtest.ts.
// Entry 4H (pullback EMA20 / breakout), bias harian EMA20/50, SL 2×ATR, TP1 1R tutup 50% + SL ke BE, sisanya trailing 3×ATR.
export const DEFAULT_CONFIG: BotConfig = {
  coins: DEFAULT_COINS,
  mode: 'position',
  biasFast: 20,
  biasSlow: 50,
  btcFilter: true,
  pullback: true,
  breakout: true,
  emaFast: 20,
  emaSlow: 50,
  rsiLongMin: 45,
  rsiLongMax: 70,
  breakoutLookback: 20,
  volMult: 1.5,
  maxExtensionAtr: 2.5,
  atrPeriod: 14,
  slAtr: 2,
  riskPct: 1,
  maxLeverage: 20,
  maxMarginPct: 30,
  minOrderMaxRiskPct: 3,
  tp1R: 1,
  tp1Frac: 0.5,
  tp2R: 0,
  trailAtr: 3,
  trailAlways: false,
  beBufferPct: 0.1,
  timeStopBars: 0,
  maxOpen: 3,
  maxSameDir: 2,
  dailyLossR: 3,
  cooldownBars: 8,
  takerFee: 0.0005,
  makerFee: 0.0002,
  slippagePct: 0.02,
};

/** Minimal nilai posisi Binance (USDT). Live diambil dari exchangeInfo; ini cadangan & untuk backtest. */
export const MIN_NOTIONAL_FALLBACK: Record<string, number> = { BTCUSDT: 100, ETHUSDT: 20 };
export const minNotionalOf = (symbol: string, table?: Record<string, number>) => table?.[symbol] ?? MIN_NOTIONAL_FALLBACK[symbol] ?? 5;

export function withDefaults(c: Partial<BotConfig> | null | undefined): BotConfig {
  return { ...DEFAULT_CONFIG, ...(c ?? {}) };
}
