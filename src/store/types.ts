import type { BtcTrend, Dir, FilterKey, Setup, TF, TFState } from '../lib/signals';

export type Snapshot = {
  t: number;
  price: number;
  tf: Partial<Record<TF, TFState | null>>;
  setup: Setup | null;
  btcTrend: BtcTrend | null;
  funding: number | null;
  longPct: number | null;
  oiChange24h: number | null;
  winrate: number | null;
  winrateN: number | null;
  breakevenWinrate?: number;
};

export type CloseReason = 'TP' | 'SL' | 'LIQ' | 'MANUAL';

export type Position = {
  id: string;
  symbol: string;
  dir: Dir;
  leverage: number;
  margin: number;
  qty: number;
  entry: number;
  tp: number;
  sl: number;
  liq: number;
  entryType: 'market' | 'limit';
  openedAt: number;
  status: 'open' | 'closed';
  exit?: number;
  closedAt?: number;
  reason?: CloseReason;
  checkedUntil: number; // sudah dicek TP/SL sampai waktu ini (candle 1m)
  fundingUntil: number; // funding sudah dihitung sampai waktu ini
  snapEntry: Snapshot | null;
  snapExit?: Snapshot | null;
  updatedAt: number;
};

export type PendingOrder = {
  id: string;
  symbol: string;
  dir: Dir;
  leverage: number;
  margin: number;
  price: number;
  createdAt: number;
  status: 'pending' | 'filled' | 'cancelled';
  checkedUntil: number;
  snapEntry: Snapshot | null;
  updatedAt: number;
};

export type LedgerKind = 'fee' | 'pnl' | 'funding';
export type LedgerEntry = { id: string; t: number; amt: number; kind: LedgerKind; posId: string };

export type Settings = {
  theme: 'light' | 'dark';
  bnb: boolean;
  marginMode: 'fixed' | 'percent';
  marginFixed: number;
  marginPercent: number;
  leverage: number;
  filters: Record<FilterKey, boolean>;
  sound: boolean;
  notify: boolean;
  updatedAt: number;
};

export type Book = {
  epoch: number;
  epochStartedAt: number;
  positions: Record<string, Position>;
  orders: Record<string, PendingOrder>;
  ledger: Record<string, LedgerEntry>;
  settings: Settings;
};
