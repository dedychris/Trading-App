import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleBinance } from './api/binance';
import { handleBot } from './server/handler';

// Di lokal, /api/binance dan /api/bot dilayani langsung oleh dev server (meniru Vercel function).
function binanceDevProxy(): Plugin {
  return {
    name: 'binance-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/binance') && !req.url?.startsWith('/api/bot')) return next();
        let r: Response;
        if (req.url.startsWith('/api/binance')) r = await handleBinance(req.url);
        else {
          // Bot lokal: state di file .bot-state.json (tanpa Supabase). BOT_SECRET default "lokal".
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'POST' ? body : undefined });
          r = await handleBot(request, { secret: process.env.BOT_SECRET ?? 'lokal' });
        }
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
