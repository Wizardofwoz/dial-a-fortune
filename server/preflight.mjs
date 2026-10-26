// Config + Twilio account checks for the SOS call. No secrets or phone numbers leave this module.
import { demoPhone, twilioEnv, mask, DEMO_E164 } from "./config.mjs";
import { accountInfo, fromNumberInfo, TwilioError } from "./twilio.mjs";

const cache = (globalThis.__preflight ??= { at: 0, value: null });
const TTL = 60_000;

/** Fast synchronous checks, run on every SOS request. Returns an error string or "". */
export function staticError() {
  const d = demoPhone();
  if (d.error) return d.error;
  const t = twilioEnv();
  if (!t.sid || !t.token) return "Twilio credentials missing (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)";
  if (!t.from) return "TWILIO_FROM_NUMBER missing";
  if (!/^\+\d{8,15}$/.test(t.from)) return "TWILIO_FROM_NUMBER is not E.164";
  if (t.from === d.phone) return "TWILIO_FROM_NUMBER must differ from DEMO_PHONE_NUMBER";
  return "";
}

const describe = (e) => (e instanceof TwilioError ? `${e.message} (code ${e.code})` : e.message);

/** Remote checks (account type, From number voice capability), cached for a minute. */
export async function remoteChecks(force = false) {
  if (!force && cache.value && Date.now() - cache.at < TTL) return cache.value;
  const v = { accountType: "", trial: false, error: "", warnings: [] };
  try {
    const a = await accountInfo();
    v.accountType = a.type || "";
    v.trial = /trial/i.test(v.accountType);
    if (a.status && a.status !== "active") v.error = `Twilio account is ${a.status}`;
  } catch (e) {
    v.error = `Twilio account check failed: ${describe(e)}`;
  }
  if (!v.error) {
    try {
      const n = await fromNumberInfo();
      if (!n) v.warnings.push(`From ${mask(twilioEnv().from)} is not an incoming number on this account (verified caller ID?)`);
      else {
        console.log(`[preflight] from ${mask(twilioEnv().from)} capabilities: ${JSON.stringify(n.capabilities)}`);
        if (n.capabilities.voice === false) v.error = "TWILIO_FROM_NUMBER does not have Voice capability";
      }
    } catch (e) {
      v.warnings.push(`Could not read From number capabilities: ${describe(e)}`);
    }
  }
  for (const w of v.warnings) console.warn(`[preflight] ${w}`);
  console.log(`[preflight] account type=${v.accountType || "?"} trial=${v.trial} ${v.error ? "ERROR: " + v.error : "ok"}`);
  cache.at = Date.now(); cache.value = v;
  return v;
}

/** Everything the SOS request needs. */
export async function preflight(force = false) {
  const err = staticError();
  if (err) return { ok: false, error: err, trial: false };
  const r = await remoteChecks(force);
  return { ok: !r.error, error: r.error, trial: r.trial, accountType: r.accountType };
}

// Startup: run once and log the result (config problems show up in the logs immediately).
if (!staticError()) remoteChecks(true).catch((e) => console.warn("[preflight] startup check failed:", e.message));
else console.warn(`[preflight] startup: ${staticError()}`);
