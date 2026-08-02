import { authenticate, browserState, json } from "../fixtures";
import { expect, test } from "@playwright/test";

const hash = `sha256:${"a".repeat(64)}`;
const future = "2030-07-17T12:00:00.000Z";

async function expectInsideViewport(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

test("a mobile invited reviewer can expand the complete long private artifact", async ({ page }) => {
  const assignmentId = `hpua_${"7".repeat(40)}`;
  const finalMarker = "END OF PRIVATE ARTIFACT — reviewer must see this.";
  const source = `${"Deployment evidence and exception context. ".repeat(45)}${finalMarker}`;
  await authenticate(page, browserState.ownerSessionToken);
  await page.route("**/api/rater/tasks?**", route => json(route, { paidAccess: { state: "ready" }, tasks: [] }));
  await page.route("**/api/account/assurance/assignments?**", route =>
    json(route, {
      principalId: browserState.ownerPrincipalId,
      assignments: [
        {
          assignmentId,
          projectName: "Mobile private artifact",
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
        groupName: "Mobile reviewers",
        purpose: "Review the complete private artifact without sharing it.",
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
        runId: "run_mobile_private_01",
        source: "customer_invited",
        runManifestHash: hash,
        policyHash: hash,
        qualificationProvenance: [],
        taskKind: "binary_review",
        compensationMode: "unpaid",
        forecastRequired: true,
        settlement: null,
        rubric: {
          prompt: "Is this complete artifact safe and correct?",
          failureTags: [],
          rationale: { mode: "off", minLength: 0, maxLength: 500 },
        },
        cases: [
          {
            caseId: "case_mobile_private_01",
            position: 0,
            title: "Read the complete artifact",
            instructions: "Inspect all private evidence before rating.",
            options: [],
            context: [],
            objectiveReference: null,
            binaryReview: {
              positiveLabel: "Approve",
              negativeLabel: "Reject",
              source: {
                artifactId: "artifact_mobile_long",
                leaseId: "lease_mobile_long",
                expiresAt: future,
                contentType: "text/plain",
              },
              suggestion: {
                artifactId: "artifact_mobile_short",
                leaseId: "lease_mobile_short",
                expiresAt: future,
                contentType: "text/plain",
              },
            },
          },
        ],
      },
    }),
  );
  await page.route(`**/api/account/assurance/assignments/${assignmentId}/artifacts/artifact_mobile_long?*`, route =>
    route.fulfill({ status: 200, contentType: "text/plain", body: source }),
  );
  await page.route(`**/api/account/assurance/assignments/${assignmentId}/artifacts/artifact_mobile_short?*`, route =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "Short candidate answer." }),
  );

  await page.goto("/human?scope=private");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept terms and begin" }).click();
  await expect(page.getByRole("button", { name: "Show more" })).toBeVisible();
  await expect(page.getByText(finalMarker)).toHaveCount(0);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(page.getByRole("dialog", { name: "Source" })).toContainText(finalMarker);
  await expectInsideViewport(page);
});

test("mobile question images stack and recovery confirmation waits for a successful share", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new Error("Mobile share was rejected.");
      },
    });
  });
  await authenticate(page, browserState.ownerSessionToken);
  await page.route("**/api/account/assurance/assignments?**", route =>
    json(route, { principalId: browserState.ownerPrincipalId, assignments: [] }),
  );
  await page.route("**/api/public-media/images/*", route =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#3857d6"/></svg>',
    }),
  );
  await page.route("**/api/rater/tasks?**", route =>
    json(route, {
      paidAccess: { state: "ready" },
      tasks: [
        {
          operationKey: "mobile-public-review",
          chainId: 84532,
          panelAddress: `0x${"1".repeat(40)}`,
          roundId: "4242",
          contentId: `0x${"2".repeat(64)}`,
          reviewerSource: "customer_invited",
          question: {
            kind: "binary",
            prompt: "Do both mobile images support this conclusion?",
            positiveLabel: "Approve",
            negativeLabel: "Reject",
            rationale: { mode: "off" },
            media: {
              kind: "images",
              items: [
                { alt: "First mobile artifact", assetId: "media_mobile_1", digest: hash },
                { alt: "Second mobile artifact", assetId: "media_mobile_2", digest: hash },
              ],
            },
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

  await page.goto("/human?scope=public");
  const images = page.getByRole("button", { name: /Open image/u });
  await expect(images).toHaveCount(2);
  const [firstBox, secondBox] = await Promise.all([images.nth(0).boundingBox(), images.nth(1).boundingBox()]);
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(secondBox!.y).toBeGreaterThanOrEqual(firstBox!.y + firstBox!.height - 1);

  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("spinbutton", { name: /What percentage of reviewers/u }).fill("70");
  await page.getByRole("button", { name: "Create recovery backup" }).click();
  const save = page.getByRole("link", { name: "Download recovery backup" });
  const confirmation = page.getByRole("checkbox", { name: "I saved the recovery backup" });
  await save.click();
  await expect(page.getByText("The recovery backup could not be saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("Mobile share was rejected.", { exact: true })).toHaveCount(0);
  await expect(confirmation).toBeDisabled();

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (value: ShareData) => {
        (window as typeof window & { __sharedRecoveryFiles?: number }).__sharedRecoveryFiles = value.files?.length ?? 0;
      },
    });
  });
  await save.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __sharedRecoveryFiles?: number }).__sharedRecoveryFiles),
    )
    .toBe(1);
  await expect(confirmation).toBeEnabled();
  await confirmation.click();
  await expect(page.getByRole("status")).toContainText("Backup confirmed");
  await expectInsideViewport(page);
});
