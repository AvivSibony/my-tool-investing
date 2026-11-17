import { MockProvider, type MarketDataProvider } from './provider';
import { AlpacaProvider } from './alpaca';
import { openSqliteRepo, SqlRepo } from './repo';
import { pgDb } from './db';
import { Runner } from './runner';
import { createServer } from './server';
import { Notifier } from './notifier';

async function openRepo(env: Record<string, string | undefined>): Promise<SqlRepo> {
  if (env.DATABASE_URL) {                       // PostgreSQL path: UNTESTED in the build sandbox. Apply schema.postgres.sql first.
    const { Pool } = await import('pg' as string); return new SqlRepo(pgDb(new Pool({ connectionString: env.DATABASE_URL })));
  }
  return openSqliteRepo(env.DB_PATH ?? './bot.db');
}
export async function startApp(env: Record<string, string | undefined>) {
  const feed: MarketDataProvider = env.DATA_PROVIDER === 'alpaca'
    ? new AlpacaProvider({ key: env.ALPACA_KEY_ID ?? '', secret: env.ALPACA_SECRET ?? '' }) : new MockProvider(Number(env.MOCK_SEED ?? 1));
  const repo = await openRepo(env); const runner = new Runner(repo, feed); await runner.recover();
  new Notifier({ repo }).attach(runner);
  const server = createServer({ runner, repo, feed, allowRegistration: env.ALLOW_REGISTRATION !== 'false', trustProxy: env.TRUST_PROXY === 'true' });
  const dog = setInterval(() => { runner.checkStale().catch(console.error); }, 5000); const purge = setInterval(() => repo.purgeExpiredSessions(Date.now()).catch(console.error), 3600_000); let drive: NodeJS.Timeout | undefined;
  if (feed instanceof MockProvider) drive = setInterval(() => feed.symbols().forEach(s => feed.tick(s, Date.now())), Number(env.MOCK_TICK_MS ?? 1000));
  return { server, feed, runner, repo, close: async () => { clearInterval(drive); clearInterval(dog); clearInterval(purge); (feed as any).close?.(); server.closeAllConnections(); server.close(); await runner.idle(); await repo.close(); } };
}
if (require.main === module) {
  startApp(process.env).then(app => { const port = Number(process.env.PORT ?? 3000);
    app.server.listen(port, '0.0.0.0', () => console.log(`PAPER-TRADING server on :${port} | data: ${app.feed.name} (${app.feed.freshness})`));
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => app.close().then(() => process.exit(0))); }).catch(e => { console.error(e); process.exit(1); });
}
