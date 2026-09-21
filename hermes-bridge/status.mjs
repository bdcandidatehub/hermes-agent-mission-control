// Parses `hermes status` output into { online, gateway }. Separate from bridge.mjs so it can be unit-tested.
// Handles both a one-line form ("Gateway: running") and the sectioned form:
//   ◆ Gateway Service
//     Status:  ✓ running
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** @param {string} raw @returns {{ online: boolean, gateway: "running" | "stopped" | "unknown" }} */
export function parseStatus(raw) {
  const out = strip(String(raw ?? ""));
  const online = /online|running|connected/i.test(out);
  const lines = out.split("\n");
  const i = lines.findIndex((l) => /gateway/i.test(l));
  if (i === -1) return { online, gateway: "unknown" };
  // the heading line plus the few lines under it (until the next "◆ " section heading)
  let end = i + 1;
  while (end < lines.length && end < i + 5 && !/^\s*◆/.test(lines[end])) end++;
  const win = lines.slice(i, end).join(" ");
  const bad = /not running|stopped|inactive|failed|not installed|✗|✘/i.test(win);
  const good = /running|online|active/i.test(win);
  return { online, gateway: good && !bad ? "running" : "stopped" };
}
