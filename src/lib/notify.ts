let ctx: AudioContext | null = null;

export function beep(kind: 'good' | 'bad' | 'info' = 'info') {
  try {
    ctx ??= new AudioContext();
    const notes = kind === 'good' ? [660, 880] : kind === 'bad' ? [440, 300] : [700];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      const t0 = ctx!.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      o.connect(g).connect(ctx!.destination);
      o.start(t0);
      o.stop(t0 + 0.16);
    });
  } catch {
    /* audio tidak tersedia */
  }
}

export async function requestNotifyPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

export async function systemNotify(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: title + body });
    else new Notification(title, { body, icon: '/icon-192.png' });
  } catch {
    /* abaikan */
  }
}
