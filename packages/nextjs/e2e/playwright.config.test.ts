import config from "./playwright.config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function getProjectTestMatch(name: string): RegExp {
  const project = (config.projects ?? []).find(candidate => candidate.name === name);

  assert.ok(project, `Expected Playwright project "${name}" to exist`);
  assert.ok(project.testMatch instanceof RegExp, `Expected Playwright project "${name}" to use a RegExp testMatch`);

  return project.testMatch;
}

function getProjectTestIgnore(name: string): RegExp {
  const project = (config.projects ?? []).find(candidate => candidate.name === name);

  assert.ok(project, `Expected Playwright project "${name}" to exist`);
  assert.ok(project.testIgnore instanceof RegExp, `Expected Playwright project "${name}" to use a RegExp testIgnore`);

  return project.testIgnore;
}

test("browser-scoped Playwright projects only match their intended spec files", () => {
  const scenarios = [
    {
      project: "compat-firefox",
      workspaceSegment: "pr74-browser-compat",
      matchingSpec: "browser-compat.spec.ts",
      nonMatchingSpec: "vote.spec.ts",
    },
    {
      project: "responsive-layout",
      workspaceSegment: "responsive-layout-laptop-check",
      matchingSpec: "responsive-layout.spec.ts",
      nonMatchingSpec: "browser-compat.spec.ts",
    },
    {
      project: "accessibility-axe",
      workspaceSegment: "accessibility-axe-audit",
      matchingSpec: "accessibility-axe.spec.ts",
      nonMatchingSpec: "settings.spec.ts",
    },
    {
      project: "mobile-phone",
      workspaceSegment: "mobile-preview",
      matchingSpec: "mobile.spec.ts",
      nonMatchingSpec: "browser-compat.spec.ts",
    },
  ];

  for (const { project, workspaceSegment, matchingSpec, nonMatchingSpec } of scenarios) {
    const testMatch = getProjectTestMatch(project);
    const matchingPath = `/tmp/${workspaceSegment}/packages/nextjs/e2e/tests/${matchingSpec}`;
    const nonMatchingPath = `/tmp/${workspaceSegment}/packages/nextjs/e2e/tests/${nonMatchingSpec}`;

    assert.equal(testMatch.test(matchingPath), true, `${project} should match ${matchingSpec}`);
    assert.equal(
      testMatch.test(nonMatchingPath),
      false,
      `${project} should ignore ${nonMatchingSpec} even when the workspace path includes "${workspaceSegment}"`,
    );
  }
});

test("CI lifecycle script does not expand Playwright project dependencies", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const lifecycleScript = packageJson.scripts?.["e2e:ci:lifecycle"] ?? "";

  assert.match(lifecycleScript, /--no-deps\b/, "lifecycle CI should not rerun dependency projects");
  assert.doesNotMatch(lifecycleScript, /--project=chromium\b/, "lifecycle CI should not include the broad suite");
});

test("CI app project covers broad Chromium specs without rerunning scoped suites", () => {
  const testIgnore = getProjectTestIgnore("ci-app");
  const broadSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/vote.spec.ts";
  const smokeSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/smoke.spec.ts";
  const apiSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/ponder-api.spec.ts";
  const lifecycleSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/settlement-lifecycle.spec.ts";
  const compatSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/browser-compat.spec.ts";

  assert.equal(testIgnore.test(broadSpec), false, "ci-app should include broad app specs");
  assert.equal(testIgnore.test(smokeSpec), true, "ci-app should leave smoke specs to ci-smoke");
  assert.equal(testIgnore.test(apiSpec), true, "ci-app should leave API-only specs to ci-api");
  assert.equal(testIgnore.test(lifecycleSpec), true, "ci-app should leave lifecycle specs to lifecycle projects");
  assert.equal(
    testIgnore.test(compatSpec),
    true,
    "ci-app should leave browser compat specs to scheduled compat projects",
  );
});

test("CI smoke and API projects keep browser smoke separate from fetch-only specs", () => {
  const smokeMatch = getProjectTestMatch("ci-smoke");
  const apiMatch = getProjectTestMatch("ci-api");
  const smokeSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/smoke.spec.ts";
  const docsSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/docs-pages.spec.ts";
  const apiSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/ponder-api.spec.ts";
  const watchlistApiSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/watchlist-api.spec.ts";

  assert.equal(smokeMatch.test(smokeSpec), true, "ci-smoke should include browser smoke specs");
  assert.equal(smokeMatch.test(docsSpec), true, "ci-smoke should include docs smoke specs");
  assert.equal(smokeMatch.test(apiSpec), false, "ci-smoke should not include API-only specs");
  assert.equal(apiMatch.test(apiSpec), true, "ci-api should include Ponder API specs");
  assert.equal(apiMatch.test(watchlistApiSpec), true, "ci-api should include Next API specs");
  assert.equal(apiMatch.test(smokeSpec), false, "ci-api should not include browser smoke specs");
});

test("Playwright config fails required E2E runs on unexpected skips", () => {
  const reporterEntries = config.reporter;
  assert.ok(Array.isArray(reporterEntries), "Playwright reporters should be configured as an array");
  assert.ok(
    reporterEntries.some(entry => Array.isArray(entry) && entry[0] === "./reporters/no-unexpected-skips.ts"),
    "required E2E runs should include the no-unexpected-skips reporter",
  );
});
