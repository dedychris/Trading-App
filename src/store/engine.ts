// Mesin simulasi: pantau harga live, eksekusi TP/SL/likuidasi & order limit,
// hitung funding asli Binance, dan cek ulang candle 1m saat app dibuka lagi (opsi A).
import { getFundingHistory, getKlinesRange, subscribePrices, subscribeTrades } from '../lib/binance';
import { fmtUsd } from '../lib/format';
import { beep, systemNotify } from '../lib/notify';
import { analyzeSymbol } from '../lib/scanner';
import { addFunding, closePosition, fillOrder, patchOrder, patchPosition, useApp } from './app';
import { positionLedger } from './book';
import type { CloseReason, Position } from './types';
import { step } from '../lib/trailing';
import { TP_PCT } from '../lib/sim';

const posLike = (p: Position) => ({ dir: p.dir, entry: p.entry, leverage: p.leverage, tp: p.tp, sl: p.sl, liq: p.liq, tpPct: p.tpPct ?? TP_PCT, trailPct: p.trailPct ?? null });

/**
 * Cek satu tick/candle. Kalau trailing baru aktif atau profit tertinggi naik ≥ 0,5% margin,
 * state trailing disimpan (supaya ikut tersinkron & tidak hilang saat app ditutup).
 */
function hit(p: Position, high: number, low: number): { reason: CloseReason; price: number } | null {
  const st0 = { active: Boolean(p.trailActive), peakRoe: p.peakRoe ?? 0 };
  const r = step(posLike(p), st0, high, low);
  if (r.exit) return r.exit;
  if (r.st.active && (!st0.active || r.st.peakRoe >= st0.peakRoe + 0.5)) {
    if (!st0.active) announceTrail(p);
    patchPosition(p.id, { trailActive: true, peakRoe: r.st.peakRoe });
    p.trailActive = true;
    p.peakRoe = r.st.peakRoe;
  }
  return null;
}

function announceTrail(p: Position) {
  const s = useApp.getState().book.settings;
  const text = `🎯 ${p.symbol} ${p.dir} nyentuh TP +${p.tpPct ?? TP_PCT}% — trailing aktif, profit dikunci & dibiarkan jalan`;
  useApp.getState().toast(text, 'good');
  if (s.sound) beep('good');
  if (s.notify) systemNotify('Trailing TP aktif', text);
}

function announceClose(p: Position) {
  const { settings } = useApp.getState().book;
  const net = positionLedger(useApp.getState().book, p.id).net;
  const label = p.reason === 'TP' ? '✅ TP kena' : p.reason === 'TRAIL' ? '✅ TP trailing kena' : p.reason === 'SL' ? '❌ SL kena' : p.reason === 'LIQ' ? '💀 Likuidasi' : 'Posisi ditutup';
  const text = `${p.auto ? '🤖 ' : ''}${label}: ${p.symbol} ${p.dir} ${p.leverage}× → ${fmtUsd(net, true)} USDT`;
  useApp.getState().toast(text, net >= 0 ? 'good' : 'bad');
  if (settings.sound) beep(net >= 0 ? 'good' : 'bad');
  if (settings.notify) systemNotify(label, text);
}

export async function finalizeClose(p: Position) {
  announceClose(p);
  await applyFunding([p.id]).catch(() => {});
  // snapshot kondisi indikator saat exit (untuk audit)
  try {
    const a = await analyzeSymbol(p.symbol);
    const scan = useApp.getState().scan.result;
    patchPosition(p.id, {
      snapExit: { t: Date.now(), price: p.exit ?? a.price, tf: a.tf, setup: a.setup, btcTrend: scan?.btc?.trend ?? null, funding: null, longPct: null, oiChange24h: null, winrate: null, winrateN: null },
    });
  } catch {
    /* audit tetap jalan tanpa snapshot exit */
  }
}

export function manualClose(id: string) {
  const p = useApp.getState().book.positions[id];
  const price = p && useApp.getState().prices[p.symbol];
  if (!p || !price) {
    useApp.getState().toast('Harga live belum tersedia, coba lagi sebentar', 'bad');
    return;
  }
  const closed = closePosition(id, price, 'MANUAL');
  if (closed) finalizeClose(closed);
}

type Tick = { h: number; l: number; c: number };

/** Terapkan harga baru: update state, cek order limit & TP/SL/likuidasi pakai high/low batch. */
function applyTicks(ticks: Record<string, Tick>) {
  const st = useApp.getState();
  const last: Record<string, number> = {};
  for (const [s, t] of Object.entries(ticks)) last[s] = t.c;
  useApp.setState({ prices: { ...st.prices, ...last } });
  const book = useApp.getState().book;
  const now = Date.now();
  for (const o of Object.values(book.orders)) {
    if (o.status !== 'pending') continue;
    const t = ticks[o.symbol];
    if (!t) continue;
    if ((o.dir === 'LONG' && t.l <= o.price) || (o.dir === 'SHORT' && t.h >= o.price)) {
      const pos = fillOrder(o.id, now);
      if (pos) {
        const s = useApp.getState().book.settings;
        const text = `Order limit ${o.symbol} ${o.dir} ke-fill di ${o.price}`;
        useApp.getState().toast(text, 'info');
        if (s.sound) beep('info');
        if (s.notify) systemNotify('Order limit ke-fill', text);
      }
    }
  }
  for (const p of Object.values(useApp.getState().book.positions)) {
    if (p.status !== 'open') continue;
    const t = ticks[p.symbol];
    if (!t) continue;
    const h = hit(p, t.h, t.l);
    if (h) {
      const closed = closePosition(p.id, h.price, h.reason, now);
      if (closed) finalizeClose(closed);
    }
  }
}

// --- jalur cepat (aggTrade): ditampung lalu di-flush tiap 100 ms supaya layar tidak berat ---
const FLUSH_MS = 100;
const lastFastAt: Record<string, number> = {};
let buf: Record<string, Tick> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function onTrade(symbol: string, px: number) {
  lastFastAt[symbol] = Date.now();
  const t = buf[symbol];
  buf[symbol] = t ? { h: Math.max(t.h, px), l: Math.min(t.l, px), c: px } : { h: px, l: px, c: px };
  if (!flushTimer) flushTimer = setTimeout(flushTrades, FLUSH_MS);
}

export function flushTrades() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const b = buf;
  buf = {};
  if (Object.keys(b).length) applyTicks(b);
}

/** Jalur lambat (miniTicker semua koin, ±1×/detik). Koin yang jalur cepatnya sehat dilewati
 *  supaya harga tidak mundur ke nilai yang lebih lama. */
export function onPrices(prices: Record<string, number>) {
  const now = Date.now();
  const ticks: Record<string, Tick> = {};
  for (const [s, px] of Object.entries(prices)) {
    if (now - (lastFastAt[s] ?? 0) < 5000) continue;
    ticks[s] = { h: px, l: px, c: px };
  }
  applyTicks(ticks);
}

/** Koin yang perlu harga realtime: ada posisi terbuka, order pending, atau sedang dibuka detailnya. */
export function fastSymbols(): string[] {
  const { book, detail } = useApp.getState();
  const set = new Set<string>();
  for (const p of Object.values(book.positions)) if (p.status === 'open') set.add(p.symbol);
  for (const o of Object.values(book.orders)) if (o.status === 'pending') set.add(o.symbol);
  if (detail) set.add(detail);
  return [...set].sort();
}

function startFastFeed(): () => void {
  let key = '';
  let unsub = () => {};
  const sync = () => {
    const syms = fastSymbols();
    const k = syms.join(',');
    if (k === key) return;
    key = k;
    unsub();
    unsub = subscribeTrades(syms, onTrade);
  };
  sync();
  const off = useApp.subscribe(sync);
  return () => {
    off();
    unsub();
  };
}

let catchingUp = false;
/** Cek candle 1m sejak terakhir dicek: posisi/order yang kena selama app ditutup. */
export async function catchUp() {
  if (catchingUp) return;
  catchingUp = true;
  try {
    const now = Date.now();
    const book = useApp.getState().book;
    for (const o of Object.values(book.orders)) {
      if (o.status !== 'pending') continue;
      const from = Math.floor(o.checkedUntil / 60000) * 60000 + 60000;
      if (now - from < 60000) continue;
      const candles = await getKlinesRange(o.symbol, '1m', from, now);
      let filledAt: number | null = null;
      let last = o.checkedUntil;
      for (const c of candles) {
        if (c.t + 60000 > now) break;
        last = c.t + 60000;
        if ((o.dir === 'LONG' && c.l <= o.price) || (o.dir === 'SHORT' && c.h >= o.price)) {
          filledAt = c.t;
          break;
        }
      }
      if (filledAt) {
        const pos = fillOrder(o.id, filledAt);
        if (pos) useApp.getState().toast(`Selama app ditutup: order limit ${o.symbol} ke-fill`, 'info');
      } else patchOrder(o.id, { checkedUntil: last });
    }
    for (const p of Object.values(useApp.getState().book.positions)) {
      if (p.status !== 'open') continue;
      // mulai dari candle setelah menit pembukaan (menit pembukaan dipantau live)
      const from = Math.floor(p.checkedUntil / 60000) * 60000 + 60000;
      if (now - from < 60000) continue;
      const candles = await getKlinesRange(p.symbol, '1m', from, now);
      let closedHit: { reason: CloseReason; price: number; t: number } | null = null;
      let last = p.checkedUntil;
      for (const c of candles) {
        if (c.t + 60000 > now) break;
        last = c.t + 60000;
        const h = hit(p, c.h, c.l);
        if (h) {
          closedHit = { ...h, t: c.t };
          break;
        }
      }
      if (closedHit) {
        const closed = closePosition(p.id, closedHit.price, closedHit.reason, closedHit.t);
        if (closed) finalizeClose(closed);
      } else patchPosition(p.id, { checkedUntil: last });
    }
  } catch (e) {
    useApp.getState().toast(`Gagal cek posisi ke Binance: ${(e as Error).message}`, 'bad');
  } finally {
    catchingUp = false;
  }
}

/** Funding fee pakai rate asli Binance di jam funding-nya. */
export async function applyFunding(onlyIds?: string[]) {
  const book = useApp.getState().book;
  const now = Date.now();
  const targets = Object.values(book.positions).filter((p) => {
    if (onlyIds && !onlyIds.includes(p.id)) return false;
    const end = p.status === 'open' ? now : p.closedAt ?? now;
    return p.fundingUntil < end && (p.status === 'open' || onlyIds);
  });
  const bySymbol = new Map<string, Position[]>();
  for (const p of targets) bySymbol.set(p.symbol, [...(bySymbol.get(p.symbol) ?? []), p]);
  for (const [symbol, ps] of bySymbol) {
    const from = Math.min(...ps.map((p) => p.fundingUntil));
    const events = await getFundingHistory(symbol, from + 1, now);
    for (const p of ps) {
      const end = p.status === 'open' ? now : p.closedAt ?? now;
      for (const ev of events) {
        if (ev.fundingTime <= p.openedAt || ev.fundingTime <= p.fundingUntil || ev.fundingTime > end) continue;
        const mark = ev.markPrice || p.entry;
        // rate positif: LONG bayar ke SHORT
        const amt = -(p.dir === 'LONG' ? 1 : -1) * p.qty * mark * ev.fundingRate;
        addFunding(p.id, ev.fundingTime, amt);
      }
      patchPosition(p.id, { fundingUntil: Math.min(end, now) });
    }
  }
}

let stop: (() => void) | null = null;
export function startEngine() {
  if (stop) return;
  const unsubSlow = subscribePrices(onPrices, (s) => useApp.setState({ priceStatus: s }));
  const unsubFast = startFastFeed();
  const unsub = () => {
    unsubSlow();
    unsubFast();
    flushTrades();
  };
  catchUp().then(() => applyFunding().catch(() => {}));
  const iv = setInterval(() => {
    applyFunding().catch(() => {});
    // simpan progres pengecekan supaya catch-up berikutnya tidak mulai dari awal
    const now = Date.now();
    for (const p of Object.values(useApp.getState().book.positions)) {
      if (p.status === 'open' && useApp.getState().priceStatus === 'live' && now - p.checkedUntil > 5 * 60_000) patchPosition(p.id, { checkedUntil: now - 60_000 });
    }
  }, 5 * 60_000);
  const onVis = () => {
    if (document.visibilityState === 'visible') catchUp();
  };
  document.addEventListener('visibilitychange', onVis);
  stop = () => {
    unsub();
    clearInterval(iv);
    document.removeEventListener('visibilitychange', onVis);
    stop = null;
  };
}
