import { authenticate, browserState, expectNoAxeViolations, json } from "../fixtures";
import { expect, test } from "@playwright/test";

const hash = `sha256:${"a".repeat(64)}`;
const future = "2030-07-17T12:00:00.000Z";

test("setup wizard creates a workspace and reaches agent connection", async ({ page }) => {
  test.slow();
  await authenticate(page, browserState.setupSessionToken);
  await page.goto("/agents");
  const setupHeading = page.getByRole("heading", { name: "Name your workspace" });
  const connectHeading = page.getByRole("heading", { name: "Connect your agent" });
  await expect(setupHeading.or(connectHeading)).toBeVisible();
  if (await setupHeading.isVisible()) {
    await expectNoAxeViolations(page);
    await page.getByLabel("Workspace name").fill("Playwright setup workspace");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/agents\?workspace=.+&step=connect/u);
  }
  await expect(connectHeading).toBeVisible();
  await expect(page.getByRole("link", { name: /Connection guide/ })).toHaveAttribute("href", "/docs/connect");
  await expectNoAxeViolations(page);
});

test("workspace owner configures human review", async ({ page }) => {
  test.slow();
  await authenticate(page, browserState.ownerSessionToken);
  await page.goto(`/agents?tab=registry&workspace=${browserState.workspaceId}`);
  await expect(page.getByRole("heading", { name: "Human review" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Edit reviews" })).toHaveCount(0);
  await expect(page.getByText("Review configuration", { exact: true })).toHaveCount(0);
  const frequency = page.getByRole("combobox", { name: "When should RateLoop require human review?" });
  await expect(frequency).toBeVisible();
  await frequency.selectOption("always");
  await page.getByRole("combobox", { name: /^Reviewers/u }).selectOption("private_invited");
  await page.getByRole("combobox", { name: /^Guaranteed bounty/u }).selectOption("unpaid");
  await page.getByRole("radio", { name: "Check only" }).check();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("configuration saved");
  await expect(frequency).toHaveValue("always");
  await expectNoAxeViolations(page);
});

test("reviewer answers a public task and restores the draft", async ({ page }) => {
  let networkAssignmentAccepted = false;
  await authenticate(page, browserState.ownerSessionToken);
  await page.route("**/api/rater/tasks?**", route =>
    json(route, {
      paidAccess: { state: "ready" },
      tasks: [
        {
          operationKey: "browser-public-review",
          chainId: 84532,
          panelAddress: `0x${"1".repeat(40)}`,
          roundId: "42",
          contentId: `0x${"2".repeat(64)}`,
          reviewerSource: "rateloop_network",
          assignmentId: "network_assignment_playwright_01",
          assignmentStatus: networkAssignmentAccepted ? "accepted" : "reserved",
          assignmentExpiresAt: future,
          confidentialityTermsHash: hash,
          selectionBindingHash: hash,
          question: {
            kind: "binary",
            prompt: "Is this response ready to publish?",
            positiveLabel: "Approve",
            negativeLabel: "Reject",
            rationale: { mode: "optional", maxLength: 500 },
          },
          voucherDeadline: future,
          alreadyVouchered: false,
          earnings: {
            guaranteedBaseAtomic: "1000000",
            possibleBonusAtomic: "500000",
            possibleSurpriseBonusAtomic: "250000",
            attemptCompensationAtomic: "100000",
          },
          disclosureBeacon: { network: "quicknet-t", round: 1 },
          scoringBeacon: { network: "quicknet-t", round: 2 },
        },
      ],
    }),
  );
  await page.route("**/api/account/assurance/assignments?**", route =>
    json(route, { principalId: browserState.ownerPrincipalId, assignments: [] }),
  );
  await page.route("**/api/account/assurance/assignments/network_assignment_playwright_01/accept", route => {
    networkAssignmentAccepted = true;
    return json(route, {
      assignmentId: "network_assignment_playwright_01",
      accepted: true,
      replay: false,
      leases: [],
    });
  });
  await page.goto("/human?scope=public");
  await expect(page.getByRole("heading", { name: "Accept this funded review before opening it" })).toBeVisible();
  await page.getByRole("checkbox", { name: /accept the exact public paid-review terms/iu }).check();
  await page.getByRole("button", { name: "Accept and open review" }).click();
  await expect(page.getByRole("heading", { name: "Is this response ready to publish?" })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("button", { name: "Add feedback" }).click();
  await page
    .getByRole("textbox", { name: "Feedback" })
    .fill("The conclusion follows from the supplied public evidence.");
  await page.getByLabel(/What percentage of reviewers/u).fill("70");
  await expect(page.getByRole("button", { name: "Create recovery backup" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/What percentage of reviewers/u)).toHaveValue("70");
  await expect(page.getByRole("textbox", { name: "Feedback" })).toHaveValue(/supplied public evidence/u);
});

test("invited reviewer sees exact agent content and rates it directly in Discover", async ({ page }) => {
  const assignmentId = `hpua_${"1".repeat(40)}`;
  const source = "User asked whether the release passed its deployment checks.";
  const agentOutput = "The agent reported that type checking, tests, and the production build all passed.";
  let submitted = false;
  await authenticate(page, browserState.ownerSessionToken);
  await page.route("**/api/account/assurance/assignments?**", route =>
    json(route, {
      principalId: browserState.ownerPrincipalId,
      assignments: submitted
        ? []
        : [
            {
              assignmentId,
              projectName: "Agent deployment check",
              dataClassification: "confidential",
              source: "customer_invited",
              status: "reserved",
              paidAssignment: false,
              confidentialityTermsHash: hash,
              assignmentExpiresAt: future,
              caseCount: 1,
            },
          ],
    }),
  );
  await page.route("**/api/rater/tasks?**", route => json(route, { paidAccess: { state: "ready" }, tasks: [] }));
  await page.route(`**/api/account/assurance/assignments/${assignmentId}/accept?terms=*`, route =>
    json(route, {
      assignmentId,
      state: "ready",
      termsAccepted: false,
      terms: {
        groupName: "Deployment reviewers",
        purpose: "Review the assigned agent output without sharing it.",
        policy: {
          schemaVersion: "rateloop.private-group-policy.v2",
          dataClassifications: ["confidential"],
          exportAllowed: false,
        },
      },
      responseDeadline: future,
    }),
  );
  await page.route(`**/api/account/assurance/assignments/${assignmentId}/accept?includeTask=1`, route =>
    json(route, {
      acceptance: { accepted: true },
      task: {
        assignmentId,
        runId: "run_playwright_private_01",
        source: "customer_invited",
        runManifestHash: hash,
        policyHash: hash,
        qualificationProvenance: [],
        taskKind: "binary_review",
        compensationMode: "unpaid",
        forecastRequired: true,
        settlement: null,
        rubric: {
          prompt: "Is this response safe and correct?",
          failureTags: [],
          rationale: { mode: "off", minLength: 0, maxLength: 500 },
        },
        cases: [
          {
            caseId: "case_playwright_01",
            position: 0,
            title: "Review the agent output",
            instructions: "Is this response safe and correct?",
            options: [],
            context: [],
            objectiveReference: null,
            binaryReview: {
              positiveLabel: "Approve",
              negativeLabel: "Reject",
              source: {
                artifactId: "artifact_source",
                leaseId: "lease_source",
                expiresAt: future,
                contentType: "text/plain",
              },
              suggestion: {
                artifactId: "artifact_output",
                leaseId: "lease_output",
                expiresAt: future,
                contentType: "text/plain",
              },
            },
          },
        ],
      },
    }),
  );
  await page.route(`**/api/account/assurance/assignments/${assignmentId}/artifacts/artifact_source?*`, route =>
    route.fulfill({ status: 200, contentType: "text/plain", body: source }),
  );
  await page.route(`**/api/account/assurance/assignments/${assignmentId}/artifacts/artifact_output?*`, route =>
    route.fulfill({ status: 200, contentType: "text/plain", body: agentOutput }),
  );
  await page.route(`**/api/account/assurance/assignments/${assignmentId}/responses`, route => {
    submitted = true;
    return json(route, {
      accepted: true,
      replay: false,
      responseCount: 1,
      compensation: "unpaid",
      settlementStatus: "not_applicable",
    });
  });
  await page.goto("/human?scope=private");
  await expect(page.getByRole("heading", { name: "Agent deployment check" })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept terms and begin" }).click();
  await expect(page.getByText(source)).toBeVisible();
  await expect(page.getByText(agentOutput)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open private artifact" })).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.getByRole("radio", { name: "Approve" }).check();
  await page.getByRole("spinbutton", { name: "Crowd forecast" }).fill("65");
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByRole("status")).toContainText("Review submitted");
  await expect(page.getByText(source)).toHaveCount(0);
  await expect(page.getByText(agentOutput)).toHaveCount(0);
  await page.getByRole("button", { name: "Review next assignment" }).click();
  await expect(page.getByText("No review work is available right now.")).toBeVisible();
});

test("owner approves a request and prepares its human feedback award", async ({ page }) => {
  const approval = {
    approvalId: "approval_playwright_01",
    revision: 1,
    status: "pending",
    lifecycleRevision: 1,
    preparedRequestHash: hash,
    derivedEconomicsHash: hash,
    createdAt: "2026-07-17T10:00:00.000Z",
    expiresAt: future,
    preparedRequest: {
      schemaVersion: "rateloop.human-review-prepared-request.v1",
      opportunityId: "opportunity_playwright_01",
      workflowKey: "release-gate",
      requestProfile: { id: "profile_playwright", version: 1, hash },
      question: {
        criterion: "Is this release ready?",
        positiveLabel: "Approve",
        negativeLabel: "Reject",
        rationaleMode: "required",
      },
      audience: {
        kind: "public_network",
        contentBoundary: "public_or_test",
        privateSensitivity: null,
        privateGroupId: null,
      },
      timing: { responseWindowSeconds: 3600, expiresAt: future },
      panel: { size: 3 },
      contentCommitments: { source: hash, suggestion: hash },
      provenance: {
        agentId: browserState.agentId,
        agentVersionId: "version_playwright",
        selectionPolicyId: "policy_playwright",
        selectionPolicyVersion: 1,
      },
    },
    economics: {
      schemaVersion: "rateloop.human-review-derived-economics.v1",
      compensationMode: "usdc",
      bountyPerSeatAtomic: "1000000",
      panelSize: 3,
      baseBountyAtomic: "3000000",
      feeBps: 1000,
      feeAtomic: "300000",
      attemptReserveAtomic: "1000000",
      maximumChargeAtomic: "4300000",
    },
    feedbackBonusEconomics: {
      schemaVersion: "rateloop.feedback-bonus-economics.v1",
      enabled: true,
      currency: "USDC",
      poolAtomic: "2000000",
      awarder: { kind: "requester", account: null },
      awardWindowSeconds: 604800,
      agentMayAward: false,
    },
    maximumConsentAtomic: "6300000",
  };
  const bonus = {
    workspaceId: browserState.workspaceId,
    opportunityId: "opportunity_playwright_01",
    feedbackId: "feedback_playwright_01",
    feedbackBody: "This answer caught a missing release rollback check.",
    responseHash: hash,
    payoutCommitment: `0x${"3".repeat(64)}`,
    remainingPoolAtomic: "2000000",
    depositedPoolAtomic: "2000000",
    feedbackDeadline: "2026-07-17T09:00:00.000Z",
    awardDeadline: future,
    pool: { chainId: "84532", contractAddress: `0x${"4".repeat(40)}`, poolId: `0x${"5".repeat(64)}` },
  };
  await authenticate(page, browserState.ownerSessionToken);
  await page.route("**/human-review/approvals", route => json(route, { approvals: [approval] }));
  await page.route("**/human-review/approvals/*", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    return json(route, { approval: { ...approval, status: "approved", revision: 2 } });
  });
  let bonusAwarded = false;
  await page.route("**/feedback-bonus", route => json(route, { items: bonusAwarded ? [] : [bonus] }));
  await page.route("**/feedback-bonus/*", route => {
    bonusAwarded = true;
    return json(route, { status: "confirmed" });
  });
  await page.goto(`/agents?tab=inbox&workspace=${browserState.workspaceId}`);
  await expect(page.getByRole("heading", { name: "Requests awaiting approval" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Award Feedback Bonus" })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved and ready for the request adapter.")).toBeVisible();
  await page.getByLabel("Award amount (USDC)").fill("1.5");
  await page.getByRole("button", { name: "Award this feedback" }).click();
  await expect(page.getByText("No feedback bonuses need an award.")).toBeVisible();
});

test("workspace owner inspects and exports a signed decision packet", async ({ page }) => {
  const runId = "run_playwright_evidence_01";
  const packetId = "packet_playwright_evidence_01";
  const keyId = "evidence-key-playwright-01";
  const packetDigest = `sha256:${"6".repeat(64)}`;
  const packet = {
    packetDigest,
    payload: {
      packetId,
      runId,
      generatedAt: "2026-07-17T12:00:00.000Z",
      aggregation: {
        suite: { outcome: "pass" },
        reviewerCoverage: {
          sourceSubpanels: [
            {
              source: "customer_invited",
              targetReviewerCount: 3,
              assignedReviewerCount: 3,
              paidReviewerCount: 0,
              respondingReviewerCount: 3,
              completeJudgmentSetReviewerCount: 3,
            },
          ],
        },
      },
      reviewContext: {
        selectionTrigger: { kind: "release_gate" },
        gate: { type: "blocking" },
        reviewerQualifications: {
          minimumAggregationSize: 2,
          categories: [{ key: "release-engineering", reviewerCount: 3, suppressed: false }],
          unqualified: { reviewerCount: 0, suppressed: true },
        },
      },
      settlement: {
        mode: "unpaid",
        statement: "No reviewer compensation was due for this invited private panel.",
        links: [],
      },
    },
    signing: {
      algorithm: "Ed25519",
      keyId,
      publicKey: "MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    },
  };

  await authenticate(page, browserState.ownerSessionToken);
  await page.route("**/evaluations", route =>
    json(route, {
      workspaceId: browserState.workspaceId,
      callerRole: "owner",
      canViewPublishingPolicies: true,
      attributionReady: false,
      summary: { totalRuns: 1, completedRuns: 1, evidenceBackedRuns: 1, validResponses: 3, attributedRuns: 0 },
      agents: [],
      modelProfiles: [],
      deciderTrend: { clientDecisions: { total: 0, goCount: 0 }, overrides: { total: 0, acceptedCount: 0 } },
      publishingPolicies: [],
      runs: [
        {
          runId,
          projectId: "project_playwright_evidence_01",
          projectName: "Release controls",
          suiteName: "Production readiness",
          status: "completed",
          reviewerSource: "customer_invited",
          compensation: "unpaid",
          caseCount: 1,
          calibrationCaseCount: 0,
          mechanismHealth: null,
          validResponses: 3,
          distinctReviewers: 3,
          minimumAggregationSize: 2,
          sampleStatus: "sufficient",
          candidateSelectionShareBps: 10_000,
          candidateSelectionIntervalBps: { lower: 4_383, upper: 10_000 },
          choices: { baseline: 0, candidate: 3, tie: 0 },
          clientDecision: "go",
          evidencePacketAvailable: true,
          evidencePacketDigest: packetDigest,
          explanationRequired: false,
          createdAt: "2026-07-17T11:00:00.000Z",
          completedAt: "2026-07-17T12:00:00.000Z",
          attribution: { status: "unattributed", agentId: null, versionId: null },
        },
      ],
    }),
  );
  await page.route(`**/assurance/runs/${runId}/evidence`, route => json(route, packet));
  await page.route("**/assurance/attestations?**", route =>
    json(route, {
      attestations: [
        {
          jobId: "attestation_playwright_01",
          artifactKind: "evidence_packet",
          artifactDigest: packetDigest,
          state: "completed",
          signerKeyId: "attestation-signer-playwright-01",
          rekor: { entryUuid: "rekor-playwright-01", logIndex: "42" },
          rfc3161TimestampPresent: true,
          boundaryAt: "2026-07-17T12:01:00.000Z",
          lastError: null,
        },
      ],
    }),
  );
  await page.route("**/assurance/retention", route =>
    json(route, {
      version: 1,
      evidenceRetentionMonths: 36,
      auditRetentionMonths: 36,
      minimumRetentionMonths: 12,
      effectiveAt: "2026-07-17T12:00:00.000Z",
      basis: { reasons: ["workspace_policy"] },
    }),
  );
  await page.route("**/assurance/trusted-keys", route =>
    json(route, {
      keys: [
        {
          keyId,
          status: "current",
          publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
          publicKeySpki: "MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          uses: ["evidence_packet"],
          firstPacketAt: "2026-07-17T12:00:00.000Z",
          lastPacketAt: "2026-07-17T12:00:00.000Z",
          packetCount: 1,
        },
      ],
      untrustedPacketKeyCount: 0,
    }),
  );
  await page.route("**/assurance/worm/destination", route => json(route, { active: null }));
  await page.route("**/assurance/worm/exports", route => json(route, { jobs: [] }));
  await page.route("**/assurance/event-streams", route => json(route, { streams: [] }));
  await page.route("**/assurance/grc-connectors", route => json(route, { connectors: [] }));
  await page.route("**/assurance/metrics/credentials", route => json(route, { credentials: [] }));

  await page.goto(`/agents?tab=evidence&workspace=${browserState.workspaceId}`);
  await expect(page.getByRole("heading", { name: "Decision records and exports" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Production readiness" })).toBeVisible();
  await expect(page.getByText("release gate")).toBeVisible();
  await expect(page.getByText("blocking")).toBeVisible();
  await expect(page.getByText(/3 of 3 assigned; 3 responded; 3 complete; 0 paid/iu)).toBeVisible();
  await expect(page.getByText(/release-engineering \(3\)/u)).toBeVisible();
  await expect(page.getByText(/No reviewer compensation was due/iu)).toBeVisible();
  await expect(page.getByText("Transparency receipt recorded")).toBeVisible();
  await page.getByText("Anchor details", { exact: true }).click();
  await expect(page.getByText("rekor-playwright-01")).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit log" })).toHaveAttribute(
    "href",
    `/api/account/workspaces/${browserState.workspaceId}/audit/export`,
  );
  await expectNoAxeViolations(page);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export packet" }).click();
  await expect((await download).suggestedFilename()).toBe(`rateloop-evidence-${packetId}.json`);
});
