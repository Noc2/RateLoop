import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("private rater queue is assignment-scoped and makes no unsupported payment or identity claims", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const html = renderToStaticMarkup(
    <HumanAssuranceRaterClient
      initialAssignmentId="haas_private_assignment"
      initialTermsHash={`sha256:${"a".repeat(64)}`}
      sandboxMode
    />,
  ).replace(/\s+/g, " ");

  assert.match(html, /Private review queue/);
  assert.match(html, /Redeem a one-time invitation/);
  assert.match(html, /haas_private_assignment/);
  assert.match(html, /Confidentiality terms hash/);
  assert.match(html, /Only your assigned, blinded cases are returned/);
  assert.match(html, /No paid-task capability evidence is shown/);
  assert.match(html, /payment receipts.*appear only after settlement/i);
  assert.doesNotMatch(html, /Tier \d|World ID|Self\.xyz|passport uniqueness|guaranteed base|on-chain payment/i);
});

test("assigned review renders blinded choices, failure tags, rationale, lease deadline, and honest draft state", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const expiresAt = new Date("2030-01-02T03:04:05.000Z").toISOString();
  const html = renderToStaticMarkup(
    <HumanAssuranceRaterClient
      initialServerAcceptance={{
        accepted: true,
        replay: false,
        responseCount: 1,
        compensation: "unpaid",
        settlementStatus: "not_applicable",
      }}
      initialTask={{
        assignmentId: "haas_assigned",
        runId: "har_test",
        source: "customer_invited",
        runManifestHash: `sha256:${"b".repeat(64)}`,
        policyHash: `sha256:${"c".repeat(64)}`,
        qualificationProvenance: [
          {
            key: "customer_invitation",
            value: true,
            source: "customer",
            assertedBy: "client",
            verifiedAt: "2030-01-01T00:00:00.000Z",
          },
        ],
        rubric: {
          prompt: "Which response is better?",
          failureTags: [{ key: "incorrect", label: "Incorrect" }],
          rationale: { mode: "required", minLength: 10, maxLength: 2_000 },
        },
        cases: [
          {
            caseId: "hacase_1",
            position: 0,
            title: "Compare the support replies",
            instructions: "Choose the reply that resolves the issue without inventing policy.",
            options: [
              { key: "A", artifactId: "haa_a", leaseId: "lease_a", expiresAt },
              { key: "B", artifactId: "haa_b", leaseId: "lease_b", expiresAt },
            ],
            context: [],
            objectiveReference: "Use the frozen support rubric.",
          },
        ],
      }}
      sandboxMode
    />,
  ).replace(/\s+/g, " ");

  assert.match(html, /Candidate A/);
  assert.match(html, /Candidate B/);
  assert.match(html, /Failure tags/);
  assert.match(html, /Incorrect/);
  assert.match(html, /Decision rationale/);
  assert.match(html, /customer invitation/);
  assert.match(html, /No paid voucher attached/);
  assert.match(html, /The server accepted 1 assigned response and completed the assignment/i);
  assert.match(html, /unpaid invited review, so no settlement reference is expected/i);
});
