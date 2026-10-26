// Fortune texts: exactly 3 SMS per drawn stick, sent by the durable queue (see queue.mjs),
// so they go out even if the page is closed or the server restarts mid-sequence.
import crypto from "node:crypto";
import { MODE, timing, demoPhone, mask } from "./config.mjs";
import { sendSms } from "./twilio.mjs";
import { register, add, cancelGroup, cancelKind } from "./queue.mjs";
import { fortuneForDigit } from "../shared/fortunes.mjs";

const LABELS = ["morning", "midday", "evening"];

export function composeTexts(digit, lucky) {
  const f = fortuneForDigit(digit);
  const lvl = `${f.level.en} ${f.level.zh}`;
  return [
    [
      "Good morning 🌅",
      `Stick #${lucky} (your lucky number) · ${lvl}`,
      `${f.main} ${f.sub}`,
      `Today's tip: ${f.tip}`,
      `Lucky color: ${f.color.en} ${f.color.zh}`,
    ].join("\n"),
    ["Midday check-in 🍵", `${f.midday} With ${lvl} on your side, go try today's tip.`].join("\n"),
    ["Evening 🌙", f.evening, "Dial again tomorrow for a new stick."].join("\n"),
  ];
}

// The destination is resolved when the text is sent, never stored in the queue file.
register("sms", async (job) => {
  const d = demoPhone();
  if (d.error) throw Object.assign(new Error(d.error), { code: "CONFIG" });
  await sendSms(d.phone, job.payload.body);
  return { label: job.payload.label };
}, { maxLateMs: 10 * 60_000 });

export const cancelPending = () => {
  const n = cancelKind("sms");
  if (n) console.log(`[texts] cancelled ${n} pending text(s) from the previous stick`);
  return n;
};

/** Start the 3-text sequence for a newly drawn stick (cancels the previous one first). */
export function startSequence(digit, lucky) {
  cancelPending();
  const group = crypto.randomBytes(6).toString("hex");
  const start = Date.now();
  composeTexts(digit, lucky).forEach((body, i) => add({ kind: "sms", group, runAt: start + timing.textOffsets[i], payload: { label: LABELS[i], body } }));
  console.log(`[texts] stick #${lucky} drawn (MODE=${MODE}); 3 texts queued for ${mask(demoPhone().phone)}`);
}
