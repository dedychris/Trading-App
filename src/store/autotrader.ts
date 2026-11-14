// 🤖 Auto trading (simulasi). Jalan selama app terbuka: langsung scan saat aktif, lalu tiap candle 15m close,
// buka posisi untuk sinyal ⭐ Golden / 3TF / 1H+15M searah (+ 4H+1H kalau aktif) yang BARU muncul dan lolos syarat.
import { findSignals, winrate } from '../lib/backtest';
import { getDerivatives } from '../lib/binance';
import { fmtPct, fmtPrice, fmtUsd, base } from '../lib/format';
import { beep, systemNotify } from '../lib/notify';
import { atrPass, btcConflict, filterPass, sentimentPass, SETUP_INFO, setupShort, type SetupKey } from '../lib/signals';
import { moves, previewOrder } from '../lib/sim';
import { availableBalance, openPosition, useApp, type AutoLog } from './app';
import { walletBalance } from './book';
import { doScan } from './scan';
import type { Snapshot } from './types';

export const AUTO_KEYS: SetupKey[] = ['GOLD', '3TF'];
// 1H+15M searah selalu ikut (cukup 1H & 15M searah); 4H+1H opsional
export const autoKeys = (a: { with4h1h?: boolean }): SetupKey[] => (a.with4h1h ? [...AUTO_KEYS, '1H4H', '15M1H'] : [...AUTO_KEYS, '15M1H']);

/** Jumlah posisi koin ini yang kena SL / likuidasi hari ini (WIB). */
export function slToday(symbol: string, now = Date.now()) {
  const start = dayStartWib(now);
  return Object.values(useApp.getState().book.positions).filter((p) => p.symbol === symbol && p.status === 'closed' && (p.closedAt ?? 0) >= start && (p.reason === 'SL' || p.reason === 'LIQ')).length;
}
const SLOT = 15 * 60_000;
const DELAY = 30_000; // tunggu 30 detik setelah candle close supaya data Binance sudah final
const DAY = 86_400_000;
const WIB = 7 * 3_600_000;

export function deviceId() {
  try {
    let id = localStorage.getItem('msp-device-id');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem('msp-device-id', id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

export function autoAllowedHere() {
  const a = useApp.getState().book.settings.auto;
  return a.enabled && (!a.deviceId || a.deviceId === deviceId());
}

function log(text: string, tone: AutoLog['tone'] = 'info', symbol?: string, short?: string) {
  const st = useApp.getState();
  const entry = { t: Date.now(), text, tone };
  useApp.setState({
    autoLog: [entry, ...st.autoLog].slice(0, 80),
    ...(symbol ? { autoDecision: { ...st.autoDecision, [symbol]: { ...entry, text: short ?? text } } } : {}),
  });
}

export const dayStartWib = (now = Date.now()) => Math.floor((now + WIB) / DAY) * DAY - WIB;

/** PnL terealisasi hari ini (WIB) dan saldo awal hari ini. */
export function todayPnl() {
  const b = useApp.getState().book;
  const start = dayStartWib();
  let pnl = 0;
  for (const e of Object.values(b.ledger)) if (e.t >= start) pnl += e.amt;
  return { pnl, startBalance: walletBalance(b) - pnl };
}

export const nextSlotAt = (now = Date.now()) => Math.floor((now - DELAY) / SLOT) * SLOT + SLOT + DELAY;

export async function runAutoOnce() {
  const st = useApp.getState();
  if (st.autoRun.running) return;
  useApp.setState({ autoRun: { ...st.autoRun, running: true } });
  try {
    await doScan({ quiet: true });
    evaluate();
  } catch (e) {
    log(`Gagal: ${(e as Error).message}`, 'bad');
  } finally {
    useApp.setState({ autoRun: { lastAt: Date.now(), nextAt: nextSlotAt(), running: false } });
  }
}

function evaluate() {
  const { scan, book } = useApp.getState();
  const a = book.settings.auto;
  const res = scan.result;
  if (!res) {
    log(`Scan gagal: ${scan.error ?? 'tidak ada data'}`, 'bad');
    return;
  }
  const now = Date.now();
  useApp.setState({ autoDecision: {} }); // kartu cuma menampilkan keputusan run terbaru
  const keys = autoKeys(a);
  const cands = res.rows.filter((r) => r.setup && keys.includes(r.setup.key));
  if (!cands.length) {
    log(`Scan ${new Date(res.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}: tidak ada sinyal ${keys.map(setupShort).join(' / ')}.`);
    return;
  }
  const { pnl, startBalance } = todayPnl();
  if (startBalance > 0 && pnl <= (-a.dailyLossPct / 100) * startBalance) {
    log(`Stop: rugi hari ini ${fmtUsd(pnl, true)} USDT sudah melewati batas −${a.dailyLossPct}%. Auto lanjut besok 00:00 WIB.`, 'bad');
    return;
  }
  const filters = { volume: book.settings.filters.volume, ema200: book.settings.filters.ema200, bollinger: book.settings.filters.bollinger, atr: book.settings.filters.atr };
  const ranked = cands
    .map((r) => ({ r, wr: winrate(res.series, r.symbol, r.setup!.key, r.setup!.dir, a.leverage, filters, a.tpPct, a.slPct) }))
    .sort((x, y) => (y.wr.pct ?? 0) - (x.wr.pct ?? 0));

  let planned = 0; // posisi yang sedang dibuka di run ini (pembukaan async)
  for (const { r, wr } of ranked) {
    const setup = r.setup!;
    const tag = `${base(r.symbol)} ${setup.dir} (${setupShort(setup.key)})`;
    const skip = (why: string) => log(`Lewati ${tag}: ${why}`, 'info', r.symbol, `dilewati: ${why}`);
    const b = useApp.getState().book;
    const openAuto = Object.values(b.positions).filter((p) => p.status === 'open' && p.auto);
    if (openAuto.length + planned >= a.maxOpen) {
      skip(`sudah ${openAuto.length + planned} posisi auto terbuka (maks ${a.maxOpen})`);
      continue;
    }
    if (openAuto.some((p) => p.symbol === r.symbol)) {
      skip('sudah ada posisi auto di koin ini');
      continue;
    }
    const nSl = a.maxSlPerCoinDay > 0 ? slToday(r.symbol, now) : 0;
    if (a.maxSlPerCoinDay > 0 && nSl >= a.maxSlPerCoinDay) {
      skip(`koin ini sudah ${nSl}× kena SL hari ini (batas ${a.maxSlPerCoinDay}×) — lanjut besok 00:00 WIB`);
      continue;
    }
    // sinyal harus BARU muncul (maks N candle 15m terakhir; setup 4H+1H minimal 1 candle 1H)
    const ss = res.series[r.symbol];
    const sigs = findSignals(ss, setup.key);
    const last = sigs[sigs.length - 1];
    const maxAge = Math.max(Math.max(1, a.freshCandles) * SLOT, SETUP_INFO[setup.key].grid === '1h' ? 4 * SLOT : 0) + 2 * DELAY;
    if (!last || last.dir !== setup.dir || now - last.t > maxAge) {
      const age = last ? Math.round((now - last.t) / SLOT) : null;
      skip(`sinyal sudah berjalan ${age !== null ? `±${age} candle` : 'lama'} (batas ${a.freshCandles} candle terakhir)`);
      continue;
    }
    const id = `auto-${r.symbol}-${last.t}`;
    if (b.positions[id]) continue; // sudah dibuka (device lain / run sebelumnya)
    if (res.btc && r.symbol !== 'BTCUSDT' && btcConflict(res.btc.trend, setup.dir)) {
      skip(`melawan arah BTC (${res.btc.trend})`);
      continue;
    }
    const grid = r.tf[SETUP_INFO[setup.key].grid]!;
    const failed: string[] = [];
    if (filters.volume && !filterPass('volume', grid, setup.dir)) failed.push('Volume');
    if (filters.ema200 && !filterPass('ema200', grid, setup.dir)) failed.push('EMA200');
    if (filters.bollinger && !filterPass('bollinger', grid, setup.dir)) failed.push('Bollinger');
    if (filters.atr && !atrPass(grid.v.atrPct, moves(a.leverage, a.tpPct, a.slPct).sl * 100)) failed.push('ATR');
    if (failed.length) {
      skip(`tidak lolos filter ${failed.join(', ')}`);
      continue;
    }
    const price = useApp.getState().prices[r.symbol] ?? r.price;
    const margin = a.marginMode === 'fixed' ? a.marginFixed : (walletBalance(b) * a.marginPercent) / 100;
    const pv = previewOrder({ dir: setup.dir, entry: price, leverage: a.leverage, margin, entryType: 'market', bnb: b.settings.bnb, tpPct: a.tpPct, slPct: a.slPct });
    // sampel yang dipakai winrate: koin ini kalau ≥ 20 kejadian, selain itu gabungan 40 koin
    const sample = wr.method === 'koin' ? wr.coin.n : wr.pool.n;
    const smallSample = a.ignoreSmallSample && sample < a.minSample;
    if (a.requireWinrate && !smallSample && (wr.pct === null || wr.pct < pv.breakevenWinrate)) {
      skip(`winrate ${wr.pct === null ? 'belum ada data' : fmtPct(wr.pct, 0)} (${sample} kejadian) di bawah winrate impas ${fmtPct(pv.breakevenWinrate, 0)}`);
      continue;
    }
    if (margin > availableBalance(b)) {
      skip(`saldo tersedia tidak cukup untuk margin ${fmtUsd(margin)} USDT`);
      continue;
    }
    planned++;
    void openAuto_({ id, symbol: r.symbol, setup, price, margin, wrPct: wr.pct, wrN: sample, smallSample: smallSample || !a.requireWinrate, breakeven: pv.breakevenWinrate, tf: r.tf, needSentiment: book.settings.filters.sentiment, tag });
  }
}

async function openAuto_(x: {
  id: string;
  symbol: string;
  setup: { key: SetupKey; dir: 'LONG' | 'SHORT' };
  price: number;
  margin: number;
  wrPct: number | null;
  wrN: number;
  smallSample: boolean;
  breakeven: number;
  tf: Snapshot['tf'];
  needSentiment: boolean;
  tag: string;
}) {
  const a = useApp.getState().book.settings.auto;
  let d: Awaited<ReturnType<typeof getDerivatives>> | null = null;
  try {
    d = await getDerivatives(x.symbol);
  } catch {
    /* data funding opsional, kecuali filter sentimen aktif */
  }
  if (x.needSentiment && (!d || !sentimentPass(x.setup.dir, d.fundingRate, d.longPct))) {
    log(`Lewati ${x.tag}: tidak lolos filter Funding/Long-Short`, 'info', x.symbol, 'dilewati: tidak lolos filter Funding/Long-Short');
    return;
  }
  const b = useApp.getState().book;
  if (b.positions[x.id]) return;
  if (Object.values(b.positions).filter((p) => p.status === 'open' && p.auto).length >= a.maxOpen) {
    log(`Lewati ${x.tag}: batas maks ${a.maxOpen} posisi auto sudah penuh`, 'info', x.symbol, `dilewati: maks ${a.maxOpen} posisi auto penuh`);
    return;
  }
  const price = useApp.getState().prices[x.symbol] ?? x.price;
  const snap: Snapshot = {
    t: Date.now(),
    price,
    tf: x.tf,
    setup: x.setup,
    btcTrend: useApp.getState().scan.result?.btc?.trend ?? null,
    funding: d?.fundingRate ?? null,
    longPct: d?.longPct ?? null,
    oiChange24h: d?.oiChange24h ?? null,
    winrate: x.wrPct,
    winrateN: x.wrN,
    breakevenWinrate: x.breakeven,
  };
  openPosition({ id: x.id, symbol: x.symbol, dir: x.setup.dir, leverage: a.leverage, margin: x.margin, entry: price, entryType: 'market', snap, tpPct: a.tpPct, slPct: a.slPct, trailPct: a.trailOn ? a.trailPct : null, auto: true });
  const wrText = !a.requireWinrate ? `winrate ${fmtPct(x.wrPct, 0)} (info saja)` : x.smallSample ? `winrate diabaikan (sampel ${x.wrN} < ${a.minSample})` : `winrate ${fmtPct(x.wrPct, 0)}`;
  const text = `🤖 Auto ${x.setup.dir} ${base(x.symbol)} ${a.leverage}× di ${fmtPrice(price)} · ${setupShort(x.setup.key)} · ${wrText}`;
  log(`Buka ${x.tag} di ${fmtPrice(price)}, margin ${fmtUsd(x.margin)} USDT, ${wrText}`, 'good', x.symbol, `dibuka di ${fmtPrice(price)} · ${wrText}`);
  useApp.getState().toast(text, 'good');
  const s = useApp.getState().book.settings;
  if (s.sound) beep('good');
  if (s.notify) systemNotify('🤖 Auto trading buka posisi', text);
}

let timer: ReturnType<typeof setInterval> | null = null;
let lastSlot = -1;
export function startAutoTrader() {
  if (timer) return;
  const tick = () => {
    if (!autoAllowedHere()) {
      if (useApp.getState().autoRun.nextAt) useApp.setState({ autoRun: { ...useApp.getState().autoRun, nextAt: undefined } });
      return;
    }
    const now = Date.now();
    const slot = Math.floor((now - DELAY) / SLOT);
    if (lastSlot === -1) {
      // baru dinyalakan / app baru dibuka: langsung scan. Aman, cuma sinyal yang masih baru (batas candle) yang di-entry.
      lastSlot = slot;
      log('Auto trading aktif. Scan sekarang, lalu tiap candle 15m close.');
      runAutoOnce();
      return;
    }
    if (slot > lastSlot) {
      lastSlot = slot;
      runAutoOnce();
    }
  };
  timer = setInterval(tick, 10_000);
  tick();
  syncWakeLock();
  document.addEventListener('visibilitychange', syncWakeLock);
  // reset penanda kalau auto dimatikan, supaya saat dinyalakan lagi tidak langsung entry
  useApp.subscribe((s, prev) => {
    if (prev.book.settings.auto.enabled && !s.book.settings.auto.enabled) {
      lastSlot = -1;
      log('Auto trading dimatikan.');
    }
    if (prev.book.settings.auto !== s.book.settings.auto) syncWakeLock();
  });
}

// Cegah layar HP mati selama auto aktif (kalau layar mati, browser membekukan app dan auto berhenti).
type Sentinel = { released: boolean; release: () => Promise<void> };
let wake: Sentinel | null = null;
async function syncWakeLock() {
  const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } };
  if (!nav.wakeLock) return;
  const a = useApp.getState().book.settings.auto;
  const want = autoAllowedHere() && a.wakeLock && document.visibilityState === 'visible';
  try {
    if (want && (!wake || wake.released)) wake = await nav.wakeLock.request('screen');
    else if (!want && wake && !wake.released) {
      await wake.release();
      wake = null;
    }
  } catch {
    /* browser menolak (mis. hemat baterai) — abaikan */
  }
}
