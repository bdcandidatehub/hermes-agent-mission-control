// Parses the text printed by `hermes insights` into the structured usage the dashboard tiles expect.
// The bridge stores the raw text; parsing happens here so it works with whatever the CLI prints.

export interface ParsedInsights {
  totalCost: number | null;
  totalTokens: number | null;
  byModel: { model: string; calls: number; tokens: number }[];
}

const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, "")) : null);

export function parseInsights(raw: string | null | undefined): ParsedInsights {
  const text = String(raw ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  const tokens = num(text.match(/Total tokens:\s*([\d,]+)/i)?.[1]);
  const cost = num(text.match(/Estimated:\s*~?\s*\$?\s*([\d,]+(?:\.\d+)?)/i)?.[1]);

  const byModel: ParsedInsights["byModel"] = [];
  const lines = text.split("\n");
  const head = lines.findIndex((l) => /^\s*Model\s+Sessions\s+Tokens\s*$/i.test(l));
  if (head !== -1) {
    for (const l of lines.slice(head + 1)) {
      const m = l.match(/^\s*(\S+)\s+(\d+)\s+([\d,]+)\s*$/);
      if (!m) break; // the table ends at the first line that isn't a row
      byModel.push({ model: m[1], calls: Number(m[2]), tokens: num(m[3]) as number });
    }
  }
  return { totalCost: cost, totalTokens: tokens, byModel };
}
