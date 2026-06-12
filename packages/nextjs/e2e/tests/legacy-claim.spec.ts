import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { setupWallet } from "../helpers/wallet-session";
import { gotoWithRetry } from "../helpers/wait-helpers";
import { expect, test } from "@playwright/test";

test.describe("Legacy claim", () => {
  test("prompts disconnected visitors to connect the snapshot wallet", async ({ page }) => {
    await gotoWithRetry(page, "/claim/legacy");

    await expect(page.getByRole("heading", { name: "Legacy LREP Claim" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connect Wallet" })).toBeVisible();
    await expect(
      page.getByText("Connect the wallet associated with the legacy allocation snapshot to see claim status."),
    ).toBeVisible();
  });

  test("shows a connected non-eligible wallet result", async ({ browser }) => {
    const context = await newE2EContext(browser);
    const page = await context.newPage();

    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await gotoWithRetry(page, "/claim/legacy", { ensureWalletConnected: true });

    await expect(page.getByRole("heading", { name: "Legacy LREP Claim" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No Legacy Allocation Found" })).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("This connected wallet is not present in the published legacy contributor snapshot."),
    ).toBeVisible();

    await context.close();
  });
});
