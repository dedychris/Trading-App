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

export type CloseReason = 'TP' | 'TRAIL' | 'SL' | 'LIQ' | 'MANUAL';

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
  tpPct?: number; // TP % dari margin saat entry (kosong = 14)
  slPct?: number; // SL % dari margin saat entry (kosong = 7)
  auto?: boolean; // dibuka oleh auto trading
  trailPct?: number | null; // jarak trailing (% margin); kosong = trailing mati
  trailActive?: boolean;
  peakRoe?: number; // profit tertinggi (% margin) sejak trailing aktif
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
  tpPct?: number;
  slPct?: number;
  trailPct?: number | null;
  createdAt: number;
  status: 'pending' | 'filled' | 'cancelled';
  checkedUntil: number;
  snapEntry: Snapshot | null;
  updatedAt: number;
};

export type LedgerKind = 'fee' | 'pnl' | 'funding';
export type LedgerEntry = { id: string; t: number; amt: number; kind: LedgerKind; posId: string };

export type AutoSettings = {
  enabled: boolean;
  deviceId: string | null; // null = jalan di semua device; isi = cuma device ini
  leverage: number;
  marginMode: 'fixed' | 'percent';
  marginFixed: number;
  marginPercent: number;
  tpPct: number;
  slPct: number;
  trailOn: boolean;
  trailPct: number;
  maxOpen: number;
  dailyLossPct: number;
  freshCandles: number; // sinyal boleh di-entry kalau muncul maks N candle 15m terakhir
  ignoreSmallSample: boolean; // abaikan syarat winrate kalau sampel backtest kecil
  minSample: number;
  with4h1h: boolean; // ikut entry di setup 4H+1H searah (selain Golden & 3TF)
  wakeLock: boolean; // cegah layar mati selama auto aktif & app terbuka
};

export type Settings = {
  theme: 'light' | 'dark';
  tpPct: number; // TP default order manual (% dari margin)
  slPct: number; // SL default order manual (% dari margin)
  trailOn: boolean;
  trailPct: number; // jarak trailing TP (% dari margin)
  auto: AutoSettings;
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
