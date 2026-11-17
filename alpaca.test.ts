import test from 'node:test'; import assert from 'node:assert/strict'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { AlpacaProvider } from '../src/alpaca'; import { startApp } from '../src/main';

// Fake server that follows the documented Alpaca flow: connected -> auth -> authenticated -> subscribe -> trades
async function fake(opts: { rejectAuth?: boolean } = {}) {
  const wss = new WebSocketServer({ port: 0 }); await new Promise(r => wss.on('listening', r)); const log: any[] = []; const socks: WebSocket[] = [];
  wss.on('connection', ws => { socks.push(ws); ws.send(JSON.stringify([{ T: 'success', msg: 'connected' }]));
    ws.on('message', d => { const m = JSON.parse(String(d)); log.push(m);
      if (m.action === 'auth') ws.send(JSON.stringify(opts.rejectAuth ? [{ T: 'error', code: 402, msg: 'auth failed' }] : [{ T: 'success', msg: 'authenticated' }])); }); });
  return { url: `ws://127.0.0.1:${(wss.address() as any).port}`, log, socks, trade: (S: string, p: number, t: string) => socks.at(-1)!.send(JSON.stringify([{ T: 't', S, p, s: 10, t }])), close: () => wss.close() };
}
const until = async (f: () => boolean, ms = 2000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); } };

test('auth, subscribe, trade -> Tick (price4 + parsed time); junk and unsubscribed symbols ignored', async () => {
  const s = await fake(); const p = new AlpacaProvider({ key: 'K', secret: 'S', url: s.url }); const ticks: any[] = []; const conn: boolean[] = [];
  p.onConnection(u => conn.push(u)); p.subscribe('AAPL', t => ticks.push(t));
  await until(() => conn.includes(true));
  assert.deepEqual(s.log[0], { action: 'auth', key: 'K', secret: 'S' }); await until(() => s.log.some(m => m.action === 'subscribe'));
  assert.deepEqual(s.log.find(m => m.action === 'subscribe'), { action: 'subscribe', trades: ['AAPL'] });
  s.trade('AAPL', 189.1234, '2026-11-17T15:00:00.123Z'); s.trade('MSFT', 400, '2026-11-17T15:00:01Z'); s.socks[0].send('not json'); s.trade('AAPL', 0, '2026-11-17T15:00:02Z'); s.trade('AAPL', 5, 'garbage');
  await until(() => ticks.length >= 1); await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(ticks, [{ symbol: 'AAPL', price4: 1891234, size: 10, ts: Date.parse('2026-11-17T15:00:00.123Z') }]);
  p.close(); s.close();
});
test('drop -> onConnection(false) -> reconnect -> auth again -> resubscribe -> true', async () => {
  const s = await fake(); const p = new AlpacaProvider({ key: 'K', secret: 'S', url: s.url, baseDelayMs: 20 }); const conn: boolean[] = [];
  p.onConnection(u => conn.push(u)); p.subscribe('TSLA', () => {}); await until(() => conn.length === 1);
  s.socks[0].terminate(); await until(() => conn.length === 3);
  assert.deepEqual(conn, [true, false, true]); await until(() => s.log.filter(m => m.action === 'subscribe').length === 2);
  assert.equal(s.log.filter(m => m.action === 'auth').length, 2); p.close(); s.close();
});
test('auth failure is fatal: reported, no reconnect loop', async () => {
  const s = await fake({ rejectAuth: true }); const p = new AlpacaProvider({ key: 'bad', secret: 'bad', url: s.url, baseDelayMs: 10 });
  await until(() => !!p.fatal); await new Promise(r => setTimeout(r, 150)); assert.match(p.fatal!, /402/); assert.equal(s.log.filter(m => m.action === 'auth').length, 1); s.close();
});
test('unsubscribe is sent when last listener leaves; symbol limit enforced; missing keys rejected', async () => {
  const s = await fake(); const p = new AlpacaProvider({ key: 'K', secret: 'S', url: s.url, maxSymbols: 2 }); const conn: boolean[] = []; p.onConnection(u => conn.push(u)); await until(() => conn.length === 1);
  const off = p.subscribe('AAPL', () => {}); p.subscribe('MSFT', () => {}); assert.throws(() => p.subscribe('NVDA', () => {}), /limit/);
  off(); await until(() => s.log.some(m => m.action === 'unsubscribe')); assert.deepEqual(s.log.find(m => m.action === 'unsubscribe').trades, ['AAPL']);
  assert.throws(() => new AlpacaProvider({ key: '', secret: '', url: s.url }), /missing/); p.close(); s.close();
});
test('main app (mock feed) end-to-end over real HTTP: register, bot opens a position on driven ticks; data labelled DEMO', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-')); const app = await startApp({ DB_PATH: join(dir, 'a.db'), MOCK_TICK_MS: '20' });
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  try {
    const { token } = await (await fetch(`${base}/auth/register`, { method: 'POST', body: JSON.stringify({ email: 'me@x.io', password: 'smoke-password-12' }) })).json() as any;
    const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const { id } = await (await fetch(`${base}/bots`, { method: 'POST', headers: H, body: JSON.stringify({ symbol: 'AAPL', budgetUsd: 1000, entry: { trigger: 'below', priceUsd: 1000 }, exit: {} }) })).json() as any;
    await fetch(`${base}/bots/${id}/start`, { method: 'POST', headers: H });
    let pf: any; for (let i = 0; i < 150; i++) { pf = await (await fetch(`${base}/bots/${id}/portfolio`, { headers: H })).json(); if (pf.openPositions.length) break; await new Promise(r => setTimeout(r, 20)); }
    assert.equal(pf.openPositions.length, 1); assert.equal(pf.data.freshness, 'DEMO'); assert.equal(pf.mode, 'PAPER');
  } finally { await app.close(); }
});
