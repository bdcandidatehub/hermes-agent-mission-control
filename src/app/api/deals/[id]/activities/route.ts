import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dueBucket } from "@/lib/crm";
import {
  ACTIVITY_LABEL, FOLLOWUP_BUSINESS_DAYS, LOGGABLE_TYPES, OUTBOUND_TYPES, addBusinessDays, autoAdvance, todayDate,
  type ActivityType,
} from "@/lib/outreach";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// POST { type, summary?, occurredAt? } → log something that happened on a deal.
// Side effects (this is what keeps the pipeline honest without manual bookkeeping):
//   • outreach sent  → new lead moves to the first-touch stage; follow-up is set N business days out
//   • reply received → early-stage lead moves to "replied"; next action becomes "Reply to …" due today
//   • the contact's lastTouchedAt is updated
// Logging outreach to an unsubscribed contact is refused.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const type = String(b.type ?? "") as ActivityType;
  if (!LOGGABLE_TYPES.includes(type)) return NextResponse.json({ error: "invalid activity type" }, { status: 400 });

  const deal = await prisma.deal.findUnique({ where: { id }, include: { venture: true, contact: true, company: { select: { name: true } } } });
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (OUTBOUND_TYPES.includes(type) && deal.contact?.unsubscribedAt)
    return NextResponse.json({ error: `${deal.contact.name} has unsubscribed — don't contact them` }, { status: 409 });

  let occurredAt = new Date();
  if (b.occurredAt) {
    occurredAt = new Date(String(b.occurredAt));
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 86_400_000)
      return NextResponse.json({ error: "invalid occurredAt" }, { status: 400 });
  }
  const summary = typeof b.summary === "string" ? b.summary.trim().slice(0, 2000) : "";

  // `requestId` ties a "sent" log to the Hermes draft it came from, so one draft can only be logged once.
  const requestId = typeof b.requestId === "string" && b.requestId ? b.requestId.slice(0, 100) : null;
  if (requestId && (await prisma.activity.findFirst({ where: { dealId: id, meta: { path: ["requestId"], equals: requestId } }, select: { id: true } })))
    return NextResponse.json({ error: "this draft is already logged" }, { status: 409 });

  const tz = process.env.APP_TZ || undefined;
  const isOpen = deal.stage !== deal.venture.wonStage && deal.stage !== deal.venture.lostStage;
  const advanceTo = isOpen ? autoAdvance(deal.venture.stages, deal.stage, type) : null;
  const who = deal.contact?.name ?? deal.company.name;

  const dealData: Record<string, unknown> = {};
  if (advanceTo) { dealData.stage = advanceTo; dealData.stageChangedAt = new Date(); }
  if (isOpen && OUTBOUND_TYPES.includes(type)) {
    // don't clobber a future follow-up you set on purpose
    if (!deal.nextActionDue || ["overdue", "today"].includes(dueBucket(deal.nextActionDue, new Date(), tz))) {
      dealData.nextAction = `Follow up with ${who}`;
      dealData.nextActionDue = addBusinessDays(FOLLOWUP_BUSINESS_DAYS, new Date(), tz);
    }
  } else if (isOpen && type === "reply") {
    dealData.nextAction = `Reply to ${who}`;
    dealData.nextActionDue = todayDate(new Date(), tz);
  }

  const ops = [
    prisma.activity.create({
      data: { dealId: id, contactId: deal.contactId, type, summary, occurredAt, ...(requestId ? { meta: { requestId } } : {}) },
    }),
    ...(advanceTo
      ? [prisma.activity.create({ data: { dealId: id, contactId: deal.contactId, type: "stage", summary: "", meta: { from: deal.stage, to: advanceTo, auto: true }, occurredAt } })]
      : []),
    ...(deal.contactId ? [prisma.contact.update({ where: { id: deal.contactId }, data: { lastTouchedAt: occurredAt } })] : []),
    ...(Object.keys(dealData).length ? [prisma.deal.update({ where: { id }, data: dealData })] : []),
    prisma.agentEvent.create({
      data: { kind: "activity", agent: "pipeline", level: type === "reply" ? "up" : "info", title: `${deal.venture.name} · ${who}: ${ACTIVITY_LABEL[type]}`, meta: { dealId: id, type } },
    }),
  ];
  const [activity] = await prisma.$transaction(ops);
  const updated = await prisma.deal.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true } }, contact: { select: { id: true, name: true, title: true } } },
  });
  return NextResponse.json({ activity, deal: updated, advancedTo: advanceTo });
}
