import { prisma } from "@/lib/prisma";
import { dueBucket, summarizeVenture } from "@/lib/crm";
import { funnelCounts } from "@/lib/outreach";

// Cash-first summary shared by the Today page (/api/today) and Friday's dashboard snapshot.
export async function getTodaySummary(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [ventures, deals, pendingApprovals, activities] = await Promise.all([
    prisma.venture.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.deal.findMany({ include: { company: { select: { name: true } }, contact: { select: { name: true } } } }),
    prisma.agentRequest.count({ where: { status: "awaiting_approval" } }),
    prisma.activity.findMany({ where: { occurredAt: { gte: since } }, select: { type: true, meta: true, deal: { select: { ventureKey: true } } } }),
  ]);
  const summaries = ventures.map((v) => summarizeVenture(v, deals));
  const tz = process.env.APP_TZ || undefined;
  const closed = new Set(ventures.flatMap((v) => [v.wonStage, v.lostStage]));

  const allDue = deals
    .filter((d) => !closed.has(d.stage) && d.nextActionDue && ["overdue", "today", "soon"].includes(dueBucket(d.nextActionDue, new Date(), tz)))
    .sort((a, b) => +a.nextActionDue! - +b.nextActionDue!);
  const due = allDue.slice(0, 8).map((d) => ({
    id: d.id, ventureKey: d.ventureKey, title: d.title, company: d.company.name, contact: d.contact?.name ?? null,
    stage: d.stage, nextAction: d.nextAction, nextActionDue: d.nextActionDue, bucket: dueBucket(d.nextActionDue, new Date(), tz),
  }));

  return {
    funnelDays: days,
    ventures: ventures.map((v, i) => ({
      key: v.key, name: v.name, stages: v.stages, wonStage: v.wonStage, lostStage: v.lostStage, recurring: v.recurring,
      summary: summaries[i], funnel: funnelCounts(activities.filter((a) => a.deal.ventureKey === v.key)),
    })),
    mrrCents: summaries.reduce((n, s) => n + s.mrrCents, 0),
    openPipelineCents: summaries.reduce((n, s) => n + s.openValueCents, 0),
    dueCount: allDue.length, // the real number, not the length of the trimmed list
    due,
    pendingApprovals,
  };
}
