import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEPLOYMENT_PROFILE,
  MAINNET_CANARY_DEPLOYMENT_PROFILE,
  PRODUCTION_DEPLOYMENT_PROFILE,
  RATELOOP_DEPLOYMENT_PROFILE_ENV,
  RATELOOP_MAINNET_CANARY_ENV,
  WORLD_ID_STAGING_VERIFIER_ADDRESS,
  WORLD_ID_V4_VERIFIER_ADDRESS_ENV,
  buildDeploymentProfileEnv,
  buildDeployFlowFlags,
  buildWorldIdStagingCanaryEnv,
  isSlowBroadcastNetwork,
  parseDeployArgs,
} from "./deployArgs.js";

test("parseDeployArgs returns defaults with no options", () => {
  assert.deepEqual(parseDeployArgs([]), {
    showHelp: false,
    network: "localhost",
    keystoreArg: null,
    resume: false,
    worldIdStagingCanary: false,
  });
});

test("parseDeployArgs reads supported options", () => {
  assert.deepEqual(
    parseDeployArgs([
      "--network",
      "worldchainSepolia",
      "--keystore",
      "deployer",
    ]),
    {
      showHelp: false,
      network: "worldchainSepolia",
      keystoreArg: "deployer",
      resume: false,
      worldIdStagingCanary: false,
    }
  );
});

test("parseDeployArgs reads resume", () => {
  assert.deepEqual(parseDeployArgs(["--resume"]), {
    showHelp: false,
    network: "localhost",
    keystoreArg: null,
    resume: true,
    worldIdStagingCanary: false,
  });
});

test("parseDeployArgs reads worldchain staging canary flag", () => {
  assert.deepEqual(
    parseDeployArgs([
      "--network",
      "worldchain",
      "--world-id-staging-canary",
      "--keystore",
      "deployer",
    ]),
    {
      showHelp: false,
      network: "worldchain",
      keystoreArg: "deployer",
      resume: false,
      worldIdStagingCanary: true,
    }
  );
});

test("parseDeployArgs handles help", () => {
  assert.deepEqual(parseDeployArgs(["--help"]), {
    showHelp: true,
    network: "localhost",
    keystoreArg: null,
    resume: false,
    worldIdStagingCanary: false,
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

test("parseDeployArgs rejects worldchain staging canary outside mainnet", () => {
  assert.throws(
    () =>
      parseDeployArgs([
        "--network",
        "worldchainSepolia",
        "--world-id-staging-canary",
      ]),
    /--world-id-staging-canary is only supported with --network worldchain/
  );
});

test("buildDeployFlowFlags leaves non-World Chain deploys unchanged", () => {
  assert.equal(buildDeployFlowFlags("localhost", {}), "");
});

test("buildDeployFlowFlags throttles World Chain deploys", () => {
  assert.equal(isSlowBroadcastNetwork("worldchainSepolia"), true);
  assert.equal(
    buildDeployFlowFlags("worldchainSepolia", {}),
    "--slow --compute-units-per-second 25 --rpc-timeout 120 --timeout 300"
  );
});

test("buildDeployFlowFlags accepts World Chain throttle overrides", () => {
  assert.equal(
    buildDeployFlowFlags("worldchain", {
      WORLDCHAIN_DEPLOY_COMPUTE_UNITS_PER_SECOND: "10",
      WORLDCHAIN_DEPLOY_RPC_TIMEOUT_SECONDS: "180",
      WORLDCHAIN_DEPLOY_BROADCAST_TIMEOUT_SECONDS: "600",
    }),
    "--slow --compute-units-per-second 10 --rpc-timeout 180 --timeout 600"
  );
});

test("buildWorldIdStagingCanaryEnv sets canary and staging verifier env", () => {
  assert.deepEqual(buildWorldIdStagingCanaryEnv({}), {
    [RATELOOP_MAINNET_CANARY_ENV]: "true",
    [WORLD_ID_V4_VERIFIER_ADDRESS_ENV]: WORLD_ID_STAGING_VERIFIER_ADDRESS,
  });
});

test("buildWorldIdStagingCanaryEnv accepts existing staging verifier casing", () => {
  assert.deepEqual(
    buildWorldIdStagingCanaryEnv({
      [WORLD_ID_V4_VERIFIER_ADDRESS_ENV]:
        WORLD_ID_STAGING_VERIFIER_ADDRESS.toLowerCase(),
    }),
    {
      [RATELOOP_MAINNET_CANARY_ENV]: "true",
      [WORLD_ID_V4_VERIFIER_ADDRESS_ENV]: WORLD_ID_STAGING_VERIFIER_ADDRESS,
    }
  );
});

test("buildWorldIdStagingCanaryEnv rejects conflicting verifier override", () => {
  assert.throws(
    () =>
      buildWorldIdStagingCanaryEnv({
        [WORLD_ID_V4_VERIFIER_ADDRESS_ENV]:
          "0x00000000009E00F9FE82CfeeBB4556686da094d7",
      }),
    /--world-id-staging-canary requires WORLD_ID_V4_VERIFIER_ADDRESS/
  );
});

test("buildDeploymentProfileEnv defaults worldchain to production", () => {
  assert.deepEqual(
    buildDeploymentProfileEnv({
      network: "worldchain",
      worldIdStagingCanary: false,
    }),
    {
      [RATELOOP_DEPLOYMENT_PROFILE_ENV]: PRODUCTION_DEPLOYMENT_PROFILE,
    }
  );
});

test("buildDeploymentProfileEnv defaults non-mainnet deployments to default", () => {
  assert.deepEqual(
    buildDeploymentProfileEnv({
      network: "worldchainSepolia",
      worldIdStagingCanary: false,
    }),
    {
      [RATELOOP_DEPLOYMENT_PROFILE_ENV]: DEFAULT_DEPLOYMENT_PROFILE,
    }
  );
});

test("buildDeploymentProfileEnv stamps worldchain staging canary", () => {
  assert.deepEqual(
    buildDeploymentProfileEnv({
      network: "worldchain",
      worldIdStagingCanary: true,
    }),
    {
      [RATELOOP_DEPLOYMENT_PROFILE_ENV]: MAINNET_CANARY_DEPLOYMENT_PROFILE,
    }
  );
});

test("buildDeploymentProfileEnv rejects production profile for canary flag", () => {
  assert.throws(
    () =>
      buildDeploymentProfileEnv(
        {
          network: "worldchain",
          worldIdStagingCanary: true,
        },
        { [RATELOOP_DEPLOYMENT_PROFILE_ENV]: PRODUCTION_DEPLOYMENT_PROFILE }
      ),
    /--world-id-staging-canary requires RATELOOP_DEPLOYMENT_PROFILE/
  );
});

test("buildDeploymentProfileEnv rejects canary profile without canary flag", () => {
  assert.throws(
    () =>
      buildDeploymentProfileEnv(
        {
          network: "worldchain",
          worldIdStagingCanary: false,
        },
        { [RATELOOP_DEPLOYMENT_PROFILE_ENV]: MAINNET_CANARY_DEPLOYMENT_PROFILE }
      ),
    /RATELOOP_DEPLOYMENT_PROFILE=mainnet-canary requires --world-id-staging-canary/
  );
});
