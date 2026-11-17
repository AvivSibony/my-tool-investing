import test from 'node:test'; import assert from 'node:assert/strict'; import http from 'node:http'; import { readdirSync, readFileSync, statSync } from 'node:fs'; import { join } from 'node:path';
import { WebSocket } from 'ws';
import { FeedLimitError, MockProvider } from '../src/provider'; import { openSqliteRepo } from '../src/repo'; import { Runner } from '../src/runner'; import { createServer, MAX_BOTS_PER_USER, MAX_WS_PER_USER, type AuditEvent } from '../src/server';
import { rig, good, cfg } from './helpers'; import { newState } from '../../engine/src/engine';

const PW = 'a-long-password-1', PW2 = 'another-long-pass-2';
async function app(opts: Partial<Parameters<typeof createServer>[0]> = {}) {
  const feed = new MockProvider(7); const repo = await openSqliteRepo(); const runner = new Runner(repo, feed, () => 1_000_000); const audit: AuditEvent[] = [];
  const srv = createServer({ runner, repo, feed, clock: () => 1_000_000, audit: e => audit.push(e), ...opts }); await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port; const base = `http://127.0.0.1:${port}`; const sockets: WebSocket[] = [];
  const call = (path: string, o: { m?: string; tok?: string; body?: unknown } = {}) => fetch(base + path, { method: o.m ?? 'GET', headers: { 'content-type': 'application/json', ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}) }, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const signup = async (email: string, pw = PW) => ((await (await call('/auth/register', { m: 'POST', body: { email, password: pw } })).json()) as any).token as string;
  return { feed, repo, runner, srv, port, base, audit, call, signup, sockets, close: () => { sockets.forEach(w => w.terminate()); srv.closeAllConnections(); srv.close(); } };
}

test('start with exhausted feed limit: clean 409, bot is NOT left "running" without data', async () => {
  const a = await app(); const real = a.feed.subscribe.bind(a.feed); a.feed.subscribe = () => { throw new FeedLimitError(); };
  try { const T = await a.signup('a@x.io'); const { id } = (await (await a.call('/bots', { m: 'POST', tok: T, body: good })).json()) as any;
    assert.equal((await a.call(`/bots/${id}/start`, { m: 'POST', tok: T })).status, 409); assert.equal((await a.repo.get(id))!.state.status, 'stopped');
    a.feed.subscribe = real; assert.equal((await a.call(`/bots/${id}/start`, { m: 'POST', tok: T })).status, 200); } finally { a.close(); }
});
test('startup recovery: a bot that cannot re-attach is paused, never silently "running"', async () => {
  const r = await rig(); const { c, cash } = cfg('b1'); await r.repo.insert({ id: 'b1', userId: 'u1', config: c, state: { ...newState(cash), status: 'running' } });
  r.feed.subscribe = () => { throw new FeedLimitError(); }; await r.runner.recover(); await r.runner.idle(); assert.equal((await r.repo.get('b1'))!.state.status, 'paused');
});
test('per-user bot cap, and users cannot exhaust each other', async () => {
  const a = await app(); try { const T = await a.signup('a@x.io'); const U = await a.signup('b@x.io');
    for (let i = 0; i < MAX_BOTS_PER_USER; i++) assert.equal((await a.call('/bots', { m: 'POST', tok: T, body: good })).status, 201);
    assert.equal((await a.call('/bots', { m: 'POST', tok: T, body: good })).status, 409); assert.equal((await a.call('/bots', { m: 'POST', tok: U, body: good })).status, 201); } finally { a.close(); }
});
test('registration is rate limited per IP; failed logins are audited without secrets', async () => {
  const a = await app({ registerLimiter: new (await import('../src/auth')).LoginLimiter(3, 3600_000, () => 1_000_000) });
  try { for (let i = 0; i < 3; i++) assert.equal((await a.call('/auth/register', { m: 'POST', body: { email: `u${i}@x.io`, password: PW } })).status, 201);
    assert.equal((await a.call('/auth/register', { m: 'POST', body: { email: 'u9@x.io', password: PW } })).status, 429);
    await a.call('/auth/login', { m: 'POST', body: { email: 'u0@x.io', password: 'wrong-password-123' } });
    const kinds = a.audit.map(e => e.evt); assert.ok(kinds.includes('register') && kinds.includes('register_blocked') && kinds.includes('login_fail'));
    const dump = JSON.stringify(a.audit); for (const secret of [PW, 'wrong-password-123', '@x.io']) assert.ok(!dump.includes(secret), `audit log leaked ${secret}`); } finally { a.close(); }
});
test('password change: needs current password, revokes ALL sessions, old password dead, new one works', async () => {
  const a = await app(); try { const T1 = await a.signup('a@x.io'); const T2 = ((await (await a.call('/auth/login', { m: 'POST', body: { email: 'a@x.io', password: PW } })).json()) as any).token;
    assert.equal((await a.call('/auth/password', { m: 'POST', tok: T1, body: { current: 'wrong-password-123', next: PW2 } })).status, 401);
    assert.equal((await a.call('/auth/password', { m: 'POST', tok: T1, body: { current: PW, next: 'short' } })).status, 400);
    const r = await a.call('/auth/password', { m: 'POST', tok: T1, body: { current: PW, next: PW2 } }); assert.equal(r.status, 200); const T3 = ((await r.json()) as any).token;
    assert.equal((await a.call('/bots/x', { tok: T1 })).status, 401); assert.equal((await a.call('/bots/x', { tok: T2 })).status, 401); assert.equal((await a.call('/bots/x', { tok: T3 })).status, 404);
    assert.equal((await a.call('/auth/login', { m: 'POST', body: { email: 'a@x.io', password: PW } })).status, 401); assert.equal((await a.call('/auth/login', { m: 'POST', body: { email: 'a@x.io', password: PW2 } })).status, 200); } finally { a.close(); }
});
test('re-authentication attempts are rate limited (stolen session cannot brute-force the password)', async () => {
  const a = await app(); try { const T = await a.signup('a@x.io'); for (let i = 0; i < 5; i++) await a.call('/auth/password', { m: 'POST', tok: T, body: { current: 'wrong-password-123', next: PW2 } });
    assert.equal((await a.call('/auth/password', { m: 'POST', tok: T, body: { current: PW, next: PW2 } })).status, 429); } finally { a.close(); }
});
test('account deletion: needs password; removes bots, sessions, push tokens, feed subscription, live sockets; other users untouched', async () => {
  const a = await app(); try { const T = await a.signup('a@x.io'); const U = await a.signup('b@x.io');
    const mk = async (tok: string) => ((await (await a.call('/bots', { m: 'POST', tok, body: good })).json()) as any).id as string; const ida = await mk(T), idb = await mk(U);
    await a.call(`/bots/${ida}/start`, { m: 'POST', tok: T }); await a.call('/push/register', { m: 'POST', tok: T, body: { token: 'ExpoPushToken[abcdefghijklmnop]' } });
    const ws = new WebSocket(`ws://127.0.0.1:${a.port}`, { headers: { authorization: `Bearer ${T}` } }); a.sockets.push(ws); await new Promise(r => ws.on('open', r)); const closed = new Promise(r => ws.on('close', r));
    assert.equal((await a.call('/account', { m: 'DELETE', tok: T, body: { password: 'wrong-password-123' } })).status, 401); assert.equal((await a.repo.botsOfUser((await a.repo.userByEmail('a@x.io'))!.id)).length, 1);
    assert.equal((await a.call('/account', { m: 'DELETE', tok: T, body: { password: PW } })).status, 200); await closed;
    assert.equal(await a.repo.userByEmail('a@x.io'), undefined); assert.equal(await a.repo.get(ida), undefined); assert.equal(a.feed.symbols().length, 0 + (0));
    assert.equal((await a.call('/bots/' + ida, { tok: T })).status, 401); assert.equal((await a.call('/auth/login', { m: 'POST', body: { email: 'a@x.io', password: PW } })).status, 401);
    assert.equal((await a.call(`/bots/${idb}`, { tok: U })).status, 200); assert.ok(a.audit.some(e => e.evt === 'account_deleted')); } finally { a.close(); }
});
test('websocket: per-user connection cap, auth required', async () => {
  const a = await app(); try { const T = await a.signup('a@x.io'); const open = () => { const w = new WebSocket(`ws://127.0.0.1:${a.port}`, { headers: { authorization: `Bearer ${T}` } }); a.sockets.push(w); return w; };
    const ws = Array.from({ length: MAX_WS_PER_USER }, open); await Promise.all(ws.map(w => new Promise(r => w.on('open', r))));
    const extra = open(); const code = await new Promise<string>(r => { extra.on('error', e => r(String(e.message))); extra.on('open', () => r('open')); }); assert.match(code, /429/); } finally { a.close(); }
});
test('hardening: no-store + nosniff headers, oversized body rejected and server survives, malformed JSON is 400 not 500', async () => {
  const a = await app(); try { const r = await a.call('/healthz'); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const big = await new Promise<number | string>(res => { const q = http.request(a.base + '/auth/login', { method: 'POST' }, rsp => res(rsp.statusCode ?? 0)); q.on('error', () => res('closed')); q.end('x'.repeat(50_000)); });
    assert.ok(big === 413 || big === 'closed', String(big)); assert.equal((await a.call('/healthz')).status, 200);
    assert.equal((await fetch(a.base + '/auth/login', { method: 'POST', body: '{oops' })).status, 400); assert.equal((await fetch(a.base + '/auth/login', { method: 'POST', body: '[]' })).status, 400); } finally { a.close(); }
});
test('expired sessions are purged', async () => {
  const r = await rig(); await r.repo.createSession('old', 'u1', 5); await r.repo.createSession('new', 'u1', 5000); await r.repo.purgeExpiredSessions(1000); assert.equal(await r.repo.session('old'), undefined); assert.ok(await r.repo.session('new'));
});
test('GUARD: no source file references real-money order endpoints or order placement; engine keeps its PAPER-only check', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() && f !== 'node_modules' ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
  const bad = [/\/v2\/orders/i, /paper-api\.alpaca/i, /api\.alpaca\.markets/i, /placeOrder/i, /submitOrder/i, /createOrder/i, /\/trade\/orders/i];
  for (const f of ['../engine/src', 'src', '../mobile/src', '../mobile/App.tsx'].flatMap(x => { const p = join(__dirname, '..', x); return statSync(p).isDirectory() ? walk(p) : [p]; })) {
    const txt = readFileSync(f, 'utf8'); for (const re of bad) assert.ok(!re.test(txt), `${f} matches ${re}`); }
  assert.match(readFileSync(join(__dirname, '../../engine/src/engine.ts'), 'utf8'), /REAL-MONEY MODE IS NOT SUPPORTED/);
});
