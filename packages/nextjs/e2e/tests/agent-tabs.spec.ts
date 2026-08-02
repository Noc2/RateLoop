import { authenticate, browserState } from "../fixtures";
import { expect, test } from "@playwright/test";

test("concise German agent tabs and the workspace selector share one desktop row", async ({ page }) => {
  await authenticate(page, browserState.ownerSessionToken);
  await page.goto(`/de/agents/overview?workspace=${encodeURIComponent(browserState.workspaceId)}`);

  const navigation = page.getByRole("navigation", { name: "Bereiche für Agenten" });
  const workspace = page.getByRole("combobox", { name: "Aktiver Arbeitsbereich" });

  await expect(navigation.getByRole("link", { name: "Prüfung", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Einstellungen", exact: true })).toBeVisible();
  await expect(navigation.getByText("Prüfung einrichten", { exact: true })).toHaveCount(0);
  await expect(navigation.getByText("Abrechnung & Einstellungen", { exact: true })).toHaveCount(0);
  await expect(workspace).toBeVisible();

  const navigationBox = await navigation.boundingBox();
  const workspaceBox = await workspace.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect(workspaceBox).not.toBeNull();
  expect(
    Math.abs(navigationBox!.y + navigationBox!.height / 2 - (workspaceBox!.y + workspaceBox!.height / 2)),
  ).toBeLessThan(2);
});
