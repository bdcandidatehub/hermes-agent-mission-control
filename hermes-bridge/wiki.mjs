// Writes one memory-wiki entry as a markdown file, confined to the wiki directory.
// Kept separate from bridge.mjs so the path-safety rules can be unit-tested (see tests/).
import fs from "node:fs";
import path from "node:path";

const oneLine = (v) => String(v ?? "").replace(/[\r\n]+/g, " ").trim();
const listLine = (arr) => (Array.isArray(arr) ? arr : []).map((x) => oneLine(x).replace(/[,\[\]]/g, " ").trim()).filter(Boolean).join(", ");
export function writeWikiEntry(wikiDir, e) {
  const root = path.resolve(wikiDir);
  const slug = oneLine(e.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  if (!slug) throw new Error("wiki entry needs an id");
  const rel = String(e.path || `${oneLine(e.type || "note").toLowerCase().replace(/[^a-z0-9]+/g, "") || "note"}s/${slug}.md`).replace(/\\/g, "/");
  // Confine writes to the wiki dir: relative, .md only, no dot-segments, no .git.
  if (rel.startsWith("/") || !rel.endsWith(".md") || rel.split("/").some((s) => s === ".." || s === "." || s === "" || s === ".git"))
    throw new Error("invalid wiki path");
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error("invalid wiki path");
  // Refuse to write through a symlink that escapes the wiki dir. Check the nearest EXISTING ancestor
  // before creating anything, so a symlinked folder can't cause directories to be created outside.
  fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync(root);
  let probe = path.dirname(full);
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) throw new Error("invalid wiki path");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const now = new Date().toISOString().slice(0, 10);
  const lines = [
    "---", `id: ${slug}`, `type: ${oneLine(e.type || "note")}`, `title: ${oneLine(e.title)}`,
    `status: ${oneLine(e.status || "active")}`,
    e.confidence ? `confidence: ${oneLine(e.confidence)}` : null,
    `provenance: ${oneLine(e.provenance || "dashboard")}`,
    `tags: [${listLine(e.tags)}]`, `links: [${listLine(e.links)}]`,
    `updated: ${now}`, "---", "", String(e.body || ""), "",
  ].filter((l) => l !== null);
  fs.writeFileSync(full, lines.join("\n"), "utf8");
  return rel;
}
