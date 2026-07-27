import { hostedE2eTarget } from "../../config/hostedE2eTarget";
import { expect, test } from "@playwright/test";

const target = hostedE2eTarget();
const TOKENLESS_PROJECT = {
  id: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
  name: "rateloop-tokenless",
} as const;

test("release identity matches the intended tokenless deployment", async ({ request }) => {
  const response = await request.get("/api/release", { failOnStatusCode: false });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await response.json()).toEqual({
    schemaVersion: "rateloop.release-identity.v1",
    deploymentLine: "tokenless",
    project: TOKENLESS_PROJECT,
    environment: target.kind === "canonical" ? "production" : "preview",
    git: {
      ref: target.expectedGitRef,
      sha: target.expectedGitSha,
    },
  });
});

test("public tokenless journeys render read-only without browser or server failures", async ({ page }) => {
  const browserErrors: string[] = [];
  const serverFailures: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", response => {
    if (new URL(response.url()).origin === target.baseURL && response.status() >= 500) {
      serverFailures.push(`${response.status()} ${response.url()}`);
    }
  });

  for (const path of ["/", "/agents", "/rate", "/docs/connect"]) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), path).toBeLessThan(500);
    await expect(page.locator("main")).toBeVisible();
    expect(new URL(page.url()).origin).toBe(target.baseURL);
  }

  await expect(page.getByRole("heading", { name: "Connect a Host" })).toBeVisible();
  expect(serverFailures).toEqual([]);
  expect(browserErrors).toEqual([]);
});
