import type { Lang, Key } from './i18n';
import { t } from './i18n';
export interface Draft { symbol: string; budget: string; trigger: 'price_at' | 'above' | 'below'; entryPrice: string; rsi: string;
  tp: string; sl: string; trail: string; holdMin: string; fee: string; slip: string; maxOpen: string }
export const emptyDraft = (): Draft => ({ symbol: '', budget: '1000', trigger: 'price_at', entryPrice: '', rsi: '', tp: '', sl: '', trail: '', holdMin: '', fee: '10', slip: '5', maxOpen: '1' });
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const bps = (s: string) => Math.round(Number(s) * 100);
export type Errors = Partial<Record<keyof Draft, Key>>;
/** Client-side validation for fast feedback only. The server re-validates everything and is authoritative. */
export function toPayload(d: Draft): { ok: true; payload: any } | { ok: false; errors: Errors } {
  const e: Errors = {}; const sym = d.symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z.]{0,5}$/.test(sym)) e.symbol = 'err_symbol';
  const budget = num(d.budget); if (!(budget >= 1 && budget <= 1_000_000)) e.budget = 'err_budget';
  const ep = num(d.entryPrice); if (!(ep > 0)) e.entryPrice = 'err_price';
  const opt = (k: keyof Draft, lo: number, hi: number, err: Key, int = false) => {
    if (d[k].trim() === '') return undefined; const v = Number(d[k]);
    if (!(v >= lo && v <= hi) || (int && !Number.isInteger(v))) { e[k] = err; return undefined; } return v; };
  const rsiBelow = opt('rsi', 1, 99, 'err_rsi');
  const tp = opt('tp', 0.01, 100, 'err_pct'), sl = opt('sl', 0.01, 100, 'err_pct'), trail = opt('trail', 0.01, 100, 'err_pct');
  const hold = opt('holdMin', 1, 525600, 'err_int', true);
  const fee = opt('fee', 0, 500, 'err_int', true) ?? 0, slip = opt('slip', 0, 500, 'err_int', true) ?? 0;
  const maxOpen = opt('maxOpen', 1, 20, 'err_int', true) ?? 1;
  if (Object.keys(e).length) return { ok: false, errors: e };
  return { ok: true, payload: { mode: 'PAPER', symbol: sym, budgetUsd: budget,
    entry: { trigger: d.trigger, priceUsd: ep, ...(rsiBelow !== undefined ? { rsiBelow } : {}) },
    exit: { ...(tp !== undefined ? { takeProfitBps: bps(d.tp) } : {}), ...(sl !== undefined ? { stopLossBps: bps(d.sl) } : {}),
      ...(trail !== undefined ? { trailingStopBps: bps(d.trail) } : {}), ...(hold !== undefined ? { maxHoldMs: hold * 60000 } : {}) },
    feeBps: fee, slippageBps: slip, maxOpenPositions: maxOpen } };
}
/** Lines shown on the confirmation screen, built from the exact payload that will be sent. */
export function summary(p: any, l: Lang): [string, string][] {
  const trig = { price_at: 'trig_price_at', above: 'trig_above', below: 'trig_below' }[p.entry.trigger as 'price_at'] as Key;
  const rows: [string, string][] = [[t(l, 'symbol'), p.symbol], [t(l, 'budget'), `$${p.budgetUsd}`], [t(l, 'trigger'), `${t(l, trig)} $${p.entry.priceUsd}`]];
  if (p.entry.rsiBelow !== undefined) rows.push([t(l, 'rsi'), String(p.entry.rsiBelow)]);
  const pc = (b?: number) => (b === undefined ? undefined : `${b / 100}%`);
  for (const [k, key] of [['takeProfitBps', 'tp'], ['stopLossBps', 'sl'], ['trailingStopBps', 'trail']] as const) { const v = pc(p.exit[k]); if (v) rows.push([t(l, key), v]); }
  if (p.exit.maxHoldMs) rows.push([t(l, 'hold'), String(p.exit.maxHoldMs / 60000)]);
  rows.push([t(l, 'fee'), String(p.feeBps)], [t(l, 'slip'), String(p.slippageBps)], [t(l, 'maxpos'), String(p.maxOpenPositions)]);
  return rows;
}
