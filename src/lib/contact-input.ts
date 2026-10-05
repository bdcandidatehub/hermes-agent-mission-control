// Validation for a contact typed into the "Add contact" form. Pure (no DB, no React).
import { CONSENT_BASES, type ConsentBasis } from "./crm";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContactInput {
  name: string; title: string | null; email: string | null; linkedinUrl: string | null;
  consentBasis: ConsentBasis; consentNote: string;
}
export type ParsedContact = { ok: true; data: ContactInput } | { ok: false; error: string };

const text = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

// "linkedin.com/in/jo" and "https://www.linkedin.com/in/jo" both work; anything that isn't a web link is refused,
// so a stored value can never be a script or file URL.
export function normalizeUrl(v: unknown): string | null | "invalid" {
  const s = text(v, 500);
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".") ? u.toString() : "invalid";
  } catch { return "invalid"; }
}

export function parseContactInput(b: unknown): ParsedContact {
  const body = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const name = text(body.name, 200);
  if (!name) return { ok: false, error: "A name is required." };

  const email = text(body.email, 254)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: `"${email}" doesn't look like an email address.` };

  const linkedinUrl = normalizeUrl(body.linkedinUrl);
  if (linkedinUrl === "invalid") return { ok: false, error: "The LinkedIn link must be a web address." };

  const consentBasis = String(body.consentBasis ?? "none");
  if (!(CONSENT_BASES as readonly string[]).includes(consentBasis)) return { ok: false, error: "Unknown consent basis." };

  return {
    ok: true,
    data: {
      name, title: text(body.title, 200), email, linkedinUrl,
      consentBasis: consentBasis as ConsentBasis,
      consentNote: text(body.consentNote, 1000) ?? "Added by hand",
    },
  };
}
