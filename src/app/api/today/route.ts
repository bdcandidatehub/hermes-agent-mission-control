import { NextResponse } from "next/server";
import { getTodaySummary } from "@/lib/today";

export const dynamic = "force-dynamic";

// GET → cash-first summary for the home page: totals, ventures, and the follow-ups that need you today.
export async function GET(req: Request) {
  const days = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get("days") ?? "7", 10) || 7, 1), 90);
  return NextResponse.json(await getTodaySummary(days));
}
