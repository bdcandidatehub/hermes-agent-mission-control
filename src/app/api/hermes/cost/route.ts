import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseInsights } from "@/lib/hermes-insights";

export const dynamic = "force-dynamic";

// The bridge stores the raw `hermes insights` text; turn it into the structured usage the tiles show.
export async function GET() {
  const row = await prisma.dataStore.findUnique({ where: { key: "hermes-cost" } });
  const data = (row?.data ?? {}) as { summary?: string | null; syncedAt?: string | null };
  const parsed = parseInsights(data.summary);
  return NextResponse.json({ summary: data.summary ?? null, syncedAt: data.syncedAt ?? null, ...parsed });
}
