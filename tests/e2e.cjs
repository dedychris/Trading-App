// E2E: jalankan `npx vite preview --port 4173` dulu. Binance di-mock (data sintetis KHUSUS test).
const { chromium, devices } = require('playwright');
const OUT = process.argv[2] || '.';
const SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'SUIUSDT'];
const MS = { '1m': 6e4, '15m': 9e5, '1h': 36e5, '4h': 144e5 };
let priceBump = 1; // dipakai untuk memicu TP

function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function klines(sym, iv, limit, startTime) {
  const r = rng(sym.length * 97 + iv.length * 13 + sym.charCodeAt(0));
  const now = Date.now(), ms = MS[iv];
  const end = Math.floor(now / ms) * ms;
  const n = startTime ? Math.min(limit, Math.floor((now - startTime) / ms) + 1) : limit;
  const t0 = startTime ? Math.floor(startTime / ms) * ms : end - (n - 1) * ms;
  const dir = sym.charCodeAt(0) % 2 ? 1 : -1;
  let p = 100 + sym.length;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const wave = 0;
    const o = p; p = p * (1 + dir * 0.0006 + wave + (r() - 0.5) * 0.014);
    const h = Math.max(o, p) * (1 + r() * 0.002), l = Math.min(o, p) * (1 - r() * 0.002);
    rows.push([t0 + i * ms, o, h, l, p, 1000 + r() * 2000]);
  }
  return rows;
}
const lastPrice = (s) => klines(s, '15m', 1000).at(-1)[4];

async function route(page) {
  await page.routeWebSocket(/fstream\.binance\.com/, (ws) => ws.close());
  await page.route('**/api/binance**', (rt) => {
    const u = new URL(rt.request().url()); const p = u.searchParams.get('p'); const q = Object.fromEntries(u.searchParams);
    let body;
    if (p === '/fapi/v1/exchangeInfo') body = { symbols: SYMS };
    else if (p === '/fapi/v1/ticker/24hr') body = SYMS.map((s, i) => ({ symbol: s, lastPrice: String(lastPrice(s)), priceChangePercent: String((i % 5) - 2), quoteVolume: String(1e9 / (i + 1)) }));
    else if (p === '/fapi/v1/klines') body = klines(q.symbol, q.interval, +q.limit, q.startTime ? +q.startTime : 0);
    else if (p === '/fapi/v1/ticker/price') body = SYMS.map((s) => ({ symbol: s, price: String(lastPrice(s) * priceBump) }));
    else if (p === '/fapi/v1/premiumIndex') body = { markPrice: '100', lastFundingRate: '0.0001', nextFundingTime: Date.now() + 3e6 };
    else if (p === '/fapi/v1/fundingRate') body = [];
    else if (p === '/fapi/v1/openInterest') body = { openInterest: '12345' };
    else if (p === '/futures/data/openInterestHist') body = [{ sumOpenInterest: '100' }, { sumOpenInterest: '108' }];
    else if (p === '/futures/data/globalLongShortAccountRatio') body = [{ longShortRatio: '1.4', longAccount: '0.58' }];
    else body = { error: 'x' };
    rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await route(page);
  await page.goto('http://localhost:4173/');
  await page.getByRole('button', { name: /Scan Now/ }).click();
  await page.getByText('Scan terakhir').waitFor({ timeout: 30000 });
  const cards = page.locator('main button.card');
  console.log('kartu qualify:', await cards.count());
  console.log('winrate pills:', (await page.locator('text=🎯').allTextContents()).slice(0, 5));
  await page.screenshot({ path: `${OUT}/m-scanner-dark.png`, fullPage: false });
  await cards.first().click();
  await page.getByText(/^Winrate di \d+×$/).waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/m-detail.png`, fullPage: false });
  // ganti leverage → preview berubah
  const lev = page.locator('input[inputmode=numeric]').first();
  await lev.fill('10');
  const tpTxt = await page.getByText('TP (+14% margin)').locator('..').textContent();
  console.log('preview 10×:', tpTxt);
  const openBtn = page.getByRole('button', { name: /^Open (LONG|SHORT) 10×/ });
  const dirName = (await openBtn.textContent()).includes('LONG') ? 'LONG' : 'SHORT';
  await openBtn.click();
  await page.getByRole('button', { name: 'Konfirmasi' }).click();
  await page.getByText(/Posisi .* dibuka/).waitFor();
  await page.getByLabel('Tutup').click();
  await page.goto('http://localhost:4173/#pos');
  await page.getByText('PnL belum terealisasi').waitFor();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${OUT}/m-posisi.png` });
  // Gerakkan harga +/-2% ke arah posisi → TP 10× (1,4%) harus kena
  priceBump = dirName === 'LONG' ? 1.02 : 0.98;
  await page.getByText(/TP kena/).waitFor({ timeout: 15000 });
  console.log('TP tereksekusi untuk', dirName);
  await page.goto('http://localhost:4173/#hist');
  await page.locator('main .card button').first().click();
  await page.getByText(/Audit/).waitFor();
  await page.screenshot({ path: `${OUT}/m-riwayat.png`, fullPage: true });
  await page.goto('http://localhost:4173/#stats');
  await page.waitForTimeout(500);
  console.log('stats:', (await page.locator('main .card').first().textContent()));
  await page.goto('http://localhost:4173/#set');
  await page.getByRole('button', { name: /Terang/ }).click();
  await page.screenshot({ path: `${OUT}/m-settings-light.png`, fullPage: true });
  // Desktop light
  const d = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const dp = await d.newPage();
  dp.on('pageerror', (e) => errors.push(String(e)));
  await route(dp);
  await dp.goto('http://localhost:4173/');
  await dp.evaluate(() => { const b = JSON.parse(localStorage.getItem('msp-book-v1') || 'null'); });
  await dp.getByRole('button', { name: /Scan Now/ }).click();
  await dp.getByText('Scan terakhir').waitFor({ timeout: 30000 });
  await dp.screenshot({ path: `${OUT}/d-scanner.png` });
  await dp.locator('main button.card').first().click();
  await dp.getByText(/^Winrate di \d+×$/).waitFor();
  await dp.waitForTimeout(800);
  await dp.screenshot({ path: `${OUT}/d-detail.png` });
  // overflow horizontal di HP?
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log('overflow mobile px:', ov);
  console.log('errors:', errors.filter((e) => !/WebSocket|fstream/.test(e)));
  await browser.close();
})().catch((e) => { console.error('E2E GAGAL:', e); process.exit(1); });
