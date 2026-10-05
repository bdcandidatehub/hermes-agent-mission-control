import { prisma } from "@/lib/prisma";
import { dueBucket } from "@/lib/crm";
import {
  ACTIVITY_LABEL, FOLLOWUP_BUSINESS_DAYS, LOGGABLE_TYPES, OUTBOUND_TYPES, addBusinessDays, autoAdvance, todayDate,
  type ActivityType,
} from "@/lib/outreach";

export interface LogInput {
  type: string;
  summary?: unknown;
  occurredAt?: unknown;
  requestId?: unknown;
  by?: string; // set when an agent (not you) is logging this
}

export type LogResult =
  | { ok: true; activity: unknown; deal: unknown; advancedTo: string | null }
  | { ok: false; status: number; error: string };

// Log something that happened on a deal. Side effects (this is what keeps the pipeline honest without manual bookkeeping):
//   • outreach sent  → new lead moves to the first-touch stage; follow-up is set N business days out
//   • reply received → early-stage lead moves to "replied"; next action becomes "Reply to …" due today
//   • the contact's lastTouchedAt is updated
// Logging outreach to an unsubscribed contact is refused.
export async function logDealActivity(id: string, b: LogInput): Promise<LogResult> {
  const type = String(b.type ?? "") as ActivityType;
  if (!LOGGABLE_TYPES.includes(type)) return { ok: false, status: 400, error: "invalid activity type" };

  const deal = await prisma.deal.findUnique({ where: { id }, include: { venture: true, contact: true, company: { select: { name: true } } } });
  if (!deal) return { ok: false, status: 404, error: "not found" };
  if (OUTBOUND_TYPES.includes(type) && deal.contact?.unsubscribedAt)
    return { ok: false, status: 409, error: `${deal.contact.name} has unsubscribed — don't contact them` };

  let occurredAt = new Date();
  if (b.occurredAt) {
    occurredAt = new Date(String(b.occurredAt));
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 86_400_000)
      return { ok: false, status: 400, error: "invalid occurredAt" };
  }
  const summary = typeof b.summary === "string" ? b.summary.trim().slice(0, 2000) : "";

  // `requestId` ties a "sent" log to the Hermes draft it came from, so one draft can only be logged once.
  const requestId = typeof b.requestId === "string" && b.requestId ? b.requestId.slice(0, 100) : null;
  if (requestId && (await prisma.activity.findFirst({ where: { dealId: id, meta: { path: ["requestId"], equals: requestId } }, select: { id: true } })))
    return { ok: false, status: 409, error: "this draft is already logged" };

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

  const meta = { ...(requestId ? { requestId } : {}), ...(b.by ? { by: b.by } : {}) };
  const ops = [
    prisma.activity.create({
      data: { dealId: id, contactId: deal.contactId, type, summary, occurredAt, ...(Object.keys(meta).length ? { meta } : {}) },
    }),
    ...(advanceTo
      ? [prisma.activity.create({ data: { dealId: id, contactId: deal.contactId, type: "stage", summary: "", meta: { from: deal.stage, to: advanceTo, auto: true, ...(b.by ? { by: b.by } : {}) }, occurredAt } })]
      : []),
    ...(deal.contactId ? [prisma.contact.update({ where: { id: deal.contactId }, data: { lastTouchedAt: occurredAt } })] : []),
    ...(Object.keys(dealData).length ? [prisma.deal.update({ where: { id }, data: dealData })] : []),
    prisma.agentEvent.create({
      data: {
        kind: "activity", agent: b.by ?? "pipeline", level: type === "reply" ? "up" : "info",
        title: `${deal.venture.name} · ${who}: ${ACTIVITY_LABEL[type]}`, meta: { dealId: id, type },
      },
    }),
  ];
  const [activity] = await prisma.$transaction(ops);
  const updated = await prisma.deal.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true } }, contact: { select: { id: true, name: true, title: true } } },
  });
  return { ok: true, activity, deal: updated, advancedTo: advanceTo };
}
