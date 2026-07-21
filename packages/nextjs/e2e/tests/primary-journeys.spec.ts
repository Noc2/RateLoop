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
  await frequency.selectOption({ label: "Every output" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("configuration saved");
  await expect(frequency).toHaveValue("always");
  await expectNoAxeViolations(page);
});

test("reviewer answers a public task and restores the draft", async ({ page }) => {
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
  await page.route("**/api/account/assurance/assignments?**", route => json(route, { assignments: [] }));
  await page.goto("/human?scope=public");
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
        forecastRequired: false,
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
  await page.getByLabel("Feedback Bonus award amount").fill("1.5");
  await page.getByRole("button", { name: "Award this feedback" }).click();
  await expect(page.getByText("No feedback bonuses need an award.")).toBeVisible();
});
