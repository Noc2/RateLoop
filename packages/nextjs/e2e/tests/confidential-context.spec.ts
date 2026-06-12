import { expect, test } from "../fixtures/wallet";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import {
  acceptConfidentialityTerms,
  ensureHumanCredential,
  fetchGatedAttachment,
  submitGatedQuestion,
} from "../helpers/confidentiality";
import { gotoWithRetry } from "../helpers/wait-helpers";

/**
 * Confidential private-context coverage.
 *
 * Account allocation:
 * - Account #2 submits the private question through the browser UI.
 * - Account #3 is a credentialed zero-bond viewer.
 */
test.describe("Confidential context", () => {
  test.describe.configure({ mode: "serial" });

  test("browser submission links private details and serves them only to authorized wallets", async ({
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
});
