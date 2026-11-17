import test from 'node:test'; import assert from 'node:assert/strict';
import { QuoteStore } from '../src/quotes'; import { validateBotInput } from '../src/validate'; import { createServer } from '../src/server'; import { rig } from './helpers';
const P = (usd: number) => Math.round(usd * 10000); const MIN = 60000;
const mkBot = (extra: any) => { const v = validateBotInput({ symbol: 'AAPL', budgetUsd: 1000, exit: {}, ...extra }); if (!v.ok) throw new Error(JSON.stringify(v)); return v; };

test('QuoteStore: 1-min OHLCV bars, session stats, out-of-order ignored', () => {
  const q = new QuoteStore(); const t0 = 10 * MIN;
  for (const [dt, p, sz] of [[0, 100, 5], [10_000, 103, 5], [20_000, 99, 10], [MIN + 1, 101, 1]] as const) q.update({ symbol: 'X', ts: t0 + dt, price4: P(p), size: sz });
  q.update({ symbol: 'X', ts: t0, price4: P(500), size: 1 });                        // old -> ignored
  const s = q.snapshot('X')!;
  assert.deepEqual(s.bars[0], { t: t0, o: P(100), h: P(103), l: P(99), c: P(99), v: 20 }); assert.equal(s.bars.length, 2);
  assert.deepEqual({ ...s.session }, { open: P(100), high: P(103), low: P(99), last: P(101), volume: 21, firstTs: t0, lastTs: t0 + MIN + 1 });
  assert.equal(s.window, 'since_server_start'); assert.equal(q.snapshot('NOPE'), null);
});
test('indicators are undefined until enough bars (no guessing), then computed from real closes', () => {
  const q = new QuoteStore(); for (let i = 0; i < 14; i++) q.update({ symbol: 'X', ts: i * MIN, price4: P(100 - i) });
  assert.equal(q.indicators('X').rsi, undefined); assert.equal(q.indicators('X').sma, undefined);
  q.update({ symbol: 'X', ts: 14 * MIN, price4: P(80) }); assert.equal(q.indicators('X').rsi, 0);                  // 15 bars, only losses
  for (let i = 15; i < 20; i++) q.update({ symbol: 'X', ts: i * MIN, price4: P(80) }); assert.ok(q.indicators('X').sma !== undefined);
});
const feedMinutes = (r: Awaited<ReturnType<typeof rig>>, prices: number[]) => prices.forEach((p, i) => { r.set(i * MIN); r.feed.tick('AAPL', i * MIN, p); });
test('runner feeds REAL RSI to the engine: falling market enters on RSI<30, rising market does not', async () => {
  for (const [name, prices, expect] of [['falling', Array.from({ length: 20 }, (_, i) => 100 - i * 0.5), 1], ['rising', Array.from({ length: 20 }, (_, i) => 100 + i * 0.5), 0]] as const) {
    const r = await rig(); const v = mkBot({ entry: { trigger: 'below', priceUsd: 1000, rsiBelow: 30 }, exit: {} });
    await r.runner.create('u1', 'b', { id: 'b', ...v.config, maxStaleMs: 10 * MIN }, v.openingCashCents); r.set(0); await r.runner.start('b'); feedMinutes(r, prices as number[]); await r.runner.idle();
    assert.equal((await r.repo.get('b'))!.state.positions.length, expect, name);
  }
});
test('two bots on one symbol share ONE feed subscription and one quote update per tick', async () => {
  const r = await rig(); const v = mkBot({ entry: { trigger: 'above', priceUsd: 1000 } });
  for (const id of ['a', 'b']) { await r.runner.create('u1', id, { id, ...v.config }, v.openingCashCents); await r.runner.start(id); }
  r.feed.tick('AAPL', 1000, 100); r.feed.tick('AAPL', 2000, 101); await r.runner.idle();
  assert.equal(r.feed.symbols().length, 1); assert.equal(r.runner.store.snapshot('AAPL')!.bars[0].c, P(101));
  await r.runner.stop('a'); assert.equal(r.feed.symbols().length, 1); await r.runner.stop('b'); assert.equal(r.feed.symbols().length, 0);
});
test('watchdog pauses a silent bot; fresh data resumes it; stopped bots untouched', async () => {
  const r = await rig(); const v = mkBot({ entry: { trigger: 'above', priceUsd: 1000 } });
  await r.runner.create('u1', 'b', { id: 'b', ...v.config, maxStaleMs: 60_000 }, v.openingCashCents); r.set(0); await r.runner.start('b');
  const st = async () => (await r.repo.get('b'))!.state;
  r.set(30_000); await r.runner.checkStale(); assert.equal((await st()).status, 'running');
  r.set(90_000); await r.runner.checkStale(); assert.equal((await st()).status, 'paused'); assert.ok((await st()).events.some(e => e.type === 'DATA_STALE'));
  r.set(100_000); r.feed.tick('AAPL', 100_000, 100); await r.runner.idle(); assert.equal((await st()).status, 'running');
  await r.runner.stop('b'); r.set(900_000); await r.runner.checkStale(); assert.equal((await st()).status, 'stopped');
});
test('GET /bots/:id/market returns real session data, labelled; null before any tick', async () => {
  const r = await rig(); const srv = createServer({ runner: r.runner, repo: r.repo, feed: r.feed, clock: () => 1000 }); const { newToken, tokenHash } = await import('../src/auth');
  const tok = newToken(); await r.repo.createSession(tokenHash(tok), 'u1', 1e12);
  await new Promise<void>(res => srv.listen(0, '127.0.0.1', res)); const base = `http://127.0.0.1:${(srv.address() as any).port}`; const H = { authorization: `Bearer ${tok}` };
  try { const v = mkBot({ entry: { trigger: 'above', priceUsd: 1000 } }); await r.runner.create('u1', 'b', { id: 'b', ...v.config }, v.openingCashCents); r.set(1000); await r.runner.start('b');
    let m: any = await (await fetch(`${base}/bots/b/market`, { headers: H })).json(); assert.equal(m.quote, null); assert.equal(m.freshness, 'DEMO');
    r.feed.tick('AAPL', 1000, 150); await r.runner.idle(); m = await (await fetch(`${base}/bots/b/market`, { headers: H })).json();
    assert.equal(m.quote.session.last, P(150)); assert.equal(m.quote.window, 'since_server_start'); assert.equal(m.quote.indicators.rsi14, null);
  } finally { srv.closeAllConnections(); srv.close(); }
});
