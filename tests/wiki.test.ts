import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deriveTitle, parseEntry, walkMd, writeWikiEntry } from "../hermes-bridge/wiki.mjs";

describe("bridge wiki writer", () => {
  let wiki: string, outside: string;
  before(() => {
    wiki = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    fs.symlinkSync(outside, path.join(wiki, "link"));
  });
  after(() => { fs.rmSync(wiki, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });

  it("writes a normal entry", () => {
    const rel = writeWikiEntry(wiki, { id: "acme", type: "fact", title: "Acme", body: "hi" });
    assert.equal(rel, "facts/acme.md");
    assert.ok(fs.existsSync(path.join(wiki, rel)));
  });
  for (const bad of ["../../evil.md", "a/../../evil.md", "/etc/passwd.md", "notes/x.sh", ".git/hooks/x.md", "..\\..\\evil.md"]) {
    it(`rejects path ${JSON.stringify(bad)}`, () => {
      assert.throws(() => writeWikiEntry(wiki, { id: "x", path: bad, title: "x" }), /invalid wiki path/);
    });
  }
  it("rejects writing through a symlink that leaves the wiki, and creates nothing outside", () => {
    assert.throws(() => writeWikiEntry(wiki, { id: "x", path: "link/deep/er/x.md", title: "x" }), /invalid wiki path/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
  it("neutralises newline injection in frontmatter", () => {
    writeWikiEntry(wiki, { id: "inj", title: "a\ntags: [pwned]", tags: ["x,y", "z]"], body: "b" });
    const out = fs.readFileSync(path.join(wiki, "notes/inj.md"), "utf8");
    assert.doesNotMatch(out, /^tags: \[pwned\]/m);
    assert.match(out, /^tags: \[x y, z\]$/m);
  });
});

// Synthetic notes in the same shape as a real Karpathy-style wiki: multi-line YAML lists, extra keys, capitalised folders.
const NOTE = `---
tags:
  - Recruiting
  - ATS
topics:
  - hiring
status: active
created: 2026-01-02
updated: 2026-02-03
sources:
  - "Some Article"
source_count: 1
aliases: [Applicant Tracking]
---
# Applicant tracking

Body text here.
`;

describe("wiki parsing", () => {
  it("reads multi-line lists, inline lists, quotes and extra keys", () => {
    const { fm, body } = parseEntry(NOTE);
    assert.deepEqual(fm.tags, ["Recruiting", "ATS"]);
    assert.deepEqual(fm.sources, ["Some Article"]);
    assert.deepEqual(fm.aliases, ["Applicant Tracking"]);
    assert.equal(fm.status, "active");
    assert.equal(fm.source_count, "1");
    assert.match(body, /^# Applicant tracking/);
  });
  it("derives a title from the first heading, else the file name", () => {
    assert.equal(deriveTitle("Concepts/ats.md", "# Applicant tracking\n\nx"), "Applicant tracking");
    assert.equal(deriveTitle("Concepts/ats.md", "no heading"), "ats");
  });
  it("skips configured folders/files and all dot-directories when listing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walk-"));
    for (const f of ["Concepts/a.md", "Logs/2026.md", "index.md", ".hermy-backups/x.md", "Concepts/INDEX.md"]) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), "x");
    }
    const skip = { dirs: new Set(["logs"]), files: new Set(["index.md"]) };
    assert.deepEqual(walkMd(dir, skip).map((p: string) => path.relative(dir, p)).sort(), ["Concepts/a.md"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("editing an existing note is non-destructive", () => {
  let wiki: string;
  before(() => {
    wiki = fs.mkdtempSync(path.join(os.tmpdir(), "wiki2-"));
    fs.mkdirSync(path.join(wiki, "Concepts"));
    fs.writeFileSync(path.join(wiki, "Concepts/ats.md"), NOTE);
  });
  after(() => fs.rmSync(wiki, { recursive: true, force: true }));
  const read = () => fs.readFileSync(path.join(wiki, "Concepts/ats.md"), "utf8");

  it("a body-only edit (as the dashboard sends it) keeps every frontmatter key and its formatting", () => {
    writeWikiEntry(wiki, {
      id: "Concepts/ats", path: "Concepts/ats.md", type: "fact", title: "Applicant tracking", status: "active",
      tags: ["recruiting", "ats"], // the dashboard lowercases tags
      body: "# Applicant tracking\n\nEdited body.",
    });
    const out = read();
    for (const keep of ["topics:\n  - hiring", "created: 2026-01-02", 'sources:\n  - "Some Article"', "source_count: 1", "aliases: [Applicant Tracking]", "tags:\n  - Recruiting\n  - ATS"])
      assert.ok(out.includes(keep), `lost: ${keep}`);
    assert.match(out, /Edited body\./);
    assert.doesNotMatch(out, /^(type|provenance|id): /m); // no dashboard-only keys injected
    assert.match(out, new RegExp(`updated: ${new Date().toISOString().slice(0, 10)}`));
  });
  it("changing tags rewrites only the tags block", () => {
    writeWikiEntry(wiki, { id: "Concepts/ats", path: "Concepts/ats.md", title: "Applicant tracking", status: "active", tags: ["recruiting", "new"], body: "x" });
    const out = read();
    assert.match(out, /^tags: \[recruiting, new\]$/m);
    assert.ok(out.includes("topics:\n  - hiring") && out.includes("aliases: [Applicant Tracking]"));
  });
  it("saves a backup of the previous version before overwriting", () => {
    const dir = path.join(wiki, ".hermy-backups/Concepts");
    const files = fs.readdirSync(dir);
    assert.ok(files.length >= 2);
    assert.ok(fs.readFileSync(path.join(dir, files.sort()[0]), "utf8").includes("source_count: 1"));
  });
  it("adds frontmatter to a note that had none and keeps its body", () => {
    fs.writeFileSync(path.join(wiki, "Concepts/plain.md"), "Just text.\n");
    writeWikiEntry(wiki, { id: "Concepts/plain", path: "Concepts/plain.md", type: "fact", title: "plain", body: "Just text." });
    const out = fs.readFileSync(path.join(wiki, "Concepts/plain.md"), "utf8");
    assert.match(out, /^---\n/);
    assert.match(out, /Just text\./);
  });
  it("uses an existing folder that differs only in case", () => {
    assert.equal(writeWikiEntry(wiki, { id: "n1", path: "concepts/new-note.md", title: "N", body: "b" }), "Concepts/new-note.md");
    assert.ok(fs.existsSync(path.join(wiki, "Concepts/new-note.md")));
    assert.ok(!fs.readdirSync(wiki).includes("concepts"), "must not create a second, lowercase folder");
  });
  it("won't write into the backup folder or any dot-directory", () => {
    assert.throws(() => writeWikiEntry(wiki, { id: "x", path: ".hermy-backups/x.md", title: "x" }), /invalid wiki path/);
  });
});
