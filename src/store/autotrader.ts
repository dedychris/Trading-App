// 🤖 Auto trading (simulasi). Jalan selama app terbuka: tiap candle 15m close, scan otomatis,
// lalu buka posisi untuk sinyal ⭐ Golden / 3TF searah yang BARU muncul dan lolos semua syarat.
import { findSignals, winrate } from '../lib/backtest';
import { getDerivatives } from '../lib/binance';
import { fmtPct, fmtPrice, fmtUsd, base } from '../lib/format';
import { beep, systemNotify } from '../lib/notify';
import { features, matchPatterns, patternText } from '../lib/patterns';
import { atrPass, btcConflict, filterPass, sentimentPass, SETUP_INFO, setupShort, type SetupKey } from '../lib/signals';
import { moves, previewOrder } from '../lib/sim';
import { availableBalance, openPosition, useApp, type AutoLog } from './app';
import { walletBalance } from './book';
import { doScan } from './scan';
import type { Snapshot } from './types';

export const AUTO_KEYS: SetupKey[] = ['GOLD', '3TF'];
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

function log(text: string, tone: AutoLog['tone'] = 'info') {
  const cur = useApp.getState().autoLog;
  useApp.setState({ autoLog: [{ t: Date.now(), text, tone }, ...cur].slice(0, 60) });
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
  const cands = res.rows.filter((r) => r.setup && AUTO_KEYS.includes(r.setup.key));
  if (!cands.length) {
    log(`Scan ${new Date(res.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}: tidak ada sinyal ⭐ Golden / 3TF searah.`);
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
    const skip = (why: string) => log(`Lewati ${tag}: ${why}`);
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
    // sinyal harus BARU muncul di candle 15m yang barusan close
    const ss = res.series[r.symbol];
    const sigs = findSignals(ss, setup.key);
    const last = sigs[sigs.length - 1];
    if (!last || last.dir !== setup.dir || now - last.t > SLOT + 2 * DELAY) {
      skip('sinyal sudah berjalan sejak candle sebelumnya (bukan sinyal baru)');
      continue;
    }
    const id = `auto-${r.symbol}-${last.t}`;
    if (b.positions[id]) continue; // sudah dibuka (device lain / run sebelumnya)
    if (res.btc && r.symbol !== 'BTCUSDT' && btcConflict(res.btc.trend, setup.dir)) {
      skip(`melawan arah BTC (${res.btc.trend})`);
      continue;
    }
    const g15 = r.tf['15m'];
    const h1 = r.tf['1h'];
    if (!g15 || !h1) {
      skip('data indikator kurang');
      continue;
    }
    if (g15.v.adx < 25 || h1.v.adx < 25) {
      skip(`sideways — ADX 15m ${g15.v.adx.toFixed(0)}, 1H ${h1.v.adx.toFixed(0)} (butuh ≥ 25)`);
      continue;
    }
    if (!(h1.v.bbWidth >= 0.8 * h1.v.bbWidthAvg)) {
      skip('sideways — Bollinger 1H menyempit (harga muter di range sempit)');
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
    if (wr.pct === null || wr.pct < pv.breakevenWinrate) {
      skip(`winrate ${wr.pct === null ? 'belum ada data' : fmtPct(wr.pct, 0)} di bawah winrate impas ${fmtPct(pv.breakevenWinrate, 0)}`);
      continue;
    }
    const pat = matchPatterns(features({ setupKey: setup.key, dir: setup.dir, tf: r.tf, btcTrend: res.btc?.trend ?? null, leverage: a.leverage, symbol: r.symbol, slPct: a.slPct }), b);
    if (pat.bad) {
      skip(`pola ini sering kena SL (${pat.bad.n - pat.bad.wins}/${pat.bad.n}): ${patternText(pat.bad)}`);
      continue;
    }
    if (margin > availableBalance(b)) {
      skip(`saldo tersedia tidak cukup untuk margin ${fmtUsd(margin)} USDT`);
      continue;
    }
    planned++;
    void openAuto_({ id, symbol: r.symbol, setup, price, margin, wrPct: wr.pct, wrN: wr.coin.n, breakeven: pv.breakevenWinrate, tf: r.tf, needSentiment: book.settings.filters.sentiment, tag });
  }
}

async function openAuto_(x: {
  id: string;
  symbol: string;
  setup: { key: SetupKey; dir: 'LONG' | 'SHORT' };
  price: number;
  margin: number;
  wrPct: number;
  wrN: number;
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
    log(`Lewati ${x.tag}: tidak lolos filter Funding/Long-Short`);
    return;
  }
  const b = useApp.getState().book;
  if (b.positions[x.id]) return;
  if (Object.values(b.positions).filter((p) => p.status === 'open' && p.auto).length >= a.maxOpen) {
    log(`Lewati ${x.tag}: batas maks ${a.maxOpen} posisi auto sudah penuh`);
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
  const text = `🤖 Auto ${x.setup.dir} ${base(x.symbol)} ${a.leverage}× di ${fmtPrice(price)} · ${setupShort(x.setup.key)} · winrate ${fmtPct(x.wrPct, 0)}`;
  log(`Buka ${x.tag} di ${fmtPrice(price)}, margin ${fmtUsd(x.margin)} USDT, winrate ${fmtPct(x.wrPct, 0)}`, 'good');
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
      // baru dinyalakan / app baru dibuka: jangan kejar sinyal lama, tunggu candle berikutnya
      lastSlot = slot;
      useApp.setState({ autoRun: { ...useApp.getState().autoRun, nextAt: nextSlotAt(now) } });
      log('Auto trading aktif. Menunggu candle 15m berikutnya close.');
      return;
    }
    if (slot > lastSlot) {
      lastSlot = slot;
      runAutoOnce();
    }
  };
  timer = setInterval(tick, 10_000);
  tick();
  // reset penanda kalau auto dimatikan, supaya saat dinyalakan lagi tidak langsung entry
  useApp.subscribe((s, prev) => {
    if (prev.book.settings.auto.enabled && !s.book.settings.auto.enabled) {
      lastSlot = -1;
      log('Auto trading dimatikan.');
    }
  });
}
