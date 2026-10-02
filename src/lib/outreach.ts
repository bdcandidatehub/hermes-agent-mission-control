// Pure outreach helpers (no DB, no React): CSV import, activity rules, draft handoff, funnel maths.
import { CONSENT_BASES, type ConsentBasis } from "./crm";

/* ─────────────── Activities ─────────────── */

export const ACTIVITY_TYPES = ["email_sent", "linkedin_sent", "reply", "call", "meeting", "note", "stage"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

// Types a user may log by hand ("stage" rows are written by the server when a deal moves).
export const LOGGABLE_TYPES: ActivityType[] = ["email_sent", "linkedin_sent", "reply", "call", "meeting", "note"];
export const OUTBOUND_TYPES: ActivityType[] = ["email_sent", "linkedin_sent"];

export const ACTIVITY_LABEL: Record<string, string> = {
  email_sent: "Email sent", linkedin_sent: "LinkedIn sent", reply: "Reply received",
  call: "Call", meeting: "Meeting", note: "Note", stage: "Stage change",
};

// Convention for every venture: stages[0] = new lead, stages[1] = first touch made, stages[2] = they answered.
// Logging outreach moves a new lead to the first-touch stage; logging a reply moves a lead in either of the
// first two stages to the "answered" stage. Later stages (demo, trial, ...) are only ever moved by you.
export function autoAdvance(stages: string[], current: string, type: string): string | null {
  if (OUTBOUND_TYPES.includes(type as ActivityType)) return current === stages[0] && stages[1] ? stages[1] : null;
  if (type === "reply") return (current === stages[0] || current === stages[1]) && stages[2] ? stages[2] : null;
  return null;
}

export const FOLLOWUP_BUSINESS_DAYS = 4;

// Date-only value (UTC midnight) `n` business days after today's calendar day in `tz`.
export function addBusinessDays(n: number, now = new Date(), tz = "America/Halifax"): Date {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${today}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

export function todayDate(now = new Date(), tz = "America/Halifax"): Date {
  return addBusinessDays(0, now, tz);
}

/* ─────────────── Funnel ─────────────── */

export interface ActivityRow { type: string; meta?: unknown }
export interface Funnel {
  sent: number;
  replies: number;
  replyRate: number | null; // replies / sent, null when nothing was sent
  entries: Record<string, number>; // deals that ENTERED each stage in the window
}

export function funnelCounts(rows: ActivityRow[]): Funnel {
  let sent = 0, replies = 0;
  const entries: Record<string, number> = {};
  for (const r of rows) {
    if (OUTBOUND_TYPES.includes(r.type as ActivityType)) sent++;
    else if (r.type === "reply") replies++;
    else if (r.type === "stage") {
      const to = (r.meta as { to?: unknown } | null | undefined)?.to;
      if (typeof to === "string") entries[to] = (entries[to] ?? 0) + 1;
    }
  }
  return { sent, replies, replyRate: sent > 0 ? replies / sent : null, entries };
}

/* ─────────────── Draft handoff (Gmail compose link) ─────────────── */

export interface Draft { subject: string; body: string }

// Hermes returns "Subject: …" followed by the body. Tolerates code fences and markdown bold.
export function parseDraft(text: string): Draft {
  const cleaned = text.replace(/^\s*```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  const lines = cleaned.split("\n");
  const idx = lines.slice(0, 6).findIndex((l) => /^\s*(\*\*)?subject(\*\*)?\s*:/i.test(l));
  if (idx === -1) return { subject: "", body: cleaned };
  const subject = lines[idx].replace(/^\s*(\*\*)?subject(\*\*)?\s*:\s*(\*\*)?/i, "").replace(/\*\*\s*$/, "").trim();
  const body = [...lines.slice(0, idx), ...lines.slice(idx + 1)].join("\n").replace(/^\s*\n+/, "").trim();
  return { subject, body };
}

const MAX_URL = 7000;

// Opens a prefilled Gmail compose window. You review and press Send yourself; nothing is sent by the app.
export function gmailComposeUrl({ to, subject, body }: { to?: string | null; subject: string; body: string }): { url: string; truncated: boolean } {
  const base = `https://mail.google.com/mail/?view=cm&fs=1${to ? `&to=${encodeURIComponent(to)}` : ""}&su=${encodeURIComponent(subject)}`;
  let b = body;
  let url = `${base}&body=${encodeURIComponent(b)}`;
  let truncated = false;
  while (url.length > MAX_URL && b.length > 0) {
    truncated = true;
    b = b.slice(0, Math.floor(b.length * 0.8));
    url = `${base}&body=${encodeURIComponent(b)}`;
  }
  return { url, truncated };
}

/* ─────────────── CSV import ─────────────── */

// RFC 4180-style parser: quoted fields, "" escapes, CRLF/LF, BOM, and comma / semicolon / tab delimiters.
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => firstLine.split(c).length - 1;
  const delim = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];

  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export interface ProspectRow {
  company: string; website: string | null; industry: string | null; size: string | null; location: string | null;
  source: string | null; notes: string | null;
  contact: { name: string; email: string | null; title: string | null; linkedinUrl: string | null; consentBasis: ConsentBasis } | null;
}

const ALIASES: Record<string, string[]> = {
  company: ["company", "company_name", "organization", "organisation", "employer", "account", "business"],
  website: ["website", "url", "domain", "site", "company_website"],
  industry: ["industry", "sector"],
  size: ["size", "employees", "employee_count", "company_size", "headcount", "number_of_employees"],
  location: ["location", "city", "region", "province", "address"],
  name: ["contact_name", "name", "full_name", "contact", "person"],
  first: ["first_name", "firstname", "given_name"],
  last: ["last_name", "lastname", "surname", "family_name"],
  title: ["title", "job_title", "role", "position"],
  email: ["email", "email_address", "work_email", "e_mail"],
  linkedin: ["linkedin", "linkedin_url", "linkedin_profile", "profile", "profile_url"],
  consent: ["consent", "consent_basis", "casl"],
  source: ["source", "lead_source"],
  notes: ["notes", "note", "comments"],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
export const normalizeDomain = (w: string | null | undefined) =>
  (w ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MappedCsv { rows: { line: number; row?: ProspectRow; error?: string }[]; unknownColumns: string[]; missingCompany: boolean }

export function mapProspects(table: string[][], defaultConsent: ConsentBasis = "none"): MappedCsv {
  if (table.length === 0) return { rows: [], unknownColumns: [], missingCompany: true };
  const headers = table[0].map(norm);
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const i = headers.findIndex((h) => names.includes(h));
    if (i !== -1) col[key] = i;
  }
  const known = new Set(Object.values(col));
  const unknownColumns = table[0].filter((_, i) => !known.has(i)).map((h) => h.trim()).filter(Boolean);
  if (col.company === undefined) return { rows: [], unknownColumns, missingCompany: true };

  const get = (cells: string[], key: string) => {
    const v = col[key] === undefined ? "" : (cells[col[key]] ?? "").trim();
    return v === "" ? null : v;
  };
  const rows = table.slice(1).map((cells, i) => {
    const line = i + 2;
    const company = get(cells, "company");
    if (!company) return { line, error: "missing company name" };
    const email = get(cells, "email");
    if (email && !EMAIL_RE.test(email)) return { line, error: `invalid email "${email}"` };
    const consentRaw = get(cells, "consent")?.toLowerCase().replace(/[\s-]+/g, "_") ?? null;
    if (consentRaw && !(CONSENT_BASES as readonly string[]).includes(consentRaw)) return { line, error: `unknown consent basis "${consentRaw}"` };
    const name = get(cells, "name") ?? ([get(cells, "first"), get(cells, "last")].filter(Boolean).join(" ") || null);
    const contact = name || email
      ? { name: name ?? email!, email, title: get(cells, "title"), linkedinUrl: get(cells, "linkedin"), consentBasis: (consentRaw as ConsentBasis) ?? defaultConsent }
      : null;
    return {
      line,
      row: { company, website: get(cells, "website"), industry: get(cells, "industry"), size: get(cells, "size"), location: get(cells, "location"), source: get(cells, "source"), notes: get(cells, "notes"), contact },
    };
  });
  return { rows, unknownColumns, missingCompany: false };
}
