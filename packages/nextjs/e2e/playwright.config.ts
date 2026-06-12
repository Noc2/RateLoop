import { E2E_BASE_URL } from "./helpers/service-urls";
import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const specFile = (name: string) => new RegExp(`(^|[/\\\\])${escapeRegex(name)}\\.spec\\.[cm]?[jt]sx?$`);
const specFiles = (...names: string[]) =>
  new RegExp(`(^|[/\\\\])(?:${names.map(escapeRegex).join("|")})\\.spec\\.[cm]?[jt]sx?$`);
const E2E_DIR = resolve("e2e");
const PLAYWRIGHT_REPORT_DIR = resolve(E2E_DIR, "playwright-report");
const PLAYWRIGHT_TEST_RESULTS_DIR = resolve(E2E_DIR, "test-results");

const BROWSER_COMPAT_TESTS = specFile("browser-compat");
const RESPONSIVE_LAYOUT_TESTS = specFile("responsive-layout");
const ACCESSIBILITY_AXE_TESTS = specFile("accessibility-axe");
const MOBILE_TESTS = specFile("mobile");
const MOBILE_TABLET_TESTS = specFile("mobile-tablet");
const WORLD_ID_MOCK_TESTS = specFile("world-id-mock");
const CI_SMOKE_TESTS = specFiles("smoke", "pages-smoke", "docs-pages");
const CI_API_TESTS = specFiles("nextjs-api", "watchlist-api", "faucet", "contract-boundaries", "ponder-api");
const SETTLEMENT_TESTS = specFiles(
  "settlement-lifecycle",
  "reward-claim",
  "correlation-bounty-payout",
  "confidential-disclosure",
  "tied-round",
  "zz-multi-round",
  "unanimous-settlement",
  "frontend-fee-claim",
  "reveal-failed",
  "manual-reveal",
);
const KEEPER_SETTLEMENT_TESTS = specFile("keeper-settlement");
const ROUND_CANCELLATION_TESTS = specFile("round-cancellation");
const CONTENT_DORMANCY_TESTS = specFile("content-dormancy");
const CHROMIUM_SPECIAL_TESTS = specFiles(
  "round-cancellation",
  "content-dormancy",
  "settlement-lifecycle",
  "reward-claim",
  "correlation-bounty-payout",
  "confidential-disclosure",
  "tied-round",
  "zz-multi-round",
  "unanimous-settlement",
  "frontend-fee-claim",
  "reveal-failed",
  "manual-reveal",
  "keeper-settlement",
  "mobile",
  "mobile-tablet",
  "browser-compat",
  "responsive-layout",
  "accessibility-axe",
  "world-id-mock",
);
const CI_APP_IGNORED_TESTS = specFiles(
  "smoke",
  "pages-smoke",
  "docs-pages",
  "nextjs-api",
  "watchlist-api",
  "faucet",
  "contract-boundaries",
  "ponder-api",
  "round-cancellation",
  "content-dormancy",
  "settlement-lifecycle",
  "reward-claim",
  "correlation-bounty-payout",
  "confidential-disclosure",
  "tied-round",
  "zz-multi-round",
  "unanimous-settlement",
  "frontend-fee-claim",
  "reveal-failed",
  "manual-reveal",
  "keeper-settlement",
  "mobile",
  "mobile-tablet",
  "browser-compat",
  "responsive-layout",
  "accessibility-axe",
  "world-id-mock",
);

export default defineConfig({
  globalSetup: "./global-setup.cts",
  testDir: "./tests",
  fullyParallel: false, // Tests share Anvil chain state — run sequentially
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker to prevent Anvil nonce conflicts
  reporter: process.env.CI
    ? [
        ["github"],
        ["./reporters/no-unexpected-skips.ts"],
        ["html", { open: "never", outputFolder: PLAYWRIGHT_REPORT_DIR }],
      ]
    : [["./reporters/no-unexpected-skips.ts"], ["html", { outputFolder: PLAYWRIGHT_REPORT_DIR }]],
  outputDir: PLAYWRIGHT_TEST_RESULTS_DIR,
  timeout: 60_000, // On-chain tx confirmation needs time

  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "ci-smoke",
      use: { ...devices["Desktop Chrome"] },
      testMatch: CI_SMOKE_TESTS,
    },
    {
      name: "ci-api",
      testMatch: CI_API_TESTS,
    },
    {
      name: "ci-app",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: CI_APP_IGNORED_TESTS,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // Exclude tests that need special conditions:
      // - settlement/reward/tied-round: need block advancement for settlement
      // - round-cancellation/content-dormancy: need time-skip (fast-forward days)
      // - mobile/responsive/browser-compat/a11y: scoped device/browser projects
      testIgnore: CHROMIUM_SPECIAL_TESTS,
    },
    {
      name: "responsive-layout",
      use: { ...devices["Desktop Chrome"] },
      testMatch: RESPONSIVE_LAYOUT_TESTS,
    },
    {
      name: "accessibility-axe",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ACCESSIBILITY_AXE_TESTS,
    },
    {
      name: "world-id-mock",
      use: { ...devices["Desktop Chrome"] },
      testMatch: WORLD_ID_MOCK_TESTS,
    },
    {
      name: "compat-chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: BROWSER_COMPAT_TESTS,
    },
    {
      name: "compat-firefox",
      use: { ...devices["Desktop Firefox"] },
      testMatch: BROWSER_COMPAT_TESTS,
    },
    {
      name: "compat-webkit",
      use: { ...devices["Desktop Safari"] },
      testMatch: BROWSER_COMPAT_TESTS,
    },
    {
      // Settlement tests need block advancement for random settlement.
      // Run with: yarn e2e:settlement
      name: "settlement",
      use: { ...devices["Desktop Chrome"] },
      testMatch: SETTLEMENT_TESTS,
      dependencies: ["chromium"],
    },
    {
      // Keeper-backed settlement tests require the live keeper service and
      // should avoid direct reveal/settle helper calls.
      name: "settlement-keeper",
      use: { ...devices["Desktop Chrome"] },
      testMatch: KEEPER_SETTLEMENT_TESTS,
    },
    {
      // Round cancellation fast-forwards 7+ days — runs after settlement tests.
      name: "round-cancellation",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ROUND_CANCELLATION_TESTS,
      dependencies: ["settlement"],
    },
    {
      // Content dormancy fast-forwards 30+ days — runs after round-cancellation.
      name: "content-dormancy",
      use: { ...devices["Desktop Chrome"] },
      testMatch: CONTENT_DORMANCY_TESTS,
      dependencies: ["round-cancellation"],
    },
    // Mobile: opt-in via --project=mobile-phone or --project=mobile-tablet
    // Install first: npx playwright install chromium webkit
    {
      name: "mobile-phone",
      use: { ...devices["iPhone 12"] },
      testMatch: MOBILE_TESTS,
    },
    {
      name: "mobile-android",
      use: { ...devices["Pixel 5"] },
      testMatch: MOBILE_TESTS,
    },
    {
      name: "mobile-tablet",
      use: { ...devices["iPad Mini"] },
      testMatch: MOBILE_TABLET_TESTS,
    },
  ],

  // Services must be started manually (global-setup.ts validates they're running):
  //   yarn chain && yarn deploy && yarn dev:stack
});
