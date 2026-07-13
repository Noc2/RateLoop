import React from "react";
import {
  TokenlessHandoffClient,
  decodeTokenlessHandoffFragment,
  formatUsdcAtomic,
  validateTokenlessHandoffBinding,
  validateTokenlessQuoteRequest,
} from "./TokenlessHandoffClient";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

function request(kind: "binary" | "head_to_head" = "binary") {
  return {
    audience: { admissionPolicyHash: `0x${"ab".repeat(32)}`, source: "sandbox" },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    question:
      kind === "binary"
        ? {
            kind: "binary",
            prompt: "Should we ship the synthetic support reply?",
            negativeLabel: "Revise",
            positiveLabel: "Ship",
            rationale: { mode: "required", minLength: 20, maxLength: 500 },
          }
        : {
            kind: "head_to_head",
            prompt: "Which synthetic reply better meets the quality bar?",
            optionA: { key: "baseline", label: "Current reply" },
            optionB: { key: "candidate", label: "Candidate reply" },
            rationale: { mode: "optional" },
          },
    requestedPanelSize: 15,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  const handoffId = `rhl_${"A".repeat(32)}`;
  const handoffToken = `rht_${"B".repeat(43)}_abcdef12`;
  return {
    version: "rateloop.handoff.v1",
    handoffId,
    handoffToken,
    idempotencyKey: `mcp:${createHash("sha256").update(`${handoffId}\0${handoffToken}`).digest("base64url")}`,
    expiresAt: new Date(Number.parseInt("abcdef12", 36) * 1_000).toISOString(),
    dataClassification: "synthetic",
    redactionSummary: "Names and account identifiers were replaced with synthetic values.",
    request: request(),
    ...overrides,
  };
}

function fragment(value: unknown) {
  return `#payload=${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}

test("handoff fragments decode locally into the strict public payload contract", async () => {
  const decoded = decodeTokenlessHandoffFragment(fragment(payload()), new Date("2029-01-01T00:00:00.000Z"));
  await validateTokenlessHandoffBinding(decoded);

  assert.equal(decoded.version, "rateloop.handoff.v1");
  assert.equal(decoded.handoffId, `rhl_${"A".repeat(32)}`);
  assert.equal(decoded.dataClassification, "synthetic");
  assert.equal(decoded.request.question.prompt, "Should we ship the synthetic support reply?");
  assert.equal(decoded.request.requestedPanelSize, 15);
});

test("handoff binding rejects a shaped but tampered idempotency key", async () => {
  const decoded = decodeTokenlessHandoffFragment(
    fragment(payload({ idempotencyKey: `mcp:${"C".repeat(43)}` })),
    new Date("2029-01-01T00:00:00.000Z"),
  );
  await assert.rejects(validateTokenlessHandoffBinding(decoded), /idempotency key do not match/i);
});

test("handoff parsing rejects malformed, expired, and economically invalid links before network use", () => {
  assert.throws(() => decodeTokenlessHandoffFragment("#payload=%%%"), /valid payload fragment/i);
  assert.throws(
    () => decodeTokenlessHandoffFragment(fragment(payload({ version: "rateloop.handoff.v0" }))),
    /version is not supported/i,
  );
  assert.throws(
    () =>
      decodeTokenlessHandoffFragment(
        fragment(payload({ expiresAt: "2028-01-01T00:00:00.000Z" })),
        new Date("2029-01-01T00:00:00.000Z"),
      ),
    (error: unknown) =>
      error instanceof Error &&
      /expired/i.test(error.message) &&
      "payload" in error &&
      (error as Error & { payload?: { handoffId?: string } }).payload?.handoffId === `rhl_${"A".repeat(32)}`,
  );
  assert.throws(
    () =>
      decodeTokenlessHandoffFragment(
        fragment(
          payload({
            request: {
              ...request(),
              budget: { ...request().budget, attemptReserveAtomic: "14" },
            },
          }),
        ),
      ),
    /cover every requested reviewer/i,
  );
});

test("quote request validation preserves editable binary and head-to-head choices", () => {
  const binary = validateTokenlessQuoteRequest(request());
  assert.equal(binary.question.kind, "binary");
  if (binary.question.kind === "binary") {
    assert.equal(binary.question.negativeLabel, "Revise");
    assert.equal(binary.question.positiveLabel, "Ship");
  }

  const comparison = validateTokenlessQuoteRequest(request("head_to_head"));
  assert.equal(comparison.question.kind, "head_to_head");
  if (comparison.question.kind === "head_to_head") {
    assert.deepEqual(comparison.question.optionA, { key: "baseline", label: "Current reply" });
    assert.deepEqual(comparison.question.optionB, { key: "candidate", label: "Candidate reply" });
  }
});

test("exact USDC formatting never converts atomic values through floating point", () => {
  assert.equal(formatUsdcAtomic("31875000"), "31.875000 USDC");
  assert.equal(formatUsdcAtomic("9007199254740993123456"), "9,007,199,254,740,993.123456 USDC");
});

test("handoff client renders a fragment-local loading state without server payload access", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(<TokenlessHandoffClient sandboxMode />).replace(/\s+/g, " ");

  assert.match(html, /Reading the private handoff fragment in this browser/i);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /api\/agent\/v1\/quote|handoffToken/);
});
