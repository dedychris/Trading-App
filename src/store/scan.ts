import { runScan } from '../lib/scanner';
import { beep, systemNotify } from '../lib/notify';
import { useApp } from './app';

let running: Promise<void> | null = null;

/** Scan 20 koin market cap besar + 5 top volume. Dipakai tombol Scan Now dan auto trading (scan bersamaan digabung jadi satu). */
export function doScan(opts: { quiet?: boolean } = {}): Promise<void> {
  if (running) return running;
  running = scanOnce(opts).finally(() => {
    running = null;
  });
  return running;
}

async function scanOnce({ quiet }: { quiet?: boolean }) {
  const set = useApp.setState;
  set({ scan: { ...useApp.getState().scan, status: 'running', done: 0, total: 0, error: undefined } });
  try {
    const result = await runScan((done, total) => set({ scan: { ...useApp.getState().scan, done, total } }));
    set({ scan: { status: 'done', done: result.rows.length, total: result.rows.length, result } });
    const nGold = result.rows.filter((r) => r.setup?.key === 'GOLD').length;
    const s = useApp.getState().book.settings;
    if (!quiet && s.sound) beep('info');
    if (s.notify && nGold) systemNotify('Scan selesai', `${nGold} koin ⭐ Golden`);
    if (result.failed.length) useApp.getState().toast(`${result.failed.length} koin gagal dimuat: ${result.failed.slice(0, 5).join(', ')}`, 'bad');
  } catch (e) {
    set({ scan: { ...useApp.getState().scan, status: 'error', error: (e as Error).message } });
  }
}
