import { json, settleVisuals } from "../fixtures";
import { expect, test } from "@playwright/test";

test("landing and signed-out hubs retain their visual hierarchy", async ({ page }) => {
  await page.goto("/");
  await settleVisuals(page);
  await expect(page.locator("main")).toHaveScreenshot("landing-main.png", { maxDiffPixelRatio: 0.01 });

  await page.goto("/agents");
  await settleVisuals(page);
  await expect(page.locator("main")).toHaveScreenshot("agents-hub.png", { maxDiffPixelRatio: 0.01 });

  await page.route("**/api/rater/tasks?**", route => json(route, { message: "Authentication required." }, 401));
  await page.route("**/api/account/assurance/assignments?**", route =>
    json(route, { message: "Authentication required." }, 401),
  );
  await page.goto("/human");
  await expect(page.getByRole("heading", { name: "Sign in to discover review work" })).toBeVisible();
  await settleVisuals(page);
  await expect(page.locator("main")).toHaveScreenshot("human-hub.png", { maxDiffPixelRatio: 0.01 });
});
