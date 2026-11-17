import { start, stop, step, onDisconnect, onReconnect, pauseStale, newState } from '../../engine/src/engine';
import type { BotConfig, BotEvent, BotState, Tick } from '../../engine/src/types';
import type { MarketDataProvider } from './provider';
import type { SqlRepo } from './repo';
import { QuoteStore } from './quotes';

export class Runner {
  private feedSubs = new Map<string, { off: () => void; bots: Set<string> }>();
  private lastSeen = new Map<string, number>(); private up = true; private q = new Map<string, Promise<unknown>>();
  readonly store = new QuoteStore();
  readonly listeners = new Set<(botId: string, e: BotEvent, index: number) => void>();
  constructor(private repo: SqlRepo, private feed: MarketDataProvider, private clock = () => Date.now()) { this.feed.onConnection(up => this.onConn(up)); }
  /** Serialises all work per bot: async storage must never interleave read-modify-write cycles. */
  private enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.q.get(id) ?? Promise.resolve()).catch(() => {}).then(fn); this.q.set(id, run.catch(() => {})); return run;
  }
  async idle() { for (;;) { const snap = [...this.q.values()]; await Promise.all(snap); const now = [...this.q.values()]; if (now.length === snap.length && now.every((p, i) => p === snap[i])) return; } }
  async recover() {
    for (const b of await this.repo.active()) {
      try { this.attach(b.id, b.config.symbol); }
      catch (e) { console.error('recover: cannot attach feed for bot', b.id, String(e));        // never leave a bot "running" without data
        await this.enqueue(b.id, async () => { const f = await this.repo.get(b.id); if (f) await this.persist(f.id, f.state, pauseStale(f.state, this.clock())); }); }
    } }
  async create(userId: string, id: string, config: BotConfig, openingCashCents: number) { await this.repo.insert({ id, userId, config, state: newState(openingCashCents) }); }
  start(id: string) { return this.enqueue(id, async () => { const b = await this.repo.get(id); if (!b) throw new Error('not found');
    if (b.state.status === 'running') return; this.attach(id, b.config.symbol);                               // may throw FeedLimitError: nothing has been persisted yet
    try { await this.persist(id, b.state, start(b.state, this.clock())); } catch (e) { this.detach(id, b.config.symbol); throw e; } }); }
  stop(id: string) { return this.enqueue(id, async () => { const b = await this.repo.get(id); if (!b) throw new Error('not found');
    this.detach(id, b.config.symbol); await this.persist(id, b.state, stop(b.state, this.clock())); }); }
  async checkStale() { const now = this.clock();
    for (const b of await this.repo.active()) if (b.state.status === 'running' && now - (this.lastSeen.get(b.id) ?? now) > b.config.maxStaleMs)
      await this.enqueue(b.id, async () => { const f = await this.repo.get(b.id); if (f) await this.persist(b.id, f.state, pauseStale(f.state, now)); }); }
  private attach(id: string, symbol: string) {
    this.lastSeen.set(id, this.clock()); let s = this.feedSubs.get(symbol);
    if (!s) { s = { off: this.feed.subscribe(symbol, t => this.onTick(symbol, t)), bots: new Set() }; this.feedSubs.set(symbol, s); } s.bots.add(id);
  }
  private detach(id: string, symbol: string) { const s = this.feedSubs.get(symbol); if (!s) return; s.bots.delete(id); if (!s.bots.size) { s.off(); this.feedSubs.delete(symbol); } }
  private onTick(symbol: string, raw: Tick) {
    this.store.update(raw); const tick: Tick = { ...raw, indicators: this.store.indicators(symbol) };
    for (const id of [...(this.feedSubs.get(symbol)?.bots ?? [])]) this.enqueue(id, async () => {
      const b = await this.repo.get(id); if (!b) return; const now = this.clock(); this.lastSeen.set(id, now); let st: BotState = b.state;
      if (st.status === 'paused' && this.up && now - tick.ts <= b.config.maxStaleMs) st = onReconnect(st, now);
      await this.persist(id, b.state, step(st, b.config, tick, now));
    }).catch(e => console.error('tick error', id, e));
  }
  private onConn(up: boolean) { this.up = up;
    this.repo.active().then(bs => bs.forEach(b => this.enqueue(b.id, async () => { const f = await this.repo.get(b.id); if (!f) return; if (up) this.lastSeen.set(b.id, this.clock());
      await this.persist(b.id, f.state, up ? onReconnect(f.state, this.clock()) : onDisconnect(f.state, this.clock())); }).catch(e => console.error('conn error', e)))); }
  private async persist(id: string, before: BotState, after: BotState) {
    if (after === before) return; await this.repo.save(id, after);
    after.events.slice(before.events.length).forEach((e, i) => this.listeners.forEach(l => l(id, e, before.events.length + i)));
  }
}
