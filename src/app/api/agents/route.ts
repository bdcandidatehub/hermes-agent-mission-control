import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildRoster, type MirroredAgent } from "@/lib/agents";

export const dynamic = "force-dynamic";

// GET → the real Hermes agents (profiles mirrored by the bridge) with their model and kanban activity.
export async function GET() {
  const [row, tasks] = await Promise.all([
    prisma.dataStore.findUnique({ where: { key: "hermes-agents" } }),
    prisma.hermesTask.findMany({ orderBy: { updatedAt: "desc" }, take: 500 }),
  ]);
  const data = (row?.data ?? null) as { agents?: MirroredAgent[]; syncedAt?: string } | null;
  return NextResponse.json({
    agents: buildRoster(data?.agents ?? [], tasks),
    syncedAt: data?.syncedAt ?? null,
  });
}
