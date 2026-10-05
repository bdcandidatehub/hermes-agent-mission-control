import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, parseContactInput } from "../src/lib/contact-input";

describe("parseContactInput", () => {
  it("accepts a full contact and tidies it", () => {
    const r = parseContactInput({ name: "  Jo Tremblay ", title: " HR Director ", email: " Jo@Acme.CA ", linkedinUrl: "linkedin.com/in/jo", consentBasis: "express", consentNote: "Asked to hear from us" });
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(
        [r.data.name, r.data.title, r.data.email, r.data.linkedinUrl, r.data.consentBasis, r.data.consentNote],
        ["Jo Tremblay", "HR Director", "jo@acme.ca", "https://linkedin.com/in/jo", "express", "Asked to hear from us"],
      );
    }
  });
  it("needs only a name; everything else is optional and consent defaults to none", () => {
    const r = parseContactInput({ name: "Jo" });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.data.title, r.data.email, r.data.linkedinUrl, r.data.consentBasis, r.data.consentNote], [null, null, null, "none", "Added by hand"]);
  });
  it("refuses a missing or blank name", () => {
    for (const body of [{}, null, { name: "   " }, { name: 5 }, { email: "a@b.ca" }]) assert.ok(!parseContactInput(body).ok, JSON.stringify(body));
  });
  it("refuses bad emails but allows a blank one", () => {
    for (const email of ["jo", "jo@", "@acme.ca", "jo @acme.ca", "jo@acme"]) assert.ok(!parseContactInput({ name: "Jo", email }).ok, email);
    assert.ok(parseContactInput({ name: "Jo", email: "" }).ok);
  });
  it("refuses an unknown consent basis", () => {
    assert.ok(!parseContactInput({ name: "Jo", consentBasis: "yes please" }).ok);
  });
  it("caps overlong fields instead of storing them whole", () => {
    const r = parseContactInput({ name: "n".repeat(500), title: "t".repeat(500) });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.data.name.length, r.data.title?.length], [200, 200]);
  });
});

describe("normalizeUrl", () => {
  it("adds https:// when there's no scheme", () => {
    assert.equal(normalizeUrl("www.linkedin.com/in/jo"), "https://www.linkedin.com/in/jo");
  });
  it("keeps http(s) links and treats blank as none", () => {
    assert.equal(normalizeUrl("http://example.com/x"), "http://example.com/x");
    assert.equal(normalizeUrl(""), null);
    assert.equal(normalizeUrl(undefined), null);
  });
  it("refuses anything that isn't a web address, so no script or file URLs get stored", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://x.com/a", "mailto:a@b.ca", "notaurl", "http://localhost"])
      assert.equal(normalizeUrl(bad), "invalid", bad);
  });
});
