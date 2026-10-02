// Obsidian-style link resolution and deep links. Pure, so it's testable and usable from API routes and pages.

export interface LinkableEntry { id: string; title: string; path: string; links: string[] }
export interface ResolvedLink { target: string; id: string | null; title: string | null }
export interface LinkInfo { links: ResolvedLink[]; backlinks: { id: string; title: string }[] }

const norm = (s: string) => s.trim().toLowerCase().replace(/\.md$/i, "");
const baseName = (s: string) => norm(s).split("/").pop() ?? "";

// Obsidian resolves [[Note]] by file name (or by path when the link contains a slash). If several notes share a
// name, the first by path wins, which keeps the result stable.
export function resolveLinkGraph(entries: LinkableEntry[]): Map<string, LinkInfo> {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map<string, LinkableEntry>();
  const byBase = new Map<string, LinkableEntry>();
  for (const e of sorted) {
    byPath.set(norm(e.path), e);
    if (!byBase.has(baseName(e.path))) byBase.set(baseName(e.path), e);
  }
  const find = (target: string) => byPath.get(norm(target)) ?? byBase.get(baseName(target)) ?? null;

  const graph = new Map<string, LinkInfo>(entries.map((e) => [e.id, { links: [], backlinks: [] }]));
  for (const e of entries) {
    const info = graph.get(e.id)!;
    for (const target of e.links) {
      const hit = find(target);
      info.links.push({ target, id: hit?.id ?? null, title: hit?.title ?? null });
      if (hit && hit.id !== e.id) {
        const back = graph.get(hit.id)!.backlinks;
        if (!back.some((b) => b.id === e.id)) back.push({ id: e.id, title: e.title });
      }
    }
  }
  return graph;
}

// obsidian://open?vault=<name>&file=<vault-relative path, without .md>
export function obsidianUrl(vaultName: string, vaultRelativePath: string): string {
  const file = vaultRelativePath.replace(/\.md$/i, "").replace(/^\/+/, "");
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`;
}

export interface WikiConfig {
  mode: "edit" | "capture" | "readonly";
  vault: { name: string; wikiPrefix: string; rawPrefix: string | null } | null;
  canCapture: boolean;
}
export const DEFAULT_WIKI_CONFIG: WikiConfig = { mode: "edit", vault: null, canCapture: false };

export const wikiNoteUrl = (cfg: WikiConfig, notePath: string) =>
  cfg.vault ? obsidianUrl(cfg.vault.name, [cfg.vault.wikiPrefix, notePath].filter(Boolean).join("/")) : null;

// `sources:` entries are paths relative to the sources folder (and usually keep their .md extension).
export const wikiSourceUrl = (cfg: WikiConfig, source: string) =>
  cfg.vault?.rawPrefix ? obsidianUrl(cfg.vault.name, `${cfg.vault.rawPrefix}/${source}`) : null;
