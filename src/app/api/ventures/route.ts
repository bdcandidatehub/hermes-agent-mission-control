import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { summarizeVenture } from "@/lib/crm";

export const dynamic = "force-dynamic";

// GET → every venture with its pipeline totals.
export async function GET() {
  const [ventures, deals] = await Promise.all([
    prisma.venture.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.deal.findMany({ select: { ventureKey: true, stage: true, valueCents: true } }),
  ]);
  return NextResponse.json({
    ventures: ventures.map((v) => ({ ...v, summary: summarizeVenture(v, deals) })),
  });
}
