// Obsidian-vault awareness for the bridge: find the enclosing vault, and capture new notes as RAW SOURCES.
//
// Vaults that follow an "LLM wiki" layout keep compiled notes (Wiki/) separate from raw material (Raw/Sources/).
// The dashboard doesn't edit compiled notes; it drops new material into Raw/Sources/ and lets the vault's own
// ingest compile it. So this module only ever CREATES new files there, and never overwrites one.
import fs from "node:fs";
import path from "node:path";

const oneLine = (v) => String(v ?? "").replace(/[\r\n]+/g, " ").trim();

// The on-disk spelling of `name` inside `parent` (macOS is case-insensitive, so "wiki" can resolve to "Wiki").
function realName(parent, name) {
  try {
    const hit = fs.readdirSync(parent).find((n) => n.toLowerCase() === name.toLowerCase());
    return hit ?? name;
  } catch { return name; }
}

/** @param {string} dir @returns {{ root: string, name: string, prefix: string } | null}  prefix = `dir` relative to the vault root */
export function detectVault(dir) {
  let root = path.resolve(dir);
  while (!fs.existsSync(path.join(root, ".obsidian"))) {
    const up = path.dirname(root);
    if (up === root) return null;
    root = up;
  }
  const name = realName(path.dirname(root), path.basename(root));
  const parts = path.relative(root, path.resolve(dir)).split(path.sep).filter(Boolean);
  let cur = root;
  const real = parts.map((p) => { const n = realName(cur, p); cur = path.join(cur, n); return n; });
  return { root, name, prefix: real.join("/") };
}

const yamlStr = (s) => JSON.stringify(oneLine(s)); // a JSON string is a valid YAML double-quoted scalar

/**
 * Create a new source note in `rawDir`. Never overwrites: a name clash gets "-2", "-3", ...
 * @param {string} rawDir  existing folder, e.g. <vault>/Raw/Sources
 * @param {{ title: string, author?: string, reference?: string, body?: string }} e
 * @returns {string} the file name created
 */
export function writeSourceNote(rawDir, e) {
  const title = oneLine(e.title).slice(0, 200);
  if (!title) throw new Error("a source needs a title");
  if (!fs.existsSync(rawDir) || !fs.statSync(rawDir).isDirectory()) throw new Error("sources folder not found");
  const body = String(e.body ?? "").slice(0, 20000);

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "source";
  const today = new Date();
  const created = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const text = [
    "---",
    `Title: ${yamlStr(title)}`,
    `Author: ${yamlStr(e.author || "Hermy HQ dashboard")}`,
    `Reference: ${yamlStr(e.reference || "dashboard")}`,
    "ContentType:", '  - "markdown"',
    `Created: ${created}`,
    "Processed: false",
    "tags:", '  - "source"',
    "---", "", body, "",
  ].join("\n");

  for (let i = 1; i <= 50; i++) {
    const file = i === 1 ? `${slug}.md` : `${slug}-${i}.md`;
    try {
      fs.writeFileSync(path.join(rawDir, file), text, { encoding: "utf8", flag: "wx" }); // wx: fail if it exists
      return file;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
  throw new Error("too many notes with that title");
}
