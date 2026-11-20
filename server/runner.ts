// Satu "tick" bot. Dipanggil tiap menit oleh cron (Supabase pg_cron → /api/bot?action=tick).
// Urutan sama dengan backtest: (1) kelola posisi pakai candle 1m yang sudah close, geser trailing/time stop tiap candle TF entry close,
// (2) kalau ada candle TF entry baru close → nilai sinyal semua koin → buka posisi di harga live.
import { MODE_TF, MODES, withDefaults, type BotConfig } from '../core/config.js';
import { checkExits, closeManual, newAccount, onBarClose, stats, tryEnter, type Account } from '../core/engine.js';
import { biasAt, evaluate, prepare, type Prepared } from '../core/strategy.js';
import { TF_MS, type Decision, type Trade } from '../core/types.js';
import type { Interval, Market } from './market.js';

export type LogItem = { t: number; text: string; tone: 'good' | 'bad' | 'info' };
export type Session = { startedAt: number; endedAt: number; startBalance: number; endBalance: number; idrRate: number; trades: Trade[] };

export type BotState = {
  v: 1;
  config: BotConfig;
  acc: Account;
  idrRate: number; // kurs saat sesi dimulai
  paused: boolean;
  lastBarT: number; // waktu close candle TF entry terakhir yang sudah dinilai
  exitCursor: number; // candle 1m sebelum waktu ini sudah dicek
  scan: Decision[]; // keputusan terbaru per koin
  scanAt: number;
  decisions: Decision[]; // riwayat OPEN/SKIP (sinyal yang muncul), terbaru di depan
  log: LogItem[];
  lastRunAt: number;
  lastRunMs: number;
  lastError: string | null;
  minNotional: Record<string, number>;
  minNotionalAt: number;
  archive: Session[];
};

const MIN = 60_000;
const SETTLE = 15_000; // tunggu 15 detik setelah candle close supaya data Binance final

export function newState(config: Partial<BotConfig> | null, startBalance: number, idrRate: number, now = Date.now()): BotState {
  const cfg = withDefaults(config);
  const barMs = TF_MS[MODE_TF[cfg.mode].entry];
  return {
    v: 1,
    config: cfg,
    acc: newAccount(startBalance, now),
    idrRate,
    paused: false,
    lastBarT: Math.floor((now - SETTLE) / barMs) * barMs, // jangan entry sinyal lama saat baru mulai
    exitCursor: Math.floor(now / MIN) * MIN,
    scan: [],
    scanAt: 0,
    decisions: [],
    log: [{ t: now, text: `Sesi baru dimulai: saldo ${startBalance.toFixed(2)} USDT (≈ Rp ${Math.round(startBalance * idrRate).toLocaleString('id-ID')}). Mode ${cfg.mode}.`, tone: 'info' }],
    lastRunAt: 0,
    lastRunMs: 0,
    lastError: null,
    minNotional: {},
    minNotionalAt: 0,
    archive: [],
  };
}

function log(s: BotState, text: string, tone: LogItem['tone'] = 'info', t = Date.now()) {
  s.log.unshift({ t, text, tone });
  if (s.log.length > 300) s.log.length = 300;
}

const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 1 ? x.toFixed(4) : x.toPrecision(4));
const base = (s: string) => s.replace(/USDT$/, '');

function logTrade(s: BotState, tr: Trade) {
  const idr = Math.round(tr.pnl * s.idrRate).toLocaleString('id-ID');
  log(s, `${tr.pnl >= 0 ? '✅' : '❌'} Tutup ${base(tr.symbol)} ${tr.dir} (${tr.exitKind}) di ${fmt(tr.exit)} · ${tr.r >= 0 ? '+' : ''}${tr.r.toFixed(2)}R · ${tr.pnl >= 0 ? '+' : ''}${tr.pnl.toFixed(3)} USDT (Rp ${idr})`, tr.pnl >= 0 ? 'good' : 'bad', tr.closedAt);
}

export async function tick(s: BotState, m: Market, now = Date.now()): Promise<BotState> {
  const t0 = Date.now();
  const cfg = s.config;
  const { entry: eTf, bias: bTf } = MODE_TF[cfg.mode];
  const barMs = TF_MS[eTf];
  try {
    if (s.paused) return s;
    const lastClose = Math.floor((now - SETTLE) / barMs) * barMs; // close candle TF entry terakhir yang sudah final
    const boundaries: number[] = [];
    for (let b = s.lastBarT + barMs; b <= lastClose; b += barMs) boundaries.push(b);
    if (boundaries.length > 50) boundaries.splice(0, boundaries.length - 50);

    // (1) kelola posisi terbuka
    const entryCache: Record<string, Prepared> = {};
    const prepFor = async (sym: string, limit = 300) => {
      if (entryCache[sym]) return entryCache[sym];
      const [e, b] = await Promise.all([m.klines(sym, eTf as Interval, { limit }), m.klines(sym, bTf as Interval, { limit: biasLimit(cfg) })]);
      return (entryCache[sym] = prepare(sym, e, b, cfg));
    };
    const exitTo = Math.floor(now / MIN) * MIN; // candle 1m yang close sebelum ini sudah final
    for (const p of [...s.acc.positions]) {
      const from = Math.max(s.exitCursor, Math.ceil(p.openedAt / MIN) * MIN);
      if (from >= exitTo) continue;
      const bars = (await m.klines(p.symbol, '1m', { startTime: from, limit: 1000 })).filter((b) => b.t >= from && b.t + MIN <= exitTo);
      const needBar = boundaries.length > 0 || bars.some((b) => (b.t + MIN) % barMs === 0);
      const pr = needBar ? await prepFor(p.symbol) : null;
      for (const b of bars) {
        const tr = checkExits(s.acc, cfg, p, b.h, b.l, b.t + MIN, barMs);
        if (tr) {
          logTrade(s, tr);
          break;
        }
        const closeT = b.t + MIN;
        if (pr && closeT % barMs === 0) {
          const i = pr.e.c.findIndex((x) => x.t + barMs === closeT);
          if (i >= 0) {
            const tr2 = onBarClose(s.acc, cfg, p, pr.e.c[i].c, pr.e.atr[i], closeT, barMs);
            if (tr2) {
              logTrade(s, tr2);
              break;
            }
          }
        }
      }
    }
    s.exitCursor = exitTo;

    // (2) sinyal baru di candle TF entry yang baru close
    if (boundaries.length) {
      const closeT = boundaries.at(-1)!;
      if (boundaries.length > 1) log(s, `Bot sempat tidak jalan: ${boundaries.length - 1} candle ${eTf} terlewat, hanya candle terakhir yang dinilai.`, 'bad', now);
      if (now - s.minNotionalAt > 86_400_000) {
        try {
          s.minNotional = await m.minNotional();
          s.minNotionalAt = now;
        } catch {
          /* pakai cadangan */
        }
      }
      const syms = [...new Set(['BTCUSDT', ...cfg.coins])];
      const preps: Record<string, Prepared> = {};
      const failed: string[] = [];
      let firstErr = '';
      await Promise.all(
        syms.map(async (sym) => {
          try {
            preps[sym] = await prepFor(sym);
          } catch (e) {
            failed.push(base(sym));
            firstErr ||= (e as Error).message;
          }
        }),
      );
      // semua gagal → jangan tandai candle sudah dinilai, coba lagi menit berikutnya
      if (!Object.keys(preps).length) throw new Error(`semua data Binance gagal: ${firstErr}`);
      const idxAt = (p: Prepared) => p.e.c.findIndex((x) => x.t + barMs === closeT);
      const btc = preps['BTCUSDT'];
      const btcBias = btc && idxAt(btc) >= 0 ? biasAt(btc, idxAt(btc)) : null;
      const scan: Decision[] = [];
      for (const sym of cfg.coins) {
        const p = preps[sym];
        if (!p) continue;
        const i = idxAt(p);
        if (i < 0) {
          scan.push({ t: closeT, symbol: sym, action: 'WAIT', reason: 'candle belum tersedia dari Binance' });
          continue;
        }
        const ev = evaluate(p, i, cfg);
        let d: Decision;
        if (ev.dir) {
          const price = await m.price(sym).catch(() => p.e.c.at(-1)!.c);
          d = tryEnter(s.acc, cfg, { symbol: sym, ev, price, t: now, btcBias, minNotional: s.minNotional, barMs });
          s.decisions.unshift(d);
          if (d.action === 'OPEN') {
            const pos = s.acc.positions.at(-1)!;
            log(s, `🟢 Buka ${base(sym)} ${pos.dir} ${pos.leverage}× di ${fmt(pos.entry)} · SL ${fmt(pos.sl)} · ${pos.setup} · risiko ${pos.riskUsd.toFixed(3)} USDT`, 'good', now);
          } else log(s, `⏭️ ${base(sym)} ${ev.dir} dilewati: ${d.reason.split('DILEWATI: ')[1]}`, 'info', now);
        } else d = { t: ev.t, symbol: sym, action: 'WAIT', reason: ev.reason };
        scan.push(d);
      }
      if (s.decisions.length > 500) s.decisions.length = 500;
      s.scan = scan;
      s.scanAt = now;
      s.lastBarT = closeT;
      const opened = scan.filter((d) => d.action === 'OPEN').length;
      const sig = scan.filter((d) => d.action !== 'WAIT').length;
      log(s, `Scan candle ${eTf} ${new Date(closeT).toISOString().slice(5, 16).replace('T', ' ')} UTC: ${sig} sinyal, ${opened} dibuka. BTC bias ${btcBias ?? 'netral'}.${failed.length ? ` Gagal ambil data: ${failed.join(', ')}` : ''}`, 'info', now);
    }
    s.lastError = null;
  } catch (e) {
    s.lastError = (e as Error).message;
    log(s, `Error: ${s.lastError}`, 'bad', now);
  } finally {
    s.lastRunAt = now;
    s.lastRunMs = Date.now() - t0;
  }
  return s;
}

function biasLimit(cfg: BotConfig) {
  return Math.min(1000, Math.max(cfg.biasSlow * 3, 300));
}

export async function manualClose(s: BotState, m: Market, id: string, now = Date.now()) {
  const p = s.acc.positions.find((x) => x.id === id);
  if (!p) throw new Error('posisi tidak ditemukan');
  const price = await m.price(p.symbol);
  const tr = closeManual(s.acc, s.config, p, price, now, TF_MS[MODE_TF[s.config.mode].entry]);
  if (tr) logTrade(s, tr);
  return s;
}

/** Mulai sesi baru: posisi terbuka ditutup di harga live, sesi lama disimpan di arsip. */
export async function resetSession(s: BotState, m: Market, startBalance: number, idrRate: number, now = Date.now()): Promise<BotState> {
  for (const p of [...s.acc.positions]) await manualClose(s, m, p.id, now).catch(() => undefined);
  const archive: Session[] = [...s.archive, { startedAt: s.acc.startedAt, endedAt: now, startBalance: s.acc.startBalance, endBalance: s.acc.balance, idrRate: s.idrRate, trades: s.acc.trades }].slice(-20);
  const n = newState(s.config, startBalance, idrRate, now);
  n.archive = archive;
  return n;
}

/** Ganti setting. Kalau mode (TF) berubah, penanda candle disesuaikan supaya tidak entry sinyal lama. */
export function applyConfig(s: BotState, patch: Partial<BotConfig>, now = Date.now()) {
  const next = sanitize({ ...s.config, ...patch });
  if (next.mode !== s.config.mode) {
    const barMs = TF_MS[MODE_TF[next.mode].entry];
    s.lastBarT = Math.floor((now - SETTLE) / barMs) * barMs;
  }
  s.config = next;
  log(s, `Setting diubah: ${Object.keys(patch).join(', ')}`, 'info', now);
  return s;
}

function sanitize(c: BotConfig): BotConfig {
  const d = withDefaults(null);
  const out = { ...c } as Record<string, unknown>;
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'number') out[k] = Number.isFinite(+(out[k] as number)) ? +(out[k] as number) : v;
    if (typeof v === 'boolean') out[k] = !!out[k];
  }
  if (!MODES.includes(out.mode as never)) out.mode = d.mode;
  if (!['trend', 'bbBounce'].includes(out.strategy as string)) out.strategy = d.strategy;
  if (!['atr', 'pct'].includes(out.stopMode as string)) out.stopMode = d.stopMode;
  delete out.tpFirstIfAmbiguous;
  out.coins = Array.isArray(out.coins) ? (out.coins as string[]).map((x) => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean).map((x) => (x.endsWith('USDT') ? x : `${x}USDT`)) : d.coins;
  const cfg = out as BotConfig;
  cfg.riskPct = Math.min(5, Math.max(0.1, cfg.riskPct));
  cfg.maxLeverage = Math.min(50, Math.max(1, Math.round(cfg.maxLeverage)));
  cfg.maxOpen = Math.min(10, Math.max(1, Math.round(cfg.maxOpen)));
  cfg.maxSameDir = Math.min(cfg.maxOpen, Math.max(1, Math.round(cfg.maxSameDir)));
  cfg.slAtr = Math.max(0.3, cfg.slAtr);
  return cfg;
}

/** Ringkasan untuk dashboard (dipangkas supaya ringan). */
export function publicView(s: BotState) {
  const st = stats(s.acc.trades, s.acc.startBalance);
  return {
    config: s.config,
    paused: s.paused,
    idrRate: s.idrRate,
    balance: s.acc.balance,
    startBalance: s.acc.startBalance,
    startedAt: s.acc.startedAt,
    positions: s.acc.positions,
    trades: s.acc.trades.slice(-300),
    equity: s.acc.equity.slice(-500),
    stats: { ...st, pf: Number.isFinite(st.pf) ? st.pf : null },
    scan: s.scan,
    scanAt: s.scanAt,
    lastBarT: s.lastBarT,
    decisions: s.decisions.slice(0, 150),
    log: s.log.slice(0, 150),
    lastRunAt: s.lastRunAt,
    lastRunMs: s.lastRunMs,
    lastError: s.lastError,
    archive: s.archive.map((a) => ({ ...a, trades: a.trades.slice(-300) })),
    serverNow: Date.now(),
  };
}
export type PublicView = ReturnType<typeof publicView>;
