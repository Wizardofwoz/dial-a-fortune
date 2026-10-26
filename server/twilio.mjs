// Minimal Twilio REST client (no SDK). Credentials come from env vars only and are never logged.
import { twilioEnv, twilioLive, mask, maskDeep } from "./config.mjs";

export class TwilioError extends Error {
  constructor(message, { code = "TWILIO", status = 0, moreInfo = "" } = {}) {
    super(message);
    this.code = code; this.httpStatus = status; this.moreInfo = moreInfo;
  }
}

const base = () => process.env.TWILIO_API_BASE || "https://api.twilio.com"; // override only for local tests

/** Low-level call. Throws TwilioError with Twilio's own code/message. Logs the (masked) response. */
export async function api(label, pathname, params) {
  const { sid, token } = twilioEnv();
  if (!sid || !token) throw new TwilioError("Twilio credentials missing (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)", { code: "CONFIG" });
  let res, json;
  try {
    res = await fetch(`${base()}/2010-04-01/Accounts/${sid}/${pathname}`, {
      method: params ? "POST" : "GET",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: params ? new URLSearchParams(params) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    console.warn(`[twilio] ${label}: network error: ${e.name}: ${e.message}`);
    throw new TwilioError(`Could not reach Twilio (${e.name})`, { code: "NETWORK" });
  }
  console.log(`[twilio] ${label} -> HTTP ${res.status} ${JSON.stringify(maskDeep(json))}`);
  if (!res.ok) throw new TwilioError(json.message || `Twilio HTTP ${res.status}`, { code: json.code ?? res.status, status: res.status, moreInfo: json.more_info || "" });
  return json;
}

/** Account-level resource (type Trial/Full, status). */
export async function accountInfo() {
  const { sid, token } = twilioEnv();
  const res = await fetch(`${base()}/2010-04-01/Accounts/${sid}.json`, {
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") },
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => { throw new TwilioError(`Could not reach Twilio (${e.name})`, { code: "NETWORK" }); });
  const json = await res.json().catch(() => ({}));
  console.log(`[twilio] account lookup -> HTTP ${res.status} type=${json.type} status=${json.status} ${res.ok ? "" : `code=${json.code} message=${json.message}`}`);
  if (!res.ok) throw new TwilioError(json.message || `Twilio HTTP ${res.status}`, { code: json.code ?? res.status, status: res.status });
  return { type: json.type, status: json.status };
}

/** Capabilities of the From number via IncomingPhoneNumbers. Returns null if it is not an incoming number. */
export async function fromNumberInfo() {
  const { from } = twilioEnv();
  const json = await api("from-number lookup", `IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`);
  const n = (json.incoming_phone_numbers || [])[0];
  return n ? { capabilities: n.capabilities || {} } : null;
}

/** Text any E.164 number. Dry-run (log only) when Twilio is not configured. */
export async function sendSms(to, body) {
  if (!to) return console.warn("[sms] no valid destination configured; skipped");
  if (!twilioLive()) return console.log(`[sms] dry-run to ${mask(to)} (${body.length} chars): ${body.split("\n")[0]}`);
  const m = await api("sms send", "Messages.json", { To: to, From: twilioEnv().from, Body: body });
  console.log(`[sms] ${m.sid} ${m.status} to ${mask(to)} (${body.length} chars): ${body.split("\n")[0]}`);
}

export const placeCall = (to, twiml) => api("call create", "Calls.json", { To: to, From: twilioEnv().from, Twiml: twiml });
export const callStatus = (sid) => api("call status", `Calls/${sid}.json`);
