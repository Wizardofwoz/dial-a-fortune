# Dial a Fortune

Built by **Junyuan Jennifer Pang** at Walk & Hack, the AI Tinkerers NYC × Twilio build-while-you-walk event in Central Park on October 24, 2026, and voted Best Use of Twilio. The app was built by texting a coding agent from the park; this repo is the code that came out, packaged so it runs on your own Twilio account.

Spin a rotary dial, get a fortune. The server then texts you three follow-ups through the day and, if you hit SOS, calls you with a pep talk.

## Run it

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open http://localhost:3000. In the default `demo` mode nothing is sent: texts and the call are logged to the terminal, on a fast schedule (texts at +0 s, +30 s, +60 s; SOS call after 5 s).

## Connect your Twilio account

Edit `.env`:

```
MODE=real
DEMO_PHONE_NUMBER=+1XXXXXXXXXX      # the one number the app texts and calls (yours)
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_FROM_NUMBER=+1XXXXXXXXXX     # a Twilio number with SMS and Voice
```

Restart `pnpm dev` after changing `.env` (server modules are cached). `real` mode texts at +0, +4 h and +9 h and places the SOS call after 20 s.

To let someone text **SOS** back to the number, Twilio has to reach the app:

1. Expose it, e.g. `ngrok http 3000`.
2. In the Twilio console, set the number's messaging webhook to `POST https://<your-host>/api/sms`.
3. Set `PUBLIC_BASE_URL=https://<your-host>` in `.env` so signature checks pass behind the proxy.

Only texts from `DEMO_PHONE_NUMBER` are honored. The number is never sent to the browser; `pnpm build` then `grep -c <digits> dist/assets/*.js` should print 0.

## Layout

- `src/` the page (React + Vite): rotary dial, fortune card, SOS button.
- `server/` the API, mounted as Vite middleware: `sos.mjs` routes, `queue.mjs` durable job queue (`.data/jobs.json`), `texts.mjs`, `twilio.mjs` (REST, no SDK), `preflight.mjs` account checks, `script.mjs` pep-talk script and TwiML, `config.mjs`.
- `shared/fortunes.mjs` fortune data used by both.
- `NOTES.md` the builder's working notes from the event, kept as-is apart from scrubbing a phone number.

Real Twilio was not exercised during the event (the build sandbox had no credentials), so expect to debug the first live send. `preflight.mjs` reports the usual trial-account and from-number problems with their Twilio error codes.
