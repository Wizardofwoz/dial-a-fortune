// Server-side config. Only read on the server; never sent to the page.
// MODE=demo (default) | real  -> the single switch for all timing.
import fs from "node:fs";

try { // tiny .env loader (does not override real environment variables)
  for (const line of fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file */ }

const MIN = 60_000, HOUR = 3_600_000;
const MODES = {
  demo: { textOffsets: [0, 30_000, 60_000], sosDelayMs: 5_000 },
  real: { textOffsets: [0, 4 * HOUR, 9 * HOUR], sosDelayMs: 20_000 },
};

const requested = (process.env.MODE || "demo").trim().toLowerCase();
export const MODE = MODES[requested] ? requested : "demo";
export const timing = MODES[MODE];
export const E164 = /^\+[1-9]\d{7,14}$/; // generic, for inbound SMS senders
export const DEMO_E164 = /^\+1\d{10}$/; // DEMO_PHONE_NUMBER must be a US/CA E.164 number
export const PHONE_ERROR = "DEMO_PHONE_NUMBER missing or not E.164";
/** Read on every call so each SOS request re-validates the destination. */
export const demoPhone = () => {
  const v = process.env.DEMO_PHONE_NUMBER ?? ""; // strict: no trimming, any stray space or dash is rejected
  return DEMO_E164.test(v) ? { phone: v, error: "" } : { phone: "", error: PHONE_ERROR };
};
export const twilioEnv = () => ({
  sid: process.env.TWILIO_ACCOUNT_SID,
  token: process.env.TWILIO_AUTH_TOKEN,
  from: (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || "").trim(), // TWILIO_PHONE_NUMBER = legacy name
});
export const twilioLive = () => Object.values(twilioEnv()).every(Boolean);
export const mask = (p) => (p ? "***" + String(p).slice(-4) : "(unset)");
/** Mask any phone-like string and account SIDs inside a value (for logging Twilio responses). */
export const maskDeep = (v, key = "") => {
  if (typeof v === "string") {
    if (key === "account_sid") return mask(v);
    return v.replace(/\+\d{8,15}/g, (m) => mask(m));
  }
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, key));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x, k)]));
  return v;
};

// Mode appears in server logs only; the destination is never logged unmasked.
if (!MODES[requested]) console.warn(`[config] unknown MODE="${requested}", falling back to demo`);
console.log(`[config] MODE=${MODE} texts at +${timing.textOffsets.map((t) => t / MIN + "m").join(", +")}; SOS call delay ${timing.sosDelayMs / 1000}s`);
{
  const d = demoPhone();
  if (d.error) {
    const raw = process.env.DEMO_PHONE_NUMBER;
    const why = raw === undefined || raw === "" ? "it is not set" : `got ${raw.length} characters${/\s/.test(raw) ? " including whitespace" : ""}${/[^+\d]/.test(raw) ? " with characters other than + and digits" : ""}`;
    console.error(`[config] ERROR: ${d.error}. Expected /^\\+1\\d{10}$/ (e.g. +15555550123); ${why}. Texts and SOS calls are disabled until this is fixed.`);
  } else console.log(`[config] DEMO_PHONE_NUMBER ok, destination ${mask(d.phone)}`);
  const t = twilioEnv();
  const missing = [["TWILIO_ACCOUNT_SID", t.sid], ["TWILIO_AUTH_TOKEN", t.token], ["TWILIO_FROM_NUMBER", t.from]].filter(([, v]) => !v).map(([k]) => k);
  console.log(missing.length ? `[config] ERROR: missing ${missing.join(", ")}` : `[config] Twilio credentials present, from ${mask(t.from)}`);
}
