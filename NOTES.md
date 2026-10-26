## What this is
Dial a Fortune: React+Vite page (rotary dial -> fortune card). Server-side: 3 scheduled fortune texts per stick + SOS pep-talk call via Twilio.

## Current state
Everything works end to end against a fake Twilio server; real Twilio was not tested during the event (no creds in the build sandbox; without them it runs dry-run and logs instead of sending). No phone input anywhere in UI.

## Stack & key choices
- API = Vite middleware: `server/sos.mjs` (routes), `queue.mjs` (durable job queue `.data/jobs.json`, one worker loop, used by texts AND the SOS call), `texts.mjs`, `twilio.mjs`, `preflight.mjs` (config, Trial/Full account, From-number Voice check), `script.mjs` (pep talk -> preview + TwiML), `config.mjs`.
- Fortune data (level/color/tip/midday/evening) is in `shared/fortunes.mjs`, imported by both page and server.
- Config via env or gitignored `.env`: MODE (demo|real, default demo), DEMO_PHONE_NUMBER (E.164, server-only), TWILIO_ACCOUNT_SID/AUTH_TOKEN/TWILIO_FROM_NUMBER (old TWILIO_PHONE_NUMBER still accepted). Template: `.env.example`.
- demo: texts +0/+30s/+60s, SOS call 5s. real: +0/+4h/+9h, SOS 20s. Mode is logged at startup only.
- Page POSTs /api/draw {digit,lucky} on result and /api/draw/cancel on "Dial again"; server stores stick for SMS-SOS.

## Gotchas & environment facts
- Twilio inbound SMS webhook: POST <public-url>/api/sms; unsigned requests 403 unless SOS_ALLOW_UNSIGNED=1; set PUBLIC_BASE_URL if signature fails behind proxy.
- SMS-SOS only honored from DEMO_PHONE_NUMBER.
- Server code is plain .mjs, no @types/node.
- Changing .env needs a vite restart (server modules are cached). Check: `grep -c 5550123 dist/assets/*.js` after build -> 0 (the number must never reach the client bundle).
- SOS call is a queued job (no per-request setTimeout); page shows Twilio SID/status/error code; DEMO_PHONE_NUMBER must match ^\+1\d{10}$.
- server/*.mjs is imported by vite.config.ts, so any interval/timer there must be unref()'d or `pnpm build` never exits (it did, once).
- Offline failure-path test (21219, 21608, no SID, busy, bad phone, no voice): point TWILIO_API_BASE at a fake server. Real Twilio untested at build time.
- DEMO_PHONE_NUMBER is validated strictly (no trim): `for v in '+15555550123' ' +15555550123' '5555550123'; do DEMO_PHONE_NUMBER="$v" node -e 'import("./server/config.mjs").then(c=>console.log(c.demoPhone().error||"ok"))' 2>&1|tail -1; done` -> ok / rejected / rejected. Invalid value logs `[config] ERROR` at startup and disables texts+calls.
- UI says "Call done" only for Twilio status queued/ringing (SID shown); later statuses show their own label; errors show red `Error <code>: <message>`.
- SMS "SOS" from any number other than DEMO_PHONE_NUMBER is silently ignored (logged masked).
