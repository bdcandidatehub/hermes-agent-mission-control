import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CONSENT_BASES } from "@/lib/crm";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { consentBasis?, consentNote?, unsubscribed?: boolean, email?, title?, linkedinUrl?, name? }
// `unsubscribed: true` records the opt-out; playbooks that draft outreach refuse unsubscribed contacts.
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (b.consentBasis !== undefined) {
    if (!(CONSENT_BASES as readonly string[]).includes(b.consentBasis)) return NextResponse.json({ error: "invalid consentBasis" }, { status: 400 });
    data.consentBasis = b.consentBasis;
  }
  for (const k of ["consentNote", "email", "title", "linkedinUrl"] as const)
    if (k in b) data[k] = typeof b[k] === "string" && b[k].trim() ? b[k].trim().slice(0, 1000) : null;
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim().slice(0, 200);
  if (typeof b.unsubscribed === "boolean") data.unsubscribedAt = b.unsubscribed ? new Date() : null;
  const contact = await prisma.contact.update({ where: { id }, data }).catch(() => null);
  if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ contact });
}
