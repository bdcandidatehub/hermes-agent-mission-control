import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addBusinessDays, autoAdvance, funnelCounts, gmailComposeUrl, mapProspects, normalizeDomain, parseCsv, parseDraft,
} from "../src/lib/outreach";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas and newlines, CRLF and a BOM", () => {
    const rows = parseCsv('﻿company,notes\r\n"Acme, Inc.","said ""hi""\nsecond line"\r\nBeta,plain\r\n');
    assert.deepEqual(rows, [["company", "notes"], ["Acme, Inc.", 'said "hi"\nsecond line'], ["Beta", "plain"]]);
  });
  it("detects semicolon and tab delimiters and skips blank lines", () => {
    assert.deepEqual(parseCsv("a;b\n1;2\n\n3;4"), [["a", "b"], ["1", "2"], ["3", "4"]]);
    assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  });
  it("keeps empty fields and a final row without a trailing newline", () => {
    assert.deepEqual(parseCsv("a,b,c\n1,,3"), [["a", "b", "c"], ["1", "", "3"]]);
  });
  it("doesn't hang or throw on an unterminated quote", () => {
    assert.doesNotThrow(() => parseCsv('a,b\n"oops,1'));
  });
});

describe("mapProspects", () => {
  const table = parseCsv("Company Name,Website,Employees,First Name,Last Name,Job Title,Work Email,Consent,Extra\n" +
    "Acme Foods,https://www.acme.ca/x,200,Jo,Tremblay,HR Director,jo@acme.ca,implied conspicuous,zzz\n" +
    "Beta Ltd,,,,,,,,\n" +
    ",nocompany.ca,,,,,,,\n" +
    "Gamma,,,Sam,,,not-an-email,,\n" +
    "Delta,,,Al,,,,maybe,\n");
  const m = mapProspects(table, "none");
  it("maps aliased headers, joins first/last names, normalises consent", () => {
    assert.deepEqual(m.rows[0].row?.contact, { name: "Jo Tremblay", email: "jo@acme.ca", title: "HR Director", linkedinUrl: null, consentBasis: "implied_conspicuous" });
    assert.equal(m.rows[0].row?.size, "200");
  });
  it("reports unknown columns", () => assert.deepEqual(m.unknownColumns, ["Extra"]));
  it("allows a company with no contact", () => assert.equal(m.rows[1].row?.contact, null));
  it("reports row-level errors with line numbers", () => {
    assert.match(m.rows[2].error!, /missing company/);
    assert.match(m.rows[3].error!, /invalid email/);
    assert.match(m.rows[4].error!, /unknown consent/);
    assert.deepEqual(m.rows.map((r) => r.line), [2, 3, 4, 5, 6]);
  });
  it("applies the default consent basis when the column is absent", () => {
    const r = mapProspects(parseCsv("company,email\nA,a@a.ca"), "express");
    assert.equal(r.rows[0].row?.contact?.consentBasis, "express");
  });
  it("flags a file with no company column", () => assert.equal(mapProspects(parseCsv("foo,bar\n1,2")).missingCompany, true));
  it("normalises domains", () => assert.equal(normalizeDomain("https://www.Acme.ca/about?x=1"), "acme.ca"));
});

describe("parseDraft", () => {
  it("splits subject and body", () => {
    assert.deepEqual(parseDraft("Subject: Quick question\n\nHi Jo,\n\nThanks.\nBrad"), { subject: "Quick question", body: "Hi Jo,\n\nThanks.\nBrad" });
  });
  it("tolerates code fences and bold labels", () => {
    assert.deepEqual(parseDraft("```\n**Subject:** Hello there\n\nBody text\n```"), { subject: "Hello there", body: "Body text" });
  });
  it("returns the whole text as the body when there is no subject", () => {
    assert.deepEqual(parseDraft("Just a LinkedIn note."), { subject: "", body: "Just a LinkedIn note." });
  });
});

describe("gmailComposeUrl", () => {
  it("encodes every field and points at Gmail compose", () => {
    const { url, truncated } = gmailComposeUrl({ to: "jo@acme.ca", subject: "A & B?", body: "line1\nline2 & more" });
    assert.ok(url.startsWith("https://mail.google.com/mail/?view=cm&fs=1&to=jo%40acme.ca&su=A%20%26%20B%3F&body="));
    assert.ok(url.endsWith("line1%0Aline2%20%26%20more"));
    assert.equal(truncated, false);
  });
  it("truncates over-long bodies to stay under the URL limit", () => {
    const { url, truncated } = gmailComposeUrl({ to: null, subject: "s", body: "word ".repeat(5000) });
    assert.ok(url.length <= 7000);
    assert.equal(truncated, true);
  });
});

describe("addBusinessDays (America/Halifax)", () => {
  it("skips weekends", () => {
    assert.equal(addBusinessDays(1, new Date("2026-09-25T15:00:00Z")).toISOString().slice(0, 10), "2026-09-28"); // Fri → Mon
    assert.equal(addBusinessDays(4, new Date("2026-09-21T15:00:00Z")).toISOString().slice(0, 10), "2026-09-25"); // Mon → Fri
  });
  it("uses the local calendar day, not UTC, in the evening", () => {
    // 9:30pm Monday in Halifax is already Tuesday in UTC
    assert.equal(addBusinessDays(1, new Date("2026-09-22T00:30:00Z")).toISOString().slice(0, 10), "2026-09-22");
  });
});

describe("autoAdvance", () => {
  const stages = ["prospect", "contacted", "replied", "demo_booked"];
  it("outreach moves a new lead to the first-touch stage only", () => {
    assert.equal(autoAdvance(stages, "prospect", "email_sent"), "contacted");
    assert.equal(autoAdvance(stages, "contacted", "email_sent"), null);
    assert.equal(autoAdvance(stages, "demo_booked", "linkedin_sent"), null);
  });
  it("a reply moves early-stage deals to 'replied' and never moves later ones backwards", () => {
    assert.equal(autoAdvance(stages, "prospect", "reply"), "replied");
    assert.equal(autoAdvance(stages, "contacted", "reply"), "replied");
    assert.equal(autoAdvance(stages, "replied", "reply"), null);
    assert.equal(autoAdvance(stages, "demo_booked", "reply"), null);
  });
  it("calls and notes never move a deal", () => assert.equal(autoAdvance(stages, "prospect", "call"), null));
});

describe("funnelCounts", () => {
  it("counts sent, replies, reply rate and stage entries", () => {
    const f = funnelCounts([
      { type: "email_sent" }, { type: "email_sent" }, { type: "linkedin_sent" }, { type: "reply" },
      { type: "stage", meta: { from: "replied", to: "demo_booked" } }, { type: "stage", meta: { to: "demo_booked" } },
      { type: "stage", meta: null }, { type: "note" },
    ]);
    assert.equal(f.sent, 3);
    assert.equal(f.replies, 1);
    assert.equal(f.replyRate, 1 / 3);
    assert.deepEqual(f.entries, { demo_booked: 2 });
  });
  it("has a null reply rate when nothing was sent", () => assert.equal(funnelCounts([{ type: "reply" }]).replyRate, null));
});
