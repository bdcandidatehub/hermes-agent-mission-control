import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { agentIdFromHeaders } from "@/lib/agent-auth";
import { FALLBACK_FOLLOWUP_RULES, describeHistory, draftability } from "@/lib/agent-api";
import { renderTemplate } from "@/lib/crm";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET → everything needed to draft a follow-up for this deal, in the operator's voice: who, what happened so far, and the
// instructions (the venture's own "draft-followup" playbook when it has one). Refused for unsubscribed contacts.
// This returns text only. Nothing is queued or sent; the agent writes the draft into Gmail itself.
export async function GET(req: Request, { params }: Ctx) {
  if (!agentIdFromHeaders(req.headers)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const deal = await prisma.deal.findUnique({ where: { id }, include: { company: true, contact: true, venture: true } });
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ok = draftability(deal.contact);
  if (!ok.canDraft) return NextResponse.json({ error: ok.reason }, { status: 409 });

  const acts = await prisma.activity.findMany({ where: { dealId: id }, orderBy: { occurredAt: "desc" }, take: 10 });
  const history = describeHistory(acts);

  const playbook = await prisma.playbook.findFirst({ where: { key: "draft-followup", OR: [{ ventureKey: deal.ventureKey }, { ventureKey: null }] } });
  const instructions = playbook
    ? renderTemplate(playbook.promptTemplate, {
        deal: { title: deal.title }, company: deal.company, contact: deal.contact ?? {}, notes: deal.notes ?? "", input: history,
      })
    : [
        `Draft a brief follow-up to ${deal.contact?.name} (${deal.contact?.title ?? "no title"}) at ${deal.company.name}.`,
        `Venture: ${deal.venture.name}. Deal: ${deal.title}. Notes: ${deal.notes ?? "none"}`,
        `What happened so far:\n${history}`,
        FALLBACK_FOLLOWUP_RULES,
      ].join("\n\n");

  return NextResponse.json({
    deal: { id: deal.id, company: deal.company.name, stage: deal.stage, nextAction: deal.nextAction },
    contact: { name: deal.contact?.name, title: deal.contact?.title, email: deal.contact?.email, consentBasis: deal.contact?.consentBasis },
    warning: ok.warning,
    history,
    instructions,
  });
}
