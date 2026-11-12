import { useMemo } from 'react';
import { features, matchPatterns, MIN_PATTERN_N, patternText } from '../lib/patterns';
import type { Dir, SetupKey, TF, TFState } from '../lib/signals';
import { useApp } from '../store/app';

/** Peringatan pola dari riwayat trade lu sendiri. Tidak memblokir order. */
export function PatternAlert(p: { symbol: string; setupKey?: SetupKey | null; dir: Dir; tf: Partial<Record<TF, TFState | null>>; leverage: number; compact?: boolean }) {
  const book = useApp((s) => s.book);
  const btc = useApp((s) => s.scan.result?.btc?.trend ?? null);
  const m = useMemo(
    () => matchPatterns(features({ setupKey: p.setupKey, dir: p.dir, tf: p.tf, btcTrend: btc, leverage: p.leverage, symbol: p.symbol }), book),
    [book, btc, p.setupKey, p.dir, p.tf, p.leverage, p.symbol],
  );
  if (!m.bad && !m.good) return null;
  return (
    <div className={`space-y-0.5 ${p.compact ? 'text-[11px]' : 'text-xs'}`}>
      {m.bad && (
        <div className={m.bad.winRate <= 0.2 ? 'font-semibold text-down' : 'text-down'}>
          ⚠️ Pola ini kena SL {m.bad.n - m.bad.wins} dari {m.bad.n} kali: {patternText(m.bad)}
        </div>
      )}
      {m.good && (
        <div className="text-up">
          ✅ Pola ini kena TP {m.good.wins} dari {m.good.n} kali: {patternText(m.good)}
        </div>
      )}
    </div>
  );
}

export { MIN_PATTERN_N };
