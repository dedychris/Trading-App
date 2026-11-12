import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribePrices } from '../src/lib/binance';

// WebSocket palsu: kita yang atur kapan open / kirim pesan / diam (zombie).
class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static all: FakeWS[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(prices: Record<string, number>) {
    this.onmessage?.({ data: JSON.stringify(Object.entries(prices).map(([s, c]) => ({ s, c: String(c) }))) });
  }
  close() {
    this.readyState = 3; // zombie: onclose sengaja TIDAK dipanggil
  }
}

describe('harga live: watchdog WebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWS.all = [];
    const target = { addEventListener() {}, removeEventListener() {} };
    vi.stubGlobal('WebSocket', FakeWS);
    vi.stubGlobal('document', { ...target, visibilityState: 'visible' });
    vi.stubGlobal('window', target);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ symbol: 'BNBUSDT', price: '700' }]), { headers: { 'content-type': 'application/json' } })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('socket yang diam (zombie) dibuang → polling → reconnect', async () => {
    const statuses: string[] = [];
    const got: Record<string, number>[] = [];
    const unsub = subscribePrices((p) => got.push(p), (s) => statuses.push(s));
    FakeWS.all[0].open();
    FakeWS.all[0].send({ BNBUSDT: 673 });
    expect(statuses.at(-1)).toBe('live');

    // socket berhenti kirim data tanpa event close
    await vi.advanceTimersByTimeAsync(21_000);
    expect(statuses).toContain('polling');
    expect(got.some((p) => p.BNBUSDT === 700)).toBe(true); // harga tetap datang lewat polling
    expect(FakeWS.all.length).toBe(2); // sudah reconnect

    FakeWS.all[1].open();
    FakeWS.all[1].send({ BNBUSDT: 671 });
    expect(statuses.at(-1)).toBe('live');
    expect(got.at(-1)?.BNBUSDT).toBe(671);
    unsub();
  });

  it('socket sehat tidak diganggu', async () => {
    const statuses: string[] = [];
    const unsub = subscribePrices(() => {}, (s) => statuses.push(s));
    FakeWS.all[0].open();
    for (let i = 0; i < 30; i++) {
      FakeWS.all[0].send({ BNBUSDT: 670 + i });
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(FakeWS.all.length).toBe(1);
    expect(statuses).toEqual(['live']);
    unsub();
  });
});
