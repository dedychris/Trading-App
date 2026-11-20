export const base = (s: string) => s.replace(/USDT$/, '');

export function price(x: number) {
  if (!Number.isFinite(x)) return '–';
  const a = Math.abs(x);
  const d = a >= 1000 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : 7;
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export const usd = (x: number, sign = false) => `${sign && x > 0 ? '+' : ''}${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(x) < 1 ? 3 : 2 })}`;
export const idr = (x: number, sign = false) => `${sign && x > 0 ? '+' : x < 0 ? '−' : ''}Rp ${Math.round(Math.abs(x)).toLocaleString('id-ID')}`;
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const r = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(2)}R`;

const WIB = { timeZone: 'Asia/Jakarta' } as const;
export const time = (t: number) => new Date(t).toLocaleTimeString('id-ID', { ...WIB, hour: '2-digit', minute: '2-digit' });
export const dateTime = (t: number) => new Date(t).toLocaleString('id-ID', { ...WIB, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const date = (t: number) => new Date(t).toLocaleDateString('id-ID', { ...WIB, day: '2-digit', month: 'short', year: 'numeric' });

export function ago(t: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  return `${Math.round(s / 86400)} hari lalu`;
}

export function duration(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}j ${m % 60}m`;
  return `${Math.floor(h / 24)}h ${h % 24}j`;
}

export const tone = (x: number) => (x > 0 ? 'text-up' : x < 0 ? 'text-down' : 'text-mute');
