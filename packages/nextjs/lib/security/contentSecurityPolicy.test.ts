import { buildContentSecurityPolicy } from "./contentSecurityPolicy";
import assert from "node:assert/strict";
import test from "node:test";

function getDirective(csp: string, name: string) {
  return csp
    .split(";")
    .map(directive => directive.trim())
    .find(directive => directive.startsWith(`${name} `));
}

test("style CSP uses nonce-based element rules and keeps inline styles scoped to attributes", () => {
  const csp = buildContentSecurityPolicy({
    isVercelLiveEnabled: true,
    nonce: "testnonce",
  });
  const styleSrc = getDirective(csp, "style-src");
  const styleSrcElem = getDirective(csp, "style-src-elem");
  const styleSrcAttr = getDirective(csp, "style-src-attr");

  assert.ok(styleSrc);
  assert.match(styleSrc, /(?:^|\s)'nonce-testnonce'(?:\s|$)/);
  assert.match(styleSrc, /(?:^|\s)https:\/\/vercel\.live(?:\s|$)/);
  assert.doesNotMatch(styleSrc, /(?:^|\s)'unsafe-inline'(?:\s|$)/);

  assert.ok(styleSrcElem);
  assert.match(styleSrcElem, /(?:^|\s)'nonce-testnonce'(?:\s|$)/);
  assert.match(styleSrcElem, /(?:^|\s)https:\/\/vercel\.live(?:\s|$)/);
  assert.doesNotMatch(styleSrcElem, /(?:^|\s)'unsafe-inline'(?:\s|$)/);

  assert.equal(styleSrcAttr, "style-src-attr 'unsafe-inline'");
});
