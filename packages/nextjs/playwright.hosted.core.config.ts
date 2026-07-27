import { hostedE2eTarget } from "./config/hostedE2eTarget";
import { defineConfig, devices } from "@playwright/test";

const target = hostedE2eTarget();

export default defineConfig({
  testDir: "./e2e/hosted",
  testMatch: /core-journey\.spec\.ts/u,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? "github" : "list",
  projects: [
    {
      name: "hosted-core-desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  use: {
    baseURL: target.baseURL,
    colorScheme: "dark",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});
