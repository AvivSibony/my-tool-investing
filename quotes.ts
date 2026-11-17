import type { Tick, Price4 } from '../../engine/src/types';
import { rsi, sma } from '../../engine/src/indicators';
export interface Bar { t: number; o: Price4; h: Price4; l: Price4; c: Price4; v: number }
interface Sess { open: Price4; high: Price4; low: Price4; last: Price4; volume: number; firstTs: number; lastTs: number }
/** In-memory quotes built ONLY from ticks the server actually received. Window = since server start (not exchange-day OHLC). */
export class QuoteStore {
  private bars = new Map<string, Bar[]>(); private sess = new Map<string, Sess>();
  constructor(private maxBars = 500) {}
  update(t: Tick) {
    const s = this.sess.get(t.symbol);
    if (s && t.ts < s.lastTs) return;                                  // out-of-order: ignore
    const v = t.size ?? 0;
    if (!s) this.sess.set(t.symbol, { open: t.price4, high: t.price4, low: t.price4, last: t.price4, volume: v, firstTs: t.ts, lastTs: t.ts });
    else { s.high = Math.max(s.high, t.price4); s.low = Math.min(s.low, t.price4); s.last = t.price4; s.volume += v; s.lastTs = t.ts; }
    const m = Math.floor(t.ts / 60000) * 60000; const arr = this.bars.get(t.symbol) ?? []; const b = arr[arr.length - 1];
    if (b && b.t === m) { b.h = Math.max(b.h, t.price4); b.l = Math.min(b.l, t.price4); b.c = t.price4; b.v += v; }
    else { arr.push({ t: m, o: t.price4, h: t.price4, l: t.price4, c: t.price4, v }); if (arr.length > this.maxBars) arr.shift(); }
    this.bars.set(t.symbol, arr);
  }
  /** RSI(14) and SMA(20) over 1-minute closes. Undefined until enough bars exist (no guessing). */
  indicators(symbol: string): { rsi?: number; sma?: Price4 } {
    const closes = (this.bars.get(symbol) ?? []).map(b => b.c); const m = sma(closes, 20);
    return { rsi: rsi(closes, 14), sma: m === undefined ? undefined : Math.round(m) };
  }
  snapshot(symbol: string, nBars = 120) {
    const s = this.sess.get(symbol); if (!s) return null; const ind = this.indicators(symbol);
    return { symbol, window: 'since_server_start', session: s, bars: (this.bars.get(symbol) ?? []).slice(-nBars), indicators: { rsi14: ind.rsi ?? null, sma20: ind.sma ?? null, barInterval: '1m' } };
  }
}
