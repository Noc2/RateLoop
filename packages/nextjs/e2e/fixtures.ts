import { default as AxeBuilder } from "@axe-core/playwright";
import { type Page, type Route, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

export type BrowserState = {
  agentId: string;
  baseURL: string;
  ownerSessionToken: string;
  setupSessionToken: string;
  workspaceId: string;
};

export const browserState = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "e2e/.state.json"), "utf8"),
) as BrowserState;

export async function authenticate(page: Page, token: string) {
  await page.context().addCookies([{ name: "rateloop-session", value: token, url: browserState.baseURL }]);
}

export function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map(node => node.target.join(" ")),
    })),
  ).toEqual([]);
}

export async function settleVisuals(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
      canvas, video { visibility: hidden !important; }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
}
