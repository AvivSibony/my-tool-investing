# Go-live checklist (do in order; tick only what you actually verified)

## A. Before deploying
- [ ] `cd engine && npm i -D tsx typescript && npm test` -> all pass
- [ ] `cd server && npm i && npm test` -> all pass (39)
- [ ] `cd mobile && npm i && npx expo install --fix && npm test` -> all pass (7)
- [ ] Commit lockfiles; run `npm audit` in each package; fix high/critical
- [ ] Create `server/.env` from `.env.example` (never commit it); strong `DB_PASSWORD`
- [ ] Free Alpaca account -> data API keys into `.env`; start with `DATA_PROVIDER=mock`

## B. First run on a server
- [ ] Put an HTTPS reverse proxy in front (Caddy/nginx/cloud LB); set `TRUST_PROXY=true` only behind it
- [ ] `docker compose up -d --build`; confirm `GET https://<host>/healthz` -> 200 and `data.freshness` = `DEMO`
- [ ] Apply/verify `schema.postgres.sql` took effect; run the server test-suite against this Postgres once
- [ ] Register your account from the app, then set `ALLOW_REGISTRATION=false` and restart

## C. First run on a device
- [ ] `app.json`: real `bundleIdentifier` / `package`, EAS `projectId` for push
- [ ] Log in; create a bot; confirm the confirmation sheet shows exactly what you entered
- [ ] Mock feed: confirm trade opens/closes, notifications arrive, Hebrew RTL looks right (restart app after switching language)
- [ ] Kill and reopen the app and the server: bot state is restored, no duplicate trade
- [ ] Switch to `DATA_PROVIDER=alpaca`: confirm label says `ALPACA/IEX` / Real-time, NOT demo; unplug network and confirm bot pauses and a notification arrives
- [ ] Confirm every screen still shows the DEMO / virtual-money badge

## D. Never
- Do not add broker/order endpoints. The test `GUARD:` in server/test/security.test.ts exists to stop this.
