import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import config from "./playwright.config";

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
  const lifecycleSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/settlement-lifecycle.spec.ts";
  const compatSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/browser-compat.spec.ts";

  assert.equal(testIgnore.test(broadSpec), false, "ci-app should include broad app specs");
  assert.equal(testIgnore.test(smokeSpec), true, "ci-app should leave smoke specs to ci-smoke");
  assert.equal(testIgnore.test(lifecycleSpec), true, "ci-app should leave lifecycle specs to lifecycle projects");
  assert.equal(testIgnore.test(compatSpec), true, "ci-app should leave browser compat specs to scheduled compat projects");
});
