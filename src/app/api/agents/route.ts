import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AGENT_KIND, buildRoster, type LiveMap, type MirroredAgent } from "@/lib/agents";
import { FRIDAY_KIND } from "@/lib/friday";

export const dynamic = "force-dynamic";

// The bridge refreshes "who is mid-turn" at least every 30s while it's watching; older than this and we ignore it.
const ACTIVITY_FRESH_MS = 90_000;

// GET → the real Hermes agents (profiles mirrored by the bridge) with their model, kanban activity, reporting line and
// whether they are working right now (a board task, a conversation, a Telegram reply, a scheduled job, or an HQ chat in flight).
export async function GET() {
  const [row, tasks, activity, running] = await Promise.all([
    prisma.dataStore.findUnique({ where: { key: "hermes-agents" } }),
    prisma.hermesTask.findMany({ orderBy: { updatedAt: "desc" }, take: 500 }),
    prisma.dataStore.findUnique({ where: { key: "hermes-activity" } }),
    prisma.agentRequest.findMany({ where: { kind: { in: [FRIDAY_KIND, AGENT_KIND] }, status: "running" }, select: { kind: true, prompt: true }, take: 20 }),
  ]);
  const data = (row?.data ?? null) as { agents?: MirroredAgent[]; syncedAt?: string } | null;

  const live: LiveMap = {};
  const act = (activity?.data ?? null) as { profiles?: LiveMap; syncedAt?: string } | null;
  if (act?.profiles && act.syncedAt && Date.now() - Date.parse(act.syncedAt) < ACTIVITY_FRESH_MS) Object.assign(live, act.profiles);
  for (const r of running) { // HQ's own chats: known the instant they start, no waiting for the next bridge tick
    if (r.kind === FRIDAY_KIND) live.default ??= { source: "hq" };
    else {
      try {
        const profile = (JSON.parse(r.prompt ?? "{}") as { profile?: string }).profile;
        if (profile && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(profile)) live[profile] ??= { source: "hq" };
      } catch { /* a malformed prompt just doesn't light anyone up */ }
    }
  }

  return NextResponse.json({
    agents: buildRoster(data?.agents ?? [], tasks, live),
    syncedAt: data?.syncedAt ?? null,
  });
}
