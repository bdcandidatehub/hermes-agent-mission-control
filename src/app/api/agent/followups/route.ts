import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { agentIdFromHeaders } from "@/lib/agent-auth";
import { STALE_DAYS, draftability, shapeDeal } from "@/lib/agent-api";

export const dynamic = "force-dynamic";

// GET → what needs attention: open deals whose next action is overdue / due today / due within 2 days (`due`), and open deals
// with no next action that have gone quiet for a week (`stale`). Each says whether a message may be drafted for the contact.
export async function GET(req: Request) {
  if (!agentIdFromHeaders(req.headers)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ventures = await prisma.venture.findMany();
  const closed = ventures.flatMap((v) => [v.wonStage, v.lostStage]);
  const deals = await prisma.deal.findMany({
    where: { stage: { notIn: closed } },
    include: { company: { select: { name: true, website: true } }, contact: { select: { name: true, title: true, email: true, consentBasis: true, unsubscribedAt: true } } },
  });
  const acts = await prisma.activity.findMany({
    where: { dealId: { in: deals.map((d) => d.id) } }, orderBy: { occurredAt: "desc" },
    select: { dealId: true, type: true, summary: true, occurredAt: true },
  });
  const byDeal = new Map<string, typeof acts>();
  for (const a of acts) byDeal.set(a.dealId, [...(byDeal.get(a.dealId) ?? []), a]);

  const now = new Date();
  const tz = process.env.APP_TZ || undefined;
  const shaped = deals.map((d) => {
    const mine = byDeal.get(d.id) ?? [];
    const lastTouch = mine.find((a) => a.type !== "stage")?.occurredAt ?? d.createdAt;
    return {
      ...shapeDeal(d, mine[0] ?? null, now, tz),
      ...draftability(d.contact),
      daysSinceTouch: Math.floor((now.getTime() - lastTouch.getTime()) / 86_400_000),
    };
  });

  const rank = { overdue: 0, today: 1, soon: 2 } as const;
  const due = shaped
    .filter((d) => d.due === "overdue" || d.due === "today" || d.due === "soon")
    .sort((a, b) => rank[a.due as keyof typeof rank] - rank[b.due as keyof typeof rank] || String(a.nextActionDue).localeCompare(String(b.nextActionDue)));
  const stale = shaped
    .filter((d) => d.due === "none" && d.daysSinceTouch >= STALE_DAYS)
    .sort((a, b) => b.daysSinceTouch - a.daysSinceTouch);

  return NextResponse.json({ asOf: now.toISOString(), dueCount: due.length, staleCount: stale.length, due, stale });
}
