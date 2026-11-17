# Security review (internal, code-level) - Paper Trading Bot

**Scope and limits.** Static review of engine/, server/, mobile/ plus the automated tests in this repo (39 server tests, incl. test/security.test.ts).
This is NOT a penetration test, NOT an external audit, and says nothing about the real PostgreSQL, Docker, TLS proxy, Alpaca or on-device behaviour (none could be run in the build sandbox).
Do not describe the system as "secure" or "certified" on the strength of this document.

## Findings fixed during this review (each has a test)
| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | High | `start` persisted "running" BEFORE subscribing to the feed; hitting the 30-symbol limit left a bot "running" with no data, and returned 500 | subscribe first, persist after, roll back on failure; clean 409; startup recovery pauses bots that cannot re-attach |
| 2 | High | Any user could create unlimited bots / consume the shared 30-symbol feed budget | max 5 bots per user; feed limit surfaced as 409 |
| 3 | High | Registration unthrottled (account flooding / CPU exhaustion via scrypt) | per-IP registration limiter (10/h) |
| 4 | Medium | No way to change password or revoke sessions; no account deletion (data retention) | password change (re-auth, revokes ALL sessions) and account deletion (re-auth, removes bots, sessions, push tokens, live sockets) |
| 5 | Medium | Re-auth endpoints could be used by a stolen session to brute-force the password | shared rate limit on re-auth attempts |
| 6 | Medium | Behind a proxy, login lockout keyed on the proxy IP would let anyone lock out a victim | `TRUST_PROXY=true` uses X-Forwarded-For (enable ONLY behind your own proxy) |
| 7 | Medium | Expired sessions accumulated | hourly purge |
| 8 | Low | WebSocket: no payload cap, unlimited connections per user | 1 KB payload cap, max 5 connections per user |
| 9 | Low | No cache/sniff headers; no request timeouts; malformed URL -> 500 | `no-store`, `nosniff`, header/request timeouts, 400 on bad URL |
| 10 | Low | No audit trail of auth events | JSON audit lines to stdout (login ok/fail/locked, register, password change, account delete). Never contains emails, passwords or tokens (tested) |
| 11 | Info | Container ran with root-owned files | `chown` to the non-root `node` user |

## Controls verified by tests (not new)
Per-user isolation on every bot route (other users get 404; WS events only to the owner) | scrypt password hashing, session tokens stored only as SHA-256 | uniform timing for unknown users | parameterised SQL only | input validation on every field | 10 KB body cap | PAPER-only enforced in 3 places (engine throws, DB CHECK constraint, API rejects other modes) | a source-scan test fails the build if any file references real order endpoints.

## Residual risks and things NOT verified (you must handle these)
1. **Real PostgreSQL**: SQL logic is tested through SQLite plus a Postgres-typed shim; apply `server/schema.postgres.sql` and run the suite against a real instance.
2. **TLS**: the server speaks plain HTTP. Production must sit behind an HTTPS proxy; the app refuses non-HTTPS URLs except for local development hosts, but the server itself does not enforce it.
3. **Dependencies**: no `npm audit` / lockfile review was possible offline. Mobile `package.json` uses `*` ranges: run `npx expo install --fix`, commit lockfiles, run `npm audit`, pin versions.
4. **Registration enumeration**: `409 email already registered` reveals which emails exist (accepted trade-off). Set `ALLOW_REGISTRATION=false` after creating your accounts.
5. **No password reset / email verification**: a forgotten password cannot be recovered (needs an email provider). Accounts are not email-verified.
6. **Multi-instance**: login/registration limiters and the bot runner are in-memory and single-process. Run ONE server instance; scaling out needs a shared limiter and a bot-ownership lock.
7. **Alpaca terms**: verify their data-licensing/display terms before a public release. Live Alpaca message format was built from documentation, not run against the live service.
8. **WebSocket sessions** are checked at connect time only; logout/password change/deletion terminate sockets, natural expiry does not.
9. **Mobile**: tokens live in Keychain/Keystore via SecureStore; no certificate pinning; the app was never run on a device.
10. Secrets (`ALPACA_*`, `DB_PASSWORD`) must come from environment/secret store only; `.env` is git-ignored.
