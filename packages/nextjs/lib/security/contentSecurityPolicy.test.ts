import { buildContentSecurityPolicy } from "./contentSecurityPolicy";
import assert from "node:assert/strict";
import test from "node:test";

function getDirective(csp: string, name: string) {
  return csp
    .split(";")
    .map(directive => directive.trim())
    .find(directive => directive.startsWith(`${name} `));
}

test("style CSP allows inline styles for third-party UI libraries", () => {
  const csp = buildContentSecurityPolicy({
    isVercelLiveEnabled: true,
    nonce: "testnonce",
  });
  const styleSrc = getDirective(csp, "style-src");

  assert.ok(styleSrc);
  assert.match(styleSrc, /(?:^|\s)'unsafe-inline'(?:\s|$)/);
  assert.match(styleSrc, /(?:^|\s)https:\/\/vercel\.live(?:\s|$)/);
  assert.doesNotMatch(styleSrc, /(?:^|\s)'nonce-testnonce'(?:\s|$)/);
  assert.equal(getDirective(csp, "style-src-elem"), undefined);
  assert.equal(getDirective(csp, "style-src-attr"), undefined);
});
