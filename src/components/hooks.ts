import { useMemo } from 'react';
import { winrate, type ActiveFilters, type Winrate } from '../lib/backtest';
import type { Dir, SetupKey } from '../lib/signals';
import { useApp } from '../store/app';
import { positionLedger } from '../store/book';

export function useActiveFilters(): ActiveFilters {
  const f = useApp((s) => s.book.settings.filters);
  return useMemo(() => ({ volume: f.volume, ema200: f.ema200, bollinger: f.bollinger, atr: f.atr }), [f]);
}

export function useWinrate(symbol: string, key: SetupKey | undefined, dir: Dir | undefined, leverage: number, filters?: ActiveFilters): Winrate | null {
  const series = useApp((s) => s.scan.result?.series);
  const active = useActiveFilters();
  const f = filters ?? active;
  return useMemo(() => (series && key && dir ? winrate(series, symbol, key, dir, leverage, f) : null), [series, symbol, key, dir, leverage, f]);
}

/** Opsi D: winrate dari paper trade lu sendiri untuk setup & arah yang sama. */
export function useMyWinrate(key: SetupKey | undefined, dir: Dir | undefined) {
  const book = useApp((s) => s.book);
  return useMemo(() => {
    let w = 0;
    let n = 0;
    for (const p of Object.values(book.positions)) {
      if (p.status !== 'closed' || !key || p.snapEntry?.setup?.key !== key || p.dir !== dir) continue;
      n++;
      if (positionLedger(book, p.id).net > 0) w++;
    }
    return { w, n };
  }, [book, key, dir]);
}
