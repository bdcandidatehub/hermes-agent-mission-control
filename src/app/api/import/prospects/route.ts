import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CONSENT_BASES, type ConsentBasis } from "@/lib/crm";
import { mapProspects, normalizeDomain, parseCsv } from "@/lib/outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CHARS = 1_000_000;
const MAX_ROWS = 1000;
const LIST_CAP = 50;

// POST { ventureKey, csv, dryRun?, defaultConsent? } → import prospects as deals in the venture's first stage.
//
// Idempotent, so re-importing the same file is safe:
//   • a company is matched by name (case-insensitive) or website domain, else created
//   • a contact is matched by email, else by name within the company, else created
//   • a company that already has a deal in this venture is skipped (no duplicate deals)
//   • a row whose email belongs to an UNSUBSCRIBED contact is skipped entirely
// `dryRun: true` reports what would happen without writing anything.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const dry = b.dryRun === true;
  const csv = typeof b.csv === "string" ? b.csv : "";
  if (!csv.trim()) return NextResponse.json({ error: "csv is empty" }, { status: 400 });
  if (csv.length > MAX_CHARS) return NextResponse.json({ error: "file too large (limit ~1MB)" }, { status: 413 });

  const defaultConsent = String(b.defaultConsent ?? "none");
  if (!(CONSENT_BASES as readonly string[]).includes(defaultConsent)) return NextResponse.json({ error: "invalid defaultConsent" }, { status: 400 });

  const venture = await prisma.venture.findUnique({ where: { key: String(b.ventureKey ?? "") } });
  if (!venture) return NextResponse.json({ error: "unknown venture" }, { status: 400 });
  const stage = venture.stages[0];
  if (!stage) return NextResponse.json({ error: "venture has no stages" }, { status: 400 });

  const mapped = mapProspects(parseCsv(csv), defaultConsent as ConsentBasis);
  if (mapped.missingCompany)
    return NextResponse.json({ error: "No company column found. Add a header such as Company, Company Name or Organization." }, { status: 400 });
  if (mapped.rows.length > MAX_ROWS) return NextResponse.json({ error: `too many rows (limit ${MAX_ROWS} per import)` }, { status: 413 });

  const [companies, contacts, ventureDeals] = await Promise.all([
    prisma.company.findMany({ select: { id: true, name: true, website: true } }),
    prisma.contact.findMany({ select: { id: true, companyId: true, name: true, email: true, unsubscribedAt: true } }),
    prisma.deal.findMany({ where: { ventureKey: venture.key }, select: { companyId: true } }),
  ]);
  const byName = new Map(companies.map((c) => [c.name.toLowerCase(), c.id]));
  const byDomain = new Map(companies.filter((c) => c.website).map((c) => [normalizeDomain(c.website), c.id]));
  const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]));
  const byCompanyName = new Map(contacts.map((c) => [`${c.companyId}|${c.name.toLowerCase()}`, c.id]));
  const hasDeal = new Set(ventureDeals.map((d) => d.companyId));

  const out = { companiesCreated: 0, contactsCreated: 0, dealsCreated: 0, skipped: [] as { line: number; company: string; reason: string }[], errors: [] as { line: number; error: string }[] };
  let fake = 0;
  const skip = (line: number, company: string, reason: string) => out.skipped.push({ line, company, reason });

  for (const { line, row, error } of mapped.rows) {
    if (error || !row) { out.errors.push({ line, error: error ?? "invalid row" }); continue; }

    const existingContact = row.contact?.email ? byEmail.get(row.contact.email.toLowerCase()) : undefined;
    if (existingContact?.unsubscribedAt) { skip(line, row.company, "contact has unsubscribed"); continue; }

    const domain = normalizeDomain(row.website);
    let companyId = byName.get(row.company.toLowerCase()) ?? (domain ? byDomain.get(domain) : undefined) ?? existingContact?.companyId ?? undefined;
    if (companyId && hasDeal.has(companyId)) { skip(line, row.company, `already has a ${venture.name} deal`); continue; }

    if (!companyId) {
      companyId = dry
        ? `dry-${fake++}`
        : (await prisma.company.create({
            data: { name: row.company, website: row.website, industry: row.industry, size: row.size, location: row.location, source: row.source ?? "csv import", notes: row.notes },
          })).id;
      out.companiesCreated++;
      byName.set(row.company.toLowerCase(), companyId);
      if (domain) byDomain.set(domain, companyId);
    }

    let contactId: string | null = null;
    if (row.contact) {
      const c = row.contact;
      contactId = existingContact?.id ?? byCompanyName.get(`${companyId}|${c.name.toLowerCase()}`) ?? null;
      if (!contactId) {
        contactId = dry
          ? `dry-${fake++}`
          : (await prisma.contact.create({
              data: { companyId, name: c.name, email: c.email, title: c.title, linkedinUrl: c.linkedinUrl, consentBasis: c.consentBasis, consentNote: "Set at CSV import" },
            })).id;
        out.contactsCreated++;
        byCompanyName.set(`${companyId}|${c.name.toLowerCase()}`, contactId);
        if (c.email) byEmail.set(c.email.toLowerCase(), { id: contactId, companyId, name: c.name, email: c.email, unsubscribedAt: null });
      }
    }

    if (!dry) await prisma.deal.create({ data: { ventureKey: venture.key, companyId, contactId, title: row.company, stage } });
    out.dealsCreated++;
    hasDeal.add(companyId);
  }

  return NextResponse.json({
    dryRun: dry, venture: venture.name, stage, rows: mapped.rows.length, unknownColumns: mapped.unknownColumns,
    companiesCreated: out.companiesCreated, contactsCreated: out.contactsCreated, dealsCreated: out.dealsCreated,
    skipped: out.skipped.slice(0, LIST_CAP), skippedCount: out.skipped.length,
    errors: out.errors.slice(0, LIST_CAP), errorCount: out.errors.length,
  });
}
