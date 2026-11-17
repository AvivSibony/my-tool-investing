import type { BotConfig } from '../../engine/src/types';
const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const usd = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const toC = (v: number) => Math.round(v * 100);
const toP4 = (v: number) => Math.round(v * 10000);

export function validateBotInput(b: any): { ok: true; config: Omit<BotConfig, 'id'>; openingCashCents: number } | { ok: false; errors: string[] } {
  const e: string[] = [];
  if (!b || typeof b !== 'object') return { ok: false, errors: ['body must be an object'] };
  if (b.mode !== undefined && b.mode !== 'PAPER') e.push('mode: only PAPER is supported');
  if (typeof b.symbol !== 'string' || !/^[A-Z][A-Z.]{0,5}$/.test(b.symbol)) e.push('symbol: 1-6 uppercase letters');
  if (!usd(b.budgetUsd, 1, 1_000_000)) e.push('budgetUsd: 1..1,000,000');
  const start = b.startingCashUsd ?? 100000;
  if (!usd(start, 1, 100_000_000)) e.push('startingCashUsd: 1..100,000,000');
  const en = b.entry ?? {};
  if (!['price_at', 'above', 'below'].includes(en.trigger)) e.push('entry.trigger: price_at|above|below');
  if (!usd(en.priceUsd, 0.01, 1_000_000)) e.push('entry.priceUsd: 0.01..1,000,000');
  if (en.rsiBelow !== undefined && !usd(en.rsiBelow, 1, 99)) e.push('entry.rsiBelow: 1..99');
  const x = b.exit ?? {};
  for (const k of ['takeProfitBps', 'stopLossBps', 'trailingStopBps'])
    if (x[k] !== undefined && !int(x[k], 1, 10000)) e.push(`exit.${k}: integer 1..10000`);
  if (x.maxHoldMs !== undefined && !int(x.maxHoldMs, 1000, 31_536_000_000)) e.push('exit.maxHoldMs: >= 1000');
  if (!int(b.feeBps ?? 0, 0, 500)) e.push('feeBps: 0..500');
  if (!int(b.slippageBps ?? 0, 0, 500)) e.push('slippageBps: 0..500');
  if (!int(b.maxOpenPositions ?? 1, 1, 20)) e.push('maxOpenPositions: 1..20');
  if (b.maxTotalTrades !== undefined && !int(b.maxTotalTrades, 1, 10000)) e.push('maxTotalTrades: 1..10000');
  if (e.length) return { ok: false, errors: e };
  return { ok: true, openingCashCents: toC(start), config: {
    symbol: b.symbol, budgetCents: toC(b.budgetUsd),
    entry: { trigger: en.trigger, price4: toP4(en.priceUsd), rsiBelow: en.rsiBelow, priceAboveSma: !!en.priceAboveSma },
    exit: { takeProfitBps: x.takeProfitBps, stopLossBps: x.stopLossBps, trailingStopBps: x.trailingStopBps, maxHoldMs: x.maxHoldMs },
    feeBps: b.feeBps ?? 0, feeMinCents: 0, slippageBps: b.slippageBps ?? 0,
    maxOpenPositions: b.maxOpenPositions ?? 1, maxTotalTrades: b.maxTotalTrades, maxStaleMs: 60_000 } };
}
