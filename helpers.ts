import { MockProvider } from '../src/provider'; import { openSqliteRepo } from '../src/repo'; import { Runner } from '../src/runner'; import { validateBotInput } from '../src/validate';
export async function rig(path = ':memory:', seed = true) {
  const feed = new MockProvider(7); const repo = await openSqliteRepo(path); let now = 1000;
  const runner = new Runner(repo, feed, () => now); if (seed) await repo.createUser('u1', 'u1@x.io', 'x');
  return { feed, repo, runner, set: (n: number) => (now = n) };
}
export const good = { symbol: 'AAPL', budgetUsd: 1000, entry: { trigger: 'price_at', priceUsd: 100 }, exit: { takeProfitBps: 500 } };
export const cfg = (id: string, extra: any = {}) => { const v = validateBotInput({ ...good, ...extra }); if (!v.ok) throw new Error(JSON.stringify(v)); return { c: { id, ...v.config }, cash: v.openingCashCents }; };
