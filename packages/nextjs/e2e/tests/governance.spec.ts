import { expect, test } from "../fixtures/wallet";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import {
  acceptConfidentialityTerms,
  attachHostedQuestionDetails,
  banConfidentialityIdentity,
  ensureHumanCredential,
  fetchGatedAttachment,
  resolveConfidentialRater,
  seedAnchoredLogRootForViewToken,
  submitHostedGatedQuestionDirect,
  unbanConfidentialityIdentity,
  uploadGatedQuestionDetails,
  upsertQuestionConfidentialityForE2E,
} from "../helpers/confidentiality";
import { waitForPonderIndexed } from "../helpers/admin-helpers";
import { ponderGet } from "../helpers/ponder-api";
import { E2E_BASE_URL, E2E_RPC_URL } from "../helpers/service-urls";
import { gotoWithRetry, waitForFeedLoaded } from "../helpers/wait-helpers";
import { setupWallet } from "../helpers/wallet-session";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

async function topUpLocalEth(address: string): Promise<void> {
  const response = await fetch(E2E_RPC_URL, {
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "anvil_setBalance",
      params: [address, "0x21E19E0C9BAB2400000"],
      id: Date.now(),
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  expect(response.ok, "local Anvil balance top-up request should succeed").toBe(true);

  const body = await response.json();
  expect(body.error, "local Anvil balance top-up should not return an RPC error").toBeFalsy();
}

test.describe("Governance page", () => {
  test("page loads and shows tabs", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/governance", { ensureWalletConnected: true });
    await expect(page).toHaveURL(/\/governance(?:#.*)?$/);
    // Wait for main content to render before checking tabs
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

    // Account #2 has LREP, so should see all tabs (not just Faucet)
    const profileTab = page.getByRole("button", { name: "Profile", exact: true });
    const leaderboardTab = page.getByRole("button", { name: "Leaderboard" });
    const governanceTab = page.getByRole("button", { name: "Governance", exact: true });

    // At least one tab should be visible (tabs render after wallet state loads)
    const anyTab = profileTab.or(leaderboardTab).or(governanceTab);
    await expect(anyTab.first()).toBeVisible({ timeout: 30_000 });
    await expect(profileTab).toHaveClass(/pill-active/, { timeout: 10_000 });
  });

  test("leaderboard tab shows ranking filters", async ({ connectedPage: page }) => {
    const leaderboardTab = page.getByRole("button", { name: "Leaderboard" });
    await expect(async () => {
      await gotoWithRetry(page, "/governance", { ensureWalletConnected: true });
      await expect(leaderboardTab).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 5_000] });
    await leaderboardTab.click();

    await expect(page.getByText("Leaderboard")).toBeVisible({ timeout: 10_000 });
    const followingOnlyToggle = page.getByRole("button", { name: "Following Only" }).first();
    await expect(followingOnlyToggle).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("combobox", { name: "Time range" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("combobox", { name: "Filter by category" })).toBeVisible({ timeout: 10_000 });
    const sortBy = page.getByRole("combobox", { name: "Sort by" });
    await expect(sortBy).toBeVisible({ timeout: 10_000 });
    await expect(sortBy).toHaveValue("signalScore");

    const minVotes = page.getByRole("combobox", { name: "Minimum votes" });
    await expect(minVotes).toBeVisible({ timeout: 10_000 });
    await expect(minVotes).toHaveValue("5");
    await expect(minVotes.getByRole("option", { name: "Min 5 votes" })).toBeAttached();
  });

  test("zero-LREP onboarding explains launch credit paths", async ({ page }) => {
    test.setTimeout(120_000);

    const zeroLrepPrivateKey = generatePrivateKey();
    const zeroLrepAccount = privateKeyToAccount(zeroLrepPrivateKey);
    await topUpLocalEth(zeroLrepAccount.address);
    await setupWallet(page, zeroLrepPrivateKey);
    await gotoWithRetry(page, "/governance", { ensureWalletConnected: true });

    await expect(page.getByRole("heading", { name: "Start Building Reputation" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Verify As Human" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Earn LREP By Voting" })).toBeVisible();
    await expect(page.getByText("Launch Credits", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "eligible settled rounds" })).toHaveAttribute(
      "href",
      "/docs/how-it-works#eligible-settled-rounds",
    );

    const leaderboardTab = page.getByRole("button", { name: "Leaderboard", exact: true });
    await expect(leaderboardTab).toBeVisible();
    await leaderboardTab.click();
    await expect(page.getByRole("heading", { name: "Leaderboard", exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test("profile tab stays read-only until edit is clicked", async ({ browser }) => {
    const context = await newE2EContext(browser);
    const page = await context.newPage();

    await setupWallet(page, ANVIL_ACCOUNTS.account10.privateKey);
    await gotoWithRetry(page, "/governance#profile", { ensureWalletConnected: true });

    const editProfileButton = page.getByRole("button", { name: "Edit profile", exact: true });
    await expect(editProfileButton).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Profile name")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);

    const nameInput = page.getByLabel("Profile name");
    await expect(async () => {
      await editProfileButton.click({ timeout: 5_000 });
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });

    await context.close();
  });

  test("own public profile is editable directly", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, `/profiles/${ANVIL_ACCOUNTS.account2.address}`, { ensureWalletConnected: true });

    const profileEditorEntry = page
      .getByRole("button", { name: "Edit profile", exact: true })
      .or(page.getByLabel("Profile name"))
      .or(page.getByRole("link", { name: "Get rater credential", exact: true }));
    await expect(profileEditorEntry.first()).toBeVisible({ timeout: 15_000 });

    const editProfileButton = page.getByRole("button", { name: "Edit profile", exact: true });
    if (await editProfileButton.isVisible()) {
      const nameInput = page.getByLabel("Profile name");
      await expect(async () => {
        await editProfileButton.click({ timeout: 5_000 });
        await expect(nameInput).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
    }
  });

  test("governance tab shows governance content", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/governance", { ensureWalletConnected: true });

    // Click Governance tab (was previously "Vote", renamed in the tab UI)
    const governanceTabBtn = page.getByRole("button", { name: "Governance", exact: true });
    await expect(governanceTabBtn).toBeVisible({ timeout: 15_000 });
    await governanceTabBtn.click();

    // Governance tab shows treasury, proposal, delegation, and token surfaces.
    const govContent = page.locator("main").getByText(/treasury|proposal|delegate|token/i);
    await expect(govContent.first()).toBeVisible({ timeout: 15_000 });
  });

  test("breach report tab submits reports, opens prefilled actions, and shows sanctions", async ({
    connectedPage: page,
    browser,
  }) => {
    test.setTimeout(240_000);

    const credentialContext = await browser.newContext();
    const credentialPage = await credentialContext.newPage();
    try {
      await ensureHumanCredential(credentialPage, ANVIL_ACCOUNTS.account3);
    } finally {
      await credentialContext.close();
    }

    const accused = await resolveConfidentialRater(ANVIL_ACCOUNTS.account3);
    const uniqueId = Date.now();
    const privateDetails = await uploadGatedQuestionDetails(
      page.request,
      ANVIL_ACCOUNTS.account2,
      `Governance breach rooted evidence ${uniqueId}`,
    );
    const submitted = await submitHostedGatedQuestionDirect({
      description: `Governance breach rooted evidence ${uniqueId}`,
      detailsHash: privateDetails.detailsHash,
      detailsUrl: privateDetails.detailsUrl,
      title: `Governance breach evidence ${uniqueId}`,
    });
    await attachHostedQuestionDetails(page.request, submitted);
    await upsertQuestionConfidentialityForE2E({
      contentId: submitted.contentId,
      detailsHash: submitted.detailsHash,
      disclosurePolicy: "private_forever",
    });
    const contentId = submitted.contentId;
    const submittedDetailsUrl = submitted.detailsUrl;
    expect(submittedDetailsUrl, "submitted gated question should keep its hosted details URL").toBeTruthy();
    const accusedCookie = await acceptConfidentialityTerms(page.request, ANVIL_ACCOUNTS.account3, {
      contentId,
      detailsHash: submitted.detailsHash,
    });
    const accusedDetails = await fetchGatedAttachment(page.request, submittedDetailsUrl!, {
      address: ANVIL_ACCOUNTS.account3.address,
      cookie: accusedCookie,
      expectedStatus: 200,
    });
    const viewToken = accusedDetails.headers()["x-rateloop-view-token"] ?? "";
    expect(viewToken).toMatch(/^[a-f0-9]{64}$/);
    await seedAnchoredLogRootForViewToken(viewToken);
    const readSessionCookie = await acceptConfidentialityTerms(page.request, ANVIL_ACCOUNTS.account2, {
      contentId,
      detailsHash: submitted.detailsHash,
    });
    const [cookieName, cookieValue] = readSessionCookie.split("=");
    await page.context().addCookies([{ name: cookieName, value: cookieValue, url: E2E_BASE_URL }]);

    const warmedReportsResponse = await page.request.get(`/api/confidentiality/breaches?contentId=${contentId}`);
    expect(warmedReportsResponse.ok(), await warmedReportsResponse.text()).toBe(true);

    await gotoWithRetry(page, "/governance#breaches", { ensureWalletConnected: true });
    await expect(page.getByRole("heading", { name: "Confidentiality breach report" })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel("Content id").fill(contentId);
    await page.getByLabel("Accused identity key").fill(accused.identityKey);
    await page.getByLabel("External evidence hash").fill(`0x${"5".repeat(64)}`);
    await page.getByLabel("Evidence URL").fill("https://www.rateloop.ai/confidentiality/evidence/e2e");
    await page.getByLabel("View token").fill(viewToken);
    const submitResponsePromise = page.waitForResponse(
      response =>
        response.url().includes("/api/confidentiality/breaches") && response.request().method().toUpperCase() === "POST",
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: "Submit report" }).click();
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.ok(), await submitResponse.text()).toBe(true);

    await expect(page.getByText("Breach report submitted.")).toBeVisible({ timeout: 20_000 });
    const submittedReport = page
      .getByTestId("confidentiality-breach-report")
      .filter({ hasText: accused.identityKey })
      .first();
    await expect(async () => {
      const contentIdInput = page.getByLabel("Content id");
      await contentIdInput.fill(contentId);
      await expect(contentIdInput).toHaveValue(contentId);
      await page.getByRole("button", { name: "Load reports" }).click({ timeout: 5_000 });
      await expect(submittedReport.getByText(`identity ${accused.identityKey}`)).toBeVisible({
        timeout: 5_000,
      });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 5_000] });
    const evidenceLine = submittedReport.getByText(/^evidence 0x[0-9a-f]{64}$/);
    await expect(evidenceLine).toBeVisible();
    const evidenceHash = (await evidenceLine.textContent())?.replace(/^evidence\s+/, "") ?? "";
    expect(evidenceHash).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(submittedReport.getByRole("link", { name: "evidence artifact" })).toBeVisible();

    await submittedReport.getByRole("button", { name: "Slash bond", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Governance Action Composer" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("combobox", { name: "Governance action" })).toHaveValue(
      "confidentiality-slash-bond",
    );
    await expect(page.getByLabel("Content ID")).toHaveValue(contentId, { timeout: 10_000 });
    await expect(page.getByLabel("Identity key")).toHaveValue(accused.identityKey);
    await expect(page.getByLabel("Evidence hash")).toHaveValue(evidenceHash);
    await expect(page.getByLabel("Reporter recipient")).toHaveValue(
      new RegExp(`^${ANVIL_ACCOUNTS.account2.address}$`, "i"),
    );

    await gotoWithRetry(page, "/governance#breaches", { ensureWalletConnected: true });
    const loadedReport = page
      .getByTestId("confidentiality-breach-report")
      .filter({ hasText: `evidence ${evidenceHash}` })
      .first();
    await expect(async () => {
      const reloadedContentIdInput = page.getByLabel("Content id");
      await reloadedContentIdInput.fill(contentId);
      await expect(reloadedContentIdInput).toHaveValue(contentId);
      await page.getByRole("button", { name: "Load reports" }).click({ timeout: 5_000 });
      await expect(loadedReport.getByText(`identity ${accused.identityKey}`)).toBeVisible({
        timeout: 5_000,
      });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 5_000] });
    await loadedReport.getByRole("button", { name: "Ban identity", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Governance action" })).toHaveValue(
      "rater-registry-ban-identity",
      { timeout: 10_000 },
    );
    await expect(page.getByLabel("Evidence hash")).toHaveValue(evidenceHash);

    try {
      await banConfidentialityIdentity(ANVIL_ACCOUNTS.account3, "E2E breach report sanction");
      const indexed = await waitForPonderIndexed(
        async () => {
          const status = await ponderGet(`/rater-participation-status/${ANVIL_ACCOUNTS.account3.address}`);
          return status.confidentialitySanction?.active === true;
        },
        90_000,
        2_000,
        "governance-breach:identity-ban-indexed",
      );
      expect(indexed, "Ponder should index the active confidentiality sanction").toBe(true);

      await expect(async () => {
        await gotoWithRetry(page, `/profiles/${ANVIL_ACCOUNTS.account3.address}`, {
          ensureWalletConnected: true,
          timeout: 30_000,
        });
        await expect(page.getByText(/Ponder is unavailable/i)).toHaveCount(0, { timeout: 5_000 });
        await expect(page.getByText("Active sanction")).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 5_000] });
    } finally {
      await unbanConfidentialityIdentity(ANVIL_ACCOUNTS.account3);
    }
  });

  test("connected sidebar navigation can leave governance", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/governance", { ensureWalletConnected: true });

    const submitLink = page.getByRole("link", { name: "Submit" });
    await expect(submitLink).toBeVisible({ timeout: 15_000 });
    await submitLink.click();
    await expect(page).toHaveURL(/\/ask(?:[?#].*)?$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#nprogress")).toHaveCount(0, { timeout: 15_000 });

    await gotoWithRetry(page, "/governance", { ensureWalletConnected: true });

    const discoverLink = page.getByRole("link", { name: "Discover" });
    await expect(discoverLink).toBeVisible({ timeout: 15_000 });
    await discoverLink.click();
    await expect(page).toHaveURL(/\/rate(?:[?#].*)?$/, { timeout: 15_000 });
    await waitForFeedLoaded(page);
    await expect(page.locator("#nprogress")).toHaveCount(0, { timeout: 15_000 });
  });
});
