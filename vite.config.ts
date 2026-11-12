import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleBinance } from './api/binance';

// Di lokal, /api/binance dilayani langsung oleh dev server (meniru Vercel function).
function binanceDevProxy(): Plugin {
  return {
    name: 'binance-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/binance')) return next();
        const r = await handleBinance(req.url);
        res.statusCode = r.status;
        r.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await r.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), binanceDevProxy()],
  build: { chunkSizeWarningLimit: 900 },
});
