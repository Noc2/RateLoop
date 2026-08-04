import { hostedE2eTarget } from "../../config/hostedE2eTarget";
import { type Browser, expect, test } from "@playwright/test";

const target = hostedE2eTarget();
const TOKENLESS_PROJECT = {
  id: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
  name: "rateloop-tokenless",
} as const;

const THEME_VIEWPORTS = [
  {
    colorScheme: "light",
    kind: "desktop",
    shellBackground: "rgb(255, 255, 255)",
    viewport: { height: 900, width: 1440 },
  },
  { colorScheme: "dark", kind: "desktop", shellBackground: "rgb(10, 10, 10)", viewport: { height: 900, width: 1440 } },
  {
    colorScheme: "light",
    kind: "mobile",
    shellBackground: "rgb(255, 255, 255)",
    viewport: { height: 844, width: 390 },
  },
  { colorScheme: "dark", kind: "mobile", shellBackground: "rgb(10, 10, 10)", viewport: { height: 844, width: 390 } },
] as const;

async function checkHostedTheme(browser: Browser, expected: (typeof THEME_VIEWPORTS)[number]) {
  const context = await browser.newContext({
    baseURL: target.baseURL,
    colorScheme: expected.colorScheme,
    viewport: expected.viewport,
  });
  const page = await context.newPage();
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

  try {
    const response = await page.goto("/human/review", { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${expected.kind} ${expected.colorScheme}`).toBeLessThan(500);
    await expect(page.locator("html")).toHaveAttribute("data-theme", expected.colorScheme);
    await expect(page.locator("main")).toBeVisible();

    const shellBackground = await page
      .locator("#main-content")
      .evaluate(element => getComputedStyle(element.parentElement!).backgroundColor);
    expect(shellBackground).toBe(expected.shellBackground);

    if (expected.kind === "desktop") {
      await expect(page.locator("[data-rateloop-rail]")).toHaveCSS("background-color", expected.shellBackground);
    } else {
      const menuDetails = page.locator("header details");
      const menu = menuDetails.locator("nav.dropdown-content");
      await menuDetails.locator("summary").click();
      await expect(menu).toBeVisible();
      const [headerBackground, menuBackground] = await Promise.all([
        page.locator("header").evaluate(element => getComputedStyle(element).backgroundColor),
        menu.evaluate(element => getComputedStyle(element).backgroundColor),
      ]);
      expect({ headerBackground, menuBackground }).toEqual({
        headerBackground: expected.shellBackground,
        menuBackground: expected.shellBackground,
      });
    }

    expect(serverFailures).toEqual([]);
    expect(browserErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

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

  for (const path of ["/", "/agents/overview", "/rate", "/docs/connect"]) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), path).toBeLessThan(500);
    await expect(page.locator("main")).toBeVisible();
    expect(new URL(page.url()).origin).toBe(target.baseURL);
  }

  await expect(page.getByRole("heading", { name: "Connect Your Agent Host" })).toBeVisible();
  expect(serverFailures).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test("the hosted shell keeps light and dark backgrounds aligned on desktop and mobile", async ({ browser }) => {
  for (const expected of THEME_VIEWPORTS) await checkHostedTheme(browser, expected);
});

test("critical agent and maintenance server modules load before authorization", async ({ request }) => {
  for (const path of ["/api/agent/v1/mcp", "/api/cron/tokenless-maintenance"]) {
    const response = await request.get(path, { failOnStatusCode: false });
    expect(response.status(), path).toBeLessThan(500);
  }
});

test("hosted authentication is configured while account data stays signed-out", async ({ request }) => {
  const configuration = await request.get("/api/auth/config", { failOnStatusCode: false });
  expect(configuration.status()).toBe(200);
  expect(configuration.headers()["cache-control"]).toContain("no-store");
  expect(await configuration.json()).toMatchObject({
    configured: true,
    methods: { emailOtp: true, passkey: true },
  });

  const session = await request.get("/api/auth/session", { failOnStatusCode: false });
  expect(session.status()).toBe(200);
  expect(session.headers()["cache-control"]).toContain("no-store");
  expect(await session.json()).toEqual({ authenticated: false });

  const protectedWorkspaces = await request.get("/api/account/workspaces", { failOnStatusCode: false });
  expect(protectedWorkspaces.status()).toBe(401);
  expect(JSON.stringify(await protectedWorkspaces.json())).not.toContain("workspaceId");
});
