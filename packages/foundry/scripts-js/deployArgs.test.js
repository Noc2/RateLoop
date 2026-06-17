import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEPLOYMENT_PROFILE,
  PRODUCTION_DEPLOYMENT_PROFILE,
  RATELOOP_DEPLOYMENT_PROFILE_ENV,
  buildDeploymentProfileEnv,
  buildDeployFlowFlags,
  isSlowBroadcastNetwork,
  parseDeployArgs,
} from "./deployArgs.js";

test("parseDeployArgs returns defaults with no options", () => {
  assert.deepEqual(parseDeployArgs([]), {
    showHelp: false,
    network: "localhost",
    keystoreArg: null,
    resume: false,
  });
});

test("parseDeployArgs reads supported options", () => {
  assert.deepEqual(
    parseDeployArgs([
      "--network",
      "baseSepolia",
      "--keystore",
      "deployer",
    ]),
    {
      showHelp: false,
      network: "baseSepolia",
      keystoreArg: "deployer",
      resume: false,
    }
  );
});

test("parseDeployArgs reads resume", () => {
  assert.deepEqual(parseDeployArgs(["--resume"]), {
    showHelp: false,
    network: "localhost",
    keystoreArg: null,
    resume: true,
  });
});

test("parseDeployArgs handles help", () => {
  assert.deepEqual(parseDeployArgs(["--help"]), {
    showHelp: true,
    network: "localhost",
    keystoreArg: null,
    resume: false,
  });
});

test("parseDeployArgs rejects unknown options", () => {
  assert.throws(() => parseDeployArgs(["--bogus"]), /Unknown option: --bogus/);
});

test("parseDeployArgs rejects missing values", () => {
  assert.throws(
    () => parseDeployArgs(["--network"]),
    /Missing value for --network/
  );
});

test("parseDeployArgs rejects positional arguments", () => {
  assert.throws(
    () => parseDeployArgs(["sepolia"]),
    /Unexpected argument: sepolia/
  );
});

test("parseDeployArgs rejects networks unsupported by the deploy script", () => {
  assert.throws(
    () => parseDeployArgs(["--network", "sepolia"]),
    /Unsupported deploy network: sepolia/
  );
});

test("buildDeployFlowFlags leaves local deploys unchanged", () => {
  assert.equal(buildDeployFlowFlags("localhost", {}), "");
});

test("buildDeployFlowFlags throttles live deploys", () => {
  assert.equal(isSlowBroadcastNetwork("baseSepolia"), true);
  assert.equal(isSlowBroadcastNetwork("worldchainSepolia"), true);
  assert.equal(
    buildDeployFlowFlags("baseSepolia", {}),
    "--slow --compute-units-per-second 25 --rpc-timeout 120 --timeout 300"
  );
});

test("buildDeployFlowFlags accepts neutral live throttle overrides", () => {
  assert.equal(
    buildDeployFlowFlags("base", {
      RATELOOP_LIVE_DEPLOY_COMPUTE_UNITS_PER_SECOND: "10",
      RATELOOP_LIVE_DEPLOY_RPC_TIMEOUT_SECONDS: "180",
      RATELOOP_LIVE_DEPLOY_BROADCAST_TIMEOUT_SECONDS: "600",
    }),
    "--slow --compute-units-per-second 10 --rpc-timeout 180 --timeout 600"
  );
});

test("buildDeployFlowFlags accepts legacy World Chain throttle overrides", () => {
  assert.equal(
    buildDeployFlowFlags("worldchain", {
      WORLDCHAIN_DEPLOY_COMPUTE_UNITS_PER_SECOND: "10",
      WORLDCHAIN_DEPLOY_RPC_TIMEOUT_SECONDS: "180",
      WORLDCHAIN_DEPLOY_BROADCAST_TIMEOUT_SECONDS: "600",
    }),
    "--slow --compute-units-per-second 10 --rpc-timeout 180 --timeout 600"
  );
});

test("buildDeploymentProfileEnv defaults mainnets to production", () => {
  assert.deepEqual(
    buildDeploymentProfileEnv({
      network: "base",
    }),
    {
      [RATELOOP_DEPLOYMENT_PROFILE_ENV]: PRODUCTION_DEPLOYMENT_PROFILE,
    }
  );
});

test("buildDeploymentProfileEnv rejects non-production mainnet profile overrides", () => {
  assert.throws(
    () =>
      buildDeploymentProfileEnv(
        {
          network: "base",
        },
        {
          [RATELOOP_DEPLOYMENT_PROFILE_ENV]: "staging",
        }
      ),
    /must be production/
  );
});

test("buildDeploymentProfileEnv defaults non-mainnet deployments to default", () => {
  assert.deepEqual(
    buildDeploymentProfileEnv({
      network: "baseSepolia",
    }),
    {
      [RATELOOP_DEPLOYMENT_PROFILE_ENV]: DEFAULT_DEPLOYMENT_PROFILE,
    }
  );
});
