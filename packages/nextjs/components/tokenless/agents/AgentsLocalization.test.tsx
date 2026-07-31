import React from "react";
import { AdaptiveCoverageSummary } from "./AdaptiveCoverageSummary";
import { AgentText } from "./AgentText";
import { AgentsLocaleProvider } from "./AgentsLocaleProvider";
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
        stage: "monitoring",
        reviewRateBps: 2_500,
        populationEstimate: {
          schemaVersion: "rateloop.population-estimate.v1",
          estimand: "comparable_agreement_domain_ratio",
          status: "estimable",
          gap: null,
          counts: {
            frame: 20,
            selected: 8,
            completed: 7,
            comparable: 6,
            agreements: 4,
            certaintyUnits: 2,
            certaintyShareBps: 1_000,
          },
          probabilityKind: "history_conditioned_propensity",
          sampledAgreementBps: 6_667,
          populationAgreementBps: 7_500,
          weightedComparableTotal: 16,
          weightedAgreementTotal: 12,
          uncertainty: { method: "withheld_pending_design_review", lowerBps: null, upperBps: null },
        },
        changes: [
          {
            fromRateBps: 5_000,
            toRateBps: 2_500,
            reason: "fifty_stable_cases",
            changedAt: "2026-07-17T10:00:00.000Z",
          },
        ],
      },
    ],
  },
];

test("the Agents locale provider renders representative German UI and locale-aware values", () => {
  const html = renderToStaticMarkup(
    <AgentsLocaleProvider locale="de">
      <AgentText id="reviewers" />
      <AdaptiveCoverageSummary agents={agents} />
    </AgentsLocaleProvider>,
  );

  assert.match(html, /Prüfende/);
  assert.match(html, /Adaptive Abdeckung/);
  assert.match(html, /Prüfrate/);
  assert.match(html, />25\s?%</u);
  assert.match(html, /Beobachtete Übereinstimmung/);
  assert.match(html, /Gewichtete Population/);
  assert.match(html, />75\s?%</u);
  assert.match(html, /sequenzielle IPW-Punktschätzung/);
  assert.match(html, /Konfidenzintervall bis zur Methodenprüfung zurückgehalten/);
  assert.match(html, /50 stabile vergleichbare Fälle/);
  assert.doesNotMatch(html, /Adaptive coverage|Review rate|Weighted population|Fifty stable cases/);
});

test("the same components retain their English catalog copy", () => {
  const html = renderToStaticMarkup(
    <AgentsLocaleProvider locale="en">
      <AgentText id="reviewers" />
      <AdaptiveCoverageSummary agents={agents} />
    </AgentsLocaleProvider>,
  );

  assert.match(html, /Reviewers/);
  assert.match(html, /Adaptive coverage/);
  assert.match(html, /Weighted population/);
  assert.match(html, /50 stable comparable cases/);
});
