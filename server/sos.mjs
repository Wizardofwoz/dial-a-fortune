// Dial a Fortune backend routes: draw -> 3 queued texts, SOS call (button or SMS), pep-talk preview.
// The destination number (DEMO_PHONE_NUMBER) and Twilio credentials stay on the server.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MODE, timing, E164, demoPhone, twilioEnv, mask, maskDeep } from "./config.mjs";
import { sendSms, placeCall, callStatus, TwilioError } from "./twilio.mjs";
import { preflight } from "./preflight.mjs";
import { startSequence, cancelPending } from "./texts.mjs";
import { register, add, get, active, update } from "./queue.mjs";
import { buildScript, cleanFortune, cleanSituation, estimateSeconds, toTwiml } from "./script.mjs";
import { fortuneForDigit } from "../shared/fortunes.mjs";

const DB_FILE = path.resolve(process.env.SOS_DATA_FILE || ".data/senders.json");
const NEED_FORTUNE = "Get a fortune first: open the app and dial a number, then text again. 先拨一签 ✨";
const confirmText = () => `Incoming in ${timing.sosDelayMs / 1000} seconds. Say 'sorry, I need to take this.'`;
const PLACED = new Set(["queued", "initiated", "ringing", "in-progress", "completed"]);
const FINAL_BAD = new Set(["failed", "busy", "no-answer", "canceled"]);
const FINAL = new Set([...FINAL_BAD, "completed"]);

// Friendlier text for the errors people actually hit. Twilio's own code is always kept.
const HINTS = {
  21219: "Trial account: this number is not a Verified Caller ID. Verify it in the Twilio console.",
  21608: "Trial account: the destination or From number is not verified in the Twilio console.",
  21211: "Twilio rejected the destination as an invalid phone number.",
  21215: "Twilio's geo permissions block calls to this country. Enable it in Voice > Geo permissions.",
  21212: "TWILIO_FROM_NUMBER is not a valid caller ID for this account.",
  20003: "Twilio authentication failed. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.",
};
/** Error shape shown on the page. Phone numbers are masked; secrets never appear. */
const pageError = (e) => {
  const code = e?.code ?? "ERROR";
  const raw = String(maskDeep(e?.message || "SOS failed"));
  return { code, message: HINTS[code] ? `${HINTS[code]} (${raw})` : raw };
};

// ---- latest stick per destination (so SMS "SOS" can use it) ----
let db = {};
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { /* first run */ }
function saveFortune(who, fortune) {
  db[who] = { ...cleanFortune(fortune), at: Date.now() };
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), { mode: 0o600 });
  } catch (e) { console.warn("[sos] could not persist senders:", e.message); }
}

const hitsByKey = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const hits = (hitsByKey.get(key) || []).filter((t) => now - t < windowMs);
  const over = hits.length >= max;
  if (!over) hits.push(now);
  hitsByKey.set(key, hits);
  return over;
}

// ---- the call job: runs from the durable queue once the delay has elapsed ----
register("call", async (job) => {
  const d = demoPhone();
  if (d.error) throw new TwilioError(d.error, { code: "CONFIG" });
  const pre = await preflight();
  if (!pre.ok) throw new TwilioError(pre.error, { code: "CONFIG" });
  const steps = buildScript(job.payload.fortune, job.payload.situation);
  console.log(`[call] placing call to ${mask(d.phone)} from ${mask(twilioEnv().from)} (~${estimateSeconds(steps)}s script)`);
  const call = await placeCall(d.phone, toTwiml(steps));
  console.log(`[call] create response: sid=${call.sid || "(none)"} status=${call.status} error_code=${call.error_code ?? "-"} error_message=${call.error_message ?? "-"} to=${mask(call.to)} from=${mask(call.from)}`);
  if (!call.sid) throw new TwilioError("Twilio returned no call SID", { code: "NO_SID" });
  if (call.error_code) throw new TwilioError(call.error_message || "Twilio reported an error", { code: call.error_code });
  if (!PLACED.has(call.status)) throw new TwilioError(`Call was not accepted (status: ${call.status})`, { code: "BAD_STATUS" });
  return { sid: call.sid, status: call.status, lastPoll: 0 };
}, { maxLateMs: 60_000 });

/** Validate config, then queue the call. Returns { job } | { error:{code,message} }. */
async function trigger(situation, source) {
  const pre = await preflight(); // static checks run fresh every time; account checks are cached 60s
  if (!pre.ok) { console.warn(`[sos] ${source} trigger refused: ${pre.error}`); return { error: { code: "CONFIG", message: pre.error } }; }
  const phone = demoPhone().phone;
  const fortune = db[phone];
  if (!fortune) return { error: { code: "NO_FORTUNE", message: "Draw a fortune first. 先拨一签" } };
  const running = active("call");
  if (running) return { job: running, duplicate: true };
  if (limited("sos-min", 1, 20_000) || limited("sos-day", 10, 24 * 3600_000)) return { error: { code: "RATE", message: "Easy there, try again in a bit." } };
  const job = add({
    kind: "call", runAt: Date.now() + timing.sosDelayMs,
    payload: { fortune, situation: cleanSituation(situation), source },
  });
  console.log(`[sos] ${source} trigger accepted (MODE=${MODE}); job ${job.id}, call in ${timing.sosDelayMs / 1000}s${job.payload.situation ? ", situation set" : ""}; to ${mask(phone)}, from ${mask(twilioEnv().from)}`);
  return { job, trial: pre.trial };
}

/** What the page sees for a job; refreshes the live call status from Twilio while it is in flight. */
async function view(job) {
  const base = { id: job.id, callAt: job.runAt };
  if (job.state === "pending") return { ...base, phase: "scheduled" };
  if (job.state === "running") return { ...base, phase: "placing" };
  if (job.state === "cancelled") return { ...base, phase: "error", error: { code: "CANCELLED", message: "SOS was cancelled" } };
  if (job.state === "failed" && !job.result?.sid) return { ...base, phase: "error", error: pageError(job.error) };
  const r = job.result;
  if (!FINAL.has(r.status) && Date.now() - (r.lastPoll || 0) > 2000) {
    r.lastPoll = Date.now();
    try {
      const c = await callStatus(r.sid);
      if (c.status && c.status !== r.status) console.log(`[call] ${r.sid} status ${r.status} -> ${c.status}${c.error_code ? ` error_code=${c.error_code}` : ""}`);
      r.status = c.status || r.status;
      if (c.duration) r.duration = c.duration;
    } catch (e) { console.warn(`[call] status poll failed: ${e.code} ${e.message}`); }
    update(job, { result: r });
  }
  const out = { ...base, phase: "placed", sid: r.sid, status: r.status, duration: r.duration };
  if (FINAL_BAD.has(r.status)) out.error = { code: r.status, message: `Call ${r.status}` };
  return out;
}

// ---- HTTP plumbing ----
async function readBody(req, limit = 20_000) {
  let data = "";
  for await (const chunk of req) { data += chunk; if (data.length > limit) throw new Error("too large"); }
  return data;
}
const sendJson = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
};
const xmlEsc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sendXml = (res, inner) => {
  res.setHeader("Content-Type", "text/xml");
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);
};
const reply = (res, text) => sendXml(res, text ? `<Message>${xmlEsc(text)}</Message>` : "");

function validSignature(req, params) {
  const { token } = twilioEnv();
  if (!token) return process.env.SOS_ALLOW_UNSIGNED === "1"; // unsigned webhooks refused unless explicitly allowed
  const base = process.env.PUBLIC_BASE_URL ||
    `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const data = base.replace(/\/$/, "") + req.url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expect = crypto.createHmac("sha1", token).update(data).digest("base64");
  const got = String(req.headers["x-twilio-signature"] || "");
  return got.length === expect.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expect));
}

export async function handle(req, res, next) {
  const url = (req.url || "").split("?")[0];
  if (!url.startsWith("/api/")) return next();
  try {
    if (req.method === "GET" && url === "/api/sos/info") { // lets the page show the trial notice
      const pre = await preflight();
      return sendJson(res, 200, { trial: !!pre.trial });
    }
    if (req.method === "GET" && url.startsWith("/api/sos/status/")) {
      const job = get(url.split("/").pop());
      return job && job.kind === "call" ? sendJson(res, 200, await view(job)) : sendJson(res, 404, { error: { code: "UNKNOWN", message: "Unknown SOS job" } });
    }
    if (req.method !== "POST") return next();
    const raw = await readBody(req);

    if (url === "/api/sms") { // Twilio inbound SMS webhook (the fortune line)
      const params = Object.fromEntries(new URLSearchParams(raw));
      if (!validSignature(req, params)) { res.statusCode = 403; return res.end("bad signature"); }
      const m = /^\s*sos\b[\s:,.-]*(.*)$/i.exec(params.Body || "");
      if (!m || !E164.test(params.From || "")) return reply(res, "");
      if (params.From !== demoPhone().phone) { console.warn(`[sms] SOS text from ${mask(params.From)} ignored (not the demo number)`); return reply(res, ""); }
      if (!db[params.From]) return reply(res, NEED_FORTUNE);
      const out = await trigger(m[1], "sms");
      if (out.error) return reply(res, `SOS couldn't start: ${out.error.message} (code ${out.error.code})`);
      return reply(res, out.duplicate ? "Already on its way." : confirmText());
    }

    const body = raw ? JSON.parse(raw) : {};

    if (url === "/api/draw") { // a stick was drawn: store it and queue the 3 texts
      if (limited("draw-min", 1, 3_000) || limited("draw-hour", 20, 3600_000)) return sendJson(res, 429, { error: "Slow down." });
      const digit = Math.min(9, Math.max(0, parseInt(body.digit, 10) || 0));
      const lucky = Math.min(99, Math.max(1, parseInt(body.lucky, 10) || 1));
      const f = fortuneForDigit(digit);
      const d = demoPhone();
      if (d.error) console.warn(`[texts] ${d.error}; texts skipped`);
      else { saveFortune(d.phone, { digit, stick: lucky, poem: f.main, poemAlt: f.sub, topic: f.tag }); startSequence(digit, lucky); }
      return sendJson(res, 200, { ok: true });
    }
    if (url === "/api/draw/cancel") { cancelPending(); return sendJson(res, 200, { ok: true }); }

    if (url === "/api/sos/preview") {
      const steps = buildScript(body.fortune, body.situation);
      return sendJson(res, 200, { steps, seconds: estimateSeconds(steps) });
    }
    if (url === "/api/sos") {
      const out = await trigger(body.situation, "button");
      if (out.error) return sendJson(res, out.error.code === "RATE" ? 429 : 400, { error: out.error });
      if (!out.duplicate) await sendSms(demoPhone().phone, confirmText()).catch((e) => console.warn(`[sms] confirm failed: ${e.code} ${e.message}`));
      return sendJson(res, 200, { ...(await view(out.job)), trial: !!out.trial });
    }
    return next();
  } catch (e) {
    console.warn("[api] error:", e.message);
    return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Bad request" } });
  }
}
