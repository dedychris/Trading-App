// Vercel Function — dijalankan di region Tokyo (lihat vercel.json) karena Binance memblokir IP Amerika.
import { handleBinance } from '../server/binanceProxy';

export function GET(request: Request): Promise<Response> {
  return handleBinance(request.url);
}
