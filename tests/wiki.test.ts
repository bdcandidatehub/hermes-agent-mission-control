import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeWikiEntry } from "../hermes-bridge/wiki.mjs";

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
