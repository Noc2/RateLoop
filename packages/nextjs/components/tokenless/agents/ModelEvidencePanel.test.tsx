import React from "react";
import { AgentsLocaleProvider } from "./AgentsLocaleProvider";
import { ModelEvidencePanel, modelVolumeCalendarPoints } from "./ModelEvidencePanel";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { EvaluationModelProfile } from "~~/lib/tokenless/evaluationDashboard";

const nodeRequire = createRequire(import.meta.url);
const { renderToStaticMarkup } = nodeRequire("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

const profiles: EvaluationModelProfile[] = [
  {
    profileHash: `sha256:${"a".repeat(64)}`,
    primary: {
      provider: "OpenAI",
      requestedModel: "gpt-5.6-sol",
      resolvedModel: "gpt-5.6-sol-2026-07-01",
      modelVersion: "2026-07-01",
    },
    contributors: [
      {
        provider: "OpenAI",
        requestedModel: "gpt-5.6-terra",
        resolvedModel: null,
        modelVersion: null,
      },
    ],
    orchestrationMode: "multi_model",
    agentNames: ["Support agent"],
    executionCount: 2,
    failedExecutionCount: 0,
    opportunityCount: 2,
    reviewRequestedCount: 1,
    skippedCount: 1,
    comparableCount: 1,
    agreementCount: 1,
    humanAgreementBps: 10_000,
    averageDurationMs: 1_500,
    inputTokenTotal: 2_000,
    outputTokenTotal: 500,
    lastExecutedAt: "2026-07-20T10:00:00.000Z",
    scopes: [
      {
        scopeId: "scope-support",
        workflowKey: "support-reply",
        riskTier: "low",
        stage: "high_coverage",
        updatedAt: "2026-07-20T10:00:00.000Z",
      },
    ],
    daily: [
      {
        date: "2026-07-20",
        executionCount: 2,
        opportunityCount: 2,
        reviewRequestedCount: 1,
        comparableCount: 1,
        agreementCount: 1,
      },
    ],
    recentExecutions: [
      {
        executionId: "execution-1",
        occurredAt: "2026-07-20T10:00:00.000Z",
        status: "completed",
        workflowKey: "support-reply",
        riskTier: "low",
        reviewStatus: "completed",
        metadataComplete: true,
        modelCallCount: 2,
        durationMs: 1_500,
        inputTokens: 2_000,
        outputTokens: 500,
        agreement: "agree",
      },
    ],
  },
  {
    profileHash: `sha256:${"b".repeat(64)}`,
    primary: {
      provider: "Anthropic",
      requestedModel: "claude-sonnet",
      resolvedModel: null,
      modelVersion: null,
    },
    contributors: [],
    orchestrationMode: "single_model",
    agentNames: ["Support agent"],
    executionCount: 1,
    failedExecutionCount: 0,
    opportunityCount: 1,
    reviewRequestedCount: 0,
    skippedCount: 1,
    comparableCount: 0,
    agreementCount: 0,
    humanAgreementBps: null,
    averageDurationMs: null,
    inputTokenTotal: null,
    outputTokenTotal: null,
    lastExecutedAt: "2026-07-19T10:00:00.000Z",
    scopes: [],
    daily: [],
    recentExecutions: [],
  },
];

test("model evidence renders a profile selector, charts, coverage, and request-level execution data", () => {
  const html = renderToStaticMarkup(<ModelEvidencePanel profiles={profiles} />);

  assert.match(html, /Model evidence/);
  assert.match(html, /Model profile/);
  assert.match(html, /gpt-5\.6-sol-2026-07-01/);
  assert.match(html, /claude-sonnet/);
  assert.match(html, /Evaluation volume/);
  assert.match(html, /Human agreement/);
  assert.match(html, /role="img"/);
  assert.match(html, /support-reply/);
  assert.match(html, /High coverage/);
  assert.match(html, /Recent requests/);
  assert.match(html, /2,000 in/);
  assert.match(html, /reported by the connected host, not independently verified/);
  assert.doesNotMatch(html, /unknown · unknown/);
});

test("model evidence stays absent until an eligible output reports execution metadata", () => {
  assert.equal(renderToStaticMarkup(<ModelEvidencePanel profiles={[]} />), "");
});

test("model evidence renders its display labels and values in German", () => {
  const html = renderToStaticMarkup(
    <AgentsLocaleProvider locale="de">
      <ModelEvidencePanel profiles={profiles} />
    </AgentsLocaleProvider>,
  );

  assert.match(html, /Ausführungsnachweise/);
  assert.match(html, /Geeignete Ausgaben/);
  assert.match(html, /Zur menschlichen Prüfung gesendet/);
  assert.match(html, /Hohe Abdeckung/);
  assert.match(html, /2 Modellaufrufe/);
  assert.match(html, /1,5 Sek\./);
  assert.doesNotMatch(html, /Eligible outputs|Sent to human review|High coverage|model calls|Not reported/);
});

test("model volume fills exactly fourteen calendar days instead of slicing dates with data", () => {
  const points = modelVolumeCalendarPoints(
    [
      {
        date: "2026-07-01",
        executionCount: 9,
        opportunityCount: 9,
        reviewRequestedCount: 9,
        comparableCount: 9,
        agreementCount: 9,
      },
      {
        date: "2026-07-28",
        executionCount: 2,
        opportunityCount: 2,
        reviewRequestedCount: 1,
        comparableCount: 1,
        agreementCount: 1,
      },
    ],
    new Date("2026-07-28T20:00:00.000Z"),
  );

  assert.equal(points.length, 14);
  assert.equal(points[0]?.date, "2026-07-15");
  assert.equal(points[0]?.opportunityCount, 0);
  assert.equal(points.at(-1)?.date, "2026-07-28");
  assert.equal(points.at(-1)?.opportunityCount, 2);
  assert.equal(
    points.some(point => point.date === "2026-07-01"),
    false,
  );
});
