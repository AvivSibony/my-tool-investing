import test from 'node:test'; import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { validateBotInput } from '../src/validate'; import { MockProvider } from '../src/provider'; import { openSqliteRepo, SqlRepo, EmailTakenError } from '../src/repo';
import { sqliteDb, SQLITE_DDL, type Db } from '../src/db'; import { hashPassword, verifyPassword, validateCredentials, LoginLimiter, tokenHash, newToken } from '../src/auth';
import { Runner } from '../src/runner'; import { createServer } from '../src/server'; import { rig, good, cfg } from './helpers';

test('validation accepts a good bot, converts units, rejects bad input and any non-PAPER mode', () => {
  const v = validateBotInput(good); assert.ok(v.ok);
  if (v.ok) { assert.equal(v.config.budgetCents, 100000); assert.equal(v.config.entry.price4, 1000000); assert.equal(v.openingCashCents, 10_000_000); }
  for (const bad of [null, { ...good, mode: 'LIVE' }, { ...good, symbol: 'aapl' }, { ...good, budgetUsd: -5 }, { ...good, budgetUsd: 'x' },
    { ...good, entry: { trigger: 'nope', priceUsd: 1 } }, { ...good, exit: { stopLossBps: 0 } }, { ...good, slippageBps: 9999 }, { ...good, symbol: 'A; DROP TABLE' }])
    assert.equal(validateBotInput(bad).ok, false, JSON.stringify(bad));
});
test('DB itself refuses a non-PAPER row (constraint, not just app code)', async () => {
  const p = join(mkdtempSync(join(tmpdir(), 'bot-')), 'a.db'); await (await openSqliteRepo(p)).close(); const raw = new DatabaseSync(p);
  raw.exec("insert into users values('u','a@b.c','x',0)");
  assert.throws(() => raw.exec("insert into bots(id,user_id,config,state,mode,status,updated_at) values('x','u','{}','{}','LIVE','stopped',0)"), /CHECK/);
});
test('runner: end-to-end trade on mock feed, events emitted, double start is a no-op', async () => {
  const r = await rig(); const { c, cash } = cfg('b1'); await r.runner.create('u1', 'b1', c, cash);
  const seen: string[] = []; r.runner.listeners.add((_, e) => seen.push(e.type));
  await r.runner.start('b1'); await r.runner.start('b1');
  for (const [ts, px] of [[1, 99], [2, 100], [3, 106]] as const) r.feed.tick('AAPL', ts, px); await r.runner.idle();
  const s = (await r.repo.get('b1'))!.state; assert.equal(s.closed.length, 1); assert.equal(s.closed[0].reason, 'TAKE_PROFIT'); assert.equal(s.tradeSeq, 1);
  assert.deepEqual(seen, ['BOT_STARTED', 'ENTRY_CONDITION_MET', 'POSITION_OPENED', 'POSITION_CLOSED']);
});
test('rapid ticks are serialised: no lost updates with async storage', async () => {
  const r = await rig(); const { c, cash } = cfg('b1', { entry: { trigger: 'above', priceUsd: 1000 } }); await r.runner.create('u1', 'b1', c, cash); await r.runner.start('b1');
  for (let i = 1; i <= 50; i++) r.feed.tick('AAPL', i, 100 + i); await r.runner.idle();
  const s = (await r.repo.get('b1'))!.state; assert.equal(s.lastTickTs, 50); assert.equal(s.tradeSeq, 0);
});
test('stop detaches from the feed', async () => {
  const r = await rig(); const { c, cash } = cfg('b1'); await r.runner.create('u1', 'b1', c, cash); await r.runner.start('b1'); await r.runner.stop('b1');
  r.feed.tick('AAPL', 1, 99); r.feed.tick('AAPL', 2, 100); await r.runner.idle(); assert.equal((await r.repo.get('b1'))!.state.tradeSeq, 0);
});
test('disconnect pauses running bots, reconnect resumes them', async () => {
  const r = await rig(); const { c, cash } = cfg('b1'); await r.runner.create('u1', 'b1', c, cash); await r.runner.start('b1');
  r.feed.setConnected(false); await r.runner.idle(); assert.equal((await r.repo.get('b1'))!.state.status, 'paused');
  r.feed.tick('AAPL', 1, 99); r.feed.tick('AAPL', 2, 100); await r.runner.idle(); assert.equal((await r.repo.get('b1'))!.state.tradeSeq, 0);
  r.feed.setConnected(true); await r.runner.idle(); assert.equal((await r.repo.get('b1'))!.state.status, 'running');
});
test('process restart: open position survives, bot re-attaches, no duplicate trade', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'bot-')), 'r.db'); const a = await rig(path); const { c, cash } = cfg('b1');
  await a.runner.create('u1', 'b1', c, cash); await a.runner.start('b1'); for (const [t, p] of [[1, 99], [2, 100], [3, 102]] as const) a.feed.tick('AAPL', t, p);
  await a.runner.idle(); assert.equal((await a.repo.get('b1'))!.state.positions.length, 1); await a.repo.close();
  const b = await rig(path, false); await b.runner.recover();
  assert.equal((await b.repo.get('b1'))!.state.positions.length, 1);
  b.feed.tick('AAPL', 3, 102); b.feed.tick('AAPL', 2, 100); b.feed.tick('AAPL', 4, 107); await b.runner.idle();
  const s = (await b.repo.get('b1'))!.state; assert.equal(s.tradeSeq, 1); assert.equal(s.closed.length, 1); assert.equal(s.positions.length, 0);
});
test('SqlRepo behaves with Postgres-like row types (int8 as string, jsonb as objects) and enforces unique email', async () => {
  const inner = sqliteDb(); for (const s of SQLITE_DDL) await inner.query(s);
  const pgLike: Db = { close: () => inner.close(), async query(t, p) { return (await inner.query(t, p)).map(r => { const o: any = {};
    for (const [k, v] of Object.entries(r)) o[k] = typeof v === 'number' ? String(v) : (k === 'config' || k === 'state') ? JSON.parse(v as string) : v; return o; }); } };
  const repo = new SqlRepo(pgLike); await repo.createUser('u', 'a@b.co', 'h'); await assert.rejects(repo.createUser('u2', 'a@b.co', 'h'), EmailTakenError);
  await repo.createSession('th', 'u', 12345); assert.deepEqual(await repo.session('th'), { userId: 'u', expiresAt: 12345 }); await repo.deleteSession('th'); assert.equal(await repo.session('th'), undefined);
  const { c, cash } = cfg('b'); const { newState } = await import('../../engine/src/engine'); await repo.insert({ id: 'b', userId: 'u', config: c, state: newState(cash) });
  const row = (await repo.get('b'))!; assert.equal(row.state.mode, 'PAPER'); assert.equal(row.config.symbol, 'AAPL'); assert.equal((await repo.active()).length, 0);
});
test('auth primitives: scrypt hash/verify, unknown user, validation, limiter, token hashing', () => {
  const h = hashPassword('correct horse battery'); assert.ok(h.startsWith('scrypt$')); assert.notEqual(h, hashPassword('correct horse battery'));
  assert.ok(verifyPassword('correct horse battery', h)); assert.ok(!verifyPassword('wrong password!!', h)); assert.ok(!verifyPassword('anything-at-all', undefined));
  assert.ok(!validateCredentials({ email: 'bad', password: 'longenoughpw' }).ok); assert.ok(!validateCredentials({ email: 'a@b.co', password: 'short' }).ok);
  const v = validateCredentials({ email: ' A@B.Co ', password: 'longenoughpw' }); assert.ok(v.ok && v.email === 'a@b.co');
  let now = 0; const L = new LoginLimiter(3, 1000, () => now); for (let i = 0; i < 3; i++) L.fail('k'); assert.ok(L.blocked('k')); now = 2000; assert.ok(!L.blocked('k'));
  const t = newToken(); assert.ok(t.length >= 40); assert.equal(tokenHash(t).length, 64); assert.notEqual(tokenHash(t), t);
});
test('HTTP+WS API: accounts, isolation between users, sessions, rate limit, live events only to the owner', async () => {
  const feed = new MockProvider(7); const repo = await openSqliteRepo(); let now = 1_000_000; const runner = new Runner(repo, feed, () => now);
  const srv = createServer({ runner, repo, feed, clock: () => now }); await new Promise<void>(r => srv.listen(0, '127.0.0.1', r)); const port = (srv.address() as any).port; const base = `http://127.0.0.1:${port}`;
  const call = (path: string, o: { m?: string; tok?: string; body?: unknown } = {}) => fetch(base + path, { method: o.m ?? 'GET', headers: { 'content-type': 'application/json', ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}) }, body: o.body === undefined ? undefined : typeof o.body === 'string' ? o.body : JSON.stringify(o.body) });
  const PW = 'a-long-password-1'; const opened: WebSocket[] = [];
  try {
    assert.equal((await call('/bots')).status, 401); assert.equal((await call('/bots', { tok: 'x'.repeat(30) })).status, 401);
    assert.equal((await call('/auth/register', { m: 'POST', body: { email: 'bad', password: PW } })).status, 400);
    const ra = await call('/auth/register', { m: 'POST', body: { email: 'a@x.io', password: PW } }); assert.equal(ra.status, 201); const A = ((await ra.json()) as any).token;
    assert.equal((await call('/auth/register', { m: 'POST', body: { email: 'A@x.io', password: PW } })).status, 409);
    const B = ((await (await call('/auth/register', { m: 'POST', body: { email: 'b@x.io', password: PW } })).json()) as any).token;
    assert.equal((await call('/auth/login', { m: 'POST', body: { email: 'a@x.io', password: 'wrong-password-123' } })).status, 401);
    assert.equal((await call('/auth/login', { m: 'POST', body: { email: 'nobody@x.io', password: PW } })).status, 401);
    assert.equal((await call('/auth/login', { m: 'POST', body: { email: 'a@x.io', password: PW } })).status, 200);
    const bad = await call('/bots', { m: 'POST', tok: A, body: { ...good, mode: 'LIVE' } }); assert.equal(bad.status, 400); assert.match(JSON.stringify(await bad.json()), /PAPER/);
    assert.equal((await call('/bots', { m: 'POST', tok: A, body: '{not json' })).status, 400);
    const { id, mode } = (await (await call('/bots', { m: 'POST', tok: A, body: good })).json()) as any; assert.equal(mode, 'PAPER');
    const wsA = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { authorization: `Bearer ${A}` } }); const wsB = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { authorization: `Bearer ${B}` } });
    opened.push(wsA, wsB); await Promise.all([wsA, wsB].map(w => new Promise(r => w.on('open', r)))); const ma: any[] = [], mb: any[] = []; wsA.on('message', m => ma.push(JSON.parse(String(m)))); wsB.on('message', m => mb.push(JSON.parse(String(m))));
    for (const path of ['', '/start', '/stop', '/portfolio', '/events', '/market']) assert.equal((await call(`/bots/${id}${path}`, { tok: B, m: path === '/start' || path === '/stop' ? 'POST' : 'GET' })).status, 404, `B must not reach A's bot ${path}`);
    assert.equal((await call(`/bots/${id}/start`, { m: 'POST', tok: A })).status, 200);
    for (const [ts, px] of [[1, 99], [2, 100], [3, 106]] as const) feed.tick('AAPL', now + ts, px); await runner.idle(); await new Promise(r => setTimeout(r, 80));
    const pf = (await (await call(`/bots/${id}/portfolio`, { tok: A })).json()) as any;
    assert.equal(pf.mode, 'PAPER'); assert.deepEqual(pf.data, { source: 'MOCK', freshness: 'DEMO', lastQuoteTs: 1_000_003, lastPrice4: 1060000 }); assert.equal(pf.closedTrades.length, 1);
    assert.deepEqual(ma.map(m => m.event.type), ['BOT_STARTED', 'ENTRY_CONDITION_MET', 'POSITION_OPENED', 'POSITION_CLOSED']); assert.equal(mb.length, 0);
    wsA.close(); wsB.close(); const anon = new WebSocket(`ws://127.0.0.1:${port}`); await new Promise(r => anon.on('error', r));
    assert.equal((await call('/auth/logout', { m: 'POST', tok: B })).status, 200); assert.equal((await call('/bots/x', { tok: B })).status, 401);          // logged-out token is dead
    now += 31 * 24 * 3600 * 1000; assert.equal((await call(`/bots/${id}`, { tok: A })).status, 401);                                                         // expired session
    for (let i = 0; i < 5; i++) await call('/auth/login', { m: 'POST', body: { email: 'a@x.io', password: 'wrong-password-123' } });
    assert.equal((await call('/auth/login', { m: 'POST', body: { email: 'a@x.io', password: PW } })).status, 429);                                          // locked out
  } finally { opened.forEach(w => w.terminate()); srv.closeAllConnections(); srv.close(); }
});
test('registration can be disabled', async () => {
  const feed = new MockProvider(1); const repo = await openSqliteRepo(); const srv = createServer({ runner: new Runner(repo, feed), repo, feed, allowRegistration: false });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  try { const r = await fetch(`http://127.0.0.1:${(srv.address() as any).port}/auth/register`, { method: 'POST', body: JSON.stringify({ email: 'a@x.io', password: 'a-long-password-1' }) }); assert.equal(r.status, 403); }
  finally { srv.closeAllConnections(); srv.close(); }
});
test('mock provider is deterministic per seed', () => {
  const run = (seed: number) => { const f = new MockProvider(seed); const out: number[] = []; f.subscribe('X', t => out.push(t.price4)); for (let i = 1; i <= 5; i++) f.tick('X', i); return out; };
  assert.deepEqual(run(3), run(3)); assert.notDeepEqual(run(3), run(4));
});
