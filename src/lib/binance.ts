// Klien data Binance USDⓈ-M Futures. Semua data live — tidak ada data karangan.
// Request lewat proxy /api/binance (Vercel, region Tokyo). Kalau proxy tidak ada
// (misal dibuka dari hosting statis), otomatis coba langsung ke fapi.binance.com.

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Interval = '1m' | '15m' | '1h' | '4h';

export const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
};

let mode: 'proxy' | 'direct' = 'proxy';

export class BinanceError extends Error {}

async function raw(path: string, params: Record<string, string | number | undefined> = {}, compact = false): Promise<unknown> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  if (mode === 'proxy') {
    const p = new URLSearchParams(qs);
    p.set('p', path);
    if (compact) p.set('compact', '1');
    try {
      const r = await fetch(`/api/binance?${p}`);
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('json')) return r.json();
      if (r.status === 404 && !ct.includes('json')) {
        mode = 'direct'; // tidak ada proxy (misal hosting statis) → coba langsung
      } else {
        const text = await r.text().catch(() => '');
        let msg = text.slice(0, 160);
        try {
          const j = JSON.parse(text) as { error?: string; status?: number; body?: string };
          msg = [j.error, j.status, j.body?.slice(0, 120)].filter(Boolean).join(' · ');
        } catch {
          /* bukan JSON */
        }
        throw new BinanceError(`Proxy /api/binance error ${r.status}: ${msg || 'tanpa pesan'}`);
      }
    } catch (e) {
      if (e instanceof BinanceError) throw e;
      throw new BinanceError(`Proxy /api/binance tidak bisa dihubungi: ${String(e)}`);
    }
  }
  const r = await fetch(`https://fapi.binance.com${path}${qs.toString() ? `?${qs}` : ''}`).catch((e) => {
    throw new BinanceError(`Tidak bisa terhubung ke Binance: ${String(e)}`);
  });
  if (!r.ok) throw new BinanceError(`Binance error ${r.status}`);
  const data = await r.json();
  if (compact && path === '/fapi/v1/klines') {
    return (data as unknown[][]).map((x) => [x[0], +(x[1] as string), +(x[2] as string), +(x[3] as string), +(x[4] as string), +(x[5] as string)]);
  }
  if (path === '/fapi/v1/exchangeInfo') {
    const info = data as { symbols: { symbol: string; contractType: string; quoteAsset: string; status: string }[] };
    return {
      symbols: info.symbols
        .filter((s) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
        .map((s) => s.symbol),
    };
  }
  return data;
}

// Batasi request paralel supaya tidak kena rate limit Binance
const MAX_CONCURRENT = 6;
let active = 0;
const queue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((res) => queue.push(res));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

export async function getKlines(symbol: string, interval: Interval, limit: number, opts: { startTime?: number; endTime?: number } = {}): Promise<Candle[]> {
  const rows = (await limited(() =>
    raw('/fapi/v1/klines', { symbol, interval, limit, startTime: opts.startTime, endTime: opts.endTime }, true),
  )) as number[][];
  return rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
}

/** Ambil candle 1m dari `from` sampai sekarang (maks `maxCandles`). Untuk cek TP/SL selama app ditutup. */
export async function getKlinesRange(symbol: string, interval: Interval, from: number, to = Date.now(), maxCandles = 10_080): Promise<Candle[]> {
  const out: Candle[] = [];
  let start = from;
  while (start < to && out.length < maxCandles) {
    const batch = await getKlines(symbol, interval, 1500, { startTime: start, endTime: to });
    if (!batch.length) break;
    out.push(...batch);
    start = batch[batch.length - 1].t + INTERVAL_MS[interval];
    if (batch.length < 1500) break;
  }
  return out;
}

export type Ticker24h = { symbol: string; lastPrice: number; priceChangePercent: number; quoteVolume: number };

export async function getTopSymbols(n = 40): Promise<Ticker24h[]> {
  const [info, tickers] = await Promise.all([
    limited(() => raw('/fapi/v1/exchangeInfo')) as Promise<{ symbols: string[] }>,
    limited(() => raw('/fapi/v1/ticker/24hr')) as Promise<{ symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string }[]>,
  ]);
  const ok = new Set(info.symbols);
  return tickers
    .filter((t) => ok.has(t.symbol))
    .map((t) => ({ symbol: t.symbol, lastPrice: +t.lastPrice, priceChangePercent: +t.priceChangePercent, quoteVolume: +t.quoteVolume }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, n);
}

export async function getAllPrices(): Promise<Record<string, number>> {
  const rows = (await raw('/fapi/v1/ticker/price')) as { symbol: string; price: string }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.symbol] = +r.price;
  return out;
}

export type Premium = { symbol: string; markPrice: number; lastFundingRate: number; nextFundingTime: number };
export async function getPremium(symbol: string): Promise<Premium> {
  const r = (await limited(() => raw('/fapi/v1/premiumIndex', { symbol }))) as Record<string, string | number>;
  return { symbol, markPrice: +r.markPrice, lastFundingRate: +r.lastFundingRate, nextFundingTime: +r.nextFundingTime };
}

export type FundingEvent = { fundingTime: number; fundingRate: number; markPrice: number };
export async function getFundingHistory(symbol: string, startTime: number, endTime = Date.now()): Promise<FundingEvent[]> {
  const rows = (await limited(() => raw('/fapi/v1/fundingRate', { symbol, startTime, endTime, limit: 1000 }))) as Record<string, string | number>[];
  return rows.map((r) => ({ fundingTime: +r.fundingTime, fundingRate: +r.fundingRate, markPrice: +(r.markPrice || 0) }));
}

export type Derivs = {
  fundingRate: number;
  nextFundingTime: number;
  markPrice: number;
  openInterest: number; // dalam koin
  oiChange24h: number | null; // %
  longShortRatio: number | null;
  longPct: number | null;
};

export async function getDerivatives(symbol: string): Promise<Derivs> {
  const [prem, oi, oiHist, ls] = await Promise.all([
    getPremium(symbol),
    limited(() => raw('/fapi/v1/openInterest', { symbol })) as Promise<{ openInterest: string }>,
    (limited(() => raw('/futures/data/openInterestHist', { symbol, period: '1h', limit: 25 })) as Promise<{ sumOpenInterest: string }[]>).catch(() => []),
    (limited(() => raw('/futures/data/globalLongShortAccountRatio', { symbol, period: '1h', limit: 1 })) as Promise<{ longShortRatio: string; longAccount: string }[]>).catch(() => []),
  ]);
  const first = oiHist[0] ? +oiHist[0].sumOpenInterest : 0;
  const last = oiHist.length ? +oiHist[oiHist.length - 1].sumOpenInterest : 0;
  return {
    fundingRate: prem.lastFundingRate,
    nextFundingTime: prem.nextFundingTime,
    markPrice: prem.markPrice,
    openInterest: +oi.openInterest,
    oiChange24h: first ? ((last - first) / first) * 100 : null,
    longShortRatio: ls[0] ? +ls[0].longShortRatio : null,
    longPct: ls[0] ? +ls[0].longAccount * 100 : null,
  };
}

/**
 * Harga live via WebSocket Binance (semua simbol, update tiap ~1 detik). Fallback polling.
 * Ada watchdog: kalau socket "zombie" (tetap OPEN tapi tidak kirim data — sering terjadi
 * setelah laptop sleep / ganti jaringan), koneksi dibuang paksa, polling jalan, lalu reconnect.
 */
export const STALE_MS = 15_000;
export function subscribePrices(onPrices: (p: Record<string, number>) => void, onStatus: (s: 'live' | 'polling' | 'off') => void): () => void {
  let ws: WebSocket | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let failures = 0;
  let lastMsg = 0;

  const startPolling = () => {
    if (pollTimer) return;
    onStatus('polling');
    const tick = () => getAllPrices().then((p) => {
      onPrices(p);
      if (pollTimer) onStatus('polling');
    }).catch(() => onStatus('off'));
    tick();
    pollTimer = setInterval(tick, 4000);
  };
  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  /** Buang socket sekarang juga (tanpa menunggu onclose yang bisa telat lama), lalu jadwalkan reconnect. */
  const drop = (delay: number) => {
    const old = ws;
    ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try {
        old.close();
      } catch {
        /* abaikan */
      }
    }
    if (closed) return;
    failures++;
    startPolling();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, delay);
  };

  const connect = () => {
    retryTimer = null;
    if (closed || ws) return;
    let sock: WebSocket;
    try {
      sock = new WebSocket('wss://fstream.binance.com/ws/!miniTicker@arr');
    } catch {
      startPolling();
      return;
    }
    ws = sock;
    lastMsg = Date.now();
    sock.onopen = () => {
      failures = 0;
      lastMsg = Date.now();
      stopPolling();
      onStatus('live');
      // isi semua harga sekali (miniTicker hanya kirim simbol yang berubah)
      getAllPrices().then(onPrices).catch(() => {});
    };
    sock.onmessage = (ev) => {
      lastMsg = Date.now();
      try {
        const arr = JSON.parse(ev.data as string) as { s: string; c: string }[];
        const out: Record<string, number> = {};
        for (const x of arr) out[x.s] = +x.c;
        onPrices(out);
      } catch {
        /* abaikan */
      }
    };
    sock.onclose = () => {
      if (ws === sock) drop(Math.min(60_000, 3000 * (failures + 1)));
    };
    sock.onerror = () => sock.close();
  };

  /** Cek kesehatan koneksi: dipanggil berkala & saat app kembali aktif / online lagi. */
  const check = () => {
    if (closed) return;
    if (!ws) {
      if (!retryTimer) connect();
      return;
    }
    const silent = Date.now() - lastMsg;
    if (ws.readyState === WebSocket.OPEN) {
      if (silent > STALE_MS) drop(1000); // zombie: dulu sehat, sekarang diam → reconnect cepat
    } else if (silent > 8000) drop(Math.min(60_000, 3000 * (failures + 1))); // gagal connect → backoff
  };
  const watchdog = setInterval(check, 5000);
  const onWake = () => {
    if (document.visibilityState === 'visible') check();
  };
  const onOnline = () => {
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMsg < 3000) return;
    drop(500); // jaringan baru → socket lama hampir pasti mati
  };
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('online', onOnline);
  window.addEventListener('focus', check);

  connect();
  return () => {
    closed = true;
    clearInterval(watchdog);
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', check);
    const old = ws;
    ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      old.close();
    }
    stopPolling();
    if (retryTimer) clearTimeout(retryTimer);
    onStatus('off');
  };
}
