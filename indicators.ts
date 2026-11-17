export function sma(values: number[], n: number): number | undefined {
  if (n <= 0 || values.length < n) return undefined;
  return values.slice(-n).reduce((a, b) => a + b, 0) / n;
}
/** Wilder RSI. Needs n+1 values. */
export function rsi(values: number[], n = 14): number | undefined {
  if (values.length < n + 1) return undefined;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / n, al = loss / n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    ag = (ag * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (al === 0) return ag === 0 ? 50 : 100;
  return 100 - 100 / (1 + ag / al);
}
