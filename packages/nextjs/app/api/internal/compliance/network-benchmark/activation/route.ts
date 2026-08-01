import { NextRequest, NextResponse } from "next/server";
import { readApiJsonRequestBody, rethrowApiRequestBodyBoundaryError } from "~~/lib/tokenless/apiRequestBody";
import {
  NETWORK_BENCHMARK_ACTIVATION_SCOPE,
  NETWORK_BENCHMARK_DEACTIVATION_REASONS,
  NETWORK_BENCHMARK_EVIDENCE_TYPES,
  type NetworkBenchmarkEvidence,
  networkBenchmarkActivationService,
} from "~~/lib/tokenless/networkBenchmarkActivation";
import { authorizeComplianceOperator } from "~~/lib/tokenless/paidEligibility";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_048_576;
const NO_STORE = "private, no-store, max-age=0";

type Dependencies = {
  authorizeOperator: (authorization: string | null) => { keyVersion: string };
  activate: typeof networkBenchmarkActivationService.activate;
  deactivate: typeof networkBenchmarkActivationService.deactivate;
};

function invalid(message: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_network_benchmark_activation");
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${label} contains unsupported fields.`);
  }
}

function string(value: unknown, field: string) {
  if (typeof value !== "string") invalid(`${field} must be a string.`);
  return value;
}

function integer(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid(`${field} must be an integer.`);
  return value;
}

function stringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string"))
    invalid(`${field} must be a string array.`);
  return value as string[];
}

function evidenceArray(value: unknown): NetworkBenchmarkEvidence[] {
  if (!Array.isArray(value)) invalid("evidence must be an array.");
  return value.map((item, index) => {
    const evidence = record(item, `evidence[${index}]`);
    exact(
      evidence,
      [
        "workspaceId",
        "projectId",
        "benchmarkId",
        "evidenceWindowStart",
        "evidenceWindowEnd",
        "methodVersion",
        "deploymentKey",
        "evidenceId",
        "evidenceType",
        "counterpartyReferenceHash",
        "artifactDigest",
        "completedAt",
      ],
      `evidence[${index}]`,
    );
    const evidenceType = string(evidence.evidenceType, `evidence[${index}].evidenceType`);
    if (!(NETWORK_BENCHMARK_EVIDENCE_TYPES as readonly string[]).includes(evidenceType)) {
      invalid(`evidence[${index}].evidenceType is unsupported.`);
    }
    return {
      workspaceId: string(evidence.workspaceId, `evidence[${index}].workspaceId`),
      projectId: string(evidence.projectId, `evidence[${index}].projectId`),
      benchmarkId: string(evidence.benchmarkId, `evidence[${index}].benchmarkId`),
      evidenceWindowStart: string(evidence.evidenceWindowStart, `evidence[${index}].evidenceWindowStart`),
      evidenceWindowEnd: string(evidence.evidenceWindowEnd, `evidence[${index}].evidenceWindowEnd`),
      methodVersion: string(evidence.methodVersion, `evidence[${index}].methodVersion`),
      deploymentKey: string(evidence.deploymentKey, `evidence[${index}].deploymentKey`),
      evidenceId: string(evidence.evidenceId, `evidence[${index}].evidenceId`),
      evidenceType: evidenceType as NetworkBenchmarkEvidence["evidenceType"],
      counterpartyReferenceHash: string(
        evidence.counterpartyReferenceHash,
        `evidence[${index}].counterpartyReferenceHash`,
      ) as `sha256:${string}`,
      artifactDigest: string(evidence.artifactDigest, `evidence[${index}].artifactDigest`) as `sha256:${string}`,
      completedAt: string(evidence.completedAt, `evidence[${index}].completedAt`),
    };
  });
}

function authorizeNetworkBenchmarkOperator(authorization: string | null) {
  authorizeComplianceOperator(authorization);
  const keyVersion = process.env.TOKENLESS_COMPLIANCE_OPERATOR_KEY_VERSION?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyVersion)) {
    throw new TokenlessServiceError(
      "Network benchmark compliance operations are unavailable.",
      503,
      "compliance_unavailable",
    );
  }
  return { keyVersion };
}

export function createNetworkBenchmarkActivationPost(
  dependencies: Dependencies = {
    authorizeOperator: authorizeNetworkBenchmarkOperator,
    activate: input => networkBenchmarkActivationService.activate(input),
    deactivate: input => networkBenchmarkActivationService.deactivate(input),
  },
) {
  return async function POST(request: NextRequest) {
    try {
      const operator = dependencies.authorizeOperator(request.headers.get("authorization"));
      let body: Record<string, unknown>;
      try {
        body = record(await readApiJsonRequestBody(request, MAX_BODY_BYTES), "Activation action");
      } catch (error) {
        rethrowApiRequestBodyBoundaryError(error);
        invalid("Activation action must be valid JSON.");
      }

      let result: unknown;
      if (body.action === "activate") {
        exact(
          body,
          [
            "action",
            "workspaceManagerReferencePrincipalId",
            "workspaceId",
            "projectId",
            "benchmarkId",
            "activationReference",
            "evidenceWindowStart",
            "evidenceWindowEnd",
            "methodVersion",
            "deploymentKey",
            "activationScope",
            "permittedWorkerJurisdictions",
            "authorizationDurationSeconds",
            "evidence",
            "opportunityIds",
          ],
          "Activation action",
        );
        const activationScope = string(body.activationScope, "activationScope");
        if (activationScope !== NETWORK_BENCHMARK_ACTIVATION_SCOPE) {
          invalid("activationScope is restricted to the testnet network benchmark exercise.");
        }
        result = await dependencies.activate({
          complianceOperatorKeyVersion: operator.keyVersion,
          workspaceManagerReferencePrincipalId: string(
            body.workspaceManagerReferencePrincipalId,
            "workspaceManagerReferencePrincipalId",
          ),
          workspaceId: string(body.workspaceId, "workspaceId"),
          projectId: string(body.projectId, "projectId"),
          benchmarkId: string(body.benchmarkId, "benchmarkId"),
          activationReference: string(body.activationReference, "activationReference"),
          evidenceWindowStart: string(body.evidenceWindowStart, "evidenceWindowStart"),
          evidenceWindowEnd: string(body.evidenceWindowEnd, "evidenceWindowEnd"),
          methodVersion: string(body.methodVersion, "methodVersion"),
          deploymentKey: string(body.deploymentKey, "deploymentKey"),
          activationScope,
          permittedWorkerJurisdictions: stringArray(body.permittedWorkerJurisdictions, "permittedWorkerJurisdictions"),
          authorizationDurationSeconds: integer(body.authorizationDurationSeconds, "authorizationDurationSeconds"),
          evidence: evidenceArray(body.evidence),
          opportunityIds: stringArray(body.opportunityIds, "opportunityIds"),
        });
      } else if (body.action === "deactivate") {
        const hasReplacement = Object.hasOwn(body, "supersededByActivationReference");
        exact(
          body,
          [
            "action",
            "workspaceId",
            "projectId",
            "activationReference",
            "reason",
            ...(hasReplacement ? ["supersededByActivationReference"] : []),
          ],
          "Deactivation action",
        );
        const reason = string(body.reason, "reason");
        if (!(NETWORK_BENCHMARK_DEACTIVATION_REASONS as readonly string[]).includes(reason)) {
          invalid("reason is unsupported.");
        }
        result = await dependencies.deactivate({
          complianceOperatorKeyVersion: operator.keyVersion,
          workspaceId: string(body.workspaceId, "workspaceId"),
          projectId: string(body.projectId, "projectId"),
          activationReference: string(body.activationReference, "activationReference"),
          reason: reason as (typeof NETWORK_BENCHMARK_DEACTIVATION_REASONS)[number],
          ...(hasReplacement
            ? {
                supersededByActivationReference: string(
                  body.supersededByActivationReference,
                  "supersededByActivationReference",
                ),
              }
            : {}),
        });
      } else {
        invalid("Activation action is unsupported.");
      }
      return NextResponse.json(result, { status: 201, headers: { "Cache-Control": NO_STORE } });
    } catch (error) {
      const response = tokenlessErrorResponse(error);
      return NextResponse.json(response.body, {
        status: response.status,
        headers: { "Cache-Control": NO_STORE },
      });
    }
  };
}

export const POST = createNetworkBenchmarkActivationPost();
