import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { agentIdFromHeaders } from "@/lib/agent-auth";
import { shapeDeal } from "@/lib/agent-api";

export const dynamic = "force-dynamic";
const LIMIT = 300;

// GET ?venture=key&closed=1 → the pipeline as an agent needs to see it: ventures, then open deals (won/lost with closed=1)
// with contact consent status, days in stage, due bucket and the last thing that happened. Read-only.
export async function GET(req: Request) {
  if (!agentIdFromHeaders(req.headers)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const venture = url.searchParams.get("venture");
  const withClosed = url.searchParams.get("closed") === "1";

  const ventures = await prisma.venture.findMany({ orderBy: { sortOrder: "asc" } });
  const closed = ventures.flatMap((v) => [v.wonStage, v.lostStage]);
  const deals = await prisma.deal.findMany({
    where: { ...(venture ? { ventureKey: venture } : {}), ...(withClosed ? {} : { stage: { notIn: closed } }) },
    include: { company: { select: { name: true, website: true } }, contact: { select: { name: true, title: true, email: true, consentBasis: true, unsubscribedAt: true } } },
    orderBy: [{ nextActionDue: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    take: LIMIT,
  });

  const acts = await prisma.activity.findMany({
    where: { dealId: { in: deals.map((d) => d.id) } }, orderBy: { occurredAt: "desc" },
    select: { dealId: true, type: true, summary: true, occurredAt: true },
  });
  const last = new Map<string, (typeof acts)[number]>();
  for (const a of acts) if (!last.has(a.dealId)) last.set(a.dealId, a);

  const tz = process.env.APP_TZ || undefined;
  return NextResponse.json({
    ventures: ventures.map((v) => ({ key: v.key, name: v.name, stages: v.stages, wonStage: v.wonStage, lostStage: v.lostStage })),
    count: deals.length,
    truncated: deals.length === LIMIT,
    deals: deals.map((d) => shapeDeal(d, last.get(d.id) ?? null, new Date(), tz)),
  });
}
