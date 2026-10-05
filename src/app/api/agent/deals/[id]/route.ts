import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { agentIdFromHeaders } from "@/lib/agent-auth";
import { draftability, parseNextActionPatch, shapeDeal } from "@/lib/agent-api";
import { ACTIVITY_LABEL } from "@/lib/outreach";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const include = {
  company: { select: { name: true, website: true } },
  contact: { select: { name: true, title: true, email: true, consentBasis: true, unsubscribedAt: true } },
} as const;

// GET → one deal with its last 30 activities.
export async function GET(req: Request, { params }: Ctx) {
  if (!agentIdFromHeaders(req.headers)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const deal = await prisma.deal.findUnique({ where: { id }, include });
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acts = await prisma.activity.findMany({ where: { dealId: id }, orderBy: { occurredAt: "desc" }, take: 30 });
  return NextResponse.json({
    deal: { ...shapeDeal(deal, acts[0] ?? null, new Date(), process.env.APP_TZ || undefined), ...draftability(deal.contact) },
    activities: acts.map((a) => ({
      type: a.type, label: ACTIVITY_LABEL[a.type] ?? a.type, summary: a.summary, at: a.occurredAt.toISOString(),
      by: (a.meta as { by?: string } | null)?.by ?? null,
    })),
  });
}

// PATCH { nextAction?, nextActionDue? } → set the next step on a deal. Nothing else is writable by an agent here:
// stage, value and notes stay with the operator. The change is recorded as a note attributed to the agent.
export async function PATCH(req: Request, { params }: Ctx) {
  const agent = agentIdFromHeaders(req.headers);
  if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const patch = parseNextActionPatch(await req.json().catch(() => ({})));
  if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 });

  const deal = await prisma.deal.findUnique({ where: { id }, include: { ...include, venture: true } });
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (deal.stage === deal.venture.wonStage || deal.stage === deal.venture.lostStage)
    return NextResponse.json({ error: "this deal is closed" }, { status: 409 });

  const due = "nextActionDue" in patch.data ? patch.data.nextActionDue : undefined;
  const text = [
    "nextAction" in patch.data ? `next action: ${patch.data.nextAction ?? "cleared"}` : null,
    due !== undefined ? `due: ${due ? due.toISOString().slice(0, 10) : "cleared"}` : null,
  ].filter(Boolean).join(", ");

  await prisma.$transaction([
    prisma.deal.update({ where: { id }, data: patch.data }),
    prisma.activity.create({ data: { dealId: id, contactId: deal.contactId, type: "note", summary: `Set ${text}`, meta: { by: agent } } }),
    prisma.agentEvent.create({ data: { kind: "activity", agent, level: "info", title: `${deal.venture.name} · ${deal.company.name}: ${text}`, meta: { dealId: id } } }),
  ]);
  const updated = await prisma.deal.findUniqueOrThrow({ where: { id }, include });
  return NextResponse.json({ deal: shapeDeal(updated, null, new Date(), process.env.APP_TZ || undefined) });
}
