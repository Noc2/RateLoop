import { compareDeployedCommit } from "./check-deployed-commit.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const HEAD = "0d05e26d9f40d9ac9a18899071d169c7b50a6fd4";
const OLDER = "381797558480e79fc916a98076437be7b6bfbfef";

function identity(overrides = {}) {
  return {
    schemaVersion: "rateloop.release-identity.v1",
    deploymentLine: "tokenless",
    project: { id: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm", name: "rateloop-tokenless" },
    environment: "production",
    git: { ref: "tokenless", sha: HEAD },
    ...overrides,
  };
}

test("a deployment serving the branch head passes", () => {
  assert.deepEqual(compareDeployedCommit({ deployed: identity(), expectedSha: HEAD }), {
    ok: true,
    deployedSha: HEAD,
  });
});

test("a deployment behind the branch head is reported as drift, with both SHAs", () => {
  const result = compareDeployedCommit({
    deployed: identity({ git: { ref: "tokenless", sha: OLDER } }),
    expectedSha: HEAD,
  });
  assert.equal(result.ok, false);
  assert.equal(result.drift, true);
  assert.equal(result.deployedSha, OLDER);
  assert.equal(result.expectedSha, HEAD);
});

test("anything other than the isolated tokenless project is refused, not compared", () => {
  // The legacy production project must never be treated as this branch's deployment,
  // even if it somehow answered the request.
  for (const deployed of [
    identity({ deploymentLine: "main" }),
    identity({ project: { id: "prj_Dx9GGHzXGgf55lYGuVXHwhbke2Wb", name: "rate-loop-nextjs" } }),
    identity({ git: { ref: "main", sha: HEAD } }),
  ]) {
    const result = compareDeployedCommit({ deployed, expectedSha: HEAD });
    assert.equal(result.ok, false);
    assert.notEqual(result.drift, true, "a foreign deployment must not be reported as mere drift");
  }
});

test("an unusable release identity fails loudly rather than passing", () => {
  for (const deployed of [undefined, {}, identity({ git: { ref: "tokenless", sha: "not-a-sha" } })]) {
    assert.equal(compareDeployedCommit({ deployed, expectedSha: HEAD }).ok, false);
  }
  assert.equal(compareDeployedCommit({ deployed: identity(), expectedSha: "HEAD" }).ok, false);
});
