import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OUTREACH_PLAYBOOKS, renderTemplate } from "@/lib/crm";
import { initialStatus, MAX_PROMPT_CHARS } from "@/lib/hermes-policy";

// POST { playbookKey, dealId, input? } → render the playbook against the deal and queue it for Hermes.
// Approval tier comes from the playbook's `kind` via lib/hermes-policy.ts. Nothing here sends anything:
// outreach playbooks only produce drafts.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const [playbook, deal] = await Promise.all([
    prisma.playbook.findUnique({ where: { key: String(b.playbookKey ?? "") } }),
    prisma.deal.findUnique({ where: { id: String(b.dealId ?? "") }, include: { company: true, contact: true } }),
  ]);
  if (!playbook) return NextResponse.json({ error: "unknown playbook" }, { status: 404 });
  if (!deal) return NextResponse.json({ error: "unknown deal" }, { status: 404 });
  if (playbook.ventureKey && playbook.ventureKey !== deal.ventureKey)
    return NextResponse.json({ error: "playbook belongs to a different venture" }, { status: 400 });

  const input = typeof b.input === "string" ? b.input.trim().slice(0, 5000) : "";
  if (playbook.needsInput && !input) return NextResponse.json({ error: "this playbook needs some input" }, { status: 400 });

  const outreach = OUTREACH_PLAYBOOKS.has(playbook.key);
  if (outreach && deal.contact?.unsubscribedAt)
    return NextResponse.json({ error: `${deal.contact.name} has unsubscribed — no outreach drafts` }, { status: 409 });
  if (outreach && !deal.contact)
    return NextResponse.json({ error: "add a contact to this deal first" }, { status: 400 });

  const status = initialStatus(playbook.kind, false);
  if (!status) return NextResponse.json({ error: `playbook kind not allowed: ${playbook.kind}` }, { status: 400 });

  const prompt = renderTemplate(playbook.promptTemplate, {
    deal: { title: deal.title }, company: deal.company, contact: deal.contact ?? {}, notes: deal.notes ?? "", input,
  });
  if (prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ error: "rendered prompt too long" }, { status: 413 });

  const request = await prisma.agentRequest.create({
    data: {
      origin: "web", kind: playbook.kind, title: `${playbook.name}: ${deal.company.name}`.slice(0, 200), prompt,
      sideEffecting: status === "awaiting_approval", status, dealId: deal.id, playbookKey: playbook.key,
    },
  });
  const warning =
    outreach && deal.contact?.consentBasis === "none"
      ? "No CASL consent basis is recorded for this contact. Confirm you may message them before sending."
      : null;
  return NextResponse.json({ request, warning });
}
