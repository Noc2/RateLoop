import assert from "node:assert/strict";
import test from "node:test";
import { createTokenlessRateLoopClient } from "./tokenless";
import {
  parseHumanAssuranceProjectCreateRequest,
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
      });
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
  await client.assurance.getProject({ projectId: "hap_client" });
  await client.assurance.getRunStatus({ runId: "hau_client" });

  assert.deepEqual(
    requests.map((request) => [request.method, request.url]),
    [
      ["GET", "https://tokenless.example/api/agent/v1/assurance/projects"],
      ["POST", "https://tokenless.example/api/agent/v1/assurance/projects"],
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
});
