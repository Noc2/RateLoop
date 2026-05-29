import { expect, test } from "../fixtures/wallet";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { gotoWithRetry } from "../helpers/wait-helpers";
import { setupWallet } from "../helpers/wallet-session";
import { installLocalE2EWorldIdMock, readActiveHumanCredential } from "../helpers/world-id";

test.describe("World ID local mock", () => {
  test("attests an active human credential on-chain", async ({ page }) => {
    test.setTimeout(90_000);

    const account = ANVIL_ACCOUNTS.account2;
    const registryAddress = CONTRACT_ADDRESSES.RaterRegistry;

    await setupWallet(page, account.privateKey);
    await installLocalE2EWorldIdMock(page, account.address);
    await gotoWithRetry(page, "/settings#identity", { ensureWalletConnected: true });

    await expect(page.getByRole("heading", { name: "Human Credential" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/self-verified/i)).toHaveCount(0);

    const verifiedMessage = page.getByText("World ID verified");
    if (await verifiedMessage.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect.poll(() => readActiveHumanCredential(account.address, registryAddress)).toBe(true);
      return;
    }

    const verifyButton = page.getByRole("button", { name: "Verify with World ID" });
    await expect(
      verifyButton,
      "World ID mock verification should be available in the explicit mock project",
    ).toBeVisible({ timeout: 15_000 });
    await expect(verifyButton).toBeEnabled();
    await verifyButton.click();

    const failureMessage = page.getByText("Verification failed");
    await verifiedMessage.or(failureMessage).first().waitFor({ state: "visible", timeout: 45_000 });
    await expect(
      failureMessage,
      "World ID mock proof should be accepted by the seeded credential registry",
    ).toHaveCount(0);
    await expect.poll(() => readActiveHumanCredential(account.address, registryAddress)).toBe(true);
  });
});
