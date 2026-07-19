import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const staticAnalysis = readFileSync(
  new URL("../.github/workflows/static-analysis.yaml", import.meta.url),
  "utf8",
);
const codeql = readFileSync(
  new URL("../.github/workflows/codeql.yaml", import.meta.url),
  "utf8",
);
const dependabot = readFileSync(
  new URL("../.github/dependabot.yml", import.meta.url),
  "utf8",
);
const keeperDockerfile = readFileSync(
  new URL("../packages/keeper/Dockerfile", import.meta.url),
  "utf8",
);
const keeperRailway = readFileSync(
  new URL("../packages/keeper/railway.toml", import.meta.url),
  "utf8",
);

test("JavaScript and TypeScript CodeQL runs on tokenless changes and a weekly schedule", () => {
  assert.match(codeql, /languages: javascript-typescript/);
  assert.match(codeql, /queries: security-extended/);
  assert.match(codeql, /branches: \[main, tokenless\]/);
  assert.match(codeql, /schedule:/);
});

test("both hosted images are scanned, inventoried, and attested", () => {
  for (const service of ["keeper", "ponder"]) {
    assert.match(
      staticAnalysis,
      new RegExp(`rateloop-tokenless-${service}\\.cdx\\.json`, "u"),
    );
    assert.match(
      staticAnalysis,
      new RegExp(`rateloop-tokenless-${service}\\.sarif`, "u"),
    );
    assert.match(
      staticAnalysis,
      new RegExp(`rateloop-tokenless-${service}\\.tar`, "u"),
    );
  }
  assert.match(staticAnalysis, /anchore\/syft@sha256:[0-9a-f]{64}/u);
  assert.match(staticAnalysis, /aquasec\/trivy@sha256:[0-9a-f]{64}/u);
  assert.equal(
    (staticAnalysis.match(/uses: actions\/attest@[0-9a-f]{40}/gu) ?? []).length,
    4,
  );
  assert.match(staticAnalysis, /attestations: write/);
  assert.match(staticAnalysis, /artifact-metadata: write/);
});

test("dependency updates cover packages, actions, and each Dockerfile", () => {
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.equal(
    (dependabot.match(/package-ecosystem: docker/gu) ?? []).length,
    2,
  );
  assert.equal(
    (dependabot.match(/target-branch: tokenless/gu) ?? []).length,
    4,
  );
  assert.match(dependabot, /directory: \/packages\/keeper/);
  assert.match(dependabot, /directory: \/packages\/ponder/);
});

test("the keeper container runs unprivileged and probes operational readiness", () => {
  assert.match(keeperDockerfile, /^USER node$/mu);
  assert.match(keeperDockerfile, /HEALTHCHECK .*--start-period=(?:[6-9]\d|\d{3,})s/u);
  assert.match(keeperDockerfile, /path:\s*['"]\/ready['"]/u);
  assert.doesNotMatch(keeperDockerfile, /^ENTRYPOINT\b/mu);
  assert.equal(
    existsSync(new URL("../packages/keeper/docker-entrypoint.sh", import.meta.url)),
    false,
  );
  assert.match(keeperRailway, /^healthcheckPath = "\/ready"$/mu);
});
