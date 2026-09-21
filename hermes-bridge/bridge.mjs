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
import { shouldGenerateBrief } from "./brief.mjs";
import { deriveTitle, parseEntry, walkMd, writeWikiEntry as writeWiki } from "./wiki.mjs";

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

/* Approval policy. Mirrors src/lib/hermes-policy.ts — keep the two in sync.
 * The bridge re-checks it so a row inserted straight into Postgres can't skip approval:
 *   auto    → may run when status is queued or approved
 *   approve → runs ONLY when status is approved
 * Unknown kinds never run. */
const KIND_TIERS = {
  oneshot: "auto", chat: "auto", kanban: "auto", "briefing.generate": "auto", "memory.write": "auto",
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
  const { stdout } = await execFileP(HERMES, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
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
    try {
      await q(
        `INSERT INTO "HermesMemory" (id, path, type, title, status, confidence, provenance, tags, links, body, "validFrom", "validTo", "updatedAt", "syncedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
         ON CONFLICT (id) DO UPDATE SET path=EXCLUDED.path, type=EXCLUDED.type, title=EXCLUDED.title,
           status=EXCLUDED.status, confidence=EXCLUDED.confidence, provenance=EXCLUDED.provenance,
           tags=EXCLUDED.tags, links=EXCLUDED.links, body=EXCLUDED.body,
           "validFrom"=EXCLUDED."validFrom", "validTo"=EXCLUDED."validTo", "syncedAt"=now()`,
        [id, rel, sc(fm.type) || "fact", sc(fm.title) || deriveTitle(rel, body) || id, sc(fm.status) || "active", sc(fm.confidence),
         sc(fm.provenance), Array.isArray(fm.tags) ? fm.tags : [], Array.isArray(fm.links) ? fm.links : [],
         body, fm.valid_from || null, fm.valid_to || null]
      );
    } catch (e) { log("wiki entry skipped (previous copy kept):", rel, e.message.split("\n")[0]); }
  }
  if (seen.size) await q(`DELETE FROM "HermesMemory" WHERE id <> ALL($1::text[])`, [[...seen]]);
  else await q(`DELETE FROM "HermesMemory"`);
}
async function gitCommitWiki(msg) {
  try {
    if (!fs.existsSync(path.join(WIKI_DIR, ".git"))) await execFileP("git", ["-C", WIKI_DIR, "init"]).catch(() => {});
    await execFileP("git", ["-C", WIKI_DIR, "add", "-A"]).catch(() => {});
    await execFileP("git", ["-C", WIKI_DIR, "commit", "-m", msg]).catch(() => {});
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
  await emit("run", `Started: ${r.title}`, { level: "info", meta: { requestId: r.id, kind: r.kind } });
  try {
    let result = "";
    if (r.kind === "oneshot" || r.kind === "chat") {
      result = (await hermes(["-z", String(r.prompt || r.title)], { timeout: RUN_TIMEOUT_MS })).trim();
    } else if (r.kind === "kanban") {
      result = (await hermes(["kanban", "--board", BOARD, "create", "--json", cliArg(r.title, "title")], { timeout: 20000 })).trim();
    } else if (r.kind.startsWith("cron.")) {
      const op = r.kind.split(".")[1];
      const a = JSON.parse(r.prompt || "{}");
      const target = () => cliArg(a.id || a.name, "cron id/name");
      const argv =
        op === "create" ? ["cron", "create", cliArg(a.schedule, "schedule"), cliArg(a.prompt || a.name, "prompt")]
        : ["run", "pause", "resume", "remove", "edit"].includes(op) ? ["cron", op, target()]
        : null;
      if (!argv) throw new Error(`unknown cron op ${op}`);
      result = (await hermes(argv, { timeout: 20000 })).trim();
      await mirrorCrons();
    } else if (r.kind === "memory.write") {
      const e = JSON.parse(r.prompt || "{}");
      const rel = writeWiki(WIKI_DIR, e);
      if (WIKI_GIT) await gitCommitWiki(`wiki: update ${rel} (via dashboard)`);
      await mirrorWiki();
      result = `wrote ${rel}`;
    } else if (r.kind === "briefing.generate") {
      await generateBriefing();
      result = "brief updated";
    } else {
      throw new Error(`unknown kind ${r.kind}`);
    }
    await q(`UPDATE "AgentRequest" SET status='done', result=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`,
      [r.id, result.slice(0, 8000)]);
    await emit("run", `Done: ${r.title}`, { level: "up", detail: result.slice(0, 400), meta: { requestId: r.id } });
  } catch (e) {
    const msg = (e.stderr || e.message || "error").toString().split("\n")[0].slice(0, 600);
    await q(`UPDATE "AgentRequest" SET status='failed', error=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`, [r.id, msg]);
    await emit("run", `Failed: ${r.title}`, { level: "down", detail: msg, meta: { requestId: r.id } });
    log("request failed:", r.id, msg);
  }
}

async function processQueue() {
  const { rows } = await q(
    `SELECT * FROM "AgentRequest" WHERE status IN ('queued','approved') ORDER BY "createdAt" ASC LIMIT 20`
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

/* ─────────────── loops ─────────────── */
async function mirrorTick() {
  try { await mirrorKanban(); } catch (e) { log("mirrorKanban err", e.message); }
  try { await mirrorCrons(); } catch (e) { log("mirrorCrons err", e.message); }
  try { await mirrorHealth(); } catch (e) { log("mirrorHealth err", e.message); }
  try { await mirrorWiki(); } catch (e) { log("mirrorWiki err", e.message); }
  try { await mirrorCost(); } catch (e) { log("mirrorCost err", e.message); }
}

async function main() {
  log(`hermes-bridge up · board=${BOARD} · poll=${POLL_MS}ms · mirror=${MIRROR_MS}ms`);
  await emit("status", "Bridge connected", { level: "up" });
  // Three independent, non-overlapping loops: a slow mirror pass or a 4-minute brief must never delay the request queue.
  const loop = (name, ms, fn) => {
    const run = async () => { try { await fn(); } catch (e) { log(`${name} error:`, e.message); } finally { setTimeout(run, ms); } };
    run();
  };
  loop("queue", POLL_MS, processQueue);
  loop("mirror", MIRROR_MS, mirrorTick);
  loop("brief", 60_000, maybeDailyBrief);
}
main().catch((e) => { console.error("fatal", e); process.exit(1); });
