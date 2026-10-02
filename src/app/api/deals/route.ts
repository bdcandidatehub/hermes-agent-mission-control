import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CONSENT_BASES, isValidStage, parseDollarsToCents } from "@/lib/crm";

export const dynamic = "force-dynamic";

const str = (v: unknown, max = 300) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

function parseDue(v: unknown): Date | null | "invalid" {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

// GET ?venture=key → deals with their company and contact.
export async function GET(req: Request) {
  const venture = new URL(req.url).searchParams.get("venture");
  const deals = await prisma.deal.findMany({
    where: venture ? { ventureKey: venture } : undefined,
    include: { company: { select: { id: true, name: true } }, contact: { select: { id: true, name: true, title: true } } },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ deals });
}

// POST { ventureKey, company: {id} | {name, website?, ...}, contact?: {name, email?, ...},
//        title?, stage?, valueCents? | value?, nextAction?, nextActionDue?, notes? }
// Reuses an existing company with the same name (case-insensitive) so one prospect can hold deals in several ventures.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const venture = await prisma.venture.findUnique({ where: { key: String(b.ventureKey ?? "") } });
  if (!venture) return NextResponse.json({ error: "unknown venture" }, { status: 400 });

  const stage = String(b.stage ?? venture.stages[0]);
  if (!isValidStage(venture, stage)) return NextResponse.json({ error: "invalid stage" }, { status: 400 });

  let valueCents = 0;
  if (b.valueCents != null || b.value != null) {
    const parsed = b.valueCents != null ? (Number.isInteger(b.valueCents) && b.valueCents >= 0 ? b.valueCents : null) : parseDollarsToCents(b.value);
    if (parsed == null) return NextResponse.json({ error: "invalid value" }, { status: 400 });
    valueCents = parsed;
  }
  const due = parseDue(b.nextActionDue);
  if (due === "invalid") return NextResponse.json({ error: "invalid nextActionDue" }, { status: 400 });

  const c = (b.company ?? {}) as Record<string, unknown>;
  let companyId = str(c.id, 100);
  if (companyId) {
    if (!(await prisma.company.findUnique({ where: { id: companyId } })))
      return NextResponse.json({ error: "unknown company" }, { status: 400 });
  } else {
    const name = str(c.name);
    if (!name) return NextResponse.json({ error: "company name required" }, { status: 400 });
    const existing = await prisma.company.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    companyId = existing
      ? existing.id
      : (await prisma.company.create({
          data: {
            name, website: str(c.website), industry: str(c.industry), size: str(c.size),
            location: str(c.location), source: str(c.source), notes: str(c.notes, 5000),
          },
        })).id;
  }

  let contactId: string | null = null;
  const ct = b.contact as Record<string, unknown> | undefined;
  if (ct && (str(ct.id, 100) || str(ct.name))) {
    if (str(ct.id, 100)) {
      const found = await prisma.contact.findUnique({ where: { id: String(ct.id) } });
      if (!found) return NextResponse.json({ error: "unknown contact" }, { status: 400 });
      contactId = found.id;
    } else {
      const basis = String(ct.consentBasis ?? "none");
      if (!(CONSENT_BASES as readonly string[]).includes(basis)) return NextResponse.json({ error: "invalid consentBasis" }, { status: 400 });
      contactId = (await prisma.contact.create({
        data: {
          companyId, name: str(ct.name)!, email: str(ct.email), title: str(ct.title),
          linkedinUrl: str(ct.linkedinUrl), consentBasis: basis, consentNote: str(ct.consentNote, 1000),
        },
      })).id;
    }
  }

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const deal = await prisma.deal.create({
    data: {
      ventureKey: venture.key, companyId, contactId, stage,
      title: str(b.title) ?? company.name,
      valueCents, recurring: typeof b.recurring === "boolean" ? b.recurring : venture.recurring,
      nextAction: str(b.nextAction), nextActionDue: due, notes: str(b.notes, 5000),
    },
    include: { company: { select: { id: true, name: true } }, contact: { select: { id: true, name: true, title: true } } },
  });
  return NextResponse.json({ deal });
}
