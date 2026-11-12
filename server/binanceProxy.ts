// Proxy publik ke Binance USDⓈ-M Futures. Dipakai oleh Vercel function (api/binance.ts)
// dan oleh dev server Vite. Hanya endpoint publik read-only yang diizinkan.

const UPSTREAM = 'https://fapi.binance.com';

const ALLOWED = new Set([
  '/fapi/v1/exchangeInfo',
  '/fapi/v1/ticker/24hr',
  '/fapi/v1/ticker/price',
  '/fapi/v1/klines',
  '/fapi/v1/premiumIndex',
  '/fapi/v1/fundingRate',
  '/fapi/v1/openInterest',
  '/futures/data/openInterestHist',
  '/futures/data/globalLongShortAccountRatio',
]);

const CACHE_SECONDS: Record<string, number> = {
  '/fapi/v1/exchangeInfo': 3600,
  '/fapi/v1/ticker/24hr': 5,
  '/fapi/v1/klines': 5,
};

export async function handleBinance(reqUrl: string): Promise<Response> {
  const url = new URL(reqUrl, 'http://localhost');
  const path = url.searchParams.get('p') || '';
  if (!ALLOWED.has(path)) {
    return json({ error: 'endpoint tidak diizinkan', path }, 400);
  }
  const compact = url.searchParams.get('compact') === '1';
  const upstreamParams = new URLSearchParams();
  url.searchParams.forEach((v, k) => {
    if (k !== 'p' && k !== 'compact') upstreamParams.set(k, v);
  });
  const target = `${UPSTREAM}${path}${upstreamParams.toString() ? `?${upstreamParams}` : ''}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers: { accept: 'application/json' } });
  } catch (e) {
    return json({ error: 'gagal menghubungi Binance', detail: String(e) }, 502);
  }
  const text = await upstream.text();
  if (!upstream.ok) {
    return json({ error: 'Binance menolak request', status: upstream.status, body: text.slice(0, 300) }, upstream.status === 451 ? 451 : 502);
  }

  let body = text;
  if (compact && path === '/fapi/v1/klines') {
    // [openTime, open, high, low, close, volume] — hemat ~60% ukuran
    const rows = JSON.parse(text) as unknown[][];
    body = JSON.stringify(rows.map((r) => [r[0], +(r[1] as string), +(r[2] as string), +(r[3] as string), +(r[4] as string), +(r[5] as string)]));
  }
  if (path === '/fapi/v1/exchangeInfo') {
    const info = JSON.parse(text) as { symbols: { symbol: string; contractType: string; quoteAsset: string; status: string }[] };
    body = JSON.stringify({
      symbols: info.symbols
        .filter((s) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
        .map((s) => s.symbol),
    });
  }
  const maxAge = CACHE_SECONDS[path] ?? 0;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': maxAge ? `public, s-maxage=${maxAge}, max-age=${Math.min(maxAge, 5)}` : 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
