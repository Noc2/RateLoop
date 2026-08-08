#!/usr/bin/env node
/**
 * Reports whether the deployed tokenless site is serving the branch head.
 *
 * Auto-deploy is deliberately disabled for `tokenless` (`vercel.json` sets
 * `deploymentEnabled.tokenless: false`), so a push never reaches the site. Nothing
 * observed the gap that created: the deployment once sat twenty-three commits
 * behind for a full working session, and the only reason it surfaced was somebody
 * asking. This turns "please check" into a signal.
 *
 * It only ever reads. It targets the isolated tokenless alias and nothing else —
 * the legacy production project is never contacted.
 */

const TOKENLESS_RELEASE_URL = "https://rateloop-tokenless.vercel.app/api/release";
const EXPECTED_PROJECT = "rateloop-tokenless";
const EXPECTED_REF = "tokenless";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function compareDeployedCommit(input) {
  const { deployed, expectedSha } = input;
  if (deployed?.deploymentLine !== "tokenless") {
    return { ok: false, reason: `release identity is not the tokenless line: ${deployed?.deploymentLine ?? "absent"}` };
  }
  if (deployed?.project?.name !== EXPECTED_PROJECT) {
    return { ok: false, reason: `release identity names project ${deployed?.project?.name ?? "absent"}` };
  }
  const sha = deployed?.git?.sha;
  const ref = deployed?.git?.ref;
  if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
    return { ok: false, reason: `release identity carries no usable commit SHA: ${String(sha)}` };
  }
  if (ref !== EXPECTED_REF) {
    return { ok: false, reason: `deployment serves ref ${String(ref)}, expected ${EXPECTED_REF}` };
  }
  if (!SHA_PATTERN.test(expectedSha)) {
    return { ok: false, reason: `expected SHA is not a full lowercase commit SHA: ${expectedSha}` };
  }
  if (sha !== expectedSha) {
    return {
      ok: false,
      drift: true,
      deployedSha: sha,
      expectedSha,
      reason: "the deployment is behind the branch head",
    };
  }
  return { ok: true, deployedSha: sha };
}

async function main() {
  const expectedSha = (process.argv[2] ?? process.env.EXPECTED_COMMIT_SHA ?? "").trim().toLowerCase();
  if (!expectedSha) {
    console.error("Usage: node scripts/check-deployed-commit.mjs <expected-commit-sha>");
    process.exitCode = 2;
    return;
  }
  let deployed;
  try {
    const response = await fetch(TOKENLESS_RELEASE_URL, { headers: { accept: "application/json" } });
    if (!response.ok) {
      console.error(`Release identity request failed with HTTP ${response.status}.`);
      process.exitCode = 2;
      return;
    }
    deployed = await response.json();
  } catch (error) {
    console.error(`Release identity request failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  const result = compareDeployedCommit({ deployed, expectedSha });
  if (result.ok) {
    console.log(`rateloop-tokenless.vercel.app is serving ${result.deployedSha}, which is the branch head.`);
    return;
  }
  if (result.drift) {
    console.error(
      `rateloop-tokenless.vercel.app is serving ${result.deployedSha} but the branch head is ${result.expectedSha}.\n` +
        "Auto-deploy is disabled for this branch on purpose, so deploy manually with `yarn vercel --prod`.",
    );
    process.exitCode = 1;
    return;
  }
  console.error(result.reason);
  process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
