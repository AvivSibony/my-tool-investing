import test from 'node:test'; import assert from 'node:assert/strict';
import { fmtUsd, fmtPrice4, fmtPct } from '../src/format'; import { dict } from '../src/i18n'; import { emptyDraft, toPayload, summary } from '../src/draft';
import { validateBotInput } from '../../server/src/validate';
const strip = (s: string) => s.replace(/[\u2066\u2069]/g, '');
test('money formatting is exact integer math', () => {
  assert.equal(strip(fmtUsd(123456789)), '$1,234,567.89'); assert.equal(strip(fmtUsd(-5)), '-$0.05'); assert.equal(strip(fmtUsd(7677, true)), '+$76.77');
  assert.equal(strip(fmtUsd(0, true)), '$0.00'); assert.equal(strip(fmtPrice4(1005000)), '$100.50'); assert.equal(fmtPrice4(null), '—');
  assert.equal(strip(fmtPct(7677, 10_000_000)), '+0.08%'); assert.equal(fmtPct(1, 0), '—');
});
test('Hebrew and English dictionaries have identical keys, none empty', () => {
  assert.deepEqual(Object.keys(dict.he).sort(), Object.keys(dict.en).sort());
  for (const l of ['he', 'en'] as const) for (const [k, v] of Object.entries(dict[l])) assert.ok(v.trim(), `${l}.${k}`);
});
test('draft -> payload: converts percents to bps, minutes to ms, always PAPER', () => {
  const r = toPayload({ ...emptyDraft(), symbol: ' tsla', entryPrice: '200.5', tp: '5', sl: '2.5', trail: '1', holdMin: '30', rsi: '30' });
  assert.ok(r.ok); if (!r.ok) return;
  assert.deepEqual(r.payload.exit, { takeProfitBps: 500, stopLossBps: 250, trailingStopBps: 100, maxHoldMs: 1_800_000 });
  assert.equal(r.payload.mode, 'PAPER'); assert.equal(r.payload.symbol, 'TSLA'); assert.equal(r.payload.entry.rsiBelow, 30);
});
test('draft validation reports field errors', () => {
  const r = toPayload({ ...emptyDraft(), symbol: '1x', budget: '0', entryPrice: '', tp: '500', maxOpen: '1.5' });
  assert.ok(!r.ok); if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['budget', 'entryPrice', 'maxOpen', 'symbol', 'tp']);
});
test('every payload the app can produce passes the SERVER validator (contract check)', () => {
  for (const trigger of ['price_at', 'above', 'below'] as const) {
    const r = toPayload({ ...emptyDraft(), symbol: 'NVDA', trigger, entryPrice: '120', tp: '4', sl: '2', trail: '1.5', holdMin: '60', rsi: '35', fee: '10', slip: '5', maxOpen: '3' });
    assert.ok(r.ok); if (r.ok) { const v = validateBotInput(r.payload); assert.ok(v.ok, JSON.stringify(v)); }
  }
});
test('confirmation summary lists the exact values and works in both languages', () => {
  const r = toPayload({ ...emptyDraft(), symbol: 'AAPL', entryPrice: '100', tp: '5' }); assert.ok(r.ok); if (!r.ok) return;
  for (const l of ['he', 'en'] as const) { const rows = summary(r.payload, l); assert.ok(rows.some(([, v]) => v === 'AAPL')); assert.ok(rows.some(([, v]) => v === '5%')); }
});
import { isAllowedServerUrl } from '../src/url';
test('server URL policy: https anywhere, http only for local/private development hosts', () => {
  for (const ok of ['https://api.example.com', 'HTTPS://x.io:8443/p', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://192.168.1.20:3000', 'http://10.0.2.2:3000', 'http://172.16.0.5', 'http://mac.local:3000']) assert.ok(isAllowedServerUrl(ok), ok);
  for (const bad of ['http://example.com', 'http://8.8.8.8:3000', 'http://172.32.0.1', 'http://192.169.1.1', 'ftp://x.io', 'example.com', '', 'http://999.1.1.1', 'http://localhost.evil.com', 'javascript:alert(1)']) assert.ok(!isAllowedServerUrl(bad), bad);
});
