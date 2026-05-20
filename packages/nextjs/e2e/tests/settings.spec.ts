import { expect, test } from "../fixtures/wallet";
import { readTokenBalance } from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { gotoWithRetry } from "../helpers/wait-helpers";
import { setupWallet } from "../helpers/wallet-session";
import { installLocalE2EWorldIdMock, readActiveHumanCredential } from "../helpers/world-id";

test.describe("Settings page", () => {
  test("delegation tab can transfer LREP to another address", async ({ connectedPage: page }) => {
    test.setTimeout(60_000);

    const sender = ANVIL_ACCOUNTS.account2.address;
    const recipient = ANVIL_ACCOUNTS.account11.address;
    const transferAmount = "1.25";
    const transferAmountMicro = 1_250_000n;
    const tokenAddress = CONTRACT_ADDRESSES.LoopReputation;

    const senderBalanceBefore = await readTokenBalance(sender, tokenAddress);
    const recipientBalanceBefore = await readTokenBalance(recipient, tokenAddress);

    await gotoWithRetry(page, "/settings#delegation");

    await expect(page.getByRole("heading", { name: "Delegated Vote ID" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Transfer LREP" })).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Transfer recipient").fill(recipient);
    await page.getByLabel("Transfer amount").fill(transferAmount);

    const sendButton = page.getByRole("button", { name: "Send LREP", exact: true });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(page.getByText(`Sent ${transferAmount} LREP`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Transfer amount")).toHaveValue("");

    const senderBalanceAfter = await readTokenBalance(sender, tokenAddress);
    const recipientBalanceAfter = await readTokenBalance(recipient, tokenAddress);

    expect(senderBalanceAfter).toBe(senderBalanceBefore - transferAmountMicro);
    expect(recipientBalanceAfter).toBe(recipientBalanceBefore + transferAmountMicro);
  });

  test("delegation tab explains missing rater credential instead of rendering empty", async ({ page }) => {
    await setupWallet(page, ANVIL_ACCOUNTS.account1.privateKey);
    await gotoWithRetry(page, "/settings#delegation", { ensureWalletConnected: true });

    await expect(page).toHaveURL(/\/settings#delegation$/);
    await expect(page.getByRole("button", { name: "Delegation", exact: true })).toHaveClass(/pill-active/);
    await expect(page.getByRole("heading", { name: "Rater credential required for delegation" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: "Open LREP faucet" })).toHaveAttribute("href", "/governance#faucet");
  });

  test("frontend tab shows the registration surface", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/settings#frontend");

    await expect(page).toHaveURL(/\/settings#frontend$/);
    await expect(page.getByRole("button", { name: "Frontend", exact: true })).toHaveClass(/pill-active/);
    await expect(page.getByRole("heading", { name: "Frontend Registration" })).toBeVisible({ timeout: 15_000 });
  });

  test("wallet tab shows the ETH gas top-up surface", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/settings#wallet");

    await expect(page).toHaveURL(/\/settings#wallet$/);
    await expect(page.getByRole("button", { name: "Wallet", exact: true })).toHaveClass(/pill-active/);
    await expect(page.getByRole("heading", { name: "Gas and wallet funding" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Top up network fees" })).toBeVisible();
    await expect(page.getByText("ETH top-up is available on World Chain mainnet deployments.")).toBeVisible();
  });

  test("world id mock flow attests an active human credential on-chain", async ({ page }) => {
    test.setTimeout(90_000);

    const account = ANVIL_ACCOUNTS.account2;
    const registryAddress = CONTRACT_ADDRESSES.RaterRegistry;

    await setupWallet(page, account.privateKey);
    await installLocalE2EWorldIdMock(page, account.address);
    await gotoWithRetry(page, "/settings#identity", { ensureWalletConnected: true });

    await expect(page.getByRole("heading", { name: "Human credential" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/self-verified/i)).toHaveCount(0);

    const verifyButton = page.getByRole("button", { name: "Verify with World ID" });
    await expect(verifyButton).toBeEnabled({ timeout: 15_000 });
    await verifyButton.click();

    await expect(page.getByText("World ID verified")).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => readActiveHumanCredential(account.address, registryAddress)).toBe(true);
  });
});
