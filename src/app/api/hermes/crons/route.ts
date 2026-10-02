import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initialStatus, MAX_PROMPT_CHARS, safeCliArg, tierFor } from "@/lib/hermes-policy";

export type CronJob = {
  id: string;
  status: string;           // "active" | "paused"
  name: string;
  schedule: string;
  nextRun: string | null;
  lastRun: string | null;
  lastResult: string | null;
  deliver: string | null;
  skills: string | null;
  script: string | null;
  mode: string | null;
};

// Parse the raw `hermes cron list --all` terminal output into clean objects.
// Format per job: two-space-indented "<id> [status]" then four-space "Key: value" lines.
function parseCrons(raw: string): CronJob[] {
  const jobs: CronJob[] = [];
  let cur: CronJob | null = null;
  const push = () => { if (cur) jobs.push(cur); };
  for (const line of raw.split("\n")) {
    const head = line.match(/^\s{2}([0-9a-f]{6,})\s+\[(\w+)\]/);
    if (head) {
      push();
      cur = { id: head[1], status: head[2], name: "", schedule: "", nextRun: null, lastRun: null, lastResult: null, deliver: null, skills: null, script: null, mode: null };
      continue;
    }
    const kv = line.match(/^\s{4}([A-Za-z][A-Za-z ]*?):\s+(.*)$/);
    if (kv && cur) {
      const key = kv[1].trim().toLowerCase();
      const val = kv[2].trim();
      if (key === "name") cur.name = val;
      else if (key === "schedule") cur.schedule = val;
      else if (key === "next run") cur.nextRun = val;
      else if (key === "deliver") cur.deliver = val;
      else if (key === "skills") cur.skills = val;
      else if (key === "script") cur.script = val;
      else if (key === "mode") cur.mode = val;
      else if (key === "last run") {
        const m = val.match(/^(\S+)\s+(.*)$/);
        cur.lastRun = m ? m[1] : val;
        cur.lastResult = m ? m[2] : null;
      }
    }
  }
  push();
  return jobs;
}

export async function GET() {
  const row = await prisma.dataStore.findUnique({ where: { key: "hermes-crons" } });
  const data = (row?.data as { raw?: string; syncedAt?: string } | null) ?? {};
  const jobs = data.raw ? parseCrons(data.raw) : [];
  return NextResponse.json({ jobs, syncedAt: data.syncedAt ?? null });
}

// POST { op: "create"|"pause"|"resume"|"run"|"remove"|"edit", ... } → queue a cron mutation for the bridge.
// Approval tier comes from lib/hermes-policy.ts, not from the client.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const op = (b.op || "").toString();
  const kind = `cron.${op}`;
  if (!tierFor(kind)) return NextResponse.json({ error: "bad op" }, { status: 400 });

  const args = {
    schedule: safeCliArg(b.schedule),
    prompt: safeCliArg(b.prompt, MAX_PROMPT_CHARS),
    name: safeCliArg(b.name),
    id: safeCliArg(b.id),
  };
  if (op === "create" && (!args.schedule || !(args.prompt || args.name)))
    return NextResponse.json({ error: "schedule and prompt required" }, { status: 400 });
  if (op !== "create" && !(args.id || args.name))
    return NextResponse.json({ error: "id or name required" }, { status: 400 });

  const label = op === "create" ? `Schedule: ${args.schedule} — ${args.prompt || args.name}` : `Cron ${op}: ${args.name || args.id}`;
  const status = initialStatus(kind, false)!;
  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind,
      title: label.slice(0, 200),
      prompt: JSON.stringify(args),
      sideEffecting: status === "awaiting_approval",
      status,
    },
  });
  return NextResponse.json({ request: row });
}
