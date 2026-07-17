import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  outputDir: "./test-results",
  snapshotPathTemplate: "{testDir}/../__screenshots__/{arg}{ext}",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : {
        command: "yarn dev:built-workspace-deps",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          APP_URL: baseURL,
          NEXT_PUBLIC_APP_URL: baseURL,
          NEXT_PUBLIC_THIRDWEB_CLIENT_ID: "rateloop-e2e-browser",
          PORT: new URL(baseURL).port || "3100",
        },
      },
});
