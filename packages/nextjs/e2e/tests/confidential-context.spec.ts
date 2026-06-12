import { expect, test } from "../fixtures/wallet";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import {
  continueToBountyStep,
  continueToFeedbackBonusStep,
  selectAskCategory,
  selectAskSubcategory,
} from "../helpers/ask-form";
import {
  acceptConfidentialityTerms,
  approveConfidentialityBondSpender,
  banConfidentialityIdentity,
  createPrivateAccountReadSessionCookie,
  ensureHumanCredential,
  fetchGatedAttachment,
  postConfidentialityBond,
  postConfidentialityBondDirect,
  submitGatedQuestion,
  unbanConfidentialityIdentity,
} from "../helpers/confidentiality";
import { voteOnSpecificContent } from "../helpers/vote-helpers";
import { gotoWithRetry } from "../helpers/wait-helpers";
import { setupWallet } from "../helpers/wallet-session";

/**
 * Confidential private-context coverage.
 *
 * Account allocation:
 * - Account #2 submits the private question through the browser UI.
 * - Account #3 is a credentialed zero-bond viewer.
 */
test.describe("Confidential context", () => {
  test.describe.configure({ mode: "serial" });

  test("zero-bond browser submission links private details and serves them to authorized viewers", async ({
    connectedPage: page,
  }) => {
    test.setTimeout(180_000);

    const uniqueId = Date.now();
    const description = `Private launch-review notes ${uniqueId}: compare the unreleased prototype copy against the current positioning.`;
    const submitted = await submitGatedQuestion(page, {
      description,
      title: `Private context e2e ${uniqueId}`,
    });

    expect(submitted.detailsUrl, "browser submission should expose the captured details upload URL").toBeTruthy();

    await ensureHumanCredential(page, ANVIL_ACCOUNTS.account2);
    await gotoWithRetry(page, `/rate?content=${submitted.contentId}`, { ensureWalletConnected: true });
    await expect(page.getByText("Confirm wallet to view your private context")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Confirm wallet" }).click();

    const ownerDetails = await fetchGatedAttachment(page.request, submitted.detailsUrl!, {
      address: ANVIL_ACCOUNTS.account2.address,
      expectedStatus: 200,
    });
    expect(await ownerDetails.text()).toBe(description);
    await expect(
      page.getByText(/Your question|cannot vote on your own question/i).first(),
      "owner should not be able to vote on their own private question",
    ).toBeVisible({ timeout: 20_000 });

    await ensureHumanCredential(page, ANVIL_ACCOUNTS.account3);
    const viewerCookie = await acceptConfidentialityTerms(page.request, ANVIL_ACCOUNTS.account3, {
      contentId: submitted.contentId,
    });
    const viewerDetails = await fetchGatedAttachment(page.request, submitted.detailsUrl!, {
      address: ANVIL_ACCOUNTS.account3.address,
      cookie: viewerCookie,
      expectedStatus: 200,
    });
    expect(await viewerDetails.text()).toBe(description);
  });

  test("bonded private details fail closed through the real contract denial matrix", async ({
    connectedPage: page,
  }) => {
    test.setTimeout(240_000);

    const uniqueId = Date.now();
    const description = `Bonded private-context denial notes ${uniqueId}`;
    const submitted = await submitGatedQuestion(page, {
      bondAmount: "1",
      description,
      title: `Bonded private context e2e ${uniqueId}`,
    });
    expect(submitted.detailsUrl).toBeTruthy();

    const noSession = await fetchGatedAttachment(page.request, submitted.detailsUrl!, {
      address: ANVIL_ACCOUNTS.account4.address,
      expectedStatus: 401,
    });
    await expect(noSession.json()).resolves.toEqual({ error: "Signed wallet session required" });

    const readSessionOnlyCookie = await createPrivateAccountReadSessionCookie(page.request, ANVIL_ACCOUNTS.account4);
    const noTerms = await fetchGatedAttachment(page.request, submitted.detailsUrl!, {
      address: ANVIL_ACCOUNTS.account4.address,
      cookie: readSessionOnlyCookie,
      expectedStatus: 403,
    });
    await expect(noTerms.json()).resolves.toEqual({ error: "Confidentiality terms acceptance required" });

    const noCredentialCookie = await acceptConfidentialityTerms(page.request, ANVIL_ACCOUNTS.account1, {
      contentId: submitted.contentId,
    });
    const noCredential = await fetchGatedAttachment(page.request, submitted.detailsUrl!, {
      address: ANVIL_ACCOUNTS.account1.address,
      cookie: noCredentialCookie,
      expectedStatus: 403,
    });
    await expect(noCredential.json()).resolves.toEqual({ error: "Active human credential required" });

    const noBondCookie = await acceptConfidentialityTerms(page.request, ANVIL_ACCOUNTS.account4, {
      contentId: submitted.contentId,
    });
    const noBond = await fetchGatedAttachment(page.request, submitted.detailsUrl!, {
      address: ANVIL_ACCOUNTS.account4.address,
      cookie: noBondCookie,
      expectedStatus: 403,
    });
    await expect(noBond.json()).resolves.toEqual({ error: "Active confidentiality bond required" });

    const approved = await approveConfidentialityBondSpender(ANVIL_ACCOUNTS.account4, 1_000_000n);
    expect(approved, "Bond poster should approve the confidentiality escrow").toBe(true);
    await postConfidentialityBondDirect(ANVIL_ACCOUNTS.account4, submitted.contentId);
    const withBond = await fetchGatedAttachment(page.request, submitted.detailsUrl!, {
      address: ANVIL_ACCOUNTS.account4.address,
      cookie: noBondCookie,
      expectedStatus: 200,
    });
    expect(await withBond.text()).toBe(description);

    try {
      await banConfidentialityIdentity(ANVIL_ACCOUNTS.account4);
      const banned = await fetchGatedAttachment(page.request, submitted.detailsUrl!, {
        address: ANVIL_ACCOUNTS.account4.address,
        cookie: noBondCookie,
        expectedStatus: 403,
      });
      await expect(banned.json()).resolves.toEqual({ error: "Confidentiality access revoked" });
    } finally {
      await unbanConfidentialityIdentity(ANVIL_ACCOUNTS.account4);
    }
  });

  test("viewer accepts terms, posts bond, sees private details, and can vote", async ({ connectedPage, browser }) => {
    test.setTimeout(300_000);

    const uniqueId = Date.now();
    const description = `Private vote unlock notes ${uniqueId}`;
    const submitted = await submitGatedQuestion(connectedPage, {
      bondAmount: "1",
      description,
      title: `Private vote unlock ${uniqueId}`,
    });

    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    try {
      await setupWallet(viewerPage, ANVIL_ACCOUNTS.account3.privateKey);
      await ensureHumanCredential(viewerPage, ANVIL_ACCOUNTS.account3);
      await gotoWithRetry(viewerPage, `/rate?content=${submitted.contentId}`, { ensureWalletConnected: true });

      const acceptTermsButton = viewerPage.getByRole("button", { name: "Accept terms" }).first();
      await expect(acceptTermsButton).toBeVisible({ timeout: 30_000 });
      await acceptTermsButton.click();
      await expect(viewerPage.getByRole("dialog", { name: /Confidential Context Access Terms/i })).toBeVisible({
        timeout: 10_000,
      });
      await viewerPage.getByRole("button", { name: "Accept with wallet" }).click();
      await expect(viewerPage.getByText("Confidentiality bond required").first()).toBeVisible({ timeout: 60_000 });

      await postConfidentialityBond(viewerPage, "LREP");
      await expect(viewerPage.getByText(description)).toBeVisible({ timeout: 90_000 });

      const voted = await voteOnSpecificContent(viewerPage, submitted.contentId, "up", {
        voterAddress: ANVIL_ACCOUNTS.account3.address,
        indexedTimeoutMs: 90_000,
      });
      expect(voted, "authorized private-context viewer should be able to commit a vote").toBe(true);
    } finally {
      await viewerContext.close();
    }
  });

  test("private context bundles are rejected before submission", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/ask", { ensureWalletConnected: true });
    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });

    const uniqueId = Date.now();
    const form = page.locator("form").first();
    await selectAskCategory(page);
    await form.getByLabel("Number of questions").fill("2");
    await form.getByLabel("Private context").check();
    await page.getByPlaceholder("Write a subjective question voters can rate").fill(`Private bundle Q1 ${uniqueId}`);
    await page
      .getByPlaceholder("Add context voters can expand before rating")
      .fill(`Private bundle details 1 ${uniqueId}`);
    await selectAskSubcategory(page);

    await page.getByRole("button", { name: /^Next Question/i }).click();
    await expect(page.getByText("Question 2 of 2")).toBeVisible({ timeout: 5_000 });
    await form.getByLabel("Private context").check();
    await page.getByPlaceholder("Write a subjective question voters can rate").fill(`Private bundle Q2 ${uniqueId}`);
    await page
      .getByPlaceholder("Add context voters can expand before rating")
      .fill(`Private bundle details 2 ${uniqueId}`);

    await continueToBountyStep(page);
    await continueToFeedbackBonusStep(page);
    await expect(page.getByRole("button", { name: /^No bonus$/i })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /^Submit/i }).click();
    await expect(page.getByText("Private context bundles are not supported yet")).toBeVisible({ timeout: 5_000 });
  });
});
