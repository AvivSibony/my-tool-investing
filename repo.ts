import type { BotConfig, BotState } from '../../engine/src/types';
import { Db, sqliteDb, SQLITE_DDL } from './db';
export interface BotRow { id: string; userId: string; config: BotConfig; state: BotState }
export interface UserRow { id: string; email: string; pwHash: string }
const J = (x: any) => (typeof x === 'string' ? JSON.parse(x) : x);          // pg returns parsed jsonb, sqlite returns text
const botRow = (r: any): BotRow => ({ id: r.id, userId: r.user_id, config: J(r.config), state: J(r.state) });
export class EmailTakenError extends Error {}

/** One repository for both SQLite (tests/dev) and PostgreSQL (production). Same SQL, different Db adapter. */
export class SqlRepo {
  constructor(private db: Db) {}
  async createUser(id: string, email: string, pwHash: string) {
    try { await this.db.query('insert into users(id,email,pw_hash,created_at) values($1,$2,$3,$4)', [id, email, pwHash, Date.now()]); }
    catch (e: any) { if (/UNIQUE|unique|23505/.test(`${e?.message} ${e?.code}`)) throw new EmailTakenError(); throw e; }
  }
  async userByEmail(email: string): Promise<UserRow | undefined> {
    const r = (await this.db.query('select * from users where email=$1', [email]))[0]; return r && { id: r.id, email: r.email, pwHash: r.pw_hash };
  }
  async createSession(tokenHash: string, userId: string, expiresAt: number) { await this.db.query('insert into sessions(token_hash,user_id,expires_at) values($1,$2,$3)', [tokenHash, userId, expiresAt]); }
  async session(tokenHash: string): Promise<{ userId: string; expiresAt: number } | undefined> {
    const r = (await this.db.query('select * from sessions where token_hash=$1', [tokenHash]))[0]; return r && { userId: r.user_id, expiresAt: Number(r.expires_at) };   // int8 arrives as string in pg
  }
  async deleteSession(tokenHash: string) { await this.db.query('delete from sessions where token_hash=$1', [tokenHash]); }
  async savePushToken(userId: string, token: string, lang: string) {
    await this.db.query('delete from push_tokens where token=$1', [token]);                    // a device token belongs to its latest user
    await this.db.query('insert into push_tokens(token,user_id,lang,created_at) values($1,$2,$3,$4)', [token, userId, lang, Date.now()]); }
  async removePushToken(token: string, userId?: string) {
    if (userId) await this.db.query('delete from push_tokens where token=$1 and user_id=$2', [token, userId]); else await this.db.query('delete from push_tokens where token=$1', [token]); }
  async pushTokens(userId: string): Promise<{ token: string; lang: string }[]> { return (await this.db.query('select token, lang from push_tokens where user_id=$1', [userId])).map(r => ({ token: r.token, lang: r.lang })); }
  async userById(id: string): Promise<UserRow | undefined> { const r = (await this.db.query('select * from users where id=$1', [id]))[0]; return r && { id: r.id, email: r.email, pwHash: r.pw_hash }; }
  async setPassword(userId: string, pwHash: string) { await this.db.query('update users set pw_hash=$1 where id=$2', [pwHash, userId]); await this.db.query('delete from sessions where user_id=$1', [userId]); }   // revokes every session
  async purgeExpiredSessions(now: number) { await this.db.query('delete from sessions where expires_at < $1', [now]); }
  async botsOfUser(userId: string): Promise<BotRow[]> { return (await this.db.query('select * from bots where user_id=$1', [userId])).map(botRow); }
  /** Irreversibly removes the account and everything it owns. */
  async deleteUser(userId: string) { for (const t of ['push_tokens', 'sessions', 'bots']) await this.db.query(`delete from ${t} where user_id=$1`, [userId]); await this.db.query('delete from users where id=$1', [userId]); }
  async ping() { await this.db.query('select 1 as ok'); }
  async insert(r: BotRow) { await this.db.query('insert into bots(id,user_id,config,state,status,updated_at) values($1,$2,$3,$4,$5,$6)',
    [r.id, r.userId, JSON.stringify(r.config), JSON.stringify(r.state), r.state.status, Date.now()]); }
  async save(id: string, s: BotState) { await this.db.query('update bots set state=$1, status=$2, updated_at=$3 where id=$4', [JSON.stringify(s), s.status, Date.now(), id]); }
  async get(id: string): Promise<BotRow | undefined> { const r = (await this.db.query('select * from bots where id=$1', [id]))[0]; return r && botRow(r); }
  async active(): Promise<BotRow[]> { return (await this.db.query("select * from bots where status in ('running','paused')")).map(botRow); }
  close() { return this.db.close(); }
}
export async function openSqliteRepo(path = ':memory:') { const db = sqliteDb(path); for (const s of SQLITE_DDL) await db.query(s); return new SqlRepo(db); }
