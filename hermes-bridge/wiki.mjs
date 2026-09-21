// Memory-wiki file handling for the bridge: parsing, listing, and confined, non-destructive writes.
// Kept separate from bridge.mjs so the safety rules can be unit-tested (see tests/wiki.test.ts).
//
// Design rules:
//  - Writes never leave the wiki directory (relative .md paths only, no dot-segments, no symlink escapes).
//  - Editing an EXISTING note preserves its frontmatter: only keys whose value actually changed are rewritten,
//    unknown keys (topics, sources, aliases, ...) and their formatting are kept verbatim.
//  - Every overwrite first copies the previous version to <wiki>/.hermy-backups/ (dot-dirs are never mirrored).
import fs from "node:fs";
import path from "node:path";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const KEY_RE = /^([A-Za-z_][\w-]*)\s*:(.*)$/;

const unquote = (s) => {
  const t = s.trim();
  return t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'")) ? t.slice(1, -1) : t;
};
const oneLine = (v) => String(v ?? "").replace(/[\r\n]+/g, " ").trim();
const listLine = (arr) =>
  (Array.isArray(arr) ? arr : []).map((x) => oneLine(x).replace(/[,\[\]]/g, " ").trim()).filter(Boolean).join(", ");

/* ───────────── parsing ───────────── */

// A frontmatter block is a "key: value" line plus any indented / "- item" continuation lines.
function toBlocks(front) {
  const blocks = [];
  let cur = null;
  for (const line of front.split(/\r?\n/)) {
    const m = line.match(KEY_RE);
    if (m && !/^\s/.test(line)) { cur = { key: m[1], lines: [line] }; blocks.push(cur); }
    else if (cur) cur.lines.push(line);
    else blocks.push({ key: null, lines: [line] });
  }
  return blocks;
}

function blockValue(b) {
  const first = b.lines[0].match(KEY_RE)[2].trim();
  const rest = b.lines.slice(1).map((l) => l.trim()).filter(Boolean);
  if (first.startsWith("[") && first.endsWith("]")) return first.slice(1, -1).split(",").map((s) => unquote(s)).filter(Boolean);
  if (first === "" && rest.length && rest.every((l) => l.startsWith("- "))) return rest.map((l) => unquote(l.slice(2)));
  if (first === "" || first === "null" || first === "~") return rest.length ? rest.join("\n") : null;
  return unquote(first);
}

/** @param {string} rel @param {string} body @returns {string} */
export function deriveTitle(rel, body) {
  const h1 = String(body ?? "").match(/^#\s+(.+?)\s*$/m);
  return h1 ? h1[1] : path.basename(rel).replace(/\.md$/, "");
}

/** @returns {{ fm: Record<string, string | string[] | null>, body: string }} */
export function parseEntry(md) {
  const m = md.match(FM_RE);
  if (!m) return { fm: {}, body: md.trim() };
  const fm = {};
  for (const b of toBlocks(m[1])) if (b.key) fm[b.key] = blockValue(b);
  return { fm, body: m[2].trim() };
}

// Obsidian [[wikilinks]] in a note body → unique link targets. Strips |alias, #heading and ^block parts;
// ignores ![[embeds]] and anything inside code.
/** @param {string} body @returns {string[]} */
export function extractWikilinks(body) {
  const text = String(body ?? "").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const out = [];
  for (const m of text.matchAll(/(!?)\[\[([^\]\n]+?)\]\]/g)) {
    if (m[1] === "!") continue;
    const target = m[2].split("|")[0].split("#")[0].split("^")[0].trim();
    if (target && !out.includes(target)) out.push(target);
  }
  return out;
}

/* ───────────── listing ───────────── */

// skip = { dirs: Set<lowercase name>, files: Set<lowercase name> }. Dot-directories are always skipped.
/** @param {string} dir @param {{dirs: Set<string>, files: Set<string>}} [skip] @param {string[]} [out] @returns {string[]} */
export function walkMd(dir, skip = { dirs: new Set(), files: new Set() }, out = []) {
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (!it.name.startsWith(".") && !skip.dirs.has(it.name.toLowerCase())) walkMd(full, skip, out);
    } else if (it.name.endsWith(".md") && !skip.files.has(it.name.toLowerCase())) out.push(full);
  }
  return out;
}

/* ───────────── writing ───────────── */

function mergeFront(front, e, rel, oldBody) {
  const blocks = toBlocks(front);
  const find = (k) => blocks.find((b) => b.key === k);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const lower = (arr) => (Array.isArray(arr) ? arr : arr == null ? [] : [String(arr)]).map((s) => String(s).toLowerCase());

  // scalar: rewrite only if the key exists and the value changed
  const setScalar = (key, value) => {
    const b = find(key);
    if (!b || value == null || value === "") return;
    if (String(blockValue(b) ?? "") !== value) b.lines = [`${key}: ${value}`];
  };
  // list: rewrite only if it changed (case-insensitively: the dashboard lowercases tags)
  const setList = (key, arr, addIfMissing) => {
    const clean = (Array.isArray(arr) ? arr : []).map((x) => oneLine(x)).filter(Boolean);
    const b = find(key);
    if (b) { if (!same(lower(blockValue(b)), lower(clean))) b.lines = [`${key}: [${listLine(clean)}]`]; }
    else if (addIfMissing && clean.length) blocks.push({ key, lines: [`${key}: [${listLine(clean)}]`] });
  };

  const title = oneLine(e.title);
  if (find("title")) setScalar("title", title);
  else if (title && title !== deriveTitle(rel, oldBody) && title !== rel.replace(/\.md$/, ""))
    blocks.push({ key: "title", lines: [`title: ${title}`] });

  setScalar("status", oneLine(e.status));
  if (e.confidence != null) setScalar("confidence", oneLine(e.confidence));
  setList("tags", e.tags, true);
  setList("links", e.links, false);

  const today = new Date().toISOString().slice(0, 10);
  if (find("updated")) find("updated").lines = [`updated: ${today}`];
  else blocks.push({ key: "updated", lines: [`updated: ${today}`] });

  return blocks.flatMap((b) => b.lines).join("\n");
}

// If the first path segment doesn't exist but a folder differing only in case does, use that folder
// (so "projects/x.md" lands in an existing "Projects/").
function matchFolderCase(root, rel) {
  const parts = rel.split("/");
  if (parts.length < 2) return rel;
  try {
    // Compare against the real directory listing: on case-insensitive filesystems (macOS) existsSync("concepts")
    // is true even when the folder is "Concepts", which would hide the canonical name.
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    if (!dirs.includes(parts[0])) {
      const hit = dirs.find((n) => n.toLowerCase() === parts[0].toLowerCase());
      if (hit) parts[0] = hit;
    }
  } catch { /* root may not exist yet */ }
  return parts.join("/");
}

/** @param {string} wikiDir @param {Record<string, any>} e @returns {string} the wiki-relative path written */
export function writeWikiEntry(wikiDir, e) {
  const root = path.resolve(wikiDir);
  const slug = oneLine(e.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  if (!slug) throw new Error("wiki entry needs an id");
  let rel = String(e.path || `${oneLine(e.type || "note").toLowerCase().replace(/[^a-z0-9]+/g, "") || "note"}s/${slug}.md`).replace(/\\/g, "/");
  // Confine writes to the wiki dir: relative, .md only, no dot-segments, no .git.
  if (rel.startsWith("/") || !rel.endsWith(".md") || rel.split("/").some((s) => s === ".." || s === "." || s === "" || s.startsWith(".")))
    throw new Error("invalid wiki path");
  fs.mkdirSync(root, { recursive: true });
  rel = matchFolderCase(root, rel);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error("invalid wiki path");

  // Refuse to write through a symlink that escapes the wiki dir. Check the nearest EXISTING ancestor
  // before creating anything, so a symlinked folder can't cause directories to be created outside.
  const realRoot = fs.realpathSync(root);
  let probe = path.dirname(full);
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) throw new Error("invalid wiki path");
  fs.mkdirSync(path.dirname(full), { recursive: true });

  const body = String(e.body || "");
  const today = new Date().toISOString().slice(0, 10);
  let text;
  const existing = fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, "utf8") : null;

  if (existing !== null) {
    // keep the previous version before overwriting; never overwrite an earlier backup ("wx" fails if the name exists)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.mkdirSync(path.dirname(path.join(root, ".hermy-backups", rel)), { recursive: true });
    for (let i = 0; i < 1000; i++) {
      const backup = path.join(root, ".hermy-backups", `${rel}.${stamp}${i ? `-${i}` : ""}`);
      try { fs.writeFileSync(backup, existing, { encoding: "utf8", flag: "wx" }); break; }
      catch (err) { if (err.code !== "EEXIST") throw err; }
    }
  }
  const m = existing?.match(FM_RE);
  if (m) {
    text = `---\n${mergeFront(m[1], e, rel, m[2])}\n---\n\n${body}\n`;
  } else {
    const lines = [
      "---", `id: ${slug}`, `type: ${oneLine(e.type || "note")}`, `title: ${oneLine(e.title)}`,
      `status: ${oneLine(e.status || "active")}`,
      e.confidence ? `confidence: ${oneLine(e.confidence)}` : null,
      `provenance: ${oneLine(e.provenance || "dashboard")}`,
      `tags: [${listLine(e.tags)}]`, `links: [${listLine(e.links)}]`,
      `updated: ${today}`, "---", "", body, "",
    ].filter((l) => l !== null);
    text = lines.join("\n");
  }
  fs.writeFileSync(full, text, "utf8");
  return rel;
}
