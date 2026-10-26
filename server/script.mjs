// Builds the SOS pep talk as a list of steps: { say } or { pause } (seconds).
// Used for both the real Twilio call (as TwiML) and the on-page preview.

const TOPIC = {
  surprise: "Surprises favor people who stay curious. Whatever just landed in that room, treat it as news, not a verdict. Ask one good question before you answer.",
  tea: "Hot tea is patience in a mug. Bring that pace back in there: one sentence, one sip of water, one beat of silence before you reply.",
  yes: "Walk back in and say yes to a second try. If your first sentence came out wrong, just say, let me put that better, and begin again.",
  risk: "Pick the one honest thing you've been holding back, and say it in one calm sentence. Small risks, clearly stated, are how you earn respect.",
  luck: "Good luck loves a steady voice. Drop your shoulders, plant both feet, and say your first line a little slower than feels natural.",
  love: "Someone is thinking of you right now, so you are not walking in alone. Lead with kindness. It is the strongest move in any room.",
  snack: "Needs are not weakness. Get water, take a breath, and then ask for the one thing that would make this go better.",
  wealth: "Aim for the fair outcome. Say what you want out loud, calmly, in one sentence, and then stop talking and let it land.",
  friends: "Think of the friend who always believes in you, and borrow their confidence for the next ten minutes. It fits you fine.",
  "fresh start": "Every ending is a round little beginning. The next five minutes are a clean page, so start with one clear sentence.",
};
const TOPIC_FALLBACK =
  "You only have to handle the next five minutes. Pick one thing you want out of this, and aim every sentence at it.";

// Situation words -> tailored step c (connect the line) and step d (encouragement).
const SITUATIONS = {
  presenting: {
    c: "Let that line be about your presentation. You already know the material, and the room is waiting to hear it.",
    d: "Open with your one strongest sentence, not an apology. If you lose your place, pause, look at one friendly face, and say the next point slowly. A pause looks like confidence.",
  },
  conflict: {
    c: "Let that line be about this disagreement. You can be calm and still be firm.",
    d: "Before you reply, say back what the other person said in your own words, then state the one thing you need, in one sentence. You don't have to win. You only have to be clear.",
  },
  interview: {
    c: "Let that line be about this interview. They already liked you on paper.",
    d: "When a question comes, take one breath, then answer with one real example: what happened, what you did, what changed. Specific beats perfect.",
  },
  date: {
    c: "Let that line be about tonight. You are allowed to just enjoy this.",
    d: "Ask one curious question and actually listen to the answer. Being interested is far more charming than being impressive.",
  },
  exam: {
    c: "Let that line be about your exam. You have done more than you think.",
    d: "Start with the question you know best to get your momentum, and if one stalls you, circle it and come back. Slow is smooth, and smooth is fast.",
  },
  meeting: {
    c: "Let that line be about this meeting. Your voice belongs at that table.",
    d: "Pick the one point you most want heard, and say it in your next opening, with your first words being: here's what I'd suggest. Then stop and let them respond.",
  },
  family: {
    c: "Let that line be about the people in that room. They love you, even when it's loud.",
    d: "You don't have to fix anyone today. Pick one person, ask them one kind question, and let that be your whole job for the next ten minutes.",
  },
  boss: {
    c: "Let that line be about this conversation with your boss. You are a professional with good reasons.",
    d: "Bring one fact and one proposal. Say, here's what I'm seeing, and here's what I'd like to do. Calm and specific always lands better than loud.",
  },
  negotiating: {
    c: "Let that line be about this negotiation. Your number is a number, not a verdict on you.",
    d: "Name your number first, say it once, and then stop talking. The silence after it is not yours to fill.",
  },
  awkward: {
    c: "Let that line be about this awkward moment. Everyone in there has had one too.",
    d: "Awkward fades fast when you name it lightly. Smile, say, okay, that was a moment, and then change the subject to something warm.",
  },
};
const ALIAS = {
  presentation: "presenting", pitch: "presenting", pitching: "presenting", speech: "presenting", speaking: "presenting", demo: "presenting",
  argument: "conflict", fight: "conflict", fighting: "conflict", arguing: "conflict", confrontation: "conflict",
  interviewing: "interview", job: "interview",
  dating: "date", tinder: "date",
  test: "exam", finals: "exam", quiz: "exam",
  meetings: "meeting", standup: "meeting",
  parents: "family", mom: "family", dad: "family", inlaws: "family", relatives: "family",
  manager: "boss", review: "boss",
  negotiation: "negotiating", negotiate: "negotiating", salary: "negotiating", raise: "negotiating",
  cringe: "awkward", embarrassed: "awkward",
};

const CJK = /[\u3400-\u9fff]/;
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f<>&]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** Normalise a possibly-untrusted fortune from the client or the store. */
export function cleanFortune(f = {}) {
  const lines = [clean(f.poem, 200), clean(f.poemAlt, 200)].filter(Boolean);
  const en = lines.find((l) => !CJK.test(l)) || lines[0] || "";
  const stick = Math.min(99, Math.max(1, parseInt(f.stick, 10) || 1));
  return { stick, poem: en, topic: clean(f.topic, 40), digit: Math.min(9, Math.max(0, parseInt(f.digit, 10) || 0)) };
}

export function cleanSituation(s) {
  const m = String(s ?? "").toLowerCase().match(/[\p{L}\p{N}'-]+/u);
  return m ? m[0].slice(0, 24) : "";
}

export function buildScript(fortune, situationRaw = "") {
  const f = cleanFortune(fortune);
  const word = cleanSituation(situationRaw);
  const sit = SITUATIONS[ALIAS[word] || word];
  const step = [];
  const say = (t) => step.push({ say: t });
  const pause = (s) => step.push({ pause: s });
  const ones = ["one", "two", "three", "four", "five", "six"];

  // a. calm greeting
  say("Hey, it's your fortune calling. You did the right thing stepping out.");
  pause(2);
  // b. one slow breath: in 4, hold 4, out 6
  say("Let's take one slow breath together. Let your shoulders drop.");
  pause(2);
  say("Breathe in through your nose, for four.");
  for (let i = 0; i < 4; i++) { say(ones[i]); pause(1); }
  say("Hold it gently.");
  pause(3);
  say("Now breathe out slowly, for six.");
  for (let i = 0; i < 6; i++) { say(ones[i]); pause(1); }
  pause(2);
  say("Good.");
  pause(1);
  // c. today's stick, connected to the moment
  say(`Today's stick was number ${f.stick}.`);
  if (f.poem) { pause(1); say(`Your line says: ${f.poem.replace(/[.!?]+$/, "")}.`); }
  pause(1);
  if (sit) say(sit.c);
  else if (word) say(`Let that line ride along into this ${word}. It was written for a moment like this one.`);
  else say("Hear that line again, and let it be about right now: you stepped out, you breathed, and you are going back in steadier than you left.");
  pause(2);
  // d. one specific line of encouragement
  if (sit) say(sit.d);
  else if (word) say(`Whatever this ${word} throws at you, you only have to handle the next five minutes. Decide the one thing you want out of it, and aim every sentence at that.`);
  else say(TOPIC[f.topic.toLowerCase()] || TOPIC_FALLBACK);
  pause(3);
  // e. energetic close
  say("OK. Go back in there. You've got this.");
  return step;
}

export const estimateSeconds = (steps) =>
  Math.round(steps.reduce((t, s) => t + (s.pause ?? s.say.split(/\s+/).length / 2.6 + 0.3), 0));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toTwiml(steps, voice = "Polly.Joanna-Neural") {
  const body = steps
    .map((s) => (s.pause ? `<Pause length="${s.pause}"/>` : `<Say voice="${esc(voice)}" language="en-US">${esc(s.say)}</Say>`))
    .join("");
  return `<Response><Pause length="1"/>${body}</Response>`;
}
