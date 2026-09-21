// Pure CRM helpers (no DB, no React) so they can be unit-tested and shared by API routes and pages.

export interface VentureCfg {
  key: string;
  name: string;
  stages: string[]; // ordered open stages
  wonStage: string;
  lostStage: string;
  recurring: boolean; // won deals count toward MRR
}

export const CONSENT_BASES = ["none", "express", "implied_existing", "implied_conspicuous"] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number];

// Playbooks that produce outbound copy. They are refused for unsubscribed contacts
// and flagged when the contact has no recorded CASL consent basis.
export const OUTREACH_PLAYBOOKS = new Set(["draft-intro-email", "draft-linkedin-note", "draft-followup"]);

export const allStages = (v: Pick<VentureCfg, "stages" | "wonStage" | "lostStage">) => [...v.stages, v.wonStage, v.lostStage];

export const isValidStage = (v: Pick<VentureCfg, "stages" | "wonStage" | "lostStage">, stage: string) =>
  allStages(v).includes(stage);

export const stageLabel = (s: string) => s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// {{deal.title}} / {{company.name}} / {{input}} … Unknown or empty placeholders render as "".
export function renderTemplate(tpl: string, ctx: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    let cur: unknown = ctx;
    for (const part of path.split(".")) {
      if (cur == null || typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur == null ? "" : String(cur);
  });
}

export interface DealLite {
  ventureKey: string;
  stage: string;
  valueCents: number;
}

export interface VentureSummary {
  key: string;
  counts: Record<string, number>; // per stage (open + won + lost)
  openDeals: number;
  openValueCents: number;
  wonDeals: number;
  wonValueCents: number;
  mrrCents: number; // == wonValueCents when the venture is recurring, else 0
}

export function summarizeVenture(v: VentureCfg, deals: DealLite[]): VentureSummary {
  const counts: Record<string, number> = {};
  for (const s of allStages(v)) counts[s] = 0;
  let openDeals = 0, openValueCents = 0, wonDeals = 0, wonValueCents = 0;
  for (const d of deals) {
    if (d.ventureKey !== v.key) continue;
    counts[d.stage] = (counts[d.stage] ?? 0) + 1;
    if (d.stage === v.wonStage) { wonDeals++; wonValueCents += d.valueCents; }
    else if (d.stage !== v.lostStage) { openDeals++; openValueCents += d.valueCents; }
  }
  return { key: v.key, counts, openDeals, openValueCents, wonDeals, wonValueCents, mrrCents: v.recurring ? wonValueCents : 0 };
}

export type DueBucket = "overdue" | "today" | "soon" | "later" | "none";

// Follow-up dates are date-only (stored as UTC midnight). "Today" is the calendar day in `tz`
// (default Atlantic Canada) so a deal due today doesn't flip to overdue in the evening.
export function dueBucket(due: Date | string | null | undefined, now = new Date(), tz = "America/Halifax"): DueBucket {
  if (!due) return "none";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "none";
  const dayNum = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const diff = dayNum(d.toISOString().slice(0, 10)) - dayNum(today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 2) return "soon";
  return "later";
}

export function fmtMoney(cents: number, currency = "CAD"): string {
  const n = cents / 100;
  return new Intl.NumberFormat("en-CA", {
    style: "currency", currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

// Parse user-entered dollars ("1,200", "$99.50") into integer cents; null if not a number.
export function parseDollarsToCents(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}
