// Mesin akun paper trading: ukuran posisi berbasis risiko, exit (SL / TP1 parsial + BE / trailing / TP2 / time stop),
// dan rem risiko. Dipakai SAMA PERSIS oleh backtest dan bot live, supaya hasil backtest mewakili perilaku bot.
import { minNotionalOf, type BotConfig } from './config.js';
import type { Evaluation } from './strategy.js';
import type { Decision, Dir, ExitKind, Position, SetupKind, Trade } from './types.js';

export type Account = {
  balance: number; // saldo terealisasi (USDT), fee buka langsung dipotong
  startBalance: number;
  startedAt: number;
  positions: Position[];
  trades: Trade[];
  cooldown: Record<string, number>; // symbol → boleh entry lagi setelah waktu ini
  equity: { t: number; v: number }[]; // saldo setelah tiap trade selesai
};

export function newAccount(balance: number, t = Date.now()): Account {
  return { balance, startBalance: balance, startedAt: t, positions: [], trades: [], cooldown: {}, equity: [{ t, v: balance }] };
}

const DAY = 86_400_000;
const WIB = 7 * 3_600_000;
export const dayStartWib = (t: number) => Math.floor((t + WIB) / DAY) * DAY - WIB;

export function realizedRToday(acc: Account, t: number) {
  const s = dayStartWib(t);
  let r = 0;
  for (let k = acc.trades.length - 1; k >= 0 && acc.trades[k].closedAt >= s; k--) r += acc.trades[k].r;
  return r;
}

export const usedMargin = (acc: Account) => acc.positions.reduce((s, p) => s + (p.margin * p.qtyOpen) / p.qty, 0);
const sign = (d: Dir) => (d === 'LONG' ? 1 : -1);

export type Sizing = { qty: number; leverage: number; margin: number; riskUsd: number; notional: number };

/** Ukuran posisi: rugi di SL (termasuk fee & slippage) = riskPct % saldo. Leverage hanya hasil hitungan supaya margin muat. */
export function sizePosition(acc: Account, cfg: BotConfig, entry: number, sl: number, minNotional: number): Sizing | { error: string } {
  const risk = (acc.balance * cfg.riskPct) / 100;
  const perUnit = Math.abs(entry - sl) + entry * cfg.takerFee + sl * (cfg.takerFee + cfg.slippagePct / 100);
  if (!(perUnit > 0) || !(risk > 0)) return { error: 'saldo habis' };
  let qty = risk / perUnit;
  let notional = qty * entry;
  if (notional < minNotional) {
    const q = (minNotional * 1.001) / entry;
    const riskAt = q * perUnit;
    if (riskAt > Math.max(risk, (acc.balance * cfg.minOrderMaxRiskPct) / 100)) return { error: `posisi ${notional.toFixed(2)} USDT di bawah minimal Binance ${minNotional} USDT (dipaksa = risiko ${((riskAt / acc.balance) * 100).toFixed(1)}% saldo > batas ${cfg.minOrderMaxRiskPct}%)` };
    qty = q;
    notional = q * entry;
  }
  const maxMargin = (acc.balance * cfg.maxMarginPct) / 100;
  const leverage = Math.min(cfg.maxLeverage, Math.max(1, Math.ceil(notional / maxMargin)));
  const margin = notional / leverage;
  const slDist = Math.abs(entry - sl) / entry;
  const liqDist = 1 / leverage - 0.005; // perkiraan kasar (maintenance margin ±0,5%)
  if (liqDist < 1.5 * slDist) return { error: `butuh leverage ${leverage}× — likuidasi terlalu dekat SL` };
  if (margin > maxMargin * 1.0001) return { error: `margin ${margin.toFixed(2)} USDT > batas ${cfg.maxMarginPct}% saldo meski leverage ${cfg.maxLeverage}×` };
  const free = acc.balance - usedMargin(acc);
  if (margin + notional * cfg.takerFee > free) return { error: `saldo tersedia ${free.toFixed(2)} USDT tidak cukup untuk margin ${margin.toFixed(2)} USDT` };
  return { qty, leverage, margin, notional, riskUsd: qty * perUnit };
}

export type EntryInput = { symbol: string; ev: Evaluation; price: number; t: number; btcBias: Dir | null; minNotional?: Record<string, number>; barMs: number };

/** Cek rem risiko lalu buka posisi kalau lolos. Selalu mengembalikan keputusan + alasannya. */
export function tryEnter(acc: Account, cfg: BotConfig, x: EntryInput): Decision {
  const { symbol, ev } = x;
  const base = { t: ev.t, symbol };
  if (!ev.dir || !ev.setup) return { ...base, action: 'WAIT', reason: ev.reason };
  const dir = ev.dir;
  const d = { ...base, dir, setup: ev.setup };
  const skip = (reason: string): Decision => ({ ...d, action: 'SKIP', reason: `${ev.reason} — DILEWATI: ${reason}` });
  if (acc.positions.some((p) => p.symbol === symbol)) return skip('sudah ada posisi di koin ini');
  if (cfg.btcFilter && symbol !== 'BTCUSDT' && x.btcBias && x.btcBias !== dir) return skip(`melawan bias BTC (${x.btcBias})`);
  if ((acc.cooldown[symbol] ?? 0) > x.t) return skip(`jeda setelah kena SL sampai ${new Date(acc.cooldown[symbol]).toISOString().slice(11, 16)} UTC`);
  const rDay = realizedRToday(acc, x.t);
  if (rDay <= -cfg.dailyLossR) return skip(`rugi hari ini ${rDay.toFixed(1)}R sudah sampai batas −${cfg.dailyLossR}R (lanjut besok 00:00 WIB)`);
  if (acc.positions.length >= cfg.maxOpen) return skip(`posisi terbuka sudah ${acc.positions.length} (maks ${cfg.maxOpen})`);
  const same = acc.positions.filter((p) => p.dir === dir).length;
  if (same >= cfg.maxSameDir) return skip(`sudah ${same} posisi ${dir} (maks ${cfg.maxSameDir} searah)`);
  const entry = x.price * (1 + (sign(dir) * cfg.slippagePct) / 100);
  const slDist = cfg.stopMode === 'pct' ? (entry * cfg.slPct) / 100 : cfg.slAtr * ev.atr;
  const sl = entry - sign(dir) * slDist;
  if (!(sl > 0)) return skip('SL tidak valid');
  const sz = sizePosition(acc, cfg, entry, sl, minNotionalOf(symbol, x.minNotional));
  if ('error' in sz) return skip(sz.error);
  const feeOpen = sz.notional * cfg.takerFee;
  acc.balance -= feeOpen;
  const pos: Position = {
    id: `${symbol}-${ev.t}`,
    symbol,
    dir,
    setup: ev.setup as SetupKind,
    openedAt: x.t,
    signalT: ev.t,
    entry,
    qty: sz.qty,
    qtyOpen: sz.qty,
    sl,
    initialSl: sl,
    tp1: entry + sign(dir) * (cfg.stopMode === 'pct' ? (entry * cfg.tpPct) / 100 : cfg.tp1R * slDist),
    tp2: entry + sign(dir) * cfg.tp2R * slDist,
    tp1Hit: false,
    peak: entry,
    riskUsd: sz.riskUsd,
    leverage: sz.leverage,
    margin: sz.margin,
    feeOpen,
    fills: [],
    note: ev.reason,
  };
  acc.positions.push(pos);
  return { ...d, action: 'OPEN', reason: `${ev.reason} — BUKA ${dir} ${sz.leverage}×, risiko ${sz.riskUsd.toFixed(3)} USDT` };
}

function closePart(acc: Account, cfg: BotConfig, p: Position, qty: number, price: number, kind: ExitKind, t: number, maker: boolean, barMs: number): Trade | null {
  qty = Math.min(qty, p.qtyOpen);
  const pnl = sign(p.dir) * (price - p.entry) * qty;
  const fee = price * qty * (maker ? cfg.makerFee : cfg.takerFee);
  acc.balance += pnl - fee;
  p.qtyOpen -= qty;
  p.fills.push({ t, kind, price, qty, pnl, fee });
  if (p.qtyOpen > p.qty * 1e-9) return null;
  // posisi selesai
  acc.positions = acc.positions.filter((q) => q !== p);
  const gross = p.fills.reduce((s, f) => s + f.pnl, 0);
  const fees = p.fills.reduce((s, f) => s + f.fee, 0) + p.feeOpen;
  const net = gross - fees;
  const exit = p.fills.reduce((s, f) => s + f.price * f.qty, 0) / p.qty;
  const tr: Trade = { id: p.id, symbol: p.symbol, dir: p.dir, setup: p.setup, openedAt: p.openedAt, closedAt: t, entry: p.entry, exit, qty: p.qty, leverage: p.leverage, margin: p.margin, riskUsd: p.riskUsd, pnl: net, fees, r: net / p.riskUsd, exitKind: kind, fills: p.fills, note: p.note };
  acc.trades.push(tr);
  acc.equity.push({ t, v: acc.balance });
  if (net < 0 && (kind === 'SL' || kind === 'TRAIL') && cfg.cooldownBars > 0) acc.cooldown[p.symbol] = t + cfg.cooldownBars * barMs;
  return tr;
}

/**
 * Cek SL/TP dengan high-low sebuah bar (1m di live, candle entry di backtest). Konservatif:
 * kalau SL dan TP1 sama-sama tersentuh di bar yang sama, dianggap SL duluan.
 */
export function checkExits(acc: Account, cfg: BotConfig, p: Position, h: number, l: number, t: number, barMs: number): Trade | null {
  const L = p.dir === 'LONG';
  const tpTouch = !p.tp1Hit && (cfg.tp1Frac > 0 || cfg.tpLock) && (L ? h >= p.tp1 : l <= p.tp1);
  const slHit = (L ? l <= p.sl : h >= p.sl) && !(tpTouch && cfg.tpFirstIfAmbiguous);
  if (!slHit && tpTouch && cfg.tpLock) {
    // TP tersentuh: kunci profit di level TP, lanjut trailing
    p.tp1Hit = true;
    p.sl = p.tp1;
    p.peak = L ? Math.max(p.peak, h) : Math.min(p.peak, l);
    return null;
  }
  const slip = cfg.slippagePct / 100;
  if (slHit) {
    const kind: ExitKind = p.sl === p.initialSl ? 'SL' : p.tp1Hit && Math.abs(p.sl / p.entry - 1) <= cfg.beBufferPct / 100 + 1e-9 ? 'BE' : 'TRAIL';
    return closePart(acc, cfg, p, p.qtyOpen, p.sl * (1 - sign(p.dir) * slip), kind, t, false, barMs);
  }
  if (cfg.tp1Frac > 0 && !p.tp1Hit && (L ? h >= p.tp1 : l <= p.tp1)) {
    p.tp1Hit = true;
    const done = closePart(acc, cfg, p, p.qty * cfg.tp1Frac, p.tp1, 'TP1', t, true, barMs);
    if (done) return done;
    const be = p.entry * (1 + (sign(p.dir) * cfg.beBufferPct) / 100);
    p.sl = L ? Math.max(p.sl, be) : Math.min(p.sl, be);
  }
  if (cfg.tp2R > 0 && (p.tp1Hit || cfg.tp1Frac === 0) && (L ? h >= p.tp2 : l <= p.tp2)) return closePart(acc, cfg, p, p.qtyOpen, p.tp2, 'TP2', t, true, barMs);
  p.peak = L ? Math.max(p.peak, h) : Math.min(p.peak, l);
  return null;
}

/** Dipanggil tiap candle TF entry close: geser trailing stop & time stop. */
export function onBarClose(acc: Account, cfg: BotConfig, p: Position, close: number, atrNow: number, closeT: number, barMs: number): Trade | null {
  const L = p.dir === 'LONG';
  if (cfg.stopMode === 'pct' && cfg.trailPct > 0 && (p.tp1Hit || cfg.trailAlways)) {
    const trail = p.peak - (sign(p.dir) * p.entry * cfg.trailPct) / 100;
    p.sl = L ? Math.max(p.sl, trail) : Math.min(p.sl, trail);
  } else if ((p.tp1Hit || cfg.trailAlways) && cfg.trailAtr > 0 && atrNow > 0) {
    const trail = p.peak - sign(p.dir) * cfg.trailAtr * atrNow;
    p.sl = L ? Math.max(p.sl, trail) : Math.min(p.sl, trail);
  }
  const bars = Math.round((closeT - p.openedAt) / barMs);
  if (!p.tp1Hit && p.sl === p.initialSl && cfg.timeStopBars > 0 && bars >= cfg.timeStopBars) {
    return closePart(acc, cfg, p, p.qtyOpen, close * (1 - (sign(p.dir) * cfg.slippagePct) / 100), 'TIME', closeT, false, barMs);
  }
  return null;
}

export function closeManual(acc: Account, cfg: BotConfig, p: Position, price: number, t: number, barMs: number) {
  return closePart(acc, cfg, p, p.qtyOpen, price, 'MANUAL', t, false, barMs);
}

export function unrealized(p: Position, price: number) {
  return sign(p.dir) * (price - p.entry) * p.qtyOpen;
}

// ---- Statistik ----
export type Stats = {
  n: number;
  wins: number;
  winrate: number;
  totalR: number;
  avgR: number;
  avgWinR: number;
  avgLossR: number;
  pf: number;
  pnl: number;
  fees: number;
  maxDdPct: number;
  returnPct: number;
  byExit: Record<string, number>;
};

export function stats(trades: Trade[], startBalance: number): Stats {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = -losses.reduce((s, t) => s + t.pnl, 0);
  let eq = startBalance;
  let peak = eq;
  let dd = 0;
  for (const t of trades) {
    eq += t.pnl;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, (peak - eq) / peak);
  }
  const byExit: Record<string, number> = {};
  for (const t of trades) byExit[t.exitKind] = (byExit[t.exitKind] ?? 0) + 1;
  const totalR = trades.reduce((s, t) => s + t.r, 0);
  return {
    n,
    wins: wins.length,
    winrate: n ? wins.length / n : 0,
    totalR,
    avgR: n ? totalR / n : 0,
    avgWinR: wins.length ? wins.reduce((s, t) => s + t.r, 0) / wins.length : 0,
    avgLossR: losses.length ? losses.reduce((s, t) => s + t.r, 0) / losses.length : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    pnl: gw - gl,
    fees: trades.reduce((s, t) => s + t.fees, 0),
    maxDdPct: dd * 100,
    returnPct: ((eq - startBalance) / startBalance) * 100,
    byExit,
  };
}
