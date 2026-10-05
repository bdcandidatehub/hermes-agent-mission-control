import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseContactInput } from "@/lib/contact-input";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// POST { contactId } | { name, title?, email?, linkedinUrl?, consentBasis?, consentNote? } → set the deal's contact.
// Use it to add a contact to a deal that has none, or to change who the deal's contact is.
//   • An existing contact can be attached if it belongs to the same company (or to no company).
//   • A new contact is created under the deal's company. If its email already belongs to a contact, that contact is reused.
//   • An unsubscribed contact is never attached.
// Consent defaults to "none": adding someone to a deal is not consent to message them.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const deal = await prisma.deal.findUnique({ where: { id }, include: { contact: true, company: { select: { name: true } } } });
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });

  let contactId: string;
  let label: string;
  if (typeof b.contactId === "string" && b.contactId) {
    const c = await prisma.contact.findUnique({ where: { id: b.contactId } });
    if (!c) return NextResponse.json({ error: "unknown contact" }, { status: 400 });
    if (c.companyId && c.companyId !== deal.companyId) return NextResponse.json({ error: "that contact belongs to a different company" }, { status: 400 });
    if (c.unsubscribedAt) return NextResponse.json({ error: `${c.name} has unsubscribed` }, { status: 409 });
    contactId = c.id; label = c.name;
  } else {
    const parsed = parseContactInput(b);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const d = parsed.data;
    const existing = d.email ? await prisma.contact.findFirst({ where: { email: { equals: d.email, mode: "insensitive" } } }) : null;
    if (existing) {
      if (existing.unsubscribedAt) return NextResponse.json({ error: `${existing.name} has unsubscribed` }, { status: 409 });
      if (existing.companyId && existing.companyId !== deal.companyId)
        return NextResponse.json({ error: `${d.email} already belongs to a contact at another company` }, { status: 409 });
      contactId = existing.id; label = existing.name;
    } else {
      const created = await prisma.contact.create({
        data: { companyId: deal.companyId, name: d.name, title: d.title, email: d.email, linkedinUrl: d.linkedinUrl, consentBasis: d.consentBasis, consentNote: d.consentNote },
      });
      contactId = created.id; label = created.name;
    }
  }

  if (deal.contactId === contactId) return NextResponse.json({ error: "that's already this deal's contact" }, { status: 409 });
  const summary = deal.contact ? `Contact changed from ${deal.contact.name} to ${label}` : `Contact added: ${label}`;
  await prisma.$transaction([
    prisma.deal.update({ where: { id }, data: { contactId } }),
    prisma.activity.create({ data: { dealId: id, contactId, type: "note", summary } }),
  ]);
  const updated = await prisma.deal.findUniqueOrThrow({ where: { id }, include: { contact: true } });
  return NextResponse.json({ deal: updated });
}
