import { DatabaseSync } from 'node:sqlite';
/** Minimal async SQL interface. Queries use Postgres-style $1 placeholders and a dialect-neutral SQL subset. */
export interface Db { query(text: string, params?: unknown[]): Promise<any[]>; close(): Promise<void> }
export function sqliteDb(path = ':memory:'): Db {
  const d = new DatabaseSync(path);
  return { async query(text, params = []) { return d.prepare(text.replace(/\$(\d+)/g, '?$1')).all(...(params as any[])) as any[]; }, async close() { d.close(); } };
}
/** `pool` is a node-postgres Pool (not available in this sandbox, so this adapter is UNTESTED here). */
export function pgDb(pool: { query(t: string, p?: unknown[]): Promise<{ rows: any[] }>; end(): Promise<void> }): Db {
  return { async query(text, params = []) { return (await pool.query(text, params)).rows; }, async close() { await pool.end(); } };
}
export const SQLITE_DDL = [
  `create table if not exists users(id text primary key, email text unique not null, pw_hash text not null, created_at integer not null)`,
  `create table if not exists sessions(token_hash text primary key, user_id text not null references users(id), expires_at integer not null)`,
  `create table if not exists bots(id text primary key, user_id text not null references users(id), config text not null, state text not null,
     mode text not null default 'PAPER' check (mode = 'PAPER'), status text not null check (status in ('running','paused','stopped')), updated_at integer not null)`,
  `create table if not exists push_tokens(token text primary key, user_id text not null references users(id), lang text not null, created_at integer not null)`,
];
