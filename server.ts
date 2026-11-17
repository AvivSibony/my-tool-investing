import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { validateBotInput } from './validate';
import { portfolio } from '../../engine/src/engine';
import { hashPassword, verifyPassword, newToken, tokenHash, validateCredentials, LoginLimiter, SESSION_TTL_MS } from './auth';
import { EmailTakenError, type SqlRepo } from './repo';
import { FeedLimitError, type MarketDataProvider } from './provider';
import type { Runner } from './runner';

export const PUSH_TOKEN_RE = /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,100}\]$/;
export const MAX_BOTS_PER_USER = 5, MAX_WS_PER_USER = 5;
export const clientIp = (req: http.IncomingMessage, trustProxy: boolean) =>
  (trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?';
export type AuditEvent = { evt: string; ip?: string; userId?: string; ts: number };

export function createServer(o: { trustProxy?: boolean; runner: Runner; repo: SqlRepo; feed: MarketDataProvider; allowRegistration?: boolean; clock?: () => number;
  limiter?: LoginLimiter; registerLimiter?: LoginLimiter; audit?: (e: AuditEvent) => void }) {
  const clock = o.clock ?? (() => Date.now()); const limiter = o.limiter ?? new LoginLimiter(5, 15 * 60_000, clock);
  const regLimiter = o.registerLimiter ?? new LoginLimiter(10, 3600_000, clock);
  const audit = (e: Omit<AuditEvent, 'ts'>) => (o.audit ?? ((x: AuditEvent) => console.log(JSON.stringify(x))))({ ...e, ts: clock() });   // never logs emails, passwords or tokens
  const send = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
  const userFrom = async (h?: string): Promise<string | null> => {
    const m = /^Bearer (\S{20,200})$/.exec(h ?? ''); if (!m) return null;
    const s = await o.repo.session(tokenHash(m[1])); return s && s.expiresAt > clock() ? s.userId : null; };
  const owners = new Map<string, string>();
  const ownerOf = async (botId: string) => { if (!owners.has(botId)) { const b = await o.repo.get(botId); if (b) owners.set(botId, b.userId); } return owners.get(botId); };
  const clients = new Map<any, string>();

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse, raw: string) => {
    let p: string[]; try { p = new URL(req.url ?? '/', 'http://x').pathname.split('/').filter(Boolean); } catch { return send(res, 400, { error: 'bad request' }); }
    const ip = clientIp(req, !!o.trustProxy);
    if (req.method === 'GET' && p[0] === 'healthz') { try { await o.repo.ping(); return send(res, 200, { ok: true, data: { source: o.feed.name, freshness: o.feed.freshness } }); } catch { return send(res, 503, { ok: false }); } }
    if (req.method === 'POST' && p[0] === 'auth' && (p[1] === 'register' || p[1] === 'login')) {
      const c = validateCredentials(raw ? JSON.parse(raw) : null); if (!c.ok) return send(res, 400, { error: c.error });
      if (p[1] === 'register') {
        if (o.allowRegistration === false) return send(res, 403, { error: 'registration disabled' });
        if (regLimiter.blocked(ip)) { audit({ evt: 'register_blocked', ip }); return send(res, 429, { error: 'too many attempts, try later' }); }
        regLimiter.fail(ip);
        try { await o.repo.createUser(randomUUID(), c.email, hashPassword(c.password)); } catch (e) { if (e instanceof EmailTakenError) return send(res, 409, { error: 'email already registered' }); throw e; }
      }
      const key = `${ip}|${c.email}`; if (limiter.blocked(key)) { audit({ evt: 'login_locked', ip }); return send(res, 429, { error: 'too many attempts, try later' }); }
      const u = await o.repo.userByEmail(c.email); const ok = verifyPassword(c.password, u?.pwHash);
      if (!ok || !u) { limiter.fail(key); audit({ evt: 'login_fail', ip }); return send(res, 401, { error: 'invalid credentials' }); }
      limiter.reset(key); const token = newToken(); await o.repo.createSession(tokenHash(token), u.id, clock() + SESSION_TTL_MS);
      audit({ evt: p[1] === 'register' ? 'register' : 'login_ok', ip, userId: u.id }); return send(res, p[1] === 'register' ? 201 : 200, { token });
    }
    const userId = await userFrom(req.headers.authorization); if (!userId) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'POST' && p[0] === 'auth' && p[1] === 'logout') { await o.repo.deleteSession(tokenHash(req.headers.authorization!.slice(7))); audit({ evt: 'logout', ip, userId }); return send(res, 200, { ok: true }); }
    if ((req.method === 'POST' && p[0] === 'auth' && p[1] === 'password') || (req.method === 'DELETE' && p[0] === 'account')) {
      const b = raw ? JSON.parse(raw) : null; const isDelete = p[0] === 'account'; const cur = isDelete ? b?.password : b?.current;
      const key = `pw|${userId}`; if (limiter.blocked(key)) return send(res, 429, { error: 'too many attempts, try later' });
      const u = await o.repo.userById(userId); if (typeof cur !== 'string' || !u || !verifyPassword(cur, u.pwHash)) { limiter.fail(key); audit({ evt: 'reauth_fail', ip, userId }); return send(res, 401, { error: 'invalid credentials' }); }
      limiter.reset(key);
      if (isDelete) {
        for (const bot of await o.repo.botsOfUser(userId)) { await o.runner.stop(bot.id).catch(() => {}); owners.delete(bot.id); }
        await o.runner.idle(); await o.repo.deleteUser(userId); for (const [ws, uid] of clients) if (uid === userId) ws.terminate();
        audit({ evt: 'account_deleted', ip, userId }); return send(res, 200, { ok: true });
      }
      const nc = validateCredentials({ email: u.email, password: b?.next }); if (!nc.ok) return send(res, 400, { error: 'password must be 10-128 characters' });
      await o.repo.setPassword(userId, hashPassword(nc.password)); const token = newToken(); await o.repo.createSession(tokenHash(token), userId, clock() + SESSION_TTL_MS);
      for (const [ws, uid] of clients) if (uid === userId) ws.terminate(); audit({ evt: 'password_changed', ip, userId }); return send(res, 200, { token });
    }
    if (req.method === 'POST' && p[0] === 'push' && (p[1] === 'register' || p[1] === 'unregister')) {
      const b = raw ? JSON.parse(raw) : null; if (typeof b?.token !== 'string' || !PUSH_TOKEN_RE.test(b.token)) return send(res, 400, { error: 'invalid push token' });
      if (p[1] === 'register') await o.repo.savePushToken(userId, b.token, b.lang === 'en' ? 'en' : 'he'); else await o.repo.removePushToken(b.token, userId);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p.length === 1 && p[0] === 'bots') {
      const v = validateBotInput(raw ? JSON.parse(raw) : null); if (!v.ok) return send(res, 400, { errors: v.errors });
      if ((await o.repo.botsOfUser(userId)).length >= MAX_BOTS_PER_USER) return send(res, 409, { error: `bot limit reached (${MAX_BOTS_PER_USER})` });
      const id = randomUUID(); await o.runner.create(userId, id, { id, ...v.config }, v.openingCashCents); owners.set(id, userId); return send(res, 201, { id, mode: 'PAPER' });
    }
    if (p[0] === 'bots' && p[1]) {
      const bot = await o.repo.get(p[1]); if (!bot || bot.userId !== userId) return send(res, 404, { error: 'not found' });
      if (req.method === 'POST' && p[2] === 'start') { try { await o.runner.start(bot.id); } catch (e) { if (e instanceof FeedLimitError) return send(res, 409, { error: 'market-data symbol limit reached' }); throw e; } return send(res, 200, { status: 'running' }); }
      if (req.method === 'POST' && p[2] === 'stop') { await o.runner.stop(bot.id); return send(res, 200, { status: 'stopped' }); }
      if (req.method === 'GET' && p[2] === 'portfolio') { const s = bot.state;
        return send(res, 200, { mode: 'PAPER', status: s.status, ...portfolio(s, s.lastPrice4 ?? 0), openPositions: s.positions, closedTrades: s.closed,
          data: { source: o.feed.name, freshness: o.feed.freshness, lastQuoteTs: s.lastTickTs || null, lastPrice4: s.lastPrice4 ?? null } }); }
      if (req.method === 'GET' && p[2] === 'market') return send(res, 200, { source: o.feed.name, freshness: o.feed.freshness, quote: o.runner.store.snapshot(bot.config.symbol) });
      if (req.method === 'GET' && p[2] === 'events') return send(res, 200, { events: bot.state.events });
      if (req.method === 'GET' && !p[2]) return send(res, 200, { id: bot.id, config: bot.config, status: bot.state.status });
    }
    send(res, 404, { error: 'not found' });
  };
  const server = http.createServer((req, res) => {
    let raw = ''; let tooBig = false; req.on('data', c => { raw += c; if (raw.length > 10_000 && !tooBig) { tooBig = true; send(res, 413, { error: 'payload too large' }); req.destroy(); } });
    req.on('end', () => { if (tooBig) return; handle(req, res, raw).catch(e => { const bad = e instanceof SyntaxError; if (!bad) console.error('server error', String(e?.message ?? e)); if (!res.headersSent) send(res, bad ? 400 : 500, { error: bad ? 'bad request' : 'server error' }); }); });
  });
  server.headersTimeout = 10_000; server.requestTimeout = 15_000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('upgrade', async (req, sock, head) => {
    const uid = await userFrom(req.headers.authorization).catch(() => null);
    if (!uid) { sock.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return sock.destroy(); }
    if ([...clients.values()].filter(x => x === uid).length >= MAX_WS_PER_USER) { sock.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return sock.destroy(); }
    wss.handleUpgrade(req, sock, head, ws => { clients.set(ws, uid); ws.on('close', () => clients.delete(ws)); ws.on('error', () => clients.delete(ws)); });
  });
  o.runner.listeners.add(async (botId, event) => { const owner = await ownerOf(botId);
    for (const [ws, uid] of clients) if (uid === owner && ws.readyState === 1) ws.send(JSON.stringify({ botId, event })); });
  return server;
}
