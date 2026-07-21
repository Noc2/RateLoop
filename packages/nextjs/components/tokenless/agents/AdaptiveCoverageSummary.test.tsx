import React from "react";
import { AdaptiveCoverageSummary } from "./AdaptiveCoverageSummary";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { EvaluationDashboard } from "~~/lib/tokenless/evaluationDashboard";

const nodeRequire = createRequire(import.meta.url);
const { renderToStaticMarkup } = nodeRequire("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

const agents: EvaluationDashboard["agents"] = [
  {
    agentId: "agent_1",
    externalId: "support-agent",
    status: "active",
    versionId: "version_1",
    versionNumber: 1,
    displayName: "Support agent",
    environment: "production",
    attributedRunCount: 0,
    adaptiveCoverage: [
      {
        scopeId: "scope:support",
        workflowKey: "support-reply",
        riskTier: "low",
        stage: "high_coverage",
        reviewRateBps: 5_000,
        changes: [
          {
            fromRateBps: 10_000,
            toRateBps: 5_000,
            reason: "two_stable_windows",
            changedAt: "2026-07-17T10:00:00.000Z",
          },
          {
            fromRateBps: 5_000,
            toRateBps: 10_000,
            reason: "agreement_below_threshold",
            changedAt: "2026-07-16T10:00:00.000Z",
          },
        ],
      },
    ],
  },
];

test("adaptive coverage renders an accessible trend and explains every recorded rate change", () => {
  const html = renderToStaticMarkup(<AdaptiveCoverageSummary agents={agents} />);

  assert.match(html, /Adaptive coverage/);
  assert.match(html, /Review rate/);
  assert.match(html, />50%</);
  assert.match(html, /role="img"/);
  assert.match(
    html,
    /aria-labelledby="adaptive-coverage-scope-support-title adaptive-coverage-scope-support-description"/,
  );
  assert.match(html, /<title id="adaptive-coverage-scope-support-title">Adaptive review-rate trend<\/title>/);
  assert.match(html, /<desc id="adaptive-coverage-scope-support-description">[^<]*100%[^<]*50%/);
  assert.match(html, /Why:<\/span> Two stable review windows/);
  assert.match(html, /Rate history \(2\)/);
  assert.match(html, /Agreement fell below the policy threshold/);
  assert.equal((html.match(/<time /gu) ?? []).length, 2);
  assert.doesNotMatch(html, /two_stable_windows|agreement_below_threshold/);
});

test("adaptive coverage stays absent when no adaptive scope exists", () => {
  assert.equal(
    renderToStaticMarkup(<AdaptiveCoverageSummary agents={[{ ...agents[0]!, adaptiveCoverage: [] }]} />),
    "",
  );
});
