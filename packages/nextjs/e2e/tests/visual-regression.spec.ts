import { json, settleVisuals } from "../fixtures";
import { type Page, expect, test } from "@playwright/test";

async function signedOutGateTreatment(page: Page, titleId: string) {
  const gate = page.locator(`section[aria-labelledby="${titleId}"]`);
  const signIn = gate.getByRole("link", { name: "Sign In" });
  await expect(gate).toBeVisible();
  await expect(signIn).toBeVisible();

  return {
    action: await signIn.evaluate(element => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        borderRadius: style.borderRadius,
        borderWidth: style.borderWidth,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        height: bounds.height,
      };
    }),
    cardWidth: await gate.evaluate(element => element.getBoundingClientRect().width),
  };
}

test("landing and signed-out hubs retain their visual hierarchy", async ({ page }) => {
  await page.goto("/");
  await settleVisuals(page);
  await expect(page.locator("main")).toHaveScreenshot("landing-main.png", { maxDiffPixelRatio: 0.01 });

  await page.goto("/agents");
  await settleVisuals(page);
  const agentGate = await signedOutGateTreatment(page, "agents-sign-in-title");
  await expect(page.locator("main")).toHaveScreenshot("agents-hub.png", { maxDiffPixelRatio: 0.01 });

  await page.route("**/api/rater/tasks?**", route => json(route, { message: "Authentication required." }, 401));
  await page.route("**/api/account/assurance/assignments?**", route =>
    json(route, { message: "Authentication required." }, 401),
  );
  await page.goto("/human");
  await expect(page.getByRole("heading", { name: "Sign in to discover review work" })).toBeVisible();
  await settleVisuals(page);
  const humanGate = await signedOutGateTreatment(page, "human-discover-sign-in-title");
  expect(humanGate).toEqual(agentGate);
  expect(humanGate.action.height).toBe(40);
  expect(humanGate.action.fontSize).toBe("16px");
  expect(humanGate.cardWidth).toBeLessThanOrEqual(448);
  await expect(page.locator("main")).toHaveScreenshot("human-hub.png", { maxDiffPixelRatio: 0.01 });
});
