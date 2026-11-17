import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, start, stop, step, onDisconnect, onReconnect, pauseStale, portfolio } from '../src/engine';
import { sma, rsi } from '../src/indicators';
import type { BotConfig, BotState, Tick } from '../src/types';

const D = (usd: number) => Math.round(usd * 10000);          // dollars -> price4
const base: BotConfig = { id: 'b1', symbol: 'AAPL', budgetCents: 100000, entry: { trigger: 'price_at', price4: D(100) },
  exit: {}, feeBps: 0, feeMinCents: 0, slippageBps: 0, maxOpenPositions: 1, maxStaleMs: 60_000 };
const tk = (ts: number, usd: number, ind?: Tick['indicators']): Tick => ({ symbol: 'AAPL', ts, price4: D(usd), indicators: ind });
const run = (cfg: BotConfig, ticks: Tick[], cash = 1_000_000): BotState =>
  ticks.reduce((s, t) => step(s, cfg, t), start(newState(cash), 0));
const types = (s: BotState) => s.events.map(e => e.type);

test('entry price_at: crossing opens exactly one position, cash debited exactly', () => {
  const s = run(base, [tk(1, 99), tk(2, 100), tk(3, 101)]);
  assert.equal(s.positions.length, 1); assert.equal(s.positions[0].qty, 10);
  assert.equal(s.cashCents, 1_000_000 - 100000);
});
test('entry price_at: no entry if price never reaches level', () => {
  assert.equal(run(base, [tk(1, 95), tk(2, 98)]).positions.length, 0);
});
test('entry above / below fire on transition only (no re-entry loop)', () => {
  const up = { ...base, entry: { trigger: 'above' as const, price4: D(100) }, exit: { stopLossBps: 500 }, maxOpenPositions: 1 };
  const s = run(up, [tk(1, 99), tk(2, 101), tk(3, 90), tk(4, 91)]);   // SL hit at 90; 91 is below level -> no entry
  assert.equal(s.tradeSeq, 1); assert.equal(s.closed.length, 1);
  const dn = { ...base, entry: { trigger: 'below' as const, price4: D(100) } };
  assert.equal(run(dn, [tk(1, 101), tk(2, 99), tk(3, 98), tk(4, 97)]).tradeSeq, 1);
});
test('RSI / SMA extra conditions block when false or missing, allow when true', () => {
  const cfg = { ...base, entry: { trigger: 'below' as const, price4: D(100), rsiBelow: 30, priceAboveSma: false } };
  assert.equal(run(cfg, [tk(1, 101), tk(2, 99, { rsi: 45 })]).positions.length, 0);
  assert.equal(run(cfg, [tk(1, 101), tk(2, 99)]).positions.length, 0);          // missing indicator -> no guess
  assert.equal(run(cfg, [tk(1, 101), tk(2, 99, { rsi: 25 })]).positions.length, 1);
  const sm = { ...base, entry: { trigger: 'price_at' as const, price4: D(100), priceAboveSma: true } };
  assert.equal(run(sm, [tk(1, 99), tk(2, 100, { sma: D(101) })]).positions.length, 0);
  assert.equal(run(sm, [tk(1, 99), tk(2, 100, { sma: D(99) })]).positions.length, 1);
});
test('above/below: condition true but RSI missing at first -> enters when RSI becomes available (combined-edge)', () => {
  const cfg = { ...base, entry: { trigger: 'below' as const, price4: D(100), rsiBelow: 30 } };
  assert.equal(run(cfg, [tk(1, 99), tk(2, 98, { rsi: 20 })]).positions.length, 1);
  assert.equal(run(cfg, [tk(1, 99), tk(2, 98, { rsi: 20 }), tk(3, 97, { rsi: 10 })]).tradeSeq, 1);   // no second entry while still true
});
test('pauseStale pauses a running bot only', () => {
  const s = run(base, [tk(1, 99)]); const p = pauseStale(s, 99); assert.equal(p.status, 'paused'); assert.ok(types(p).includes('DATA_STALE'));
  assert.deepEqual(pauseStale(p, 100), p);
});
test('Take Profit closes and computes P&L', () => {
  const cfg = { ...base, exit: { takeProfitBps: 500 } };
  const s = run(cfg, [tk(1, 99), tk(2, 100), tk(3, 104), tk(4, 105)]);
  assert.equal(s.closed.length, 1); assert.equal(s.closed[0].reason, 'TAKE_PROFIT');
  assert.equal(s.closed[0].netPnlCents, 5000); assert.equal(s.cashCents, 1_005_000);
});
test('Stop Loss closes and computes loss', () => {
  const cfg = { ...base, exit: { stopLossBps: 300 } };
  const s = run(cfg, [tk(1, 99), tk(2, 100), tk(3, 98), tk(4, 97)]);
  assert.equal(s.closed[0].reason, 'STOP_LOSS'); assert.equal(s.closed[0].netPnlCents, -3000);
});
test('Trailing stop follows the high-water mark', () => {
  const cfg = { ...base, exit: { trailingStopBps: 500 } };
  const s = run(cfg, [tk(1, 99), tk(2, 100), tk(3, 120), tk(4, 115), tk(5, 114)]); // 120*0.95 = 114
  assert.equal(s.closed[0].reason, 'TRAILING_STOP'); assert.equal(s.closed[0].netPnlCents, 14000);
});
test('Time exit', () => {
  const cfg = { ...base, exit: { maxHoldMs: 1000 } };
  const s = run(cfg, [tk(1, 99), tk(2, 100), tk(500, 100), tk(1002, 100)]);
  assert.equal(s.closed[0].reason, 'TIME_EXIT');
});
test('Fees and slippage: hand-computed numbers', () => {
  const cfg = { ...base, feeBps: 20, slippageBps: 50, exit: { takeProfitBps: 500 } };
  const s = run(cfg, [tk(1, 99), tk(2, 100), tk(3, 110)]);
  // buy 100.5000, qty 9, cost 90450, fee 181 -> cash 1_000_000-90631
  const t = s.closed[0];
  assert.equal(t.qty, 9); assert.equal(t.entryPrice4, 1005000); assert.equal(t.exitPrice4, 1094500);
  assert.equal(t.netPnlCents, 7677); assert.equal(t.feesCents, 181 + 197);
  assert.equal(s.cashCents, 1_000_000 + 7677);
});
test('Insufficient funds: skip, log, no position', () => {
  const s = run(base, [tk(1, 99), tk(2, 100)], 5000);   // $50 < 1 share
  assert.equal(s.positions.length, 0); assert.ok(types(s).includes('ENTRY_SKIPPED'));
});
test('Max open positions and max total trades are enforced', () => {
  const cfg = { ...base, entry: { trigger: 'below' as const, price4: D(100) }, maxOpenPositions: 2, maxTotalTrades: 2 };
  // alternate across the level to create several edges
  const s = run(cfg, [tk(1, 101), tk(2, 99), tk(3, 101), tk(4, 99), tk(5, 101), tk(6, 99)]);
  assert.equal(s.tradeSeq, 2); assert.equal(s.positions.length, 2);
});
test('Duplicate / replayed / out-of-order ticks never create duplicate trades', () => {
  let s = start(newState(1_000_000), 0);
  for (const t of [tk(1, 99), tk(2, 100), tk(2, 100), tk(2, 100), tk(1, 99)]) s = step(s, base, t);
  assert.equal(s.tradeSeq, 1); assert.equal(s.positions.length, 1);
  assert.equal(new Set(s.positions.map(p => p.id)).size, s.positions.length);
});
test('Stale data pauses the bot; disconnect pauses; reconnect resumes; paused bot does not trade', () => {
  let s = start(newState(1_000_000), 0);
  s = step(s, base, tk(1, 99), 1);
  s = step(s, base, tk(2, 100), 2 + 120_000);               // quote is 2 min old
  assert.equal(s.status, 'paused'); assert.equal(s.positions.length, 0); assert.ok(types(s).includes('DATA_STALE'));
  s = onReconnect(s, 200_000); assert.equal(s.status, 'running');
  s = onDisconnect(s, 300_000); assert.equal(s.status, 'paused');
  s = step(s, base, tk(300_001, 100), 300_001); assert.equal(s.positions.length, 0);
  s = onReconnect(s, 400_000); assert.deepEqual(types(s).filter(t => t.startsWith('DATA_')),
    ['DATA_STALE', 'DATA_RECONNECTED', 'DATA_DISCONNECTED', 'DATA_RECONNECTED']);
});
test('Restart recovery: JSON round-trip mid-trade continues identically', () => {
  const cfg = { ...base, exit: { takeProfitBps: 500 } };
  const ticks = [tk(1, 99), tk(2, 100), tk(3, 102), tk(4, 106), tk(5, 90)];
  const before = ticks.slice(0, 3).reduce((s, t) => step(s, cfg, t), start(newState(1_000_000), 0));
  const restored: BotState = JSON.parse(JSON.stringify(before));            // "app/server restart"
  const a = ticks.slice(3).reduce((s, t) => step(s, cfg, t), restored);
  const b = ticks.reduce((s, t) => step(s, cfg, t), start(newState(1_000_000), 0));
  assert.deepEqual(a, b);
});
test('Stopped bot is inert; stop preserves state', () => {
  let s = run(base, [tk(1, 99), tk(2, 100)]); s = stop(s, 3);
  const after = step(s, base, tk(4, 200)); assert.deepEqual(after, s);
});
test('PAPER guard: any non-PAPER mode throws', () => {
  const bad = { ...newState(1000), mode: 'LIVE' } as unknown as BotState;
  assert.throws(() => step(bad, base, tk(1, 100)), /PAPER only/);
  assert.throws(() => start(bad, 1), /PAPER only/);
});
test('Accounting identity: equity = opening + realized + unrealized', () => {
  const cfg = { ...base, feeBps: 10, slippageBps: 20, exit: { takeProfitBps: 300 } };
  const s = run(cfg, [tk(1, 99), tk(2, 100), tk(3, 104), tk(4, 99), tk(5, 100), tk(6, 101)]);
  const p = portfolio(s, D(101));
  assert.equal(p.equityCents, s.openingCashCents + p.realizedCents + p.unrealizedCents);
});
test('Indicators', () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5); assert.equal(sma([1], 2), undefined);
  assert.equal(rsi([1, 2, 3, 4, 5, 6], 5), 100); assert.equal(rsi([1, 2], 5), undefined);
  // hand-computed Wilder n=2: ag=.5, al=.5 -> then +1 step: ag=.75, al=.25 -> RS=3 -> RSI=75
  assert.equal(rsi([1, 2, 1, 2], 2), 75);
});
