import { expect, test } from "../fixtures/wallet";
import { readTokenBalance } from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { gotoWithRetry } from "../helpers/wait-helpers";
import { setupWallet } from "../helpers/wallet-session";

test.describe("Settings page", () => {
  test("wallet tab can transfer LREP to another address", async ({ connectedPage: page }) => {
    test.setTimeout(60_000);

    const sender = ANVIL_ACCOUNTS.account2.address;
    const recipient = ANVIL_ACCOUNTS.account11.address;
    const transferAmount = "1.25";
    const transferAmountMicro = 1_250_000n;
    const tokenAddress = CONTRACT_ADDRESSES.LoopReputation;

    const senderBalanceBefore = await readTokenBalance(sender, tokenAddress);
    const recipientBalanceBefore = await readTokenBalance(recipient, tokenAddress);

    await gotoWithRetry(page, "/settings#wallet");

    await expect(page.getByRole("button", { name: "Wallet", exact: true })).toHaveClass(/pill-active/);
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

  test("wallet tab keeps LREP transfer visible without a rater credential", async ({ page }) => {
    await setupWallet(page, ANVIL_ACCOUNTS.account1.privateKey);
    await gotoWithRetry(page, "/settings#wallet", { ensureWalletConnected: true });

    await expect(page).toHaveURL(/\/settings#wallet$/);
    await expect(page.getByRole("button", { name: "Wallet", exact: true })).toHaveClass(/pill-active/);
    const credentialPrompt = page.getByRole("heading", { name: "Rater credential required for delegation" });
    await expect(credentialPrompt).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Open rater setup" })).toHaveAttribute("href", "/governance");
    await expect(page.getByRole("heading", { name: "Transfer LREP" })).toBeVisible();
    await expect(page.getByLabel("Transfer recipient")).toBeVisible();
    await expect(page.getByLabel("Transfer amount")).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Gas And Wallet Funding" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("wallet-snapshot-address")).toHaveText(ANVIL_ACCOUNTS.account2.address);
    await expect(page.getByTestId("wallet-snapshot-eth")).toContainText("ETH");
    await expect(page.getByTestId("wallet-snapshot-lrep")).toContainText("LREP");
    await expect(page.getByTestId("wallet-snapshot-usdc")).toContainText("USDC");
    await expect(page.getByRole("heading", { name: "Top Up Network Fees" })).toBeVisible();
    await expect(page.getByText("ETH top-up is available on World Chain mainnet deployments.")).toBeVisible();
  });
});
