import test from 'node:test'; import assert from 'node:assert/strict'; import http from 'node:http';
import { compose, Notifier } from '../src/notifier'; import { PUSH_TOKEN_RE, createServer, clientIp } from '../src/server';
import { rig, cfg } from './helpers'; import { newToken, tokenHash } from '../src/auth';

const TOK = 'ExponentPushToken[abcdefghijklmnopqrst]', TOK2 = 'ExpoPushToken[zyxwvutsrqponmlkjihg]';
async function expo(respond: (msgs: any[]) => { code?: number; body?: any } = m => ({ body: { data: m.map(() => ({ status: 'ok' })) } })) {
  const calls: any[][] = []; const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { const msgs = JSON.parse(b); calls.push(msgs); const r = respond(msgs); res.writeHead(r.code ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body ?? {})); }); });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r)); return { calls, endpoint: `http://127.0.0.1:${(srv.address() as any).port}/push`, close: () => srv.close() };
}
// a bot that opens at 100 and takes profit / stops out; ticks are fresh relative to the rig clock (1000)
async function tradedBot(exit: any, ticks: [number, number][], extra: any = {}) {
  const r = await rig(); const { c, cash } = cfg('b1', { exit, ...extra }); await r.runner.create('u1', 'b1', c, cash); return { r, run: async () => { await r.runner.start('b1'); for (const [ts, px] of ticks) r.feed.tick('AAPL', 1000 + ts, px); await r.runner.idle(); } };
}
test('compose: every event type maps to the right text in both languages; TP vs SL vs other close', async () => {
  const { r, run } = await tradedBot({ takeProfitBps: 500 }, [[1, 99], [2, 100], [3, 106]]); await run(); const bot = (await r.repo.get('b1'))!; const ev = bot.state.events;
  const out = (lang: 'he' | 'en') => ev.map((e, i) => compose(bot, bot.state, e, i, lang)?.title);
  assert.deepEqual(out('en'), ['Bot started (demo)', 'Entry conditions met', 'Virtual trade opened', 'Take profit reached']);
  assert.deepEqual(out('he'), ['הבוט הופעל (דמו)', 'תנאי הכניסה התקיימו', 'עסקה וירטואלית נפתחה', 'יעד הרווח הושג']);
  assert.match(compose(bot, bot.state, ev[3], 3, 'en')!.body, /AAPL \$106\.00 · \+\$60\.00/); assert.match(compose(bot, bot.state, ev[2], 2, 'en')!.body, /AAPL 10 @ \$100\.00/);
  const sl = await tradedBot({ stopLossBps: 300 }, [[1, 99], [2, 100], [3, 96]]); await sl.run(); const b2 = (await sl.r.repo.get('b1'))!;
  assert.equal(compose(b2, b2.state, b2.state.events[3], 3, 'en')!.title, 'Stop loss triggered'); assert.match(compose(b2, b2.state, b2.state.events[3], 3, 'en')!.body, /-\$40\.00/);
  const tm = await tradedBot({ maxHoldMs: 1000 }, [[1, 99], [2, 100], [3000, 100]]); await tm.run(); const b3 = (await tm.r.repo.get('b1'))!; assert.equal(compose(b3, b3.state, b3.state.events.at(-1)!, b3.state.events.length - 1, 'en')!.title, 'Virtual trade closed');
  for (const t of ['DATA_DISCONNECTED', 'DATA_RECONNECTED', 'DATA_STALE'] as const) assert.ok(compose(bot, bot.state, { ts: 1, type: t, message: '' }, 0, 'en'));
  assert.equal(compose(bot, bot.state, { ts: 1, type: 'BOT_STOPPED', message: '' }, 0, 'en'), null);
});
test('two positions closing on the same tick get their own notification (k-th closed trade)', async () => {
  const { r, run } = await tradedBot({ stopLossBps: 300 }, [[1, 101], [2, 99], [3, 101], [4, 99], [5, 90]], { entry: { trigger: 'below', priceUsd: 100 }, maxOpenPositions: 2 }); await run();
  const bot = (await r.repo.get('b1'))!; const idx = bot.state.events.map((e, i) => (e.type === 'POSITION_CLOSED' ? i : -1)).filter(i => i >= 0); assert.equal(idx.length, 2);
  const bodies = idx.map(i => compose(bot, bot.state, bot.state.events[i], i, 'en')!.body); assert.equal(bot.state.closed.length, 2);
  for (const [k, b] of bodies.entries()) assert.ok(b.includes(`${(bot.state.closed[k].netPnlCents < 0 ? '-' : '+')}$${(Math.abs(bot.state.closed[k].netPnlCents) / 100).toFixed(2)}`), b);
});
test('Notifier sends to the OWNER devices only, in each device language, via the live runner', async () => {
  const e = await expo(); const { r, run } = await tradedBot({ takeProfitBps: 500 }, [[1, 99], [2, 100], [3, 106]]);
  await r.repo.createUser('u2', 'u2@x.io', 'x'); await r.repo.savePushToken('u1', TOK, 'en'); await r.repo.savePushToken('u1', TOK2, 'he'); await r.repo.savePushToken('u2', 'ExpoPushToken[otheruserdevice00000]', 'en');
  new Notifier({ repo: r.repo, endpoint: e.endpoint }).attach(r.runner); await run(); await new Promise(x => setTimeout(x, 150));
  const all = e.calls.flat(); assert.equal(all.length, 8);                                   // 4 events x 2 devices of the owner
  assert.ok(all.every(m => m.to === TOK || m.to === TOK2)); assert.ok(all.some(m => m.to === TOK && m.title === 'Take profit reached')); assert.ok(all.some(m => m.to === TOK2 && m.title === 'יעד הרווח הושג'));
  e.close();
});
test('dead device tokens are removed; Expo outage never throws into the runner; no tokens -> no request; chunks of 100', async () => {
  const e1 = await expo(m => ({ body: { data: m.map(x => (x.to === TOK ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) } }));
  const { r } = await tradedBot({}, []); await r.repo.savePushToken('u1', TOK, 'en'); await r.repo.savePushToken('u1', TOK2, 'en'); const n1 = new Notifier({ repo: r.repo, endpoint: e1.endpoint });
  await r.runner.create('u1', 'b9', cfg('b9').c, 1); await n1.onEvent('b9', { ts: 1, type: 'BOT_STARTED', message: '' }, 0); assert.deepEqual((await r.repo.pushTokens('u1')).map(t => t.token), [TOK2]); e1.close();
  const e2 = await expo(() => ({ code: 500, body: {} })); const n2 = new Notifier({ repo: r.repo, endpoint: e2.endpoint }); await n2.onEvent('b9', { ts: 1, type: 'BOT_STARTED', message: '' }, 0); assert.equal(e2.calls.length, 1); e2.close();
  const e3 = await expo(); await r.repo.removePushToken(TOK2); await new Notifier({ repo: r.repo, endpoint: e3.endpoint }).onEvent('b9', { ts: 1, type: 'BOT_STARTED', message: '' }, 0); assert.equal(e3.calls.length, 0);
  for (let i = 0; i < 205; i++) await r.repo.savePushToken('u1', `ExpoPushToken[device${String(i).padStart(12, '0')}]`, 'en');
  await new Notifier({ repo: r.repo, endpoint: e3.endpoint }).onEvent('b9', { ts: 1, type: 'BOT_STARTED', message: '' }, 0); assert.deepEqual(e3.calls.map(c => c.length), [100, 100, 5]); e3.close();
});
test('push token format, register/unregister API, token reassignment, healthz (no auth, 503 when DB is down), proxy IP', async () => {
  assert.ok(PUSH_TOKEN_RE.test(TOK)); for (const bad of ['', 'abc', 'ExpoPushToken[]', 'ExpoPushToken[short]', TOK + 'x', 'ExpoPushToken[<script>alert(1)</script>]']) assert.ok(!PUSH_TOKEN_RE.test(bad), bad);
  const r = await rig(); await r.repo.createUser('u2', 'u2@x.io', 'x'); const srv = createServer({ runner: r.runner, repo: r.repo, feed: r.feed, clock: () => 1000 });
  const tA = newToken(), tB = newToken(); await r.repo.createSession(tokenHash(tA), 'u1', 1e12); await r.repo.createSession(tokenHash(tB), 'u2', 1e12);
  await new Promise<void>(x => srv.listen(0, '127.0.0.1', x)); const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  const post = (path: string, tok: string | null, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/push/register', null, { token: TOK })).status, 401); assert.equal((await post('/push/register', tA, { token: 'nope' })).status, 400);
    assert.equal((await post('/push/register', tA, { token: TOK, lang: 'en' })).status, 200); assert.equal((await post('/push/register', tA, { token: TOK, lang: 'en' })).status, 200);
    assert.deepEqual(await r.repo.pushTokens('u1'), [{ token: TOK, lang: 'en' }]);                                                   // idempotent
    await post('/push/register', tB, { token: TOK }); assert.equal((await r.repo.pushTokens('u1')).length, 0); assert.equal((await r.repo.pushTokens('u2')).length, 1);   // device changed owner
    await post('/push/unregister', tA, { token: TOK }); assert.equal((await r.repo.pushTokens('u2')).length, 1);                    // A cannot remove B's token
    await post('/push/unregister', tB, { token: TOK }); assert.equal((await r.repo.pushTokens('u2')).length, 0);
    const h = await fetch(base + '/healthz'); assert.equal(h.status, 200); assert.deepEqual(await h.json(), { ok: true, data: { source: 'MOCK', freshness: 'DEMO' } });
    (r.repo as any).ping = async () => { throw new Error('db down'); }; assert.equal((await fetch(base + '/healthz')).status, 503);
  } finally { srv.closeAllConnections(); srv.close(); }
  const fake = (xff: string | undefined, addr = '10.0.0.1') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: addr } }) as any;
  assert.equal(clientIp(fake('1.2.3.4, 10.0.0.1'), true), '1.2.3.4'); assert.equal(clientIp(fake('1.2.3.4'), false), '10.0.0.1'); assert.equal(clientIp(fake(undefined), true), '10.0.0.1');
});
