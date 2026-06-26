import config from "./playwright.config";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const playwrightPackage = require("@playwright/test/package.json") as { version: string };

function readNextPackageJson(): {
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
} {
  return JSON.parse(readFileSync("package.json", "utf8")) as {
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
}

function readE2EWorkflow(): string {
  return readFileSync("../../.github/workflows/e2e.yaml", "utf8");
}

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

function projectIncludesSpec(project: NonNullable<typeof config.projects>[number], specPath: string): boolean {
  const testMatch = project.testMatch;
  const testIgnore = project.testIgnore;

  const matches =
    testMatch === undefined
      ? true
      : Array.isArray(testMatch)
        ? testMatch.some(pattern => pattern instanceof RegExp && pattern.test(specPath))
        : testMatch instanceof RegExp
          ? testMatch.test(specPath)
          : false;

  const ignored =
    testIgnore === undefined
      ? false
      : Array.isArray(testIgnore)
        ? testIgnore.some(pattern => pattern instanceof RegExp && pattern.test(specPath))
        : testIgnore instanceof RegExp
          ? testIgnore.test(specPath)
          : false;

  return matches && !ignored;
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
    {
      project: "mobile-android",
      workspaceSegment: "mobile-preview",
      matchingSpec: "mobile-android.spec.ts",
      nonMatchingSpec: "mobile.spec.ts",
    },
    {
      project: "mobile-tablet",
      workspaceSegment: "mobile-preview",
      matchingSpec: "mobile-tablet.spec.ts",
      nonMatchingSpec: "mobile.spec.ts",
    },
    {
      project: "world-id-mock",
      workspaceSegment: "world-id-mock",
      matchingSpec: "world-id-mock.spec.ts",
      nonMatchingSpec: "settings.spec.ts",
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
  const packageJson = readNextPackageJson();
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
  const androidSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/mobile-android.spec.ts";
  const worldIdMockSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/world-id-mock.spec.ts";
  const submitSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/submit.spec.ts";
  const confidentialContextSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/confidential-context.spec.ts";

  assert.equal(testIgnore.test(broadSpec), false, "ci-app should include broad app specs");
  assert.equal(
    testIgnore.test("/tmp/mobile-preview/packages/nextjs/e2e/tests/vote.spec.ts"),
    false,
    "ci-app ignores should not match workspace path segments",
  );
  assert.equal(testIgnore.test(smokeSpec), true, "ci-app should leave smoke specs to ci-smoke");
  assert.equal(testIgnore.test(apiSpec), true, "ci-app should leave API-only specs to ci-api");
  assert.equal(testIgnore.test(lifecycleSpec), true, "ci-app should leave lifecycle specs to lifecycle projects");
  assert.equal(
    testIgnore.test(compatSpec),
    true,
    "ci-app should leave browser compat specs to scheduled compat projects",
  );
  assert.equal(testIgnore.test(androidSpec), true, "ci-app should leave Android specs to mobile-android");
  assert.equal(testIgnore.test(worldIdMockSpec), true, "ci-app should leave World ID mock specs to the mock project");
  assert.equal(testIgnore.test(submitSpec), true, "ci-app should leave submit specs to ci-submit");
  assert.equal(
    testIgnore.test(confidentialContextSpec),
    true,
    "ci-app should leave confidential context specs to ci-confidential-context",
  );
});

test("CI submission projects isolate browser write-heavy specs", () => {
  const submitMatch = getProjectTestMatch("ci-submit");
  const confidentialMatch = getProjectTestMatch("ci-confidential-context");
  const submitSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/submit.spec.ts";
  const confidentialContextSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/confidential-context.spec.ts";
  const voteSpec = "/tmp/rateloop/packages/nextjs/e2e/tests/vote.spec.ts";

  assert.equal(submitMatch.test(submitSpec), true, "ci-submit should include submit specs");
  assert.equal(
    submitMatch.test(confidentialContextSpec),
    false,
    "ci-submit should not include confidential context specs",
  );
  assert.equal(submitMatch.test(voteSpec), false, "ci-submit should not include broad app specs");
  assert.equal(
    confidentialMatch.test(confidentialContextSpec),
    true,
    "ci-confidential-context should include confidential context specs",
  );
  assert.equal(confidentialMatch.test(submitSpec), false, "ci-confidential-context should not include submit specs");
  assert.equal(confidentialMatch.test(voteSpec), false, "ci-confidential-context should not include broad app specs");
});

test("broad Chromium ignores and lifecycle matches only target spec basenames", () => {
  const chromiumIgnore = getProjectTestIgnore("chromium");
  const settlementMatch = getProjectTestMatch("settlement");
  const keeperMatch = getProjectTestMatch("settlement-keeper");
  const cancellationMatch = getProjectTestMatch("round-cancellation");
  const dormancyMatch = getProjectTestMatch("content-dormancy");
  const broadSpec = "/tmp/mobile-preview/packages/nextjs/e2e/tests/vote.spec.ts";

  assert.equal(chromiumIgnore.test(broadSpec), false, "chromium ignores should not match workspace path segments");
  assert.equal(
    chromiumIgnore.test("/tmp/rateloop/packages/nextjs/e2e/tests/mobile-tablet.spec.ts"),
    true,
    "chromium should ignore tablet mobile specs",
  );
  assert.equal(
    chromiumIgnore.test("/tmp/rateloop/packages/nextjs/e2e/tests/mobile-android.spec.ts"),
    true,
    "chromium should ignore Android mobile specs",
  );
  assert.equal(
    settlementMatch.test("/tmp/settlement-lifecycle-worktree/packages/nextjs/e2e/tests/vote.spec.ts"),
    false,
    "settlement project should not match workspace path segments",
  );
  assert.equal(
    settlementMatch.test("/tmp/rateloop/packages/nextjs/e2e/tests/settlement-lifecycle.spec.ts"),
    true,
    "settlement project should match lifecycle specs by basename",
  );
  assert.equal(
    keeperMatch.test("/tmp/keeper-settlement-worktree/packages/nextjs/e2e/tests/vote.spec.ts"),
    false,
    "keeper project should not match workspace path segments",
  );
  assert.equal(
    cancellationMatch.test("/tmp/round-cancellation-worktree/packages/nextjs/e2e/tests/vote.spec.ts"),
    false,
    "round-cancellation project should not match workspace path segments",
  );
  assert.equal(
    dormancyMatch.test("/tmp/content-dormancy-worktree/packages/nextjs/e2e/tests/vote.spec.ts"),
    false,
    "content-dormancy project should not match workspace path segments",
  );
});

test("mobile specs avoid runtime project skips", () => {
  const phoneSpec = readFileSync("e2e/tests/mobile.spec.ts", "utf8");
  const androidSpec = readFileSync("e2e/tests/mobile-android.spec.ts", "utf8");
  const tabletSpec = readFileSync("e2e/tests/mobile-tablet.spec.ts", "utf8");

  assert.doesNotMatch(phoneSpec, /\btest\.skip\b/, "phone mobile spec should be selected by project config");
  assert.doesNotMatch(androidSpec, /\btest\.skip\b/, "Android mobile spec should be selected by project config");
  assert.doesNotMatch(tabletSpec, /\btest\.skip\b/, "tablet mobile spec should be selected by project config");
});

test("mobile CI scripts can run each device profile independently", () => {
  const packageJson = readNextPackageJson();
  const phoneShardScripts = [
    "e2e:mobile:phone:navigation",
    "e2e:mobile:phone:vote",
    "e2e:mobile:phone:pages",
  ];

  assert.match(packageJson.scripts?.["e2e:mobile"] ?? "", /--project=mobile-phone\b/);
  assert.match(packageJson.scripts?.["e2e:mobile"] ?? "", /--project=mobile-android\b/);
  assert.match(packageJson.scripts?.["e2e:mobile"] ?? "", /--project=mobile-tablet\b/);
  assert.match(packageJson.scripts?.["e2e:mobile:phone"] ?? "", /--project=mobile-phone\b/);
  assert.doesNotMatch(packageJson.scripts?.["e2e:mobile:phone"] ?? "", /--project=mobile-android\b/);
  for (const scriptName of phoneShardScripts) {
    const script = packageJson.scripts?.[scriptName] ?? "";
    assert.match(script, /--project=mobile-phone\b/, `${scriptName} should target the phone profile`);
    assert.match(script, /--grep\b/, `${scriptName} should keep scheduled WebKit phone coverage sharded`);
    assert.doesNotMatch(script, /--project=mobile-android\b/, `${scriptName} should not run Android coverage`);
    assert.doesNotMatch(script, /--project=mobile-tablet\b/, `${scriptName} should not run tablet coverage`);
  }
  assert.match(packageJson.scripts?.["e2e:mobile:android"] ?? "", /--project=mobile-android\b/);
  assert.doesNotMatch(packageJson.scripts?.["e2e:mobile:android"] ?? "", /--project=mobile-phone\b/);
  assert.match(packageJson.scripts?.["e2e:mobile:tablet"] ?? "", /--project=mobile-tablet\b/);
  assert.doesNotMatch(packageJson.scripts?.["e2e:mobile:tablet"] ?? "", /--project=mobile-phone\b/);
  assert.match(packageJson.scripts?.["e2e:ci:submit"] ?? "", /--project=ci-submit\b/);
  assert.match(
    packageJson.scripts?.["e2e:ci:confidential"] ?? "",
    /--project=ci-confidential-context\b/,
  );
});

test("GitHub E2E workflow commands stay backed by package Playwright scripts", () => {
  const packageJson = readNextPackageJson();
  const workflow = readE2EWorkflow();
  const commandMatches = [...workflow.matchAll(/command:\s*yarn workspace @rateloop\/nextjs ([^\s]+)/gu)].map(
    match => match[1],
  );

  assert.ok(commandMatches.length > 0, "expected GitHub E2E workflow matrix commands");

  for (const scriptName of commandMatches) {
    const script = packageJson.scripts?.[scriptName];

    assert.ok(script, `workflow command should reference an existing script: ${scriptName}`);
    assert.match(
      script,
      /\bplaywright test\b/,
      `${scriptName} should remain a Playwright test command`,
    );
  }
});

test("Playwright package versions stay aligned with the browser compatibility container", () => {
  const packageJson = readNextPackageJson();
  const workflow = readE2EWorkflow();
  const installedVersion = playwrightPackage.version;
  const escapedVersion = installedVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const imageMatch = workflow.match(/mcr\.microsoft\.com\/playwright:v(?<version>\d+\.\d+\.\d+)-/u);

  assert.equal(
    imageMatch?.groups?.version,
    installedVersion,
    "scheduled browser/mobile CI container should match the installed Playwright version",
  );
  assert.match(
    packageJson.devDependencies?.["@playwright/test"] ?? "",
    new RegExp(`(^|[^0-9])${escapedVersion}($|[^0-9])`, "u"),
    "@playwright/test devDependency should document the installed Playwright version",
  );
  assert.equal(
    packageJson.devDependencies?.["playwright-core"],
    installedVersion,
    "direct playwright-core dependency should stay in lockstep with @playwright/test",
  );
  assert.match(
    workflow,
    /mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-[^\s@]+@sha256:[a-f0-9]{64}/u,
    "scheduled browser/mobile CI container should be pinned by digest",
  );
  assert.equal(
    [...workflow.matchAll(/image:\s+postgres:16@sha256:[a-f0-9]{64}/gu)].length,
    2,
    "E2E Postgres service images should be pinned by digest",
  );
});

test("Vercel deploy scripts use the locked workspace CLI", () => {
  const packageJson = readNextPackageJson();

  assert.equal(packageJson.devDependencies?.vercel, "54.0.0");
  assert.match(packageJson.scripts?.vercel ?? "", /^vercel --build-env /);
  assert.equal(packageJson.scripts?.["vercel:login"], "vercel login");
  assert.doesNotMatch(packageJson.scripts?.vercel ?? "", /yarn dlx|vercel@/);
  assert.doesNotMatch(packageJson.scripts?.["vercel:login"] ?? "", /yarn dlx|vercel@/);
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

test("every E2E spec is assigned to at least one Playwright project", () => {
  const specs = readdirSync("e2e/tests")
    .filter(fileName => /\.spec\.[cm]?[jt]sx?$/.test(fileName))
    .map(fileName => join("/tmp/rateloop/packages/nextjs/e2e/tests", fileName));

  assert.ok(specs.length > 0, "expected at least one E2E spec file");

  const projects = config.projects ?? [];
  for (const specPath of specs) {
    const matchingProjects = projects.filter(project => projectIncludesSpec(project, specPath)).map(project => project.name);
    assert.ok(matchingProjects.length > 0, `${specPath} should be included by at least one Playwright project`);
  }
});

test("Playwright artifacts are written under the e2e directory for CI upload", () => {
  assert.match(String(config.outputDir), /packages[/\\]nextjs[/\\]e2e[/\\]test-results$/);

  const reporterEntries = config.reporter;
  assert.ok(Array.isArray(reporterEntries), "Playwright reporters should be configured as an array");
  assert.ok(
    reporterEntries.some(
      entry =>
        Array.isArray(entry) &&
        entry[0] === "html" &&
        typeof entry[1] === "object" &&
        entry[1] !== null &&
        "outputFolder" in entry[1] &&
        /packages[/\\]nextjs[/\\]e2e[/\\]playwright-report$/.test(String(entry[1].outputFolder)),
    ),
    "html reporter should write to packages/nextjs/e2e/playwright-report",
  );
});

test("Playwright config fails required E2E runs on unexpected skips", () => {
  const reporterEntries = config.reporter;
  assert.ok(Array.isArray(reporterEntries), "Playwright reporters should be configured as an array");
  assert.ok(
    reporterEntries.some(entry => Array.isArray(entry) && entry[0] === "./reporters/no-unexpected-skips.ts"),
    "required E2E runs should include the no-unexpected-skips reporter",
  );
});
