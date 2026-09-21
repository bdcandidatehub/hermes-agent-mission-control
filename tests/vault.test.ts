import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectVault, writeSourceNote } from "../hermes-bridge/vault.mjs";
import { parseEntry } from "../hermes-bridge/wiki.mjs";

describe("detectVault", () => {
  let tmp: string;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
    fs.mkdirSync(path.join(tmp, "My Vault/.obsidian"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "My Vault/Wiki/Concepts"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "elsewhere"), { recursive: true });
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("finds the enclosing vault, its name, and the wiki folder's path inside it", () => {
    const v = detectVault(path.join(tmp, "My Vault/Wiki"));
    assert.equal(v?.name, "My Vault");
    assert.equal(v?.prefix, "Wiki");
    assert.equal(detectVault(path.join(tmp, "My Vault/Wiki/Concepts"))?.prefix, "Wiki/Concepts");
  });
  it("returns the on-disk spelling even if the configured path uses different case (macOS)", () => {
    const wrong = path.join(tmp, "My Vault/wiki");
    if (!fs.existsSync(wrong)) return; // case-sensitive filesystem: nothing to test
    assert.equal(detectVault(wrong)?.prefix, "Wiki");
  });
  it("returns null outside a vault", () => assert.equal(detectVault(path.join(tmp, "elsewhere")), null));
});

describe("writeSourceNote", () => {
  let dir: string;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "raw-")); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("writes a note in the vault's source format", () => {
    const file = writeSourceNote(dir, { title: "Q3 Pricing Call", author: "Brad", reference: "call notes", body: "We agreed on $249/mo." });
    assert.equal(file, "q3-pricing-call.md");
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const { fm, body } = parseEntry(text);
    assert.equal(fm.Title, "Q3 Pricing Call");
    assert.equal(fm.Author, "Brad");
    assert.equal(fm.Reference, "call notes");
    assert.deepEqual(fm.ContentType, ["markdown"]);
    assert.deepEqual(fm.tags, ["source"]);
    assert.equal(fm.Processed, "false");
    assert.match(String(fm.Created), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(body, "We agreed on $249/mo.");
  });
  it("never overwrites: a second note with the same title gets a numbered name", () => {
    const a = writeSourceNote(dir, { title: "Same Title", body: "first" });
    const b = writeSourceNote(dir, { title: "Same Title", body: "second" });
    assert.deepEqual([a, b], ["same-title.md", "same-title-2.md"]);
    assert.match(fs.readFileSync(path.join(dir, a), "utf8"), /first/);
  });
  it("quotes hostile titles safely (no frontmatter injection)", () => {
    const file = writeSourceNote(dir, { title: 'Evil": x\ntags:\n  - "pwned' });
    const { fm } = parseEntry(fs.readFileSync(path.join(dir, file), "utf8"));
    assert.deepEqual(fm.tags, ["source"]);
    assert.match(String(fm.Title), /Evil/);
  });
  it("can't escape the folder via the title", () => {
    const file = writeSourceNote(dir, { title: "../../../etc/evil" });
    assert.equal(path.dirname(path.join(dir, file)), dir);
    assert.match(file, /^[a-z0-9-]+\.md$/);
  });
  it("rejects a missing folder and an empty title", () => {
    assert.throws(() => writeSourceNote(path.join(dir, "nope"), { title: "x" }), /sources folder not found/);
    assert.throws(() => writeSourceNote(dir, { title: "   " }), /needs a title/);
  });
});
