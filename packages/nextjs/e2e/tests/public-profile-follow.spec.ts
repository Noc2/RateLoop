import { expect, test } from "../fixtures/wallet";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";

test.describe("Public profile follow button", () => {
  test("connected user can toggle follow state from the public profile page", async ({ connectedPage: page }) => {
    await page.goto(`/profiles/${ANVIL_ACCOUNTS.account8.address}`);

    const button = page.getByRole("button", { name: /^(Follow|Following)$/i }).first();
    await expect(button).toBeVisible({ timeout: 15_000 });

    const before = (await button.textContent())?.toLowerCase() ?? "";
    const expectedName = before.includes("following") ? /^Follow$/i : /^Following$/i;

    await expect(async () => {
      const toggle = page.getByRole("button", { name: /^(Follow|Following)$/i }).first();
      await expect(toggle).toBeVisible({ timeout: 5_000 });
      if (!(await page.getByRole("button", { name: expectedName }).first().isVisible().catch(() => false))) {
        await toggle.click({ timeout: 5_000 });
      }
      await expect(page.getByRole("button", { name: expectedName }).first()).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 5_000] });
  });
});
