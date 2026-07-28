import { hostedE2eTarget } from "../../config/hostedE2eTarget";
import { verifyAuditExport } from "../../scripts/audit-export-core.mjs";
import type { HostedAuthRole } from "../hosted-auth/config";
import { HostedAuthHarness } from "../hosted-auth/harness";
import { authorizeHostedMcpClient, sha256Commitment } from "./hostedMcp";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

type JsonObject = Record<string, unknown>;
type HttpMethod = "DELETE" | "GET" | "POST" | "PUT";

const target = hostedE2eTarget();

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid response.`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} was unavailable.`);
  return value;
}

function number(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} was invalid.`);
  return value;
}

async function browserJson(
  context: BrowserContext,
  method: HttpMethod,
  path: string,
  options: { body?: unknown; statuses?: number[] } = {},
) {
  const response = await context.request.fetch(path, {
    data: options.body,
    failOnStatusCode: false,
    headers: {
      Accept: "application/json",
      ...(method === "GET" ? {} : { Origin: target.baseURL }),
    },
    method,
  });
  const statuses = options.statuses ?? [200];
  if (!statuses.includes(response.status())) {
    throw new Error(`${method} ${path} returned HTTP ${response.status()}.`);
  }
  return object(await response.json(), `${method} ${path}`);
}

async function acceptReviewerInvitation(page: Page, destinationUrl: string) {
  const destination = new URL(destinationUrl);
  if (destination.origin !== target.baseURL || destination.pathname !== "/human") {
    throw new Error("Reviewer invitation destination left the isolated tokenless deployment.");
  }
  await page.goto(destination.href, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Reviewer invitation" })).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Reviewer invitation accepted.");
}

async function submitPrivateApproval(page: Page, source: string, suggestion: string) {
  await page.goto("/human?scope=private", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(source, { exact: true })).toHaveCount(0);
  await page
    .getByRole("checkbox", {
      name: /accept the current confidentiality terms and will not copy or share this private material/iu,
    })
    .check();
  await page.getByRole("button", { name: "Accept terms and begin" }).click();
  await expect(page.getByText(source, { exact: true })).toBeVisible();
  await expect(page.getByText(suggestion, { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Approve" }).check();
  await page
    .getByRole("textbox", { name: "Decision rationale" })
    .fill("The candidate is correct, bounded, and safe for this exact request.");
  await page.getByRole("spinbutton", { name: "Crowd forecast" }).fill("65");
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByRole("status")).toContainText("Review submitted.");
  await expect(page.getByText(source, { exact: true })).toHaveCount(0);
  await expect(page.getByText(suggestion, { exact: true })).toHaveCount(0);
}

async function poll<T>(read: () => Promise<T | null>, attempts = 30): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (value !== null) return value;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error("Hosted E2E polling timed out.");
}

test("@hosted-core completes a real OAuth, three-account, two-reviewer private journey", async ({
  browser,
  request,
}) => {
  test.setTimeout(15 * 60_000);
  expect(process.env.E2E_ALLOW_HOSTED_MUTATIONS).toBe("true");

  const releaseResponse = await request.get("/api/release", { failOnStatusCode: false });
  expect(releaseResponse.status()).toBe(200);
  expect(await releaseResponse.json()).toMatchObject({
    deploymentLine: "tokenless",
    git: { ref: target.expectedGitRef, sha: target.expectedGitSha },
    project: { id: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm", name: "rateloop-tokenless" },
  });

  const runId = randomUUID().replaceAll("-", "").slice(0, 16);
  const workspaceName = `Hosted E2E ${runId}`;
  const clientName = `Hosted E2E ${runId}`;
  const sourcePayload = JSON.stringify({ request: "Check this exact hosted private-review response.", runId });
  const suggestionPayload = JSON.stringify({ answer: "The hosted private-review response is safe and correct." });
  const auth = await HostedAuthHarness.create(browser);
  let integrationId: string | null = null;
  let workspaceId: string | null = null;
  let primaryFailure: unknown = null;

  try {
    await auth.signInAll();
    const [ownerSession, reviewerOneSession, reviewerTwoSession] = await Promise.all([
      auth.session("owner"),
      auth.session("reviewerOne"),
      auth.session("reviewerTwo"),
    ]);
    expect(
      new Set([ownerSession.principalId, reviewerOneSession.principalId, reviewerTwoSession.principalId]).size,
    ).toBe(3);

    const owner = auth.context("owner");
    const createdWorkspace = await browserJson(owner, "POST", "/api/account/workspaces", {
      body: { name: workspaceName },
      statuses: [201],
    });
    workspaceId = string(createdWorkspace.workspaceId, "Workspace ID");

    const connectionIntent = await browserJson(
      owner,
      "POST",
      `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-connections`,
      { body: {}, statuses: [201] },
    );
    const connectionUrl = string(connectionIntent.connectionUrl, "Connection URL");

    const ownerPage = await owner.newPage();
    const mcp = await authorizeHostedMcpClient({
      baseUrl: target.baseURL,
      clientName,
      page: ownerPage,
    });
    await mcp.initialize(clientName);
    const connected = await mcp.call("rateloop_connect_workspace", { connectionUrl });
    expect(connected).toMatchObject({ connected: true, nextAction: "follow_bound_policy" });
    const connection = object(connected.connection, "Connected agent");
    integrationId = string(connection.integrationId, "Integration ID");
    const agentId = string(connection.agentId, "Agent ID");
    await mcp.call("rateloop_get_agent_context", {});
    const verification = await mcp.call("rateloop_verify_connection", {});
    expect(verification).toMatchObject({
      schemaVersion: "rateloop.connection-verification.v1",
      connection: { status: "connected", integrationId },
    });

    const groupResponse = await browserJson(
      owner,
      "POST",
      `/api/account/workspaces/${encodeURIComponent(workspaceId)}/private-groups`,
      {
        body: {
          name: `Hosted reviewers ${runId}`,
          purpose: "Review exact confidential output created by the hosted end-to-end test.",
          policy: { defaultCompensation: "unpaid", dataClassifications: ["confidential"] },
        },
        statuses: [201],
      },
    );
    const group = object(groupResponse.group, "Private reviewer group");
    const privateGroupId = string(group.groupId, "Private group ID");

    const invitations = await Promise.all(
      (["reviewerOne", "reviewerTwo"] as const).map(async role => {
        const response = await browserJson(
          owner,
          "POST",
          `/api/account/workspaces/${encodeURIComponent(workspaceId!)}/reviewer-invitations`,
          {
            body: {
              privateGroupId,
              maxPrivateSensitivity: "confidential",
              intendedEmail: auth.config.accounts[role].email,
              maximumRedemptions: 1,
              paidAdulthoodAttested: false,
            },
            statuses: [201],
          },
        );
        const invitation = object(response.invitation, `${role} invitation`);
        return {
          destinationUrl: string(invitation.destinationUrl, `${role} invitation destination`),
          role,
        };
      }),
    );
    for (const invitation of invitations) {
      const page = await auth.context(invitation.role).newPage();
      await acceptReviewerInvitation(page, invitation.destinationUrl);
      await page.close();
    }

    const currentConfiguration = await browserJson(
      owner,
      "GET",
      `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/human-review`,
    );
    const configured = await browserJson(
      owner,
      "PUT",
      `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/human-review`,
      {
        body: {
          expectedBindingVersion:
            currentConfiguration.bindingRevision === null
              ? null
              : number(currentConfiguration.bindingRevision, "Human-review binding revision"),
          selection: {
            mode: "always",
            enforcementMode: "advisory",
            agreementThresholdBps: 8_000,
            productionFloorBps: 0,
            fixedRateBps: null,
            maximumUnreviewedGap: 20,
            requiredRiskTiers: ["high"],
            criticalRiskTiers: ["critical"],
            minimumConfidenceBps: 7_000,
            maximumLatencyMs: 120_000,
          },
          requestProfile: {
            questionAuthority: "owner_fixed",
            criterion: "Is this response safe and correct?",
            positiveLabel: "Approve",
            negativeLabel: "Reject",
            rationaleMode: "required",
            audience: "private_invited",
            contentBoundary: "private_workspace",
            privateSensitivity: "confidential",
            privateGroupId,
            responseWindowSeconds: 3_600,
            panelSize: 2,
            compensationMode: "unpaid",
            bountyPerSeatAtomic: null,
            feedbackBonusEnabled: false,
          },
          authority: "ask_automatically",
          publishingGrant: {
            integrationId,
            provision: "private_invited_unpaid",
            allowedWorkflowKeys: ["general-assistance"],
          },
        },
      },
    );
    expect(configured).toMatchObject({
      blockingReason: null,
      capability: { available: true },
      configuration: {
        authority: "ask_automatically",
        requestProfile: { value: { audience: "private_invited", panelSize: 2, compensationMode: "unpaid" } },
      },
      connection: { safeAccess: { canPublish: true, canSpend: false, canReadPrivateArtifacts: false } },
    });

    const agentContext = await mcp.call("rateloop_get_agent_context", {});
    expect(agentContext).toMatchObject({
      humanReview: { authority: "ask_automatically" },
      capabilities: { effectiveLane: { lane: "private_invited_unpaid" } },
      publishingGrant: { active: true },
      safeAccess: { canPublish: true, canSpend: false, canReadPrivateArtifacts: false },
    });
    const reviewPolicy = object(agentContext.reviewPolicy, "Agent review policy");
    const audiencePolicyHash = string(reviewPolicy.audiencePolicyHash, "Audience policy hash");
    const externalOpportunityId = `hosted-private-${runId}`;
    const evaluation = await mcp.call("rateloop_evaluate_review_requirement", {
      externalOpportunityId,
      workflowKey: "general-assistance",
      riskTier: "high",
      audiencePolicyHash,
      suggestionCommitment: sha256Commitment(suggestionPayload),
      sourceEvidence: {
        reference: `hosted-e2e/${runId}/source`,
        hash: sha256Commitment(sourcePayload),
      },
      declaredConfidenceBps: 8_500,
      criticalRisk: false,
      metadataComplete: true,
      execution: {
        externalExecutionId: `hosted-execution-${runId}`,
        status: "completed",
        primarySpanId: "generation-primary",
        generationSpans: [
          {
            spanId: "generation-primary",
            role: "primary",
            provider: "OpenAI",
            requestedModel: "gpt-test",
            resolvedModel: "gpt-test-hosted",
            reasoningEffort: "low",
            serviceTier: "default",
            inputTokens: 120,
            outputTokens: 40,
            reasoningOutputTokens: 10,
          },
        ],
      },
    });
    expect(evaluation).toMatchObject({
      decision: "required",
      lifecycle: { state: "request_ready", terminal: false },
    });
    expect(object(evaluation.lifecycle, "Review lifecycle").reasonCodes).toContain("private_invited_unpaid_lane_ready");
    const opportunityId = string(evaluation.opportunityId, "Opportunity ID");

    const routed = await mcp.call("rateloop_request_review", {
      opportunityId,
      sourcePayload,
      suggestionPayload,
      material: {
        kind: "private",
        sourceContentType: "application/json; charset=utf-8",
        suggestionContentType: "application/json; charset=utf-8",
      },
    });
    expect(routed).toMatchObject({ action: "private_review_assigned" });
    const delivery = object(routed.delivery, "Private review delivery");
    if (!Array.isArray(delivery.assignments) || delivery.assignments.length !== 2) {
      throw new Error("Private review routing did not create exactly two assignments.");
    }
    const assignments = delivery.assignments.map((value, index) => {
      const assignment = object(value, `Private assignment ${index + 1}`);
      return {
        assignmentId: string(assignment.assignmentId, "Private assignment ID"),
        reviewerAccountAddress: string(assignment.reviewerAccountAddress, "Private reviewer account"),
      };
    });
    expect(new Set(assignments.map(assignment => assignment.reviewerAccountAddress)).size).toBe(2);

    for (const role of ["reviewerOne", "reviewerTwo"] as HostedAuthRole[]) {
      const reviewerSession = await auth.session(role);
      const expectedAssignment = assignments.find(
        assignment => assignment.reviewerAccountAddress === reviewerSession.principalId,
      );
      if (!expectedAssignment) throw new Error(`The ${role} principal did not receive its exact private assignment.`);
      const queue = await browserJson(auth.context(role), "GET", "/api/account/assurance/assignments?q=&view=active");
      if (!Array.isArray(queue.assignments) || queue.assignments.length !== 1) {
        throw new Error(`${role} must be a dedicated account with exactly one active hosted assignment.`);
      }
      expect(object(queue.assignments[0], `${role} assignment`).assignmentId).toBe(expectedAssignment.assignmentId);
      const page = await auth.context(role).newPage();
      await submitPrivateApproval(page, sourcePayload, suggestionPayload);
      await page.close();
    }

    const terminal = await poll(async () => {
      const result = await mcp.call("rateloop_get_review_result", { opportunityId });
      const lifecycle = object(result.lifecycle, "Terminal review lifecycle");
      return lifecycle.terminal === true ? result : null;
    });
    expect(terminal).toMatchObject({
      lifecycle: { state: "completed", terminal: true },
      route: { lane: "private_unpaid", authority: "ask_automatically" },
    });
    const rawResult = object(terminal.rawResult, "Raw review result");
    expect(rawResult).toMatchObject({
      schemaVersion: "rateloop.adaptive-review-result.v1",
      result: {
        schemaVersion: "rateloop.human-review-result.v1",
        outcome: "positive",
        panel: { requestedCount: 2, assignedCount: 2, responseCount: 2 },
      },
    });

    const completedRun = await poll(async () => {
      const evaluations = await browserJson(
        owner,
        "GET",
        `/api/account/workspaces/${encodeURIComponent(workspaceId!)}/evaluations`,
      );
      if (!Array.isArray(evaluations.runs)) return null;
      const candidate = evaluations.runs.find(value => {
        const run = object(value, "Evaluation run");
        return (
          run.status === "completed" &&
          run.reviewerSource === "customer_invited" &&
          run.compensation === "unpaid" &&
          run.validResponses === 2 &&
          run.distinctReviewers === 2
        );
      });
      return candidate ? object(candidate, "Completed evaluation run") : null;
    });
    expect(completedRun).toMatchObject({
      status: "completed",
      reviewerSource: "customer_invited",
      compensation: "unpaid",
      validResponses: 2,
      distinctReviewers: 2,
    });

    const evidencePage = await owner.newPage();
    await evidencePage.goto(`/agents?tab=evidence&workspace=${encodeURIComponent(workspaceId)}`);
    await expect(evidencePage.getByRole("heading", { name: "Decision records and exports" })).toBeVisible();
    await evidencePage.close();

    const auditResponse = await owner.request.get(
      `/api/account/workspaces/${encodeURIComponent(workspaceId)}/audit/export`,
      { failOnStatusCode: false },
    );
    expect(auditResponse.status()).toBe(200);
    expect(auditResponse.headers()["content-disposition"]).toContain("rateloop-audit.json");
    const audit = await auditResponse.json();
    const auditVerification = verifyAuditExport(audit);
    expect(auditVerification.valid).toBe(true);
    expect(auditVerification.eventCount).toBeGreaterThan(0);
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanupFailures: unknown[] = [];
    const owner = auth.context("owner");
    if (workspaceId && integrationId) {
      await browserJson(
        owner,
        "DELETE",
        `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-integrations/${encodeURIComponent(integrationId)}`,
      ).catch(error => cleanupFailures.push(error));
    }
    if (workspaceId) {
      await browserJson(owner, "POST", `/api/account/workspaces/${encodeURIComponent(workspaceId)}/deletion`, {
        body: { confirmation: "DELETE" },
        statuses: [202],
      }).catch(error => cleanupFailures.push(error));
    }
    await auth.cleanup().catch(error => cleanupFailures.push(error));
    if (primaryFailure === null && cleanupFailures.length > 0) {
      throw new Error("Hosted E2E cleanup failed.");
    }
  }
});
