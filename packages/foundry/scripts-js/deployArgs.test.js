import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DEPLOYMENT_PROFILE,
  DEPLOY_HELP_TEXT,
  PRODUCTION_DEPLOYMENT_PROFILE,
  PRODUCTION_REDEPLOY_CONFIRMATION_ENV,
  RATELOOP_DEPLOYMENT_PROFILE_ENV,
  buildDeploymentProfileEnv,
  buildDeployFlowFlags,
  buildProductionRedeployConfirmationToken,
  isSlowBroadcastNetwork,
  parseDeployArgs,
  resolveEtherscanVerification,
  validateProductionRedeployConfirmation,
} from "./deployArgs.js";

const parseArgsScript = fileURLToPath(
  new URL("./parseArgs.js", import.meta.url),
);

test("parseDeployArgs returns defaults with no options", () => {
  assert.deepEqual(parseDeployArgs([]), {
    showHelp: false,
    network: "localhost",
    keystoreArg: null,
    resume: false,
    productionRedeployConfirmation: null,
  });
});

test("parseDeployArgs reads supported options", () => {
  assert.deepEqual(
    parseDeployArgs(["--network", "baseSepolia", "--keystore", "deployer"]),
    {
      showHelp: false,
      network: "baseSepolia",
      keystoreArg: "deployer",
      resume: false,
      productionRedeployConfirmation: null,
    },
  );
});

test("parseDeployArgs reads resume", () => {
  assert.deepEqual(parseDeployArgs(["--resume"]), {
    showHelp: false,
    network: "localhost",
    keystoreArg: null,
    resume: true,
    productionRedeployConfirmation: null,
  });
});

test("parseDeployArgs handles help", () => {
  assert.deepEqual(parseDeployArgs(["--help"]), {
    showHelp: true,
    network: "localhost",
    keystoreArg: null,
    resume: false,
    productionRedeployConfirmation: null,
  });
});

test("parseDeployArgs reads production redeploy confirmation", () => {
  assert.deepEqual(
    parseDeployArgs([
      "--network",
      "base",
      "--confirm-production-redeploy",
      "8453:47542128",
    ]),
    {
      showHelp: false,
      network: "base",
      keystoreArg: null,
      resume: false,
      productionRedeployConfirmation: "8453:47542128",
    },
  );
});

test("parseDeployArgs rejects unknown options", () => {
  assert.throws(() => parseDeployArgs(["--bogus"]), /Unknown option: --bogus/);
});

test("parseDeployArgs rejects missing values", () => {
  assert.throws(
    () => parseDeployArgs(["--network"]),
    /Missing value for --network/,
  );
  assert.throws(
    () => parseDeployArgs(["--confirm-production-redeploy"]),
    /Missing value for --confirm-production-redeploy/,
  );
});

test("parseDeployArgs rejects positional arguments", () => {
  assert.throws(
    () => parseDeployArgs(["sepolia"]),
    /Unexpected argument: sepolia/,
  );
});

test("parseDeployArgs rejects networks unsupported by the deploy script", () => {
  assert.throws(
    () => parseDeployArgs(["--network", "sepolia"]),
    /Unsupported deploy network: sepolia/,
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
    "--slow --compute-units-per-second 25 --rpc-timeout 120 --timeout 300",
  );
});

test("buildDeployFlowFlags accepts neutral live throttle overrides", () => {
  assert.equal(
    buildDeployFlowFlags("base", {
      RATELOOP_LIVE_DEPLOY_COMPUTE_UNITS_PER_SECOND: "10",
      RATELOOP_LIVE_DEPLOY_RPC_TIMEOUT_SECONDS: "180",
      RATELOOP_LIVE_DEPLOY_BROADCAST_TIMEOUT_SECONDS: "600",
    }),
    "--slow --compute-units-per-second 10 --rpc-timeout 180 --timeout 600",
  );
});

test("buildDeployFlowFlags accepts legacy World Chain throttle overrides", () => {
  assert.equal(
    buildDeployFlowFlags("worldchain", {
      WORLDCHAIN_DEPLOY_COMPUTE_UNITS_PER_SECOND: "10",
      WORLDCHAIN_DEPLOY_RPC_TIMEOUT_SECONDS: "180",
      WORLDCHAIN_DEPLOY_BROADCAST_TIMEOUT_SECONDS: "600",
    }),
    "--slow --compute-units-per-second 10 --rpc-timeout 180 --timeout 600",
  );
});

test("buildDeploymentProfileEnv defaults mainnets to production", () => {
  assert.deepEqual(
    buildDeploymentProfileEnv({
      network: "base",
    }),
    {
      [RATELOOP_DEPLOYMENT_PROFILE_ENV]: PRODUCTION_DEPLOYMENT_PROFILE,
    },
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
        },
      ),
    /must be production/,
  );
});

test("buildDeploymentProfileEnv defaults non-mainnet deployments to default", () => {
  assert.deepEqual(
    buildDeploymentProfileEnv({
      network: "baseSepolia",
    }),
    {
      [RATELOOP_DEPLOYMENT_PROFILE_ENV]: DEFAULT_DEPLOYMENT_PROFILE,
    },
  );
});

test("production deploy help avoids ordinary mainnet redeploy examples", () => {
  assert.match(DEPLOY_HELP_TEXT, /--confirm-production-redeploy/);
  assert.doesNotMatch(
    DEPLOY_HELP_TEXT,
    /yarn deploy --network base --keystore/,
  );
});

test("buildProductionRedeployConfirmationToken uses chain and deployment block", () => {
  assert.equal(
    buildProductionRedeployConfirmationToken({
      chainId: 8453,
      deploymentBlockNumber: 47542128,
    }),
    "8453:47542128",
  );
});

test("validateProductionRedeployConfirmation ignores non-production networks", () => {
  assert.deepEqual(
    validateProductionRedeployConfirmation({
      network: "baseSepolia",
      deploymentJson: null,
      confirmation: null,
    }),
    {
      required: false,
      expectedToken: null,
    },
  );
});

test("validateProductionRedeployConfirmation rejects existing production artifacts without confirmation", () => {
  assert.throws(
    () =>
      validateProductionRedeployConfirmation({
        network: "base",
        deploymentJson: {
          deploymentBlockNumber: 47542128,
          deploymentProfile: PRODUCTION_DEPLOYMENT_PROFILE,
          networkName: "base",
        },
        confirmation: null,
      }),
    /production contracts are already deployed/,
  );
});

test("validateProductionRedeployConfirmation accepts the current artifact token", () => {
  assert.deepEqual(
    validateProductionRedeployConfirmation({
      network: "base",
      deploymentJson: {
        deploymentBlockNumber: 47542128,
        deploymentProfile: PRODUCTION_DEPLOYMENT_PROFILE,
        networkName: "base",
      },
      confirmation: "8453:47542128",
    }),
    {
      required: true,
      expectedToken: "8453:47542128",
    },
  );
});

test("validateProductionRedeployConfirmation message names the env break-glass token", () => {
  assert.throws(
    () =>
      validateProductionRedeployConfirmation({
        network: "base",
        deploymentJson: {
          deploymentBlockNumber: 47542128,
          deploymentProfile: PRODUCTION_DEPLOYMENT_PROFILE,
          networkName: "base",
        },
        confirmation: "8453:1",
      }),
    new RegExp(`${PRODUCTION_REDEPLOY_CONFIRMATION_ENV}=8453:47542128`),
  );
});

test("validateProductionRedeployConfirmation rejects mismatched production artifacts", () => {
  assert.throws(
    () =>
      validateProductionRedeployConfirmation({
        network: "base",
        deploymentJson: {
          deploymentBlockNumber: 47542128,
          deploymentProfile: PRODUCTION_DEPLOYMENT_PROFILE,
          networkName: "worldchain",
        },
        confirmation: "8453:47542128",
      }),
    /existing production artifact is for worldchain/,
  );
});

test("deploy wrapper rejects production redeploys before keystore selection", () => {
  const result = spawnSync(
    process.execPath,
    [parseArgsScript, "--network", "base", "--keystore", "does-not-matter"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: "/tmp/rateloop-missing-keystore-home",
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production contracts are already deployed/);
  assert.doesNotMatch(result.stdout, /Keystore/);
});

test("resolveEtherscanVerification skips when the required API key env is missing", () => {
  assert.deepEqual(
    resolveEtherscanVerification({
      etherscanConfig: {
        key: "${BASESCAN_API_KEY}",
        url: "https://api-sepolia.basescan.org/api",
      },
      env: {},
    }),
    {
      verifyFlags: "",
      reason: "missing-api-key",
      requiredApiKeyEnv: "BASESCAN_API_KEY",
    },
  );
});

test("resolveEtherscanVerification enables verification when the required API key env is present", () => {
  assert.deepEqual(
    resolveEtherscanVerification({
      etherscanConfig: {
        key: "${BASESCAN_API_KEY}",
        url: "https://api-sepolia.basescan.org/api",
      },
      env: {
        BASESCAN_API_KEY: "abc123",
      },
    }),
    {
      verifyFlags: "--verify",
      reason: "enabled",
      requiredApiKeyEnv: "BASESCAN_API_KEY",
    },
  );
});
