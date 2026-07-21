import assert from "node:assert/strict";
import test from "node:test";
import { createTokenlessRateLoopClient } from "./tokenless";
import {
  parseHumanAssuranceProjectCreateRequest,
  parseHumanAssurancePrivateReviewCreateRequest,
  parseHumanAssuranceProjectResourcesResponse,
  parseHumanAssuranceRunStatusResponse,
} from "./humanAssuranceApiSchema";
import { HUMAN_ASSURANCE_SCHEMA_VERSION } from "./humanAssuranceTypes";

const API_KEY = `rlk_${"a".repeat(16)}_${"b".repeat(32)}`;

test("project creation requires explicit privacy and retention choices", () => {
  assert.deepEqual(
    parseHumanAssuranceProjectCreateRequest({
      name: "Client support quality",
      description: "Recurring blinded release checks",
      dataClassification: "confidential",
      retentionDays: 90,
    }),
    {
      name: "Client support quality",
      description: "Recurring blinded release checks",
      dataClassification: "confidential",
      retentionDays: 90,
    },
  );
  assert.throws(
    () =>
      parseHumanAssuranceProjectCreateRequest({
        name: "Unsafe default",
        retentionDays: 30,
      }),
    /dataClassification/,
  );
  assert.throws(
    () =>
      parseHumanAssuranceProjectCreateRequest({
        name: "Unknown field",
        dataClassification: "internal",
        retentionDays: 30,
        workspaceId: "must-be-derived-from-api-key",
      }),
    /only name, description, dataClassification, retentionDays/,
  );
});

test("private reviews require exact integration/profile bindings and reject plaintext fields", () => {
  const request = {
    idempotencyKey: "private-review-0001",
    integrationId: "agi_exact",
    projectId: "hap_private",
    requestProfile: {
      id: "rrp_private",
      version: 3,
      hash: `sha256:${"a".repeat(64)}`,
    },
    cohortId: "hacoh_private",
    dataClassification: "regulated",
    source: {
      contentType: "text/plain",
      bytesBase64: Buffer.from("source").toString("base64"),
    },
    suggestion: {
      contentType: "text/plain",
      bytesBase64: Buffer.from("suggestion").toString("base64"),
    },
  };
  assert.deepEqual(
    parseHumanAssurancePrivateReviewCreateRequest(request),
    request,
  );
  assert.deepEqual(
    parseHumanAssurancePrivateReviewCreateRequest({
      ...request,
      source: { ...request.source, contentType: "Text/Plain; Charset=UTF-8" },
      suggestion: {
        ...request.suggestion,
        contentType: 'text/plain; charset="utf-8"',
      },
    }),
    request,
  );
  assert.throws(
    () =>
      parseHumanAssurancePrivateReviewCreateRequest({
        ...request,
        sourceText: "plaintext",
      }),
    /only idempotencyKey, integrationId, projectId/u,
  );
  assert.throws(
    () =>
      parseHumanAssurancePrivateReviewCreateRequest({
        ...request,
        dataClassification: "public",
      }),
    /dataClassification/u,
  );
  assert.throws(
    () =>
      parseHumanAssurancePrivateReviewCreateRequest({
        ...request,
        source: { ...request.source, bytesBase64: "" },
      }),
    /bytesBase64/u,
  );
  assert.throws(
    () =>
      parseHumanAssurancePrivateReviewCreateRequest({
        ...request,
        source: { ...request.source, contentType: "text/plain; charset" },
      }),
    /contentType/u,
  );
});

test("run status validation reconciles valid response totals", () => {
  const fixture = {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    runId: "hau_release_1",
    runStatus: "collecting",
    totalCases: 2,
    roundStates: { open: 2 },
    deterministicChecks: { notApplicable: 2, pending: 0, passed: 0, failed: 0 },
    responses: { baseline: 1, candidate: 2, tie: 0, valid: 3 },
    candidatePreferenceShareBps: 6666,
    passRule: {
      metric: "candidate_preference_share_bps",
      operator: "gte",
      thresholdBps: 6000,
      minimumValidResponses: 3,
    },
    decision: "passed",
    rerun: {
      rootRunId: "hau_release_1",
      previousRunId: null,
      previousManifestHash: null,
      ordinal: 0,
    },
  };
  assert.equal(
    parseHumanAssuranceRunStatusResponse(fixture).decision,
    "passed",
  );
  assert.throws(
    () =>
      parseHumanAssuranceRunStatusResponse({
        ...fixture,
        responses: { ...fixture.responses, valid: 4 },
      }),
    /sum of baseline, candidate, and tie/,
  );
});

test("project resources reuse canonical audience policy values", () => {
  const parsed = parseHumanAssuranceProjectResourcesResponse({
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    projectId: "hap_client",
    suites: [],
    policies: [
      {
        policyId: "hapolicy_client",
        version: 1,
        reviewerSource: "hybrid",
        compensation: "mixed",
        selection: "randomized",
        policyHash: `sha256:${"a".repeat(64)}`,
      },
    ],
    runs: [],
  });
  assert.equal(parsed.policies[0]?.compensation, "mixed");
  assert.equal(parsed.policies[0]?.selection, "randomized");
});

test("client exposes API-key scoped project and run paths", async () => {
  const requests: Array<{
    method: string;
    url: string;
    authorization: string | null;
    idempotencyKey: string | null;
  }> = [];
  const client = createTokenlessRateLoopClient({
    apiBaseUrl: "https://tokenless.example",
    apiKey: API_KEY,
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      requests.push({
        method: init.method ?? "GET",
        url,
        authorization: new Headers(init.headers).get("authorization"),
        idempotencyKey: new Headers(init.headers).get("idempotency-key"),
      });
      if (url.endsWith("/assurance/private-reviews")) {
        return new Response(
          JSON.stringify({
            schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
            privateReviewId: "hpr_client",
            status: "ready_for_assignment",
            lane: "private",
            task: {
              kind: "binary_review",
              commitment: `sha256:${"1".repeat(64)}`,
            },
            bindings: {
              bindingHash: `sha256:${"2".repeat(64)}`,
              project: {
                projectId: "hap_client",
                hash: `sha256:${"3".repeat(64)}`,
              },
              requestProfile: {
                id: "rrp_client",
                version: 1,
                hash: `sha256:${"4".repeat(64)}`,
              },
              privateGroup: {
                groupId: "pgrp_client",
                policyVersion: 1,
                policyHash: `sha256:${"5".repeat(64)}`,
                allowlistHash: `sha256:${"6".repeat(64)}`,
                allowlistStatus: "allowed",
              },
              cohort: {
                cohortId: "hacoh_client",
                hash: `sha256:${"7".repeat(64)}`,
              },
            },
            artifacts: {
              sourceArtifactId: "art_source",
              suggestionArtifactId: "art_suggestion",
            },
            responseWindowSeconds: 3_600,
            responseDeadline: "2026-07-16T12:00:00.000Z",
          }),
        );
      }
      if (url.endsWith("/assurance/projects") && init.method === "POST") {
        return new Response(
          JSON.stringify({
            schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
            projectId: "hap_client",
            workspaceId: "ws_client",
          }),
        );
      }
      if (url.endsWith("/assurance/projects")) {
        return new Response(
          JSON.stringify({
            schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
            workspaceId: "ws_client",
            projects: [],
          }),
        );
      }
      if (url.endsWith("/assurance/projects/hap_client")) {
        return new Response(
          JSON.stringify({
            schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
            projectId: "hap_client",
            suites: [],
            policies: [],
            runs: [],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
          runId: "hau_client",
          runStatus: "frozen",
          totalCases: 1,
          roundStates: { planned: 1 },
          deterministicChecks: {
            notApplicable: 1,
            pending: 0,
            passed: 0,
            failed: 0,
          },
          responses: { baseline: 0, candidate: 0, tie: 0, valid: 0 },
          candidatePreferenceShareBps: null,
          passRule: {
            metric: "candidate_preference_share_bps",
            operator: "gte",
            thresholdBps: 6000,
            minimumValidResponses: 3,
          },
          decision: "pending",
          rerun: {
            rootRunId: "hau_client",
            previousRunId: null,
            previousManifestHash: null,
            ordinal: 0,
          },
        }),
      );
    },
  });

  await client.assurance.listProjects();
  await client.assurance.createProject({
    name: "Client",
    dataClassification: "confidential",
    retentionDays: 90,
  });
  await client.assurance.createPrivateReview({
    idempotencyKey: "private-client-0001",
    integrationId: "agi_client",
    projectId: "hap_client",
    requestProfile: {
      id: "rrp_client",
      version: 1,
      hash: `sha256:${"4".repeat(64)}`,
    },
    cohortId: "hacoh_client",
    dataClassification: "confidential",
    source: {
      contentType: "text/plain",
      bytesBase64: Buffer.from("source").toString("base64"),
    },
    suggestion: {
      contentType: "text/plain",
      bytesBase64: Buffer.from("suggestion").toString("base64"),
    },
  });
  await client.assurance.getProject({ projectId: "hap_client" });
  await client.assurance.getRunStatus({ runId: "hau_client" });

  assert.deepEqual(
    requests.map((request) => [request.method, request.url]),
    [
      ["GET", "https://tokenless.example/api/agent/v1/assurance/projects"],
      ["POST", "https://tokenless.example/api/agent/v1/assurance/projects"],
      [
        "POST",
        "https://tokenless.example/api/agent/v1/assurance/private-reviews",
      ],
      [
        "GET",
        "https://tokenless.example/api/agent/v1/assurance/projects/hap_client",
      ],
      [
        "GET",
        "https://tokenless.example/api/agent/v1/assurance/runs/hau_client",
      ],
    ],
  );
  assert.ok(
    requests.every((request) => request.authorization === `Bearer ${API_KEY}`),
  );
  assert.equal(
    requests.find((request) =>
      request.url.endsWith("/assurance/private-reviews"),
    )?.idempotencyKey,
    "private-client-0001",
  );
});
