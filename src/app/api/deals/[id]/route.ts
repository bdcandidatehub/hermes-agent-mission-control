import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidStage, parseDollarsToCents, stageLabel } from "@/lib/crm";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET → the deal, its company/contact, and the playbook runs attached to it.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({ where: { id }, include: { company: true, contact: true } });
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  const requests = await prisma.agentRequest.findMany({ where: { dealId: id }, orderBy: { createdAt: "desc" }, take: 20 });
  const activities = await prisma.activity.findMany({ where: { dealId: id }, orderBy: { occurredAt: "desc" }, take: 50 });
  return NextResponse.json({ deal, requests, activities });
}

// PATCH { stage?, title?, valueCents?|value?, nextAction?, nextActionDue?, notes?, lostReason? }
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const existing = await prisma.deal.findUnique({ where: { id }, include: { venture: true, company: { select: { name: true } } } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim().slice(0, 300);
  if ("nextAction" in b) data.nextAction = typeof b.nextAction === "string" && b.nextAction.trim() ? b.nextAction.trim().slice(0, 300) : null;
  if ("notes" in b) data.notes = typeof b.notes === "string" && b.notes.trim() ? b.notes.slice(0, 5000) : null;
  if ("nextActionDue" in b) {
    if (b.nextActionDue == null || b.nextActionDue === "") data.nextActionDue = null;
    else {
      const d = new Date(String(b.nextActionDue));
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "invalid nextActionDue" }, { status: 400 });
      data.nextActionDue = d;
    }
  }
  if (b.valueCents != null || b.value != null) {
    const parsed = b.valueCents != null ? (Number.isInteger(b.valueCents) && b.valueCents >= 0 ? b.valueCents : null) : parseDollarsToCents(b.value);
    if (parsed == null) return NextResponse.json({ error: "invalid value" }, { status: 400 });
    data.valueCents = parsed;
  }

  let stageEvent: string | null = null;
  if (typeof b.stage === "string" && b.stage !== existing.stage) {
    if (!isValidStage(existing.venture, b.stage)) return NextResponse.json({ error: "invalid stage" }, { status: 400 });
    data.stage = b.stage;
    data.stageChangedAt = new Date();
    const closing = b.stage === existing.venture.wonStage || b.stage === existing.venture.lostStage;
    data.closedAt = closing ? new Date() : null;
    data.lostReason = b.stage === existing.venture.lostStage && typeof b.lostReason === "string" ? b.lostReason.trim().slice(0, 500) || null : null;
    if (b.stage === "contacted" && existing.contactId)
      await prisma.contact.update({ where: { id: existing.contactId }, data: { lastTouchedAt: new Date() } });
    stageEvent = `${existing.company.name}: ${stageLabel(existing.stage)} → ${stageLabel(b.stage)}`;
  }

  const [deal] = await prisma.$transaction([
    prisma.deal.update({
      where: { id }, data,
      include: { company: { select: { id: true, name: true } }, contact: { select: { id: true, name: true, title: true } } },
    }),
    ...(data.stage
      ? [prisma.activity.create({ data: { dealId: id, contactId: existing.contactId, type: "stage", meta: { from: existing.stage, to: data.stage as string } } })]
      : []),
  ]);
  if (stageEvent)
    await prisma.agentEvent.create({
      data: {
        kind: "activity", title: `${existing.venture.name} · ${stageEvent}`, agent: "pipeline",
        level: data.stage === existing.venture.wonStage ? "up" : data.stage === existing.venture.lostStage ? "warn" : "info",
        meta: { dealId: id, ventureKey: existing.ventureKey },
      },
    });
  return NextResponse.json({ deal });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await prisma.deal.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
