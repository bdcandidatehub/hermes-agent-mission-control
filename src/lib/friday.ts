// Friday = the main Hermes agent, talked to from the dashboard. Server-side helpers (snapshot the agent sees).
import { fmtMoney } from "./crm";

export const FRIDAY_KIND = "friday.chat";
export const MAX_MESSAGE_CHARS = 2000;

// Company and contact names come from imported CSVs, i.e. untrusted text that ends up in an agent's context.
// Keep them to plain, short words so they can't smuggle in instructions or break out of the data block.
export function sanitizeName(s: string, max = 40): string {
  return String(s ?? "")
    .replace(/[^\p{L}\p{N} .,&'()\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export interface SnapshotInput {
  mrrCents: number;
  openPipelineCents: number;
  pendingApprovals: number;
  due: { company: string; nextAction: string | null; bucket: string; stage: string }[];
}

// A compact, factual picture of the business right now, so "what needs me today?" has an answer.
export function buildSnapshot(i: SnapshotInput): string {
  const lines = [
    `MRR ${fmtMoney(i.mrrCents)}; open pipeline ${fmtMoney(i.openPipelineCents)}; ${i.pendingApprovals} item(s) awaiting approval.`,
    i.due.length === 0
      ? "No follow-ups are due."
      : `Follow-ups due (${i.due.length}): ` +
        i.due.slice(0, 6).map((d) => `${sanitizeName(d.company)} [${d.bucket}, ${sanitizeName(d.stage, 20)}]${d.nextAction ? `: ${sanitizeName(d.nextAction, 50)}` : ""}`).join("; ") + ".",
  ];
  return lines.join("\n");
}
