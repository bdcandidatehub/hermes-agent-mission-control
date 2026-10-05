import { NextResponse } from "next/server";
import { logDealActivity } from "@/lib/activity-log";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// POST { type, summary?, occurredAt?, requestId? } → log something that happened on a deal.
// The rules (auto-advance, follow-up scheduling, unsubscribe refusal) live in lib/activity-log.ts.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const r = await logDealActivity(id, b);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ activity: r.activity, deal: r.deal, advancedTo: r.advancedTo });
}
