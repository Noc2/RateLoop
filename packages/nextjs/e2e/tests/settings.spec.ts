import { expect, test } from "../fixtures/wallet";
import { readTokenBalance } from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { gotoWithRetry, waitForVisibleWithReload } from "../helpers/wait-helpers";
import { setupWallet } from "../helpers/wallet-session";
import type { Page } from "@playwright/test";

const SETTINGS_SECTION_TIMEOUT_MS = 15_000;

async function expectActiveSettingsTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("button", { name, exact: true });
  await waitForVisibleWithReload(page, () => tab, { timeout: SETTINGS_SECTION_TIMEOUT_MS });
  await expect(tab).toHaveClass(/pill-active/, { timeout: SETTINGS_SECTION_TIMEOUT_MS });
}

async function waitForSettingsHeading(page: Page, name: string | RegExp): Promise<void> {
  await waitForVisibleWithReload(page, () => page.getByRole("heading", { name }), {
    timeout: SETTINGS_SECTION_TIMEOUT_MS,
  });
}

test.describe("Settings page", () => {
  test("settings route defaults to the wallet tab", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/settings");

    await waitForSettingsHeading(page, "Gas And Wallet Funding");
    await expectActiveSettingsTab(page, "Wallet");
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("notification query canonically opens the notification tab", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/settings?tab=notifications");

    await waitForSettingsHeading(page, /Notification settings/i);
    await expectActiveSettingsTab(page, "Notifications");
    await expect(page).toHaveURL(/\/settings#notifications$/);
  });

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

    await expectActiveSettingsTab(page, "Wallet");
    await waitForSettingsHeading(page, "Delegated Vote ID");
    await waitForSettingsHeading(page, "Transfer LREP");

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

    await expect(page).toHaveURL(/\/settings$/);
    await expectActiveSettingsTab(page, "Wallet");
    await waitForSettingsHeading(page, "Rater credential required for delegation");
    await expect(page.getByText("Delegation is only available", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open rater setup" })).toHaveAttribute("href", "/governance");
    await waitForSettingsHeading(page, "Transfer LREP");
    await expect(page.getByLabel("Transfer recipient")).toBeVisible();
    await expect(page.getByLabel("Transfer amount")).toBeVisible();
  });

  test("frontend tab shows the registration surface", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/settings#frontend");

    await expect(page).toHaveURL(/\/settings#frontend$/);
    await expectActiveSettingsTab(page, "Frontend");
    await waitForSettingsHeading(page, "Frontend Registration");
  });

  test("wallet tab shows the ETH gas top-up surface", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/settings#wallet");

    await waitForSettingsHeading(page, "Gas And Wallet Funding");
    await expectActiveSettingsTab(page, "Wallet");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("wallet-snapshot-address")).toHaveText(ANVIL_ACCOUNTS.account2.address);
    await expect(page.getByTestId("wallet-snapshot-eth")).toContainText("ETH");
    await expect(page.getByTestId("wallet-snapshot-lrep")).toContainText("LREP");
    await expect(page.getByTestId("wallet-snapshot-usdc")).toContainText("USDC");

    const walletAddressValueStyle = await page.getByTestId("wallet-snapshot-address").evaluate(element => {
      const style = window.getComputedStyle(element);
      return {
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
      };
    });
    const ethValueStyle = await page.getByTestId("wallet-snapshot-eth").evaluate(element => {
      const style = window.getComputedStyle(element);
      return {
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
      };
    });
    expect(walletAddressValueStyle).toEqual(ethValueStyle);

    await expect(page.getByRole("heading", { name: "Top Up Network Fees" })).toHaveCount(0);
    await expect(page.getByTestId("eth-top-up-panel")).toBeVisible();
    await expect(page.getByText("ETH top-up is available on live deployments.")).toBeVisible();
  });
});
