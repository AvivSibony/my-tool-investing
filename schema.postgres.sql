-- PostgreSQL schema used by SqlRepo (DATABASE_URL). NOT executed in the build sandbox: apply and verify on a real instance.
-- Bot state (positions, trades, events) lives in bots.state JSONB; the engine is a pure function over that document.
create table if not exists users(id text primary key, email text unique not null, pw_hash text not null, created_at bigint not null);
create table if not exists sessions(token_hash text primary key, user_id text not null references users(id) on delete cascade, expires_at bigint not null);
create table if not exists bots(
  id text primary key, user_id text not null references users(id) on delete cascade,
  config jsonb not null, state jsonb not null,
  mode text not null default 'PAPER' check (mode = 'PAPER'),
  status text not null check (status in ('running','paused','stopped')), updated_at bigint not null);
create index if not exists bots_active on bots(status) where status in ('running','paused');
create index if not exists bots_user on bots(user_id);
create table if not exists push_tokens(token text primary key, user_id text not null references users(id) on delete cascade, lang text not null, created_at bigint not null);
