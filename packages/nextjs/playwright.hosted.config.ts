import { hostedE2eTarget } from "./config/hostedE2eTarget";
import { defineConfig, devices } from "@playwright/test";

const target = hostedE2eTarget();

export default defineConfig({
  testDir: "./e2e/hosted",
  testMatch: /hosted-smoke\.spec\.ts/u,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "hosted-playwright-report" }]]
    : "list",
  outputDir: "./hosted-test-results",
  projects: [
    {
      name: "hosted-desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  use: {
    baseURL: target.baseURL,
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
