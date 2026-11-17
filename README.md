# Paper Trading Bot (DEMO ONLY - no real money, no broker code)
engine/  pure trading engine + tests        (cd engine && npm i -D tsx typescript && npm test)
server/  Node API + WebSocket + mock feed   (cd server && npm i && npm test)   schema.postgres.sql = target DB (not yet run)
mobile/  Expo app (he/en, RTL)              (cd mobile && npm i && npx expo install --fix && npx expo start)
See DEPLOY_CHECKLIST.md (go-live order) and SECURITY.md (review scope, findings, residual risks).
NOT YET DONE: real-Postgres verification, Docker deployment test, push delivery on a device, live Alpaca verification, on-device UI testing. No Redis (not needed yet).
