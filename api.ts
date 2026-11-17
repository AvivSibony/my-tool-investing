export interface Portfolio { mode: 'PAPER'; status: 'running' | 'paused' | 'stopped'; equityCents: number; realizedCents: number; unrealizedCents: number;
  openPositions: any[]; closedTrades: any[]; data: { source: string; freshness: 'REALTIME' | 'DELAYED' | 'HISTORICAL' | 'DEMO'; lastQuoteTs: number | null; lastPrice4: number | null } }
export interface Market { source: string; freshness: Portfolio['data']['freshness'];
  quote: null | { symbol: string; window: string; session: { open: number; high: number; low: number; last: number; volume: number; firstTs: number; lastTs: number };
    bars: { t: number; o: number; h: number; l: number; c: number; v: number }[]; indicators: { rsi14: number | null; sma20: number | null; barInterval: string } } }
export interface BotEvent { ts: number; type: string; message: string; price4?: number }
export class ApiError extends Error { constructor(public status: number, public body: any) { super(`HTTP ${status}`); } }
/** Register or log in. Returns an opaque session token; the password is never stored on the device. */
export async function authenticate(baseUrl: string, mode: 'register' | 'login', email: string, password: string): Promise<string> {
  const r = await fetch(`${baseUrl}/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new ApiError(r.status, j); return j.token as string;
}
export class Api {
  constructor(private baseUrl: string, private token: string) {}
  private async req<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const r = await fetch(this.baseUrl + path, { method: init.method ?? 'GET', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new ApiError(r.status, j); return j as T;
  }
  registerPush = (token: string, lang: string) => this.req('/push/register', { method: 'POST', body: { token, lang } });
  unregisterPush = (token: string) => this.req('/push/unregister', { method: 'POST', body: { token } });
  logout = () => this.req('/auth/logout', { method: 'POST' });
  createBot = (payload: unknown) => this.req<{ id: string; mode: 'PAPER' }>('/bots', { method: 'POST', body: payload });
  start = (id: string) => this.req(`/bots/${id}/start`, { method: 'POST' });
  stop = (id: string) => this.req(`/bots/${id}/stop`, { method: 'POST' });
  portfolio = (id: string) => this.req<Portfolio>(`/bots/${id}/portfolio`);
  market = (id: string) => this.req<Market>(`/bots/${id}/market`);
  events = (id: string) => this.req<{ events: BotEvent[] }>(`/bots/${id}/events`);
  /** WebSocket with exponential backoff reconnect. React Native's WebSocket accepts a headers option (3rd arg). */
  stream(onEvent: (m: { botId: string; event: BotEvent }) => void, onStatus: (up: boolean) => void) {
    let ws: any, tries = 0, closed = false, timer: any;
    const open = () => {
      ws = new (WebSocket as any)(this.baseUrl.replace(/^http/, 'ws'), undefined, { headers: { authorization: `Bearer ${this.token}` } });
      ws.onopen = () => { tries = 0; onStatus(true); };
      ws.onmessage = (m: any) => { try { onEvent(JSON.parse(m.data)); } catch {} };
      ws.onclose = () => { onStatus(false); if (!closed) timer = setTimeout(open, Math.min(30000, 1000 * 2 ** tries++)); };
    };
    open(); return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }
}
