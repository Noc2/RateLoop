import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("contract size gate includes linked libraries", () => {
  const script = readFileSync(
    join("packages", "foundry", "scripts", "check-contract-sizes.sh"),
    "utf8"
  );

  assert.match(
    script,
    /including linked libraries and deploy-only dependencies/
  );
  assert.doesNotMatch(script, /!\s+-path\s+"\$CONTRACTS_DIR\/libraries\/\*"/);
  assert.doesNotMatch(script, /abi_length/);
  assert.match(script, /!\s+-path\s+"\$CONTRACTS_DIR\/interfaces\/\*"/);
  assert.match(script, /!\s+-path\s+"\$CONTRACTS_DIR\/mocks\/\*"/);
  assert.match(script, /TimelockController\.sol/);
  assert.match(script, /ProxyAdmin\.sol/);
  assert.match(script, /TransparentUpgradeableProxy\.sol/);
  assert.match(script, /check_source_artifacts "\$source"/);
});
