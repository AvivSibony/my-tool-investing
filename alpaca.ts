import WebSocket from 'ws';
import type { Tick } from '../../engine/src/types';
import { FeedLimitError, type MarketDataProvider } from './provider';
/** Alpaca market-data stream (data only: no trading/broker endpoints are used or imported). Free plan = IEX feed, 30 symbols. */
export class AlpacaProvider implements MarketDataProvider {
  readonly name = 'ALPACA/IEX'; readonly freshness = 'REALTIME' as const;
  private ws?: WebSocket; private subs = new Map<string, Set<(t: Tick) => void>>(); private conn = new Set<(u: boolean) => void>();
  private authed = false; private closed = false; private tries = 0; private timer?: NodeJS.Timeout;
  fatal?: string;                                   // set on auth failure; no reconnect loop that would hammer the API
  constructor(private o: { key: string; secret: string; url?: string; maxSymbols?: number; baseDelayMs?: number }) {
    if (!o.key || !o.secret) throw new Error('Alpaca key/secret missing'); this.open();
  }
  private open() {
    const ws = this.ws = new WebSocket(this.o.url ?? 'wss://stream.data.alpaca.markets/v2/iex');
    ws.on('message', d => { try { const a = JSON.parse(String(d)); for (const m of Array.isArray(a) ? a : [a]) this.handle(m); } catch { /* ignore malformed */ } });
    ws.on('error', () => { /* 'close' follows */ });
    ws.on('close', () => { const was = this.authed; this.authed = false; if (was) this.conn.forEach(c => c(false));
      if (!this.closed && !this.fatal) this.timer = setTimeout(() => this.open(), Math.min(30000, (this.o.baseDelayMs ?? 1000) * 2 ** this.tries++)); });
  }
  private send(x: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(x)); }
  private handle(m: any) {
    if (m.T === 'success' && m.msg === 'connected') this.send({ action: 'auth', key: this.o.key, secret: this.o.secret });
    else if (m.T === 'success' && m.msg === 'authenticated') {
      this.authed = true; this.tries = 0; const s = [...this.subs.keys()]; if (s.length) this.send({ action: 'subscribe', trades: s });
      this.conn.forEach(c => c(true));
    } else if (m.T === 'error') { if (m.code === 402 || m.code === 403) { this.fatal = `auth failed (${m.code})`; this.closed = true; this.ws?.close(); } }
    else if (m.T === 't' && typeof m.S === 'string' && typeof m.p === 'number' && m.p > 0) {
      const ts = Date.parse(m.t); if (Number.isNaN(ts)) return;
      this.subs.get(m.S)?.forEach(cb => cb({ symbol: m.S, ts, price4: Math.round(m.p * 10000), ...(typeof m.s === 'number' && m.s > 0 ? { size: m.s } : {}) }));
    }
  }
  subscribe(sym: string, cb: (t: Tick) => void) {
    if (!this.subs.has(sym)) {
      if (this.subs.size >= (this.o.maxSymbols ?? 30)) throw new FeedLimitError();
      this.subs.set(sym, new Set()); if (this.authed) this.send({ action: 'subscribe', trades: [sym] });
    }
    this.subs.get(sym)!.add(cb);
    return () => { const set = this.subs.get(sym); set?.delete(cb);
      if (set && set.size === 0) { this.subs.delete(sym); if (this.authed) this.send({ action: 'unsubscribe', trades: [sym] }); } };
  }
  onConnection(cb: (u: boolean) => void) { this.conn.add(cb); return () => this.conn.delete(cb); }
  close() { this.closed = true; clearTimeout(this.timer); this.ws?.close(); }
}
