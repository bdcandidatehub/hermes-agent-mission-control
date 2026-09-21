// Turn a written reply into something worth speaking: strip markdown, links, code and emoji, then cut it into
// sentence-sized chunks so audio can start after the first sentence instead of after the whole reply.

const ABBREV = /\b(?:e\.g|i\.e|vs|etc|mr|mrs|ms|dr|st|no|inc|ltd|co)\.$/i;

export function cleanForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ") // code blocks aren't read aloud
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/\bhttps?:\/\/\S+/gi, "a link")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, "$1")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s*[\r\n]+\s*/g, ". ")
    .replace(/\.{2,}\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

// Split on sentence ends, but not after common abbreviations. Very long sentences are broken at commas or spaces.
export function splitSpeech(text: string, maxLen = 220): string[] {
  const words = text.split(/(?<=[.!?…])\s+/);
  const sentences: string[] = [];
  for (const w of words) {
    const prev = sentences[sentences.length - 1];
    if (prev && ABBREV.test(prev)) sentences[sentences.length - 1] = `${prev} ${w}`;
    else if (w.trim()) sentences.push(w.trim());
  }
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= maxLen) { out.push(s); continue; }
    let rest = s;
    while (rest.length > maxLen) {
      const lim = maxLen - 1; // the break char itself stays on the left side, so search one earlier
      const cut = Math.max(rest.lastIndexOf(", ", lim), rest.lastIndexOf("; ", lim), rest.lastIndexOf(" ", lim));
      const at = cut > maxLen * 0.4 ? cut + 1 : maxLen;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  // fold very short fragments into their neighbour so we don't make a request per "Yes."
  const merged: string[] = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev && (prev.length < 24 || s.length < 12) && prev.length + s.length < maxLen) merged[merged.length - 1] = `${prev} ${s}`;
    else merged.push(s);
  }
  return merged;
}

// What actually gets spoken: the first few sentences up to a character budget. The full text stays on screen.
export function speakable(text: string, { maxChars = 520, maxChunks = 4 } = {}): { chunks: string[]; truncated: boolean } {
  const all = splitSpeech(cleanForSpeech(text));
  const chunks: string[] = [];
  let used = 0;
  for (const c of all) {
    if (chunks.length >= maxChunks || used + c.length > maxChars) break;
    chunks.push(c);
    used += c.length;
  }
  if (chunks.length === 0 && all[0]) chunks.push(all[0].slice(0, maxChars)); // never say nothing for a non-empty reply
  return { chunks, truncated: chunks.length < all.length };
}
