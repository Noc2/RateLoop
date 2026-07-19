import React from "react";
import {
  TokenlessHandoffClient,
  decodeTokenlessHandoffFragment,
  formatBpsPercent,
  formatUsdcAtomic,
  validateTokenlessHandoffBinding,
  validateTokenlessQuoteRequest,
} from "./TokenlessHandoffClient";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};
const handoffSource = readFileSync(new URL("./TokenlessHandoffClient.tsx", import.meta.url), "utf8");

test("insufficient prepaid handoffs link directly to workspace top-up settings", () => {
  assert.match(handoffSource, /Top up balance/);
  assert.match(handoffSource, /\/agents\?tab=overview#panel-funding/);
  assert.match(handoffSource, /workspace=\$\{encodeURIComponent\(selectedWorkspace\.workspaceId\)\}/);
  assert.match(handoffSource, /import Link from "next\/link"/);
  assert.match(handoffSource, /insufficientPrepaid/);
});

const REDACTION_SUMMARY = "Names and account identifiers were replaced with synthetic values.";

function request(kind: "binary" | "head_to_head" = "binary") {
  return {
    audience: { admissionPolicyHash: `0x${"ab".repeat(32)}`, source: "rateloop_network" },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    confirmedNoSensitiveData: true,
    dataClassification: "synthetic",
    redactionSummary: REDACTION_SUMMARY,
    visibility: "public",
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
    responseWindowSeconds: 3_600,
  };
}

const imageAssetId = `pqm_${"A".repeat(24)}`;
const imageDigest = `sha256:${"a1".repeat(32)}`;

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
    redactionSummary: REDACTION_SUMMARY,
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

  const withMedia = validateTokenlessQuoteRequest({
    ...request(),
    question: {
      ...request().question,
      media: {
        kind: "images",
        items: [{ alt: "  Candidate checkout  ", assetId: imageAssetId, digest: imageDigest }],
      },
    },
  });
  assert.deepEqual(withMedia.question.media, {
    kind: "images",
    items: [{ alt: "Candidate checkout", assetId: imageAssetId, digest: imageDigest }],
  });
  assert.throws(
    () =>
      validateTokenlessQuoteRequest({
        ...request(),
        audience: { ...request().audience, source: "unsupported" },
      }),
    /audience.source is unsupported/i,
  );
});

test("exact USDC formatting never converts atomic values through floating point", () => {
  assert.equal(formatUsdcAtomic("31875000"), "31.875000 USDC");
  assert.equal(formatUsdcAtomic("9007199254740993123456"), "9,007,199,254,740,993.123456 USDC");
  assert.equal(formatBpsPercent(750), "7.5%");
});

test("handoff client renders a fragment-local loading state without server payload access", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(<TokenlessHandoffClient />).replace(/\s+/g, " ");

  assert.match(html, /Reading the private handoff fragment in this browser/i);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /api\/agent\/v1\/quote|handoffToken/);
});

test("browser handoff reveals price and submission progressively while retaining technical detail", () => {
  assert.match(handoffSource, /Review this ask\./);
  assert.match(handoffSource, /Request details/);
  assert.match(handoffSource, /Price details/);
  assert.match(handoffSource, /sourceLabel\(request\.audience\.source\)[\s\S]{0,100}request\.requestedPanelSize/);
  assert.match(handoffSource, /accepted-work reserve/);
  assert.match(handoffSource, /\{quote \? \([\s\S]*aria-labelledby="submit-heading"/);
  assert.match(handoffSource, /Admission policy/);
  assert.match(handoffSource, /Quote ID/);
  assert.doesNotMatch(handoffSource, /Draft summary|Lock the exact economics|01 · Review|02 · Quote|03 · Submit/);
});

test("browser handoff renders and verifies media before privacy approval or network mutation", () => {
  assert.match(handoffSource, /<QuestionMedia[\s\S]{0,160}media=\{request\.question\.media\}/);
  assert.match(handoffSource, /previewCapabilities=\{payload\.mediaPreviews\}/);
  assert.match(handoffSource, /Review all attached context before confirming it is safe to share/);
  assert.match(handoffSource, /disabled=\{formDisabled \|\| !mediaReady\}/);
  assert.match(handoffSource, /if \(!mediaReady\)[\s\S]{0,120}before requesting a quote/);
  assert.match(handoffSource, /if \(!mediaReady\)[\s\S]{0,120}before submitting/);
});

test("expired browser handoffs stop at one recovery action", () => {
  assert.match(handoffSource, /if \(handoff\.status === "expired"\)/);
  assert.match(handoffSource, /Ask the agent for a new link\./);
});

test("signed-out handoffs open a fragment-safe sign-in in a separate tab and refresh on return", () => {
  // AUD-15: the bearer handoff lives only in the URL fragment. Sign-in must not navigate this tab
  // away (which would drop the fragment) or place the bearer in a server-visible URL.
  assert.match(handoffSource, /href="\/sign-in"\s+target="_blank"\s+rel="noopener noreferrer"/);
  assert.match(handoffSource, /Sign in in a new tab/);
  // The session is re-checked when the user returns to this tab after signing in elsewhere.
  assert.match(handoffSource, /const loadSession = useCallback/);
  assert.match(handoffSource, /subscribeToBrowserAuthSessionChanges\(refresh\)/);
  assert.match(handoffSource, /sessionControllerRef\.current\?\.abort\(\)/);
  assert.match(handoffSource, /sessionPrincipalRef\.current !== sessionBody\.principalId/);
  assert.match(handoffSource, /clearPrincipalState\(\)/);
  // The bearer capability must never be encoded into a query string / server-visible URL.
  assert.doesNotMatch(handoffSource, /sign-in\?[^"'`\n]*(payload|handoffToken|returnTo|hash)/i);
  assert.doesNotMatch(handoffSource, /[?&](returnTo|payload)=[^"'`\n]*(location\.hash|payload)/i);
});

test("browser quote validation preserves the owner-approved public-data contract", () => {
  const validated = validateTokenlessQuoteRequest(request());
  assert.equal(validated.visibility, "public");
  assert.equal(validated.dataClassification, "synthetic");
  assert.equal(validated.redactionSummary, REDACTION_SUMMARY);
  assert.equal(validated.confirmedNoSensitiveData, true);
});

test("browser quote validation rejects a stripped or downgraded public-data contract", () => {
  const strip = (key: string) => {
    const next = request() as Record<string, unknown>;
    delete next[key];
    return next;
  };
  assert.throws(() => validateTokenlessQuoteRequest(strip("visibility")), /request\.visibility must be/i);
  assert.throws(
    () => validateTokenlessQuoteRequest(strip("dataClassification")),
    /request\.dataClassification must be/i,
  );
  assert.throws(
    () => validateTokenlessQuoteRequest(strip("confirmedNoSensitiveData")),
    /confirmedNoSensitiveData must be true/i,
  );
  assert.throws(
    () => validateTokenlessQuoteRequest({ ...request(), dataClassification: "internal" }),
    /dataClassification is unsupported/i,
  );
  assert.throws(
    () => validateTokenlessQuoteRequest({ ...request(), dataClassification: "redacted", redactionSummary: "short" }),
    /redaction summary of at least 10 characters/i,
  );
});

test("handoff decoding rejects a privacy envelope that disagrees with the embedded request", () => {
  assert.throws(
    () => decodeTokenlessHandoffFragment(fragment(payload({ dataClassification: "public" }))),
    /data classification does not match the embedded request/i,
  );
  assert.throws(
    () => decodeTokenlessHandoffFragment(fragment(payload({ redactionSummary: `${REDACTION_SUMMARY} (edited)` }))),
    /redaction summary does not match the embedded request/i,
  );
});
