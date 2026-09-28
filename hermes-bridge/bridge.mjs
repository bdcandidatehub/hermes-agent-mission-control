#!/usr/bin/env node
/**
 * Hermy HQ ↔ Hermes bridge.
 *
 * Runs on the Mac mini where Hermes lives. Talks to the shared Postgres
 * (the same DATABASE_URL the website uses) — nothing is exposed to the
 * internet. Two jobs:
 *
 *   PULL  (Hermes → website): mirror the kanban board into HermesTask,
 *         cron list + health into DataStore, and emit activity events.
 *   PUSH  (website → Hermes): pick up AgentRequest rows that are `queued`
 *         (safe) or `approved` (human-approved side-effecting), run them
 *         through the `hermes` CLI, and write results back.
 *
 * Requires: the `hermes` binary on PATH, and env DATABASE_URL.
 * Optional env: HERMES_BOARD (default "default"), BRIDGE_POLL_MS (5000),
 *               BRIDGE_MIRROR_MS (30000), HERMES_BIN (default "hermes").
 */
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseStatus } from "./status.mjs";
import { composeQuery, parseChatOutput } from "./friday.mjs";
import { shouldGenerateBrief } from "./brief.mjs";
import { deriveTitle, extractWikilinks, parseEntry, walkMd, writeWikiEntry as writeWiki } from "./wiki.mjs";
import { detectVault, writeSourceNote } from "./vault.mjs";

const execFileP = promisify(execFile);
const HERMES = process.env.HERMES_BIN || "hermes";
const BOARD = process.env.HERMES_BOARD || "default";
const POLL_MS = Number(process.env.BRIDGE_POLL_MS || 5000);
const MIRROR_MS = Number(process.env.BRIDGE_MIRROR_MS || 30000);
const RUN_TIMEOUT_MS = Number(process.env.BRIDGE_RUN_TIMEOUT_MS || 240000);
const WIKI_DIR = process.env.HERMES_WIKI || path.join(os.homedir(), ".hermes", "wiki");
// Names (case-insensitive) that are NOT mirrored as wiki entries: folders like Logs, or files like index.md.
const WIKI_SKIP = (process.env.HERMES_WIKI_SKIP ?? "Logs,index.md,INDEX.md").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const SKIP = { dirs: new Set(WIKI_SKIP.filter((x) => !x.endsWith(".md"))), files: new Set(WIKI_SKIP.filter((x) => x.endsWith(".md"))) };
// Dashboard edits only touch the file (a backup of the old version goes to .hermy-backups/).
// Set HERMES_WIKI_GIT=1 to also `git init` (if needed) and commit each dashboard edit.
const WIKI_GIT = process.env.HERMES_WIKI_GIT === "1";
// How the dashboard may change the wiki:
//   edit     (default) edit notes in place (frontmatter merged, old version backed up)
//   capture  compiled notes are read-only; new material is saved as source notes in HERMES_RAW_DIR for your own ingest
//   readonly the dashboard never writes to the vault
const WIKI_MODE = ["edit", "capture", "readonly"].includes(process.env.HERMES_WIKI_MODE ?? "edit") ? (process.env.HERMES_WIKI_MODE ?? "edit") : "edit";
// Friday: the dashboard's talking chief of staff. One persistent Hermes session so she remembers the conversation.
const FRIDAY_SESSION = process.env.FRIDAY_SESSION || "hermy-dashboard";
const FRIDAY_MODEL = process.env.FRIDAY_MODEL || ""; // optional: a faster model just for chat (passed as `hermes chat -m`)
const FRIDAY_TIMEOUT_MS = Number(process.env.FRIDAY_TIMEOUT_MS || 300000); // a 120s default proved too tight for a large/remote model on a growing session
const TAG_TYPES = new Set(["concept", "entity", "topic", "project", "log"]);
const VAULT = detectVault(WIKI_DIR); // enclosing Obsidian vault, if any
const RAW_DIR = process.env.HERMES_RAW_DIR || (VAULT && fs.existsSync(path.join(VAULT.root, "Raw", "Sources")) ? path.join(VAULT.root, "Raw", "Sources") : null);
const BRIEF_HOUR = Number(process.env.BRIEF_HOUR || 8);   // local hour to auto-generate the daily brief
const BRIEF_PROMPT =
  "You are the operator's chief of staff. Produce today's brief. Read your memory wiki open-loops " +
  "(~/.hermes/wiki), the kanban board, and recent activity. Output ONLY valid JSON (no prose, no code fences) " +
  'in exactly this shape: {"greeting":"one warm line","summary":"2-3 sentences on where things stand",' +
  '"sections":[{"label":"Needs your decision","items":["..."]},{"label":"Top priorities","items":["..."]},' +
  '{"label":"Recently shipped","items":["..."]},{"label":"Next actions","items":["..."]}]}. ' +
  "Keep every item short, concrete, and specific. Omit a section if it has nothing.";
let briefInFlight = false;
let lastBriefAttemptMs = null;

const DB_URL = process.env.DATABASE_URL || "";
if (!DB_URL) { console.error("DATABASE_URL is required (use the direct postgres:// URL, not a prisma:// Accelerate URL)"); process.exit(1); }
if (DB_URL.startsWith("prisma://") || DB_URL.startsWith("prisma+")) {
  console.error("DATABASE_URL is a Prisma Accelerate URL; the bridge needs a DIRECT postgres:// connection string (e.g. POSTGRES_URL).");
  process.exit(1);
}
// Cloud Postgres (Prisma Postgres/Neon/Supabase/RDS) needs SSL; localhost doesn't.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(DB_URL);
// Verify the server certificate by default. Only set PGSSL_INSECURE=1 if your provider uses a
// self-signed chain you can't add to the trust store (not recommended).
const sslOpt = isLocal ? undefined : { rejectUnauthorized: process.env.PGSSL_INSECURE !== "1" };
const pool = new pg.Pool({ connectionString: DB_URL, max: 4, ssl: sslOpt });
// node-postgres emits 'error' on an idle client whose connection drops (a Postgres restart, a brief network
// blip). With no listener, Node treats that as an unhandled 'error' event and CRASHES THE WHOLE PROCESS —
// silently, with nothing in the log to explain why. This is exactly what killed a live bridge once already.
pool.on("error", (e) => log("pg pool error (connection recovered automatically on next query):", e.message));

/* Approval policy. Mirrors src/lib/hermes-policy.ts — keep the two in sync.
 * The bridge re-checks it so a row inserted straight into Postgres can't skip approval:
 *   auto    → may run when status is queued or approved
 *   approve → runs ONLY when status is approved
 * Unknown kinds never run. */
const KIND_TIERS = {
  oneshot: "auto", chat: "auto", kanban: "auto", "briefing.generate": "auto", "memory.write": "auto", "source.add": "auto", "friday.chat": "auto",
  "cron.create": "approve", "cron.edit": "approve", "cron.run": "approve", "cron.remove": "approve",
  "cron.pause": "auto", "cron.resume": "auto",
};
const canRun = (r) => {
  const tier = Object.prototype.hasOwnProperty.call(KIND_TIERS, r.kind) ? KIND_TIERS[r.kind] : null;
  if (!tier) return false;
  return tier === "approve" ? r.status === "approved" : r.status === "queued" || r.status === "approved";
};
// argv is passed without a shell, but a leading "-" would still be read as a flag.
const cliArg = (v, what) => {
  const s = v == null ? "" : String(v);
  if (!s || s.startsWith("-") || s.includes("\0") || s.length > 20000) throw new Error(`invalid ${what}`);
  return s;
};

const log = (...a) => console.log(new Date().toISOString(), ...a);
const q = (text, params) => pool.query(text, params);

async function hermes(args, { timeout = 30000 } = {}) {
  // HERMES_EXEC_TIMEOUT_MS lets a wrapper (e.g. hermes-docker.sh) enforce this same deadline where the
  // process actually runs, not just where we're killing our own client — see that script for why that
  // distinction matters. A plain local `hermes` binary just ignores the extra env var.
  const env = { ...process.env, HERMES_EXEC_TIMEOUT_MS: String(timeout) };
  const { stdout } = await execFileP(HERMES, args, { timeout: timeout + 15000, maxBuffer: 8 * 1024 * 1024, env });
  return stdout;
}

async function emit(kind, title, { detail = null, agent = "hermes", level = "info", meta = null } = {}) {
  await q(
    `INSERT INTO "AgentEvent" (id, kind, title, detail, agent, level, meta, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
    [randomUUID(), kind, title.slice(0, 200), detail, agent, level, meta ? JSON.stringify(meta) : null]
  );
}

async function setStore(key, data) {
  await q(
    `INSERT INTO "DataStore" (key, data, "updatedAt") VALUES ($1,$2, now())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, "updatedAt" = now()`,
    [key, JSON.stringify(data)]
  );
}

/* ─────────────── PULL: mirror Hermes → Postgres ─────────────── */
async function mirrorKanban() {
  let tasks = [];
  try {
    // NB: this Hermes CLI wants --board BEFORE the subcommand.
    const out = await hermes(["kanban", "--board", BOARD, "list", "--json"], { timeout: 15000 });
    const parsed = JSON.parse(out || "[]");
    tasks = Array.isArray(parsed) ? parsed : parsed.tasks || [];
  } catch (e) { log("kanban list failed:", e.message.split("\n")[0]); return; }

  const seen = new Set();
  for (const t of tasks) {
    const id = String(t.id ?? t.task_id ?? "");
    if (!id) continue;
    seen.add(id);
    await q(
      `INSERT INTO "HermesTask" (id, board, title, assignee, status, priority, result, "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, assignee=EXCLUDED.assignee, status=EXCLUDED.status,
         priority=EXCLUDED.priority, result=EXCLUDED.result, "syncedAt"=now()`,
      [id, BOARD, String(t.title ?? "untitled").slice(0, 300), t.assignee ?? null,
       String(t.status ?? "todo"), t.priority != null ? Number(t.priority) : null,
       t.result ? String(t.result).slice(0, 2000) : null]
    );
  }
  // prune tasks that vanished from the board
  if (seen.size) {
    await q(`DELETE FROM "HermesTask" WHERE board=$1 AND id <> ALL($2::text[])`, [BOARD, [...seen]]);
  } else {
    await q(`DELETE FROM "HermesTask" WHERE board=$1`, [BOARD]);
  }
}

async function mirrorCrons() {
  try {
    const out = await hermes(["cron", "list", "--all"], { timeout: 15000 });
    const lines = out.split("\n").map((l) => l.trimEnd()).filter(Boolean);
    await setStore("hermes-crons", { jobs: lines, raw: out.slice(0, 8000), syncedAt: new Date().toISOString() });
  } catch (e) { log("cron list failed:", e.message.split("\n")[0]); }
}

async function mirrorCost() {
  for (const args of [["insights", "--days", "7"], ["insights"]]) {
    try {
      const out = await hermes(args, { timeout: 15000 });
      await setStore("hermes-cost", { summary: out.slice(0, 4000), syncedAt: new Date().toISOString() });
      return;
    } catch { /* try next arg shape */ }
  }
}

// Tells the dashboard how it may treat the wiki and how to build "Open in Obsidian" links.
async function mirrorWikiConfig() {
  const rawPrefix = VAULT && RAW_DIR ? path.relative(VAULT.root, RAW_DIR).split(path.sep).join("/") : null;
  await setStore("wiki-config", {
    mode: WIKI_MODE,
    vault: VAULT ? { name: VAULT.name, wikiPrefix: VAULT.prefix, rawPrefix } : null,
    canCapture: WIKI_MODE !== "readonly" && !!RAW_DIR,
  });
}

async function mirrorHealth() {
  let online = false, gateway = "unknown", detail = "";
  try {
    const out = await hermes(["status"], { timeout: 12000 });
    detail = out.slice(0, 4000);
    ({ online, gateway } = parseStatus(out));
  } catch (e) { detail = e.message.split("\n")[0]; }
  await setStore("hermes-health", { online, gateway, detail, lastSeen: new Date().toISOString() });
}

/* ─────────────── Memory Wiki (warm tier: git-tracked markdown) ─────────────── */
async function mirrorWiki() {
  if (!fs.existsSync(WIKI_DIR)) return;
  const seen = new Set();
  for (const file of walkMd(WIKI_DIR, SKIP)) {
    const rel = path.relative(WIKI_DIR, file);
    const id = rel.replace(/\.md$/, "");
    seen.add(id);
    let raw = ""; try { raw = fs.readFileSync(file, "utf8"); } catch { continue; }
    const { fm, body } = parseEntry(raw);
    const sc = (v) => (Array.isArray(v) ? v.join(", ") : v ?? null); // scalar columns: flatten list-valued keys
    const tagList = Array.isArray(fm.tags) ? fm.tags : [];
    const noteType = sc(fm.type) || tagList.find((t) => TAG_TYPES.has(String(t).toLowerCase())) || "fact"; // vault notes carry their kind as a tag
    const links = [...new Set([...(Array.isArray(fm.links) ? fm.links : []), ...extractWikilinks(body)])];
    try {
      await q(
        `INSERT INTO "HermesMemory" (id, path, type, title, status, confidence, provenance, tags, links, body, "validFrom", "validTo", sources, "updatedAt", "syncedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now())
         ON CONFLICT (id) DO UPDATE SET path=EXCLUDED.path, type=EXCLUDED.type, title=EXCLUDED.title,
           status=EXCLUDED.status, confidence=EXCLUDED.confidence, provenance=EXCLUDED.provenance,
           tags=EXCLUDED.tags, links=EXCLUDED.links, body=EXCLUDED.body, sources=EXCLUDED.sources,
           "validFrom"=EXCLUDED."validFrom", "validTo"=EXCLUDED."validTo", "syncedAt"=now()`,
        [id, rel, noteType, sc(fm.title) || deriveTitle(rel, body) || id, sc(fm.status) || "active", sc(fm.confidence),
         sc(fm.provenance), tagList, links,
         body, fm.valid_from || null, fm.valid_to || null, Array.isArray(fm.sources) ? fm.sources.map(String) : []]
      );
    } catch (e) { log("wiki entry skipped (previous copy kept):", rel, e.message.split("\n")[0]); }
  }
  if (seen.size) await q(`DELETE FROM "HermesMemory" WHERE id <> ALL($1::text[])`, [[...seen]]);
  else await q(`DELETE FROM "HermesMemory"`);
}
async function gitCommitWiki(msg, relFile) {
  try {
    const inside = await execFileP("git", ["-C", WIKI_DIR, "rev-parse", "--is-inside-work-tree"]).then((r) => r.stdout.trim() === "true", () => false);
    if (!inside) await execFileP("git", ["-C", WIKI_DIR, "init"]).catch(() => {}); // only for a wiki that isn't already in a repo
    // Commit ONLY the file we wrote (pathspec), so anything else you have staged stays staged.
    await execFileP("git", ["-C", WIKI_DIR, "add", "--", relFile]).catch(() => {});
    await execFileP("git", ["-C", WIKI_DIR, "commit", "-m", msg, "--", relFile]).catch(() => {});
  } catch { /* ignore */ }
}

/* ─────────────── Chief-of-staff daily brief ─────────────── */
async function generateBriefing() {
  const raw = (await hermes(["-z", BRIEF_PROMPT], { timeout: RUN_TIMEOUT_MS })).trim();
  let brief;
  try {
    const jsonStr = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const m = jsonStr.match(/\{[\s\S]*\}/);
    brief = JSON.parse(m ? m[0] : jsonStr);
  } catch { brief = { summary: raw.slice(0, 1500), sections: [] }; }
  brief.generatedAt = new Date().toISOString();
  await setStore("hermes-briefing", brief);
  await emit("status", "Daily brief generated", { level: "up" });
}
async function maybeDailyBrief() {
  const { rows } = await q(`SELECT data FROM "DataStore" WHERE key='hermes-briefing'`);
  const lastGeneratedAt = rows[0]?.data?.generatedAt ?? null;
  const now = new Date();
  if (!shouldGenerateBrief({ now, briefHour: BRIEF_HOUR, lastGeneratedAt, lastAttemptMs: lastBriefAttemptMs, inFlight: briefInFlight })) return;
  briefInFlight = true;
  lastBriefAttemptMs = now.getTime();
  try { await generateBriefing(); log("daily brief generated"); }
  catch (e) { log("daily brief failed (will retry in 30 min):", e.message.split("\n")[0]); }
  finally { briefInFlight = false; }
}

/* ─────────────── PUSH: run website requests via Hermes ─────────────── */
async function runRequest(r) {
  await q(`UPDATE "AgentRequest" SET status='running', "startedAt"=now(), "updatedAt"=now() WHERE id=$1`, [r.id]);
  const quiet = r.kind === "friday.chat"; // chat turns stay out of the activity feed
  if (!quiet) await emit("run", `Started: ${r.title}`, { level: "info", meta: { requestId: r.id, kind: r.kind } });
  let timeoutMs = null; // the timeout passed to whichever hermes() call is in flight, so a kill can be reported honestly
  try {
    let result = "";
    if (r.kind === "oneshot" || r.kind === "chat") {
      timeoutMs = RUN_TIMEOUT_MS;
      result = (await hermes(["-z", String(r.prompt || r.title)], { timeout: timeoutMs })).trim();
    } else if (r.kind === "kanban") {
      timeoutMs = 20000;
      result = (await hermes(["kanban", "--board", BOARD, "create", "--json", cliArg(r.title, "title")], { timeout: timeoutMs })).trim();
    } else if (r.kind.startsWith("cron.")) {
      const op = r.kind.split(".")[1];
      const a = JSON.parse(r.prompt || "{}");
      const target = () => cliArg(a.id || a.name, "cron id/name");
      const argv =
        op === "create" ? ["cron", "create", cliArg(a.schedule, "schedule"), cliArg(a.prompt || a.name, "prompt")]
        : ["run", "pause", "resume", "remove", "edit"].includes(op) ? ["cron", op, target()]
        : null;
      if (!argv) throw new Error(`unknown cron op ${op}`);
      timeoutMs = 20000;
      result = (await hermes(argv, { timeout: timeoutMs })).trim();
      await mirrorCrons();
    } else if (r.kind === "memory.write") {
      if (WIKI_MODE !== "edit") throw new Error(`This wiki is read-only from the dashboard (HERMES_WIKI_MODE=${WIKI_MODE}). Add a source instead.`);
      const e = JSON.parse(r.prompt || "{}");
      const rel = writeWiki(WIKI_DIR, e);
      if (WIKI_GIT) await gitCommitWiki(`wiki: update ${rel} (via dashboard)`, rel);
      await mirrorWiki();
      result = `wrote ${rel}`;
    } else if (r.kind === "friday.chat") {
      const t = JSON.parse(r.prompt || "{}");
      if (!t.message) throw new Error("empty message");
      const args = ["chat", "-Q", "-q", composeQuery({ message: t.message, context: t.context }), "--continue", FRIDAY_SESSION, "--create-if-missing"];
      if (FRIDAY_MODEL) args.push("-m", FRIDAY_MODEL);
      timeoutMs = FRIDAY_TIMEOUT_MS;
      result = parseChatOutput(await hermes(args, { timeout: timeoutMs }));
      if (!result) throw new Error("Friday returned nothing");
    } else if (r.kind === "source.add") {
      if (WIKI_MODE === "readonly") throw new Error("The dashboard is read-only for this vault (HERMES_WIKI_MODE=readonly).");
      if (!RAW_DIR) throw new Error("No sources folder configured (set HERMES_RAW_DIR).");
      const file = writeSourceNote(RAW_DIR, JSON.parse(r.prompt || "{}"));
      result = `saved ${file} to the sources folder; your ingest will pick it up`;
    } else if (r.kind === "briefing.generate") {
      await generateBriefing();
      result = "brief updated";
    } else {
      throw new Error(`unknown kind ${r.kind}`);
    }
    await q(`UPDATE "AgentRequest" SET status='done', result=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`,
      [r.id, result.slice(0, 8000)]);
    if (!quiet) await emit("run", `Done: ${r.title}`, { level: "up", detail: result.slice(0, 400), meta: { requestId: r.id } });
  } catch (e) {
    // A timeout can surface two ways, and both leave e.stdout/e.stderr holding whatever the process had
    // printed so far (a status banner, a partial line — not a real error), which reads as nonsense and hides
    // the actual cause:
    //   - e.killed: execFile's own `timeout` option fired and it killed the child directly (a local `hermes`
    //     binary, or the docker-exec client itself if the inner enforcement somehow didn't).
    //   - e.code 124/137: the wrapper's own inner `timeout` (see hermes-docker.sh) killed the real process
    //     inside the container; docker exec then just relays that exit code as its own, so execFile never
    //     had to kill anything itself and e.killed is false even though this WAS a timeout.
    // Report the timeout honestly either way, instead of whatever scraps were captured.
    const timedOut = e.killed || e.code === 124 || e.code === 137;
    const msg = timedOut
      ? `timed out after ${Math.round((timeoutMs ?? 0) / 1000)}s${e.code === 137 ? " (had to force-kill)" : ""}`
      : (e.stderr || e.message || "error").toString().split("\n")[0].slice(0, 600);
    await q(`UPDATE "AgentRequest" SET status='failed', error=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`, [r.id, msg]);
    await emit("run", `Failed: ${r.title}`, { level: "down", detail: msg, meta: { requestId: r.id } });
    log("request failed:", r.id, msg);
  }
}

async function processQueue() {
  const { rows } = await q(
    `SELECT * FROM "AgentRequest" WHERE status IN ('queued','approved') AND kind <> 'friday.chat' ORDER BY "createdAt" ASC LIMIT 20`
  );
  let ran = 0;
  for (const r of rows) {
    if (!canRun(r)) {
      // Unknown kind, or an approve-tier request that was never approved: never run it.
      if (!Object.prototype.hasOwnProperty.call(KIND_TIERS, r.kind)) {
        await q(`UPDATE "AgentRequest" SET status='failed', error=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`,
          [r.id, `unsupported kind: ${String(r.kind).slice(0, 60)}`]);
      } else {
        await q(`UPDATE "AgentRequest" SET status='awaiting_approval', "updatedAt"=now() WHERE id=$1 AND status='queued'`, [r.id]);
      }
      continue;
    }
    await runRequest(r);
    if (++ran >= 3) break;
  }
}

// Friday's own lane: polled fast and separately, so a spoken conversation never waits behind cron work or other requests.
async function processFriday() {
  const { rows } = await q(`SELECT * FROM "AgentRequest" WHERE kind='friday.chat' AND status IN ('queued','approved') ORDER BY "createdAt" ASC LIMIT 1`);
  if (rows[0] && canRun(rows[0])) await runRequest(rows[0]);
}

/* ─────────────── loops ─────────────── */
async function mirrorTick() {
  try { await mirrorKanban(); } catch (e) { log("mirrorKanban err", e.message); }
  try { await mirrorCrons(); } catch (e) { log("mirrorCrons err", e.message); }
  try { await mirrorHealth(); } catch (e) { log("mirrorHealth err", e.message); }
  try { await mirrorWikiConfig(); } catch (e) { log("mirrorWikiConfig err", e.message); }
  try { await mirrorWiki(); } catch (e) { log("mirrorWiki err", e.message); }
  try { await mirrorCost(); } catch (e) { log("mirrorCost err", e.message); }
}

// This bridge is the only thing that ever sets status='running', so any row still 'running' when a fresh
// instance starts belongs to a PREVIOUS instance that died (crash, `kill`, the Mac sleeping) mid-request —
// its underlying process is gone and nothing will ever move that row forward. Left alone it sits there
// forever: the dashboard shows an endless spinner and the request silently never gets a reply. Fail them
// honestly on startup so the UI's own "Try again" can take over.
async function reapStaleRunning() {
  const { rows } = await q(`UPDATE "AgentRequest" SET status='failed', error='bridge restarted mid-request', "finishedAt"=now(), "updatedAt"=now() WHERE status='running' RETURNING id, kind, title`);
  for (const r of rows) log("reaped stale running request:", r.id, r.kind, JSON.stringify(r.title).slice(0, 80));
  if (rows.length) await emit("run", `Recovered from a restart: ${rows.length} stuck request(s) marked failed`, { level: "warn" });
}

async function main() {
  log(`hermes-bridge up · board=${BOARD} · poll=${POLL_MS}ms · mirror=${MIRROR_MS}ms`);
  try { await reapStaleRunning(); } catch (e) { log("reapStaleRunning error:", e.message); }
  await emit("status", "Bridge connected", { level: "up" });
  // Three independent, non-overlapping loops: a slow mirror pass or a 4-minute brief must never delay the request queue.
  const loop = (name, ms, fn) => {
    const run = async () => { try { await fn(); } catch (e) { log(`${name} error:`, e.message); } finally { setTimeout(run, ms); } };
    run();
  };
  loop("queue", POLL_MS, processQueue);
  loop("friday", 700, processFriday);
  loop("mirror", MIRROR_MS, mirrorTick);
  loop("brief", 60_000, maybeDailyBrief);
}
// Log and keep running rather than dying silently on some error path the loops' own try/catches didn't
// anticipate — a bridge that stays up and logs a problem beats one that vanishes with no trace, which is
// exactly what happened once already (an unhandled pg pool 'error' event, fixed above, but this is the
// general backstop for whatever's next).
process.on("unhandledRejection", (e) => log("unhandledRejection (bridge staying up):", e?.message ?? e));
process.on("uncaughtException", (e) => log("uncaughtException (bridge staying up):", e?.message ?? e));

main().catch((e) => { console.error("fatal", e); process.exit(1); });
