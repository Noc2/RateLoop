import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("private rater queue opens one assigned task without unrelated eligibility UI", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const html = renderToStaticMarkup(
    <HumanAssuranceRaterClient
      initialAssignmentId="haas_private_assignment"
      initialTermsHash={`sha256:${"a".repeat(64)}`}
    />,
  ).replace(/\s+/g, " ");

  assert.match(html, /Private assignment/);
  assert.match(html, /Open your assigned review/);
  assert.match(html, /Assignment details/);
  assert.match(html, /Invitation details loaded/);
  assert.doesNotMatch(html, />Assignment ID</);
  assert.doesNotMatch(html, />Confidentiality terms hash</);
  assert.match(html, /Only your assigned, blinded cases are returned/);
  assert.match(html, /Private artifact access is short-lived and logged/);
  assert.match(html, /Do not copy, share, or reuse assigned material/);
  assert.ok(html.indexOf("Privacy and access") < html.indexOf("I accept this reviewer group"));
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /Capability status|Review eligibility|No capability evidence is shown/);
  assert.doesNotMatch(html, /Tier \d|World ID|Self\.xyz|passport uniqueness|guaranteed base|on-chain payment/i);
});

test("assigned review keeps the content, decision, and deadline visible without internal review metadata", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");
  const expiresAt = new Date("2030-01-02T03:04:05.000Z").toISOString();
  const html = renderToStaticMarkup(
    <HumanAssuranceRaterClient
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
          {
            key: "expertise:code-review:typescript",
            value: true,
            source: "workspace_owner",
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
    />,
  ).replace(/\s+/g, " ");

  assert.match(html, /Candidate A/);
  assert.match(html, /Candidate B/);
  assert.match(html, /Failure tags/);
  assert.match(html, /Incorrect/);
  assert.match(html, /Decision rationale/);
  assert.doesNotMatch(html, /customer invitation/i);
  assert.doesNotMatch(html, /TypeScript code review/i);
  assert.doesNotMatch(html, /workspace owner/i);
  assert.doesNotMatch(html, /voucher|calibration|qualification/i);
  assert.match(html, /Case 1 of 1/);
  assert.match(html, /Keyboard: 1 or 2 selects/);
  assert.match(html, /Access:/);
});
