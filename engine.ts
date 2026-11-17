import type { BotConfig, BotState, BotEvent, Tick, Position, ExitReason, EventType, Cents, Price4 } from './types';

export function newState(openingCashCents: Cents): BotState {
  return { mode: 'PAPER', status: 'stopped', openingCashCents, cashCents: openingCashCents,
    positions: [], closed: [], events: [], lastTickTs: 0, tradeSeq: 0 };
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
function assertPaper(s: BotState) {
  if (s.mode !== 'PAPER') throw new Error('REAL-MONEY MODE IS NOT SUPPORTED: engine is PAPER only');
}
function log(s: BotState, ts: number, type: EventType, message: string, price4?: Price4) {
  const e: BotEvent = { ts, type, message, ...(price4 !== undefined ? { price4 } : {}) };
  s.events.push(e);
}
const fee = (c: BotConfig, notional: Cents) => Math.max(c.feeMinCents, Math.round((notional * c.feeBps) / 10000));
const valueCents = (qty: number, p4: Price4) => Math.round((qty * p4) / 100);

export function start(state: BotState, ts: number): BotState {
  assertPaper(state); const s = clone(state);
  s.status = 'running'; log(s, ts, 'BOT_STARTED', 'Bot started (PAPER)'); return s;
}
export function stop(state: BotState, ts: number): BotState {
  assertPaper(state); const s = clone(state);
  s.status = 'stopped'; log(s, ts, 'BOT_STOPPED', 'Bot stopped'); return s;
}
export function onDisconnect(state: BotState, ts: number): BotState {
  assertPaper(state); const s = clone(state);
  if (s.status === 'running') { s.status = 'paused'; log(s, ts, 'DATA_DISCONNECTED', 'Market data disconnected; bot paused'); }
  return s;
}
export function pauseStale(state: BotState, ts: number): BotState {
  assertPaper(state); const s = clone(state);
  if (s.status === 'running') { s.status = 'paused'; log(s, ts, 'DATA_STALE', 'No market data received; bot paused'); }
  return s;
}
export function onReconnect(state: BotState, ts: number): BotState {
  assertPaper(state); const s = clone(state);
  if (s.status === 'paused') { s.status = 'running'; log(s, ts, 'DATA_RECONNECTED', 'Market data restored; bot resumed'); }
  return s;
}

function extrasOk(c: BotConfig, t: Tick): boolean {
  if (c.entry.rsiBelow !== undefined) { const r = t.indicators?.rsi; if (r === undefined || !(r < c.entry.rsiBelow)) return false; }
  if (c.entry.priceAboveSma) { const m = t.indicators?.sma; if (m === undefined || !(t.price4 > m)) return false; }
  return true;
}
/** above/below fire when the COMBINED condition (level + RSI/SMA) turns true; price_at fires on a crossing. */
function entryMet(c: BotConfig, s: BotState, t: Tick): { fire: boolean; cond: boolean } {
  const { trigger, price4: lvl } = c.entry; const last = s.lastPrice4;
  if (trigger === 'price_at') {
    const edge = last === undefined ? t.price4 === lvl
      : (last < lvl && t.price4 >= lvl) || (last > lvl && t.price4 <= lvl) || (last !== lvl && t.price4 === lvl);
    const ok = edge && extrasOk(c, t); return { fire: ok, cond: false };
  }
  const cond = (trigger === 'above' ? t.price4 > lvl : t.price4 < lvl) && extrasOk(c, t);
  return { fire: cond && !s.prevCond, cond };
}

function exitReason(c: BotConfig, p: Position, t: Tick): ExitReason | null {
  const x = c.exit;
  if (x.stopLossBps !== undefined && t.price4 * 10000 <= p.entryPrice4 * (10000 - x.stopLossBps)) return 'STOP_LOSS';
  if (x.takeProfitBps !== undefined && t.price4 * 10000 >= p.entryPrice4 * (10000 + x.takeProfitBps)) return 'TAKE_PROFIT';
  if (x.trailingStopBps !== undefined && t.price4 * 10000 <= p.highWater4 * (10000 - x.trailingStopBps)) return 'TRAILING_STOP';
  if (x.maxHoldMs !== undefined && t.ts - p.entryTs >= x.maxHoldMs) return 'TIME_EXIT';
  return null;
}

function closePosition(s: BotState, c: BotConfig, p: Position, t: Tick, reason: ExitReason) {
  const sell4 = Math.floor((t.price4 * (10000 - c.slippageBps)) / 10000);
  const gross = valueCents(p.qty, sell4); const f = fee(c, gross); const net = gross - f;
  s.cashCents += net;
  s.positions = s.positions.filter(q => q.id !== p.id);
  const pnl = net - (p.costCents + p.entryFeeCents);
  s.closed.push({ id: p.id, entryTs: p.entryTs, exitTs: t.ts, qty: p.qty, entryPrice4: p.entryPrice4,
    exitPrice4: sell4, reason, netPnlCents: pnl, feesCents: p.entryFeeCents + f });
  log(s, t.ts, 'POSITION_CLOSED', `${reason}: net P&L ${pnl} cents`, sell4);
}

/** Pure: returns a new state. Never touches I/O. */
export function step(state: BotState, cfg: BotConfig, tick: Tick, now: number = tick.ts): BotState {
  assertPaper(state);
  if (state.status !== 'running' || tick.symbol !== cfg.symbol) return state;
  if (tick.ts <= state.lastTickTs) return state;           // duplicate / out-of-order tick: ignore
  const s = clone(state);
  if (now - tick.ts > cfg.maxStaleMs) {
    s.status = 'paused'; log(s, now, 'DATA_STALE', 'Stale market data; bot paused'); return s;
  }
  let exited = false;
  for (const p of [...s.positions]) {
    p.highWater4 = Math.max(p.highWater4, tick.price4);
    const r = exitReason(cfg, p, tick);
    if (r) { closePosition(s, cfg, p, tick, r); exited = true; }
  }
  const inWindow = !cfg.window || (tick.ts >= cfg.window.fromMs && tick.ts <= cfg.window.toMs);
  const capOk = cfg.maxTotalTrades === undefined || s.tradeSeq < cfg.maxTotalTrades;
  const em = entryMet(cfg, s, tick);
  if (!exited && inWindow && capOk && s.positions.length < cfg.maxOpenPositions && em.fire) {
    log(s, tick.ts, 'ENTRY_CONDITION_MET', 'Entry condition met', tick.price4);
    const buy4 = Math.ceil((tick.price4 * (10000 + cfg.slippageBps)) / 10000);
    const avail = Math.min(cfg.budgetCents, s.cashCents);
    let qty = Math.floor((avail * 100) / buy4);
    while (qty > 0 && valueCents(qty, buy4) + fee(cfg, valueCents(qty, buy4)) > avail) qty--;
    if (qty < 1) log(s, tick.ts, 'ENTRY_SKIPPED', 'Insufficient virtual funds', tick.price4);
    else {
      const cost = valueCents(qty, buy4); const f = fee(cfg, cost);
      s.tradeSeq += 1; const id = `${cfg.id}:${s.tradeSeq}`;
      if (s.positions.some(p => p.id === id)) throw new Error('duplicate position id');
      s.cashCents -= cost + f;
      s.positions.push({ id, entryTs: tick.ts, entryPrice4: buy4, qty, costCents: cost, entryFeeCents: f, highWater4: tick.price4 });
      log(s, tick.ts, 'POSITION_OPENED', `Bought ${qty} @ ${buy4}`, buy4);
    }
  }
  s.lastTickTs = tick.ts; s.lastPrice4 = tick.price4; s.prevCond = em.cond;
  return s;
}

export function portfolio(s: BotState, mark4: Price4) {
  const open = s.positions.reduce((a, p) => a + valueCents(p.qty, mark4), 0);
  const realized = s.closed.reduce((a, t) => a + t.netPnlCents, 0);
  const equity = s.cashCents + open;
  return { equityCents: equity, realizedCents: realized, unrealizedCents: equity - s.openingCashCents - realized };
}
