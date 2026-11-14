export function fmtPrice(p: number | null | undefined) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  const a = Math.abs(p);
  const d = a >= 1000 ? 2 : a >= 100 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : 7;
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
/** USDT: 2 desimal; angka kecil (modal kecil) lebih banyak desimal supaya fee/PnL receh tetap kelihatan. */
export function fmtUsd(v: number | null | undefined, sign = false) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a === 0 || a >= 1 ? 2 : a >= 0.1 ? 3 : 4;
  const s = a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${v < 0 && +s.replace(/,/g, '') !== 0 ? '−' : sign && v > 0 ? '+' : ''}${s}`;
}
/** Rupiah: "Rp 150.000". Di bawah Rp 10 pakai 1 desimal. */
export function fmtIdr(v: number | null | undefined, sign = false) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a.toLocaleString('id-ID', { maximumFractionDigits: a < 10 ? 1 : 0 });
  return `${v < 0 && s !== '0' ? '−' : sign && v > 0 ? '+' : ''}Rp ${s}`;
}
/** Baca angka Rupiah yang diketik user: "150.000", "150000", "150rb", "1,5jt". */
export function parseIdr(str: string): number {
  const t = str.toLowerCase().replace(/rp|\s/g, '');
  const m = t.match(/^([\d.,]+)(rb|ribu|k|jt|juta)?$/);
  if (!m) return NaN;
  const mult = m[2] === 'rb' || m[2] === 'ribu' || m[2] === 'k' ? 1e3 : m[2] ? 1e6 : 1;
  let num = m[1];
  // format Indonesia: titik = ribuan, koma = desimal
  num = num.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return +num * mult;
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
/** Angka setting (TP/SL/trailing): 14 → "14", 12.5 → "12,5". */
export function fmtSet(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return String(+v.toFixed(2)).replace('.', ',');
}
