export function fmtPrice(p: number | null | undefined) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  const a = Math.abs(p);
  const d = a >= 1000 ? 2 : a >= 100 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : 7;
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtUsd(v: number | null | undefined, sign = false) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}${s}`;
}
export function fmtPct(v: number | null | undefined, d = 2, sign = false) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}${Math.abs(v).toFixed(d).replace('.', ',')}%`;
}
export function fmtNum(v: number | null | undefined, d = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(d).replace('.', ',');
}
export function fmtCompact(v: number) {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}
export function fmtTime(t: number | undefined) {
  if (!t) return '—';
  return new Date(t).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtDuration(ms: number) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}j ${m % 60}m`;
  return `${Math.floor(h / 24)}h ${h % 24}j`;
}
export const base = (symbol: string) => symbol.replace(/USDT$/, '');
