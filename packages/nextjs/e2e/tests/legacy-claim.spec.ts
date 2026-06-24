import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { setupWallet } from "../helpers/wallet-session";
import { getVisibleAuthConnectButton, gotoWithRetry, waitForWalletConnected } from "../helpers/wait-helpers";
import { expect, test } from "@playwright/test";

test.describe("Legacy claim", () => {
  test("prompts disconnected visitors to connect the snapshot wallet", async ({ browser }) => {
    const context = await newE2EContext(browser);
    const page = await context.newPage();

    try {
      await gotoWithRetry(page, "/claim/legacy", { skipInjectedWalletConnectionCheck: true });

      await expect(page.getByRole("heading", { name: "Legacy LREP Claim" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Connect Wallet" })).toBeVisible({ timeout: 45_000 });
      await expect(
        page.getByText("Connect the wallet associated with the legacy allocation snapshot to see claim status."),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("shows a connected non-eligible wallet result", async ({ browser }) => {
    const context = await newE2EContext(browser);
    const page = await context.newPage();

    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await gotoWithRetry(page, "/claim/legacy", { ensureWalletConnected: true });
    await waitForWalletConnected(page);
    await expect(getVisibleAuthConnectButton(page)).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Legacy LREP Claim" })).toBeVisible();
    await expect
      .poll(
        async () => {
          const statusHeadings = [
            "No Legacy Allocation Found",
            "Legacy Claim Root Pending",
            "Claim Lookup Unavailable",
            "Switch Network",
          ];
          for (const heading of statusHeadings) {
            if (await page.getByRole("heading", { name: heading }).isVisible().catch(() => false)) {
              return heading;
            }
          }
          return "";
        },
        { intervals: [1_000, 2_000, 5_000], timeout: 60_000 },
      )
      .toBe("No Legacy Allocation Found");
    await expect(
      page.getByText("This connected wallet is not present in the published legacy contributor snapshot."),
    ).toBeVisible();

    await context.close();
  });
});
