export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number }; // t = waktu buka (ms)
export type Dir = 'LONG' | 'SHORT';
export type TF = '15m' | '1h' | '4h' | '1d';
export const TF_MS: Record<TF, number> = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };
export type SetupKind = 'pullback' | 'breakout';

export type ExitKind = 'SL' | 'TP1' | 'TP2' | 'BE' | 'TRAIL' | 'TIME' | 'MANUAL';

export type Fill = { t: number; kind: ExitKind; price: number; qty: number; pnl: number; fee: number };

export type Position = {
  id: string;
  symbol: string;
  dir: Dir;
  setup: SetupKind;
  openedAt: number;
  signalT: number; // waktu close candle sinyal
  entry: number;
  qty: number; // qty awal
  qtyOpen: number;
  sl: number;
  initialSl: number;
  tp1: number;
  tp2: number;
  tp1Hit: boolean;
  peak: number; // harga terbaik sejak entry (high utk LONG, low utk SHORT)
  riskUsd: number; // rugi kalau kena SL awal (sudah termasuk fee) = 1R
  leverage: number;
  margin: number;
  feeOpen: number;
  fills: Fill[];
  note: string; // alasan entry
};

export type Trade = {
  id: string;
  symbol: string;
  dir: Dir;
  setup: SetupKind;
  openedAt: number;
  closedAt: number;
  entry: number;
  exit: number; // harga keluar rata-rata
  qty: number;
  leverage: number;
  margin: number;
  riskUsd: number;
  pnl: number; // bersih setelah fee
  fees: number;
  r: number; // pnl / riskUsd
  exitKind: ExitKind; // exit terakhir
  fills: Fill[];
  note: string;
};

export type Decision = {
  t: number; // waktu close candle yang dinilai
  symbol: string;
  action: 'OPEN' | 'SKIP' | 'WAIT';
  dir?: Dir;
  setup?: SetupKind;
  reason: string;
};
