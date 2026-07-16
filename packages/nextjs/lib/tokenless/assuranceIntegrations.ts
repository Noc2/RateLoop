import {
  HUMAN_ASSURANCE_SCHEMA_VERSION,
  type HumanAssurancePrivateReviewCreateRequest,
  type HumanAssuranceProjectCreateRequest,
  RateLoopSdkError,
  parseHumanAssurancePrivateReviewCreateRequest,
  parseHumanAssuranceProjectCreateRequest,
} from "@rateloop/sdk";
import "server-only";
import { authenticateAgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import { getAssuranceRunAggregateState } from "~~/lib/tokenless/assuranceRunOrchestration";
import {
  createAssuranceProject,
  getAssuranceProjectResources,
  listAssuranceProjects,
} from "~~/lib/tokenless/humanAssurance";
import { preparePrivateReviewFoundation } from "~~/lib/tokenless/privateReviewFoundation";
import { type ProductPrincipal, authenticateProductPrincipal } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export type AssuranceApiPrincipal = Extract<ProductPrincipal, { kind: "api_key" }>;
export const ASSURANCE_API_RESPONSE_HEADERS = { "cache-control": "private, no-store, max-age=0" } as const;

export async function authenticateAssuranceApiPrincipal(authorization: string | null): Promise<AssuranceApiPrincipal> {
  if (!authorization) {
    throw new TokenlessServiceError(
      "A workspace API key is required for the assurance integration API.",
      401,
      "workspace_api_key_required",
    );
  }
  const principal = await authenticateProductPrincipal({ authorization, sessionToken: undefined });
  if (principal.kind !== "api_key") {
    throw new TokenlessServiceError(
      "A workspace API key is required for the assurance integration API.",
      401,
      "workspace_api_key_required",
    );
  }
  return principal;
}

export async function authenticateAssurancePrivateReviewPrincipal(authorization: string | null) {
  if (/^Bearer\s+rlo_at_/i.test(authorization ?? "")) {
    const authenticated = await authenticateAgentMcpPrincipal(authorization);
    if (
      authenticated.kind !== "oauth" ||
      !authenticated.principal ||
      !authenticated.integration ||
      authenticated.connectionStatus !== "connected"
    ) {
      throw new TokenlessServiceError(
        "A connected owner-approved agent credential is required for private review.",
        401,
        "private_review_agent_connection_required",
      );
    }
    return { boundIntegrationId: authenticated.integration.integrationId, principal: authenticated.principal };
  }
  return { boundIntegrationId: null, principal: await authenticateAssuranceApiPrincipal(authorization) };
}

export function parseAssuranceApiProjectRequest(value: unknown): HumanAssuranceProjectCreateRequest {
  try {
    return parseHumanAssuranceProjectCreateRequest(value);
  } catch (error) {
    if (error instanceof RateLoopSdkError) {
      throw new TokenlessServiceError(error.message, 400, "invalid_human_assurance_input");
    }
    throw error;
  }
}

export function parseAssuranceApiPrivateReviewRequest(value: unknown): HumanAssurancePrivateReviewCreateRequest {
  try {
    return parseHumanAssurancePrivateReviewCreateRequest(value);
  } catch (error) {
    if (error instanceof RateLoopSdkError) {
      throw new TokenlessServiceError(error.message, 400, "invalid_human_assurance_input");
    }
    throw error;
  }
}

export async function createAssuranceApiPrivateReview(input: {
  boundIntegrationId: string | null;
  principal: AssuranceApiPrincipal;
  request: HumanAssurancePrivateReviewCreateRequest;
}) {
  if (input.boundIntegrationId && input.boundIntegrationId !== input.request.integrationId) {
    throw new TokenlessServiceError(
      "The private-review integration does not match the authenticated agent.",
      409,
      "private_review_integration_binding_mismatch",
    );
  }
  return preparePrivateReviewFoundation({ principal: input.principal, request: input.request });
}

export async function listAssuranceApiProjects(principal: AssuranceApiPrincipal) {
  const projects = await listAssuranceProjects(principal);
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    workspaceId: principal.workspaceId,
    projects: projects.map(project => ({
      ...project,
      description: project.description ?? undefined,
    })),
  };
}

export async function createAssuranceApiProject(input: {
  principal: AssuranceApiPrincipal;
  request: HumanAssuranceProjectCreateRequest;
}) {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    ...(await createAssuranceProject({ principal: input.principal, ...input.request })),
  };
}

export async function getAssuranceApiProject(input: { principal: AssuranceApiPrincipal; projectId: string }) {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    projectId: input.projectId,
    ...(await getAssuranceProjectResources(input)),
  };
}

export async function getAssuranceApiRunStatus(input: { principal: AssuranceApiPrincipal; runId: string }) {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    ...(await getAssuranceRunAggregateState(input)),
  };
}
