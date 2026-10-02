import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractWikilinks } from "../hermes-bridge/wiki.mjs";
import { obsidianUrl, resolveLinkGraph, wikiNoteUrl, wikiSourceUrl, type WikiConfig } from "../src/lib/wiki-links";

describe("extractWikilinks", () => {
  it("returns unique targets and strips alias, heading and block parts", () => {
    assert.deepEqual(extractWikilinks("See [[Alpha]], [[Beta|the beta]], [[Gamma#Section]], [[Delta^abc]] and [[Alpha]] again."), ["Alpha", "Beta", "Gamma", "Delta"]);
  });
  it("ignores embeds and links inside code", () => {
    assert.deepEqual(extractWikilinks("![[diagram.png]] `[[inline]]`\n```\n[[fenced]]\n```\n[[real]]"), ["real"]);
  });
  it("copes with empty input", () => assert.deepEqual(extractWikilinks(""), []));
});

describe("resolveLinkGraph", () => {
  const entries = [
    { id: "Concepts/ats", title: "ATS", path: "Concepts/ats.md", links: ["Sourcing", "missing-note", "concepts/sourcing"] },
    { id: "Concepts/sourcing", title: "Sourcing", path: "Concepts/sourcing.md", links: ["ATS"] },
    { id: "Topics/sourcing", title: "Sourcing topic", path: "Topics/sourcing.md", links: [] },
  ];
  const g = resolveLinkGraph(entries);
  it("resolves by file name, case-insensitively, and by path", () => {
    assert.deepEqual(g.get("Concepts/sourcing")!.links, [{ target: "ATS", id: "Concepts/ats", title: "ATS" }]);
    assert.equal(g.get("Concepts/ats")!.links[2].id, "Concepts/sourcing"); // explicit path wins
  });
  it("prefers the first path when several notes share a name (stable)", () => assert.equal(g.get("Concepts/ats")!.links[0].id, "Concepts/sourcing"));
  it("keeps unresolved links, with null id", () => assert.deepEqual(g.get("Concepts/ats")!.links[1], { target: "missing-note", id: null, title: null }));
  it("computes backlinks without duplicates or self-links", () => {
    assert.deepEqual(g.get("Concepts/ats")!.backlinks, [{ id: "Concepts/sourcing", title: "Sourcing" }]);
    assert.deepEqual(g.get("Concepts/sourcing")!.backlinks, [{ id: "Concepts/ats", title: "ATS" }]);
    assert.deepEqual(g.get("Topics/sourcing")!.backlinks, []);
  });
});

describe("Obsidian deep links", () => {
  const cfg: WikiConfig = { mode: "capture", canCapture: true, vault: { name: "Candidate Hub", wikiPrefix: "Wiki", rawPrefix: "Raw/Sources" } };
  it("encodes the vault name and drops the .md extension", () => {
    assert.equal(obsidianUrl("My Vault", "Wiki/Concepts/a b.md"), "obsidian://open?vault=My%20Vault&file=Wiki%2FConcepts%2Fa%20b");
  });
  it("builds note and source links relative to the vault root", () => {
    assert.equal(wikiNoteUrl(cfg, "Concepts/ats.md"), "obsidian://open?vault=Candidate%20Hub&file=Wiki%2FConcepts%2Fats");
    assert.equal(wikiSourceUrl(cfg, "CandidateHub Positioning & Messaging Canon.md"), "obsidian://open?vault=Candidate%20Hub&file=Raw%2FSources%2FCandidateHub%20Positioning%20%26%20Messaging%20Canon");
  });
  it("returns null when there is no vault", () => assert.equal(wikiNoteUrl({ mode: "edit", vault: null, canCapture: false }, "x.md"), null));
});
