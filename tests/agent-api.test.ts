import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agentForKey, agentIdFromHeaders, parseAgentKeys, presentedKey } from "../src/lib/agent-auth";
import { AGENT_ACTIVITY_TYPES, describeHistory, draftability, parseNextActionPatch, shapeDeal, type DealRow } from "../src/lib/agent-api";

const K1 = "a".repeat(40);
const K2 = "b".repeat(40);
const RAW = `mason:${K1}, friday:${K2}`;
const hdr = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("parseAgentKeys", () => {
  it("reads id:key pairs", () => {
    assert.deepEqual(parseAgentKeys(RAW).map((k) => k.id), ["mason", "friday"]);
  });
  it("ignores weak keys, bad ids and garbage instead of accepting them", () => {
    assert.deepEqual(parseAgentKeys("mason:short,Bad Id:" + K1 + ",:" + K1 + ",nocolon," + `ok:${K2}`).map((k) => k.id), ["ok"]);
    assert.deepEqual(parseAgentKeys(undefined), []);
    assert.deepEqual(parseAgentKeys(""), []);
  });
  it("keeps a colon inside the key", () => {
    assert.equal(parseAgentKeys(`x:${K1}:tail`)[0].key, `${K1}:tail`);
  });
});

describe("agentForKey", () => {
  it("returns the agent for its own key", () => {
    assert.equal(agentForKey(RAW, K1), "mason");
    assert.equal(agentForKey(RAW, K2), "friday");
  });
  it("rejects wrong, empty, missing and near-miss keys", () => {
    for (const bad of ["", null, undefined, "c".repeat(40), K1 + "x", K1.slice(0, -1)]) assert.equal(agentForKey(RAW, bad as string), null, String(bad));
  });
  it("rejects everything when no keys are configured", () => {
    assert.equal(agentForKey(undefined, K1), null);
    assert.equal(agentForKey("mason:weak", "weak"), null);
  });
});

describe("presentedKey / agentIdFromHeaders", () => {
  it("accepts Bearer or x-agent-key", () => {
    assert.equal(presentedKey(hdr({ authorization: `Bearer ${K1}` })), K1);
    assert.equal(presentedKey(hdr({ "x-agent-key": K1 })), K1);
    assert.equal(presentedKey(hdr({})), null);
    assert.equal(presentedKey(hdr({ authorization: "Basic abc" })), null);
  });
  it("only accepts a well-formed agent id from the stamped header", () => {
    assert.equal(agentIdFromHeaders(hdr({ "x-agent-id": "mason" })), "mason");
    for (const bad of ["../x", "A B", "", "x".repeat(40)]) assert.equal(agentIdFromHeaders(hdr({ "x-agent-id": bad })), null, bad);
    assert.equal(agentIdFromHeaders(hdr({})), null);
  });
});

describe("what agents may log", () => {
  it("is notes and replies only, never 'sent'", () => {
    assert.deepEqual([...AGENT_ACTIVITY_TYPES], ["note", "reply"]);
  });
});

describe("parseNextActionPatch", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  it("accepts a next action and a date", () => {
    const r = parseNextActionPatch({ nextAction: "  Call Jo ", nextActionDue: "2026-10-09" }, now);
    assert.ok(r.ok && r.data.nextAction === "Call Jo" && r.data.nextActionDue?.toISOString().startsWith("2026-10-09"));
  });
  it("can clear either field", () => {
    const r = parseNextActionPatch({ nextAction: "", nextActionDue: null }, now);
    assert.ok(r.ok && r.data.nextAction === null && r.data.nextActionDue === null);
  });
  it("refuses anything other than those two fields (stage, value, notes stay with the operator)", () => {
    for (const body of [{ stage: "won" }, { valueCents: 1 }, { nextAction: "x", notes: "y" }, { recurring: true }]) {
      const r = parseNextActionPatch(body, now);
      assert.ok(!r.ok, JSON.stringify(body));
    }
  });
  it("refuses empty bodies, past and far-future dates, bad dates and non-text actions", () => {
    for (const body of [{}, null, { nextActionDue: "2026-09-01" }, { nextActionDue: "2028-01-01" }, { nextActionDue: "next tuesday" }, { nextAction: 5 }])
      assert.ok(!parseNextActionPatch(body, now).ok, JSON.stringify(body));
  });
  it("allows today", () => {
    assert.ok(parseNextActionPatch({ nextActionDue: "2026-10-05" }, now).ok);
  });
});

describe("draftability", () => {
  const c = (o = {}) => ({ name: "Jo", title: null, email: "jo@x.ca", consentBasis: "express", unsubscribedAt: null as Date | null, ...o });
  it("blocks a missing or unsubscribed contact", () => {
    assert.equal(draftability(null).canDraft, false);
    const u = draftability(c({ unsubscribedAt: new Date() }));
    assert.equal(u.canDraft, false);
    assert.match(u.reason ?? "", /unsubscribed/);
  });
  it("allows a consented contact without a warning", () => {
    assert.deepEqual(draftability(c()), { canDraft: true, reason: null, warning: null });
  });
  it("warns when consent is unrecorded or there's no email", () => {
    assert.match(draftability(c({ consentBasis: "none" })).warning ?? "", /CASL/);
    assert.match(draftability(c({ email: null })).warning ?? "", /No email/);
  });
});

describe("describeHistory", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const a = (type: string, d: string, summary = "") => ({ type, summary, occurredAt: new Date(d) });
  it("notes when we're waiting on a reply", () => {
    const h = describeHistory([a("email_sent", "2026-10-03T12:00:00Z", "Intro"), a("stage", "2026-10-03T12:00:00Z")], now);
    assert.match(h, /Email sent \(7d ago\): Intro/);
    assert.match(h, /No reply has been logged since the last message, 7 days ago/);
    assert.doesNotMatch(h, /Stage change/);
  });
  it("doesn't claim silence after a reply or a call", () => {
    assert.doesNotMatch(describeHistory([a("reply", "2026-10-09T12:00:00Z", "Interested")], now), /No reply/);
  });
  it("handles an empty history", () => {
    assert.match(describeHistory([], now), /Nothing has been logged/);
  });
});

describe("shapeDeal", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const deal: DealRow = {
    id: "d1", ventureKey: "candidatehub", stage: "contacted", valueCents: 24900, recurring: true,
    nextAction: "Follow up", nextActionDue: new Date("2026-10-08T00:00:00Z"), stageChangedAt: new Date("2026-10-01T12:00:00Z"), notes: "n".repeat(900),
    company: { name: "Acme", website: "acme.ca" },
    contact: { name: "Jo", title: "HR", email: "jo@acme.ca", consentBasis: "none", unsubscribedAt: null },
  };
  const s = shapeDeal(deal, { type: "email_sent", summary: "Intro", occurredAt: new Date("2026-10-02T12:00:00Z") }, now, "America/Halifax");
  it("computes due bucket, days in stage and a date-only due", () => {
    assert.deepEqual([s.due, s.daysInStage, s.nextActionDue], ["overdue", 9, "2026-10-08"]);
  });
  it("exposes consent state and caps long notes", () => {
    assert.deepEqual([s.contact?.consentBasis, s.contact?.unsubscribed], ["none", false]);
    assert.equal(s.notes?.length, 500);
    assert.equal(s.lastActivity?.label, "Email sent");
  });
});
