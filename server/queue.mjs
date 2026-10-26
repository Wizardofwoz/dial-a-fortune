// Tiny durable job queue shared by fortune texts and SOS calls.
// Jobs are persisted to disk; ONE worker loop runs due jobs. Nothing depends on a request
// staying open or on a per-job setTimeout, and pending jobs survive a server restart.
// Delivery is at-most-once: a job is marked "running" on disk before its handler starts,
// so a crash mid-send is reported as failed instead of being repeated (no double calls).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.env.SOS_QUEUE_FILE || ".data/jobs.json");
const TICK_MS = 500;
const KEEP_MS = 60 * 60_000;

// Survive Vite re-evaluating this module: keep state and the single interval on globalThis.
const g = (globalThis.__jobQueue ??= { jobs: null, handlers: new Map(), timer: null, busy: false });

function load() {
  try { g.jobs = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { g.jobs = []; }
  let changed = false;
  for (const j of g.jobs) if (j.state === "running") { j.state = "failed"; j.error = { code: "INTERRUPTED", message: "Server restarted while this job was running" }; changed = true; }
  if (changed) persist();
}
function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(g.jobs), { mode: 0o600 });
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { console.warn("[queue] could not persist:", e.message); }
}
if (!g.jobs) load();

/** Register what to do for a job kind. maxLateMs: how overdue a job may be before it is dropped (e.g. after downtime). */
export function register(kind, handler, { maxLateMs }) { g.handlers.set(kind, { handler, maxLateMs }); }

export function add({ kind, group = "", runAt, payload = {} }) {
  const job = { id: crypto.randomBytes(8).toString("hex"), kind, group, runAt, state: "pending", payload, result: null, error: null, createdAt: Date.now() };
  g.jobs.push(job);
  persist();
  return job;
}
export const get = (id) => g.jobs.find((j) => j.id === id) || null;
export const active = (kind) => g.jobs.find((j) => j.kind === kind && (j.state === "pending" || j.state === "running")) || null;
export const update = (job, patch) => { Object.assign(job, patch); persist(); };

/** Cancel every pending job in a group. Returns how many were cancelled. */
export function cancelGroup(group, kind) {
  let n = 0;
  for (const j of g.jobs) if (j.group === group && (!kind || j.kind === kind) && j.state === "pending") { j.state = "cancelled"; n++; }
  if (n) persist();
  return n;
}
export const cancelKind = (kind) => {
  let n = 0;
  for (const j of g.jobs) if (j.kind === kind && j.state === "pending") { j.state = "cancelled"; n++; }
  if (n) persist();
  return n;
};

async function tick() {
  if (g.busy) return;
  g.busy = true;
  try {
    const now = Date.now();
    for (const j of g.jobs) {
      if (j.state !== "pending" || j.runAt > now) continue;
      const h = g.handlers.get(j.kind);
      if (!h) continue; // module not loaded yet; try again next tick
      if (now - j.runAt > h.maxLateMs) { j.state = "failed"; j.error = { code: "EXPIRED", message: "Job was too overdue to run" }; persist(); console.warn(`[queue] ${j.kind} ${j.id} expired`); continue; }
      j.state = "running"; persist(); // at-most-once marker
      try {
        j.result = (await h.handler(j)) ?? null;
        j.state = j.error ? "failed" : "done";
      } catch (e) {
        j.state = "failed";
        j.error = { code: e.code ?? "ERROR", message: e.message || "Job failed" };
        console.warn(`[queue] ${j.kind} ${j.id} failed: ${j.error.code} ${j.error.message}`);
      }
      persist();
    }
    const before = g.jobs.length;
    g.jobs = g.jobs.filter((j) => j.state === "pending" || j.state === "running" || now - (j.runAt || 0) < KEEP_MS);
    if (g.jobs.length !== before) persist();
  } finally { g.busy = false; }
}
if (g.timer) clearInterval(g.timer);
g.timer = setInterval(() => tick().catch((e) => console.warn("[queue] tick error:", e.message)), TICK_MS);
g.timer.unref?.(); // never keep a process (e.g. `vite build`) alive just for the worker; the dev server stays up on its own
