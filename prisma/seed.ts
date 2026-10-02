// Seeds the CandidateHub venture and its playbooks. Idempotent: safe to re-run.
//   npm run db:seed
// Edit playbook prompts here (or in the DB) to match your own voice and offer.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const VOICE =
  "Voice: a calm, plainspoken operator. Consent-based, low pressure, specific to the recipient, no hype, " +
  "no buzzwords, no exclamation marks. Never invent facts about the recipient; if you are unsure, leave it out.";

const CONTEXT =
  "Company: {{company.name}} ({{company.website}}) — industry: {{company.industry}}; size: {{company.size}}; " +
  "location: {{company.location}}.\n" +
  "Contact: {{contact.name}}, {{contact.title}} ({{contact.email}}).\n" +
  "Deal: {{deal.title}}. Notes: {{notes}}";

const SIGNOFF =
  "Sign as Brad DiPaolo, founder of CandidateHub. Include a one-line sender identification and a simple opt-out line " +
  "(reply 'no thanks' and I won't follow up) to keep it CASL-compliant.";

const playbooks = [
  {
    key: "research-company",
    name: "Research company",
    description: "Recruiting pain points and an outreach angle. Internal only.",
    needsInput: false,
    promptTemplate:
      "Research this prospect for CandidateHub (recruiting/ATS software for mid-market employers in Atlantic Canada).\n" +
      CONTEXT +
      "\n\nFind and summarize: what they do, roughly how many people they employ, current hiring signals or open roles, " +
      "who runs HR / talent acquisition, and any recent news. Then list 2-3 likely recruiting pain points and ONE suggested " +
      "outreach angle. Be concise (bullets). Mark anything you could not verify as 'unverified'. Do not contact anyone.",
  },
  {
    key: "draft-intro-email",
    name: "Draft intro email",
    description: "Cold intro to book a demo. Draft only — you review and send.",
    needsInput: false,
    promptTemplate:
      "Draft a short cold intro email to {{contact.name}} ({{contact.title}}) at {{company.name}}, with the goal of booking a " +
      "15-minute CandidateHub demo.\n" + CONTEXT + "\n\n" + VOICE + "\n" +
      "Under 120 words, one clear low-pressure ask. Output the subject line and the body only. " + SIGNOFF + " Do NOT send anything.",
  },
  {
    key: "draft-linkedin-note",
    name: "Draft LinkedIn note",
    description: "Connection request note (300 characters max). Draft only.",
    needsInput: false,
    promptTemplate:
      "Draft a LinkedIn connection request note to {{contact.name}} ({{contact.title}}) at {{company.name}}.\n" +
      CONTEXT + "\n\n" + VOICE + "\nMaximum 300 characters. No pitch, no link. Output the note only. Do NOT send anything.",
  },
  {
    key: "draft-followup",
    name: "Draft follow-up",
    description: "Follow-up when a thread has gone quiet. Tell Hermes what happened.",
    needsInput: true,
    promptTemplate:
      "Draft a brief follow-up to {{contact.name}} ({{contact.title}}) at {{company.name}}.\n" + CONTEXT +
      "\nWhat happened so far: {{input}}\n\n" + VOICE + "\nUnder 80 words, add something useful rather than 'just checking in'. " +
      "Output the subject line (or 'Re:' if replying) and the body only. " + SIGNOFF + " Do NOT send anything.",
  },
  {
    key: "draft-reply",
    name: "Draft reply",
    description: "Reply to something they wrote back. Paste their message.",
    needsInput: true,
    promptTemplate:
      "Draft a reply to {{contact.name}} ({{contact.title}}) at {{company.name}}.\n" + CONTEXT +
      "\nTheir reply, verbatim:\n\"\"\"\n{{input}}\n\"\"\"\n\n" + VOICE + "\n" +
      "Answer what they actually asked. If they are interested, propose two specific 15-minute slots next week (leave the times " +
      "as [TIME 1] / [TIME 2] for me to fill in). If they said no or asked to stop, thank them briefly and confirm you won't follow up. " +
      "Under 100 words. Output the subject line ('Re: …') and the body only. " + SIGNOFF + " Do NOT send anything.",
  },
  {
    key: "prep-demo",
    name: "Prep demo",
    description: "One-page brief before a demo call. Internal only.",
    needsInput: false,
    promptTemplate:
      "Prepare a one-page demo brief for a CandidateHub demo with {{contact.name}} ({{contact.title}}) at {{company.name}}.\n" +
      CONTEXT + "\n\nInclude: who they are, what they probably struggle with in recruiting, 5 discovery questions, " +
      "the 2-3 CandidateHub features most relevant to them, likely objections with short answers, and a suggested next step " +
      "to propose at the end. Mark anything you could not verify as 'unverified'.",
  },
];

async function main() {
  await prisma.venture.upsert({
    where: { key: "candidatehub" },
    update: {},
    create: {
      key: "candidatehub",
      name: "CandidateHub",
      stages: ["prospect", "contacted", "replied", "demo_booked", "demo_done", "trial"],
      wonStage: "won",
      lostStage: "lost",
      recurring: true, // deal value = monthly subscription
      sortOrder: 0,
    },
  });
  await prisma.venture.upsert({
    where: { key: "ai-consulting" },
    update: {},
    create: {
      key: "ai-consulting",
      name: "AI Consulting",
      stages: ["prospect", "contacted", "replied", "discovery_booked", "proposal_sent"],
      wonStage: "won",
      lostStage: "lost",
      recurring: false, // most engagements are one-time; toggle per deal for retainers
      sortOrder: 1,
    },
  });
  await prisma.venture.upsert({
    where: { key: "web-design-marketing" },
    update: {},
    create: {
      key: "web-design-marketing",
      name: "Web Design & Marketing",
      stages: ["prospect", "contacted", "replied", "scoped", "proposal_sent"],
      wonStage: "won",
      lostStage: "lost",
      recurring: false, // project fees are one-time; toggle per deal for hosting/maintenance retainers
      sortOrder: 2,
    },
  });
  let i = 0;
  for (const p of playbooks) {
    await prisma.playbook.upsert({
      where: { key: p.key },
      // keep any edits you've made in the DB; only fill in what's missing
      update: {},
      create: { ...p, ventureKey: "candidatehub", kind: "oneshot", sortOrder: i++ },
    });
  }
  console.log(`Seeded venture "candidatehub" with ${playbooks.length} playbooks.`);
}

main().finally(() => prisma.$disconnect());
