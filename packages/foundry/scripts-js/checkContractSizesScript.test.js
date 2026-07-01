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

test("contract size gate validates deploy-profile artifacts", () => {
  const script = readFileSync(
    join("packages", "foundry", "scripts", "check-contract-sizes.sh"),
    "utf8"
  );
  const packageJson = JSON.parse(
    readFileSync(join("packages", "foundry", "package.json"), "utf8")
  );
  const makefile = readFileSync(
    join("packages", "foundry", "Makefile"),
    "utf8"
  );

  assert.equal(packageJson.scripts["check:sizes"], "make check-contract-sizes");
  assert.match(makefile, /forge build --force --skip script --skip test/);
  assert.match(makefile, /forge build \$\(DEPLOYED_DEPENDENCY_SIZE_SOURCES\)/);
  assert.doesNotMatch(
    makefile,
    /forge build --force \$\(DEPLOYED_DEPENDENCY_SIZE_SOURCES\)/
  );
  assert.match(script, /Non-deploy-profile artifact/);
  assert.match(script, /metadata\.settings\.optimizer\.runs/);
  assert.match(script, /metadata\.settings\.metadata\.bytecodeHash/);
  assert.match(script, /metadata\.settings\.metadata\.appendCBOR/);
});
