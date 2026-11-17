import type { Tick } from '../../engine/src/types';
export class FeedLimitError extends Error { constructor() { super('market-data symbol limit reached'); } }
export interface MarketDataProvider {
  readonly name: string; readonly freshness: 'REALTIME' | 'DELAYED' | 'HISTORICAL' | 'DEMO';
  subscribe(symbol: string, cb: (t: Tick) => void): () => void;
  onConnection(cb: (up: boolean) => void): () => void;
}
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** DEMO data only: deterministic random walk. Never presented as real market data. */
export class MockProvider implements MarketDataProvider {
  readonly name = 'MOCK'; readonly freshness = 'DEMO' as const;
  private subs = new Map<string, Set<(t: Tick) => void>>(); private conn = new Set<(u: boolean) => void>();
  private px = new Map<string, number>(); private r: () => number; private ts = 0;
  constructor(seed = 1, private start = 100) { this.r = rng(seed); }
  subscribe(sym: string, cb: (t: Tick) => void) {
    if (!this.subs.has(sym)) this.subs.set(sym, new Set()); this.subs.get(sym)!.add(cb);
    return () => this.subs.get(sym)!.delete(cb);
  }
  onConnection(cb: (u: boolean) => void) { this.conn.add(cb); return () => this.conn.delete(cb); }
  symbols() { return [...this.subs].filter(([, v]) => v.size > 0).map(([k]) => k); }
  setConnected(up: boolean) { this.conn.forEach(c => c(up)); }
  /** advance one step (random walk) or push an explicit price */
  tick(sym: string, ts: number, usd?: number) {
    const prev = this.px.get(sym) ?? this.start;
    const p = usd ?? Math.max(0.01, prev * (1 + (this.r() - 0.5) * 0.02));
    this.px.set(sym, p);
    this.subs.get(sym)?.forEach(cb => cb({ symbol: sym, ts, price4: Math.round(p * 10000) }));
  }
}
