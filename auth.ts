import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
// Standard primitives only: scrypt for passwords, random opaque session tokens stored as SHA-256 hashes.
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export function hashPassword(pw: string): string {
  const salt = randomBytes(16); const h = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
const DUMMY = hashPassword('dummy-password-for-timing');
export function verifyPassword(pw: string, stored: string | undefined): boolean {
  const [alg, s, h] = (stored ?? DUMMY).split('$'); if (alg !== 'scrypt') return false;
  const exp = Buffer.from(h, 'base64'); const got = scryptSync(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(exp, got) && stored !== undefined;                   // unknown user: same work, always false
}
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');
export function validateCredentials(b: any): { ok: true; email: string; password: string } | { ok: false; error: string } {
  const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : ''; const password = typeof b?.password === 'string' ? b.password : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalid email' };
  if (password.length < 10 || password.length > 128) return { ok: false, error: 'password must be 10-128 characters' };
  return { ok: true, email, password };
}
export class LoginLimiter {
  private m = new Map<string, { n: number; t0: number }>();
  constructor(private max = 5, private windowMs = 15 * 60_000, private clock = () => Date.now()) {}
  blocked(key: string) { const e = this.m.get(key); if (!e) return false; if (this.clock() - e.t0 > this.windowMs) { this.m.delete(key); return false; } return e.n >= this.max; }
  fail(key: string) { const e = this.m.get(key); if (!e || this.clock() - e.t0 > this.windowMs) this.m.set(key, { n: 1, t0: this.clock() }); else e.n++; }
  reset(key: string) { this.m.delete(key); }
}
