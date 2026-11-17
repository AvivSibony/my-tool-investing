// Integer-only money formatting (cents / price4). Wrapped in bidi isolates so numbers & tickers stay LTR inside Hebrew text.
export const ltr = (s: string) => `\u2066${s}\u2069`;
export function fmtUsd(cents: number, signed = false): string {
  const neg = cents < 0, a = Math.abs(Math.round(cents));
  const body = `$${Math.trunc(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(a % 100).padStart(2, '0')}`;
  return ltr(`${neg ? '-' : signed && cents > 0 ? '+' : ''}${body}`);
}
export const fmtPrice4 = (p4: number | null | undefined) => (p4 == null ? '—' : fmtUsd(Math.round(p4 / 100)));
export function fmtPct(num: number, den: number): string {
  if (!den) return '—'; const v = (num / den) * 100;
  return ltr(`${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
}
export const pnlColor = (cents: number, C: { up: string; down: string; muted: string }) => (cents > 0 ? C.up : cents < 0 ? C.down : C.muted);
export const fmtTime = (ts: number) => ltr(new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
