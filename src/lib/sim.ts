// Matematika trading: TP/SL dari margin, fee Binance, likuidasi (perkiraan), PnL.
import type { Dir } from './signals';

export const TP_PCT = 14; // % dari margin
export const SL_PCT = 7; // % dari margin
export const START_BALANCE = 10_000;
export const FEE = { taker: 0.0005, maker: 0.0002, bnbDiscount: 0.1 };
const MMR = 0.005; // maintenance margin rate perkiraan (tier terendah)

export function feeRate(kind: 'taker' | 'maker', bnb: boolean) {
  return FEE[kind] * (bnb ? 1 - FEE.bnbDiscount : 1);
}

/** Pergerakan harga (fraksi) yang dibutuhkan untuk TP & SL pada leverage tertentu. */
export function moves(leverage: number) {
  return { tp: TP_PCT / 100 / leverage, sl: SL_PCT / 100 / leverage };
}

export function tpSlPrices(dir: Dir, entry: number, leverage: number) {
  const m = moves(leverage);
  return dir === 'LONG'
    ? { tp: entry * (1 + m.tp), sl: entry * (1 - m.sl) }
    : { tp: entry * (1 - m.tp), sl: entry * (1 + m.sl) };
}

/** Perkiraan harga likuidasi (isolated). Angka pasti tergantung tier Binance. */
export function liqPrice(dir: Dir, entry: number, leverage: number) {
  return dir === 'LONG' ? entry * (1 - 1 / leverage + MMR) : entry * (1 + 1 / leverage - MMR);
}

export function pnl(dir: Dir, entry: number, exit: number, qty: number) {
  return (dir === 'LONG' ? exit - entry : entry - exit) * qty;
}

/** Perkiraan leverage maksimal Binance per koin (angka persis butuh API key). */
const MAX_LEV: Record<string, number> = { BTCUSDT: 125, ETHUSDT: 125 };
const MAJOR = new Set(['BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT', 'DOTUSDT', 'BCHUSDT', 'TRXUSDT', 'SUIUSDT', 'ETCUSDT']);
export function estMaxLeverage(symbol: string) {
  return MAX_LEV[symbol] ?? (MAJOR.has(symbol) ? 75 : 50);
}

export type OrderPreview = {
  entry: number;
  tp: number;
  sl: number;
  liq: number;
  tpMovePct: number;
  slMovePct: number;
  liqMovePct: number;
  notional: number;
  qty: number;
  feeOpen: number;
  feeClose: number;
  netWin: number; // USDT bersih kalau TP (setelah fee)
  netLoss: number; // USDT bersih kalau SL (negatif)
  netWinPct: number;
  netLossPct: number;
  breakevenWinrate: number; // winrate minimal supaya impas
};

export function previewOrder(p: { dir: Dir; entry: number; leverage: number; margin: number; entryType: 'market' | 'limit'; bnb: boolean }): OrderPreview {
  const { tp, sl } = tpSlPrices(p.dir, p.entry, p.leverage);
  const liq = liqPrice(p.dir, p.entry, p.leverage);
  const notional = p.margin * p.leverage;
  const qty = notional / p.entry;
  const feeOpen = notional * feeRate(p.entryType === 'market' ? 'taker' : 'maker', p.bnb);
  const exitFeeRate = feeRate('taker', p.bnb); // TP/SL Binance = stop-market (taker)
  const winGross = pnl(p.dir, p.entry, tp, qty);
  const lossGross = pnl(p.dir, p.entry, sl, qty);
  const netWin = winGross - feeOpen - tp * qty * exitFeeRate;
  const netLoss = lossGross - feeOpen - sl * qty * exitFeeRate;
  const m = moves(p.leverage);
  return {
    entry: p.entry,
    tp,
    sl,
    liq,
    tpMovePct: m.tp * 100,
    slMovePct: m.sl * 100,
    liqMovePct: (Math.abs(liq - p.entry) / p.entry) * 100,
    notional,
    qty,
    feeOpen,
    feeClose: tp * qty * exitFeeRate,
    netWin,
    netLoss,
    netWinPct: (netWin / p.margin) * 100,
    netLossPct: (netLoss / p.margin) * 100,
    breakevenWinrate: (-netLoss / (netWin - netLoss)) * 100,
  };
}
