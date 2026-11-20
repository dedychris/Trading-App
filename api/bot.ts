// Vercel Function untuk bot (region Tokyo, lihat vercel.json). Logika ada di server/handler.ts.
import { handleBot } from '../server/handler.js';

export function GET(request: Request): Promise<Response> {
  return handleBot(request);
}

export function POST(request: Request): Promise<Response> {
  return handleBot(request);
}
