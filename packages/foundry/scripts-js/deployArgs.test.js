import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DEPLOYMENT_PROFILE,
  DEPLOY_HELP_TEXT,
  PRODUCTION_DEPLOYMENT_PROFILE,
  RATELOOP_DEPLOYMENT_PROFILE_ENV,
  assertDeployKeystoreAccountName,
  buildDeploymentProfileEnv,
  buildDeployFlowFlags,
  isDeployKeystoreAccountName,
  isSlowBroadcastNetwork,
  parseDeployArgs,
  readRpcChainId,
  resolveConfiguredRpcEndpoint,
  resolveEtherscanVerification,
  validateObservedDeployChain,
  validateProductionRedeployConfirmation,
} from "./deployArgs.js";

const parseArgsScript = fileURLToPath(
  new URL("./parseArgs.js", import.meta.url)
);
const checkProductionDeployGuardScript = fileURLToPath(
  new URL("./checkProductionDeployGuard.js", import.meta.url)
);
const makefilePath = fileURLToPath(new URL("../Makefile", import.meta.url));

function runNodeScript(script, args = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

async function withMockRpcChain(chainId, callback) {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = body ? JSON.parse(body) : {};
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id ?? 1,
          result: `0x${chainId.toString(16)}`,
        })
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const rpcUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(rpcUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

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
    parseDeployArgs(["--network", "base", "--keystore", "deployer"]),
    {
      showHelp: false,
      network: "base",
      keystoreArg: "deployer",
      resume: false,
    }
  );
});

test("parseDeployArgs accepts the explicit Base Sepolia tokenless target", () => {
  assert.deepEqual(
    parseDeployArgs([
      "--network",
      "baseSepolia",
      "--keystore",
      "tokenless-testnet",
    ]),
    {
      showHelp: false,
      network: "baseSepolia",
      keystoreArg: "tokenless-testnet",
      resume: false,
    }
  );
});

test("parseDeployArgs accepts conservative live keystore names", () => {
  assert.equal(isDeployKeystoreAccountName("keeper-prod_1.json"), true);
  assert.equal(
    parseDeployArgs(["--network", "base", "--keystore", "keeper-prod_1.json"])
      .keystoreArg,
    "keeper-prod_1.json"
  );
});

test("parseDeployArgs rejects unsafe live keystore names", () => {
  for (const value of [
    "keeper profile",
    "nested/keeper",
    "../keeper",
    "keeper;echo",
    "-keeper",
    ".keeper",
  ]) {
    assert.equal(isDeployKeystoreAccountName(value), false);
    assert.throws(
      () => parseDeployArgs(["--network", "base", "--keystore", value]),
      /(--keystore must be 1-128 characters|Missing value for --keystore)/
    );
    assert.throws(
      () => assertDeployKeystoreAccountName(value),
      /keystore name must be 1-128 characters/
    );
  }
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
  assert.equal(isSlowBroadcastNetwork("base"), true);
  assert.equal(isSlowBroadcastNetwork("baseSepolia"), true);
  assert.equal(isSlowBroadcastNetwork("localhost"), false);
  assert.equal(
    buildDeployFlowFlags("base", {}),
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
      network: "localhost",
    }),
    {
      [RATELOOP_DEPLOYMENT_PROFILE_ENV]: DEFAULT_DEPLOYMENT_PROFILE,
    }
  );
  assert.deepEqual(buildDeploymentProfileEnv({ network: "baseSepolia" }), {
    [RATELOOP_DEPLOYMENT_PROFILE_ENV]: DEFAULT_DEPLOYMENT_PROFILE,
  });
});

test("production deploy help documents the Base deploy path", () => {
  assert.match(DEPLOY_HELP_TEXT, /--network <network>/);
  assert.match(DEPLOY_HELP_TEXT, /yarn deploy --network base --keystore/);
  assert.match(
    DEPLOY_HELP_TEXT,
    /yarn deploy --network baseSepolia --keystore/
  );
});

test("validateObservedDeployChain accepts Base Sepolia without mainnet redeploy checks", async () => {
  const result = await validateObservedDeployChain({
    network: "baseSepolia",
    rpcUrl: "https://rpc.example",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ result: "0x14a34" }),
    }),
  });

  assert.deepEqual(result, {
    observedChainId: 84532,
    productionNetwork: null,
  });
});

test("validateProductionRedeployConfirmation ignores non-production networks", () => {
  assert.deepEqual(
    validateProductionRedeployConfirmation({
      network: "localhost",
      deploymentJson: null,
    }),
    {
      required: false,
      expectedToken: null,
    }
  );
});

test("validateProductionRedeployConfirmation allows missing production artifacts", () => {
  assert.deepEqual(
    validateProductionRedeployConfirmation({
      network: "base",
      deploymentJson: null,
    }),
    {
      required: false,
      expectedToken: null,
    }
  );
});

test("validateProductionRedeployConfirmation allows existing production artifacts without confirmation", () => {
  assert.deepEqual(
    validateProductionRedeployConfirmation({
      network: "base",
      deploymentJson: {
        deploymentBlockNumber: 47542128,
        deploymentProfile: PRODUCTION_DEPLOYMENT_PROFILE,
        networkName: "base",
      },
    }),
    {
      required: false,
      expectedToken: null,
    }
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
          networkName: "old-base",
        },
      }),
    /existing production artifact is for old-base/
  );
});

test("resolveConfiguredRpcEndpoint expands required environment variables", () => {
  assert.equal(
    resolveConfiguredRpcEndpoint("https://rpc.example/${API_KEY}", {
      API_KEY: "secret",
    }),
    "https://rpc.example/secret"
  );
  assert.throws(
    () => resolveConfiguredRpcEndpoint("https://rpc.example/${API_KEY}", {}),
    /API_KEY is required/
  );
});

test("readRpcChainId parses hex chain IDs", async () => {
  const chainId = await readRpcChainId("https://rpc.example", {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ result: "0x2105" }),
    }),
  });

  assert.equal(chainId, 8453);
});

test("readRpcChainId reports HTTP failures", async () => {
  await assert.rejects(
    () =>
      readRpcChainId("https://rpc.example", {
        fetchImpl: async () => ({
          ok: false,
          status: 500,
        }),
      }),
    /HTTP 500/
  );
});

test("readRpcChainId reports JSON-RPC errors", async () => {
  await assert.rejects(
    () =>
      readRpcChainId("https://rpc.example", {
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ error: { message: "bad method" } }),
        }),
      }),
    /bad method/
  );
});

test("readRpcChainId rejects invalid chain IDs", async () => {
  await assert.rejects(
    () =>
      readRpcChainId("https://rpc.example", {
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ result: "nope" }),
        }),
      }),
    /invalid chain ID/
  );
});

test("readRpcChainId times out stalled probes", async () => {
  await assert.rejects(
    () =>
      readRpcChainId("https://rpc.example", {
        timeoutMs: 1,
        fetchImpl: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      }),
    /timed out/
  );
});

test("deploy wrapper allows production redeploys before keystore selection", async () => {
  const result = await withMockRpcChain(8453, (rpcUrl) =>
    runNodeScript(
      parseArgsScript,
      ["--network", "base", "--keystore", "does-not-matter"],
      {
        BASE_RPC_URL: rpcUrl,
        HOME: "/tmp/rateloop-missing-keystore-home",
      }
    )
  );

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(
    result.stderr,
    /production contracts are already deployed/
  );
  assert.match(result.stdout, /Keystore 'does-not-matter' not found/);
});

test("direct make deploy guard allows production redeploys without confirmation", async () => {
  const result = await withMockRpcChain(8453, (rpcUrl) =>
    runNodeScript(checkProductionDeployGuardScript, [], {
      DEPLOY_TARGET_NETWORK: "base",
      RPC_URL: rpcUrl,
    })
  );

  assert.equal(result.status, 0);
});

test("direct make deploy guard rejects raw live RPC URLs without target network", () => {
  const result = spawnSync(
    process.execPath,
    [checkProductionDeployGuardScript],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DEPLOY_TARGET_NETWORK: "",
        RPC_URL: "https://base.example.invalid",
      },
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Refusing live make deploy without DEPLOY_TARGET_NETWORK/
  );
});

test("direct make deploy guard rejects live network aliases without target network", () => {
  const result = spawnSync(
    process.execPath,
    [checkProductionDeployGuardScript],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DEPLOY_TARGET_NETWORK: "",
        RPC_URL: "base",
      },
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Refusing live make deploy without DEPLOY_TARGET_NETWORK/
  );
});

test("direct make deploy guard rejects removed staging targets", async () => {
  const result = await withMockRpcChain(8453, (rpcUrl) =>
    runNodeScript(checkProductionDeployGuardScript, [], {
      DEPLOY_TARGET_NETWORK: "unsupported",
      RPC_URL: rpcUrl,
    })
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported deploy network: unsupported/);
});

test("Make live deploys run the production guard before Forge work", () => {
  const makefile = readFileSync(makefilePath, "utf8");
  assert.match(
    makefile,
    /guard-production-deploy:\n\t@node scripts-js\/checkProductionDeployGuard\.js/
  );
  assert.match(
    makefile,
    /deploy-and-generate-abis: guard-production-deploy check-contract-sizes/
  );
  assert.match(
    makefile,
    /LOCAL_DEPLOYMENT_SYNC_CONTRACTS := .*LoopReputation.*ContentRegistry.*RoundVotingEngine.*QuestionRewardPoolEscrow.*MockWorldIDRouter/
  );
  assert.match(
    makefile,
    /DEPLOY_TARGET_NETWORK" = "localhost".*validateLocalDeploymentSync\.js deployments\/31337\.json \.\.\/contracts\/src\/deployedContracts\.ts 31337 \$\(LOCAL_DEPLOYMENT_SYNC_CONTRACTS\)/s
  );
  assert.match(
    makefile,
    /\$\(MAKE\) guard-production-deploy \|\| exit 1; \\\n\t\t\$\(MAKE\) check-contract-sizes \|\| exit 1; \\\n\t\tFOUNDRY_PROFILE=.*forge script/s
  );
  assert.match(makefile, /--rpc-url "\$\(RPC_URL\)"/);
  assert.match(makefile, /--account "\$\(ETH_KEYSTORE_ACCOUNT\)"/);
  assert.match(makefile, /cast wallet address --account "\$\(ACCOUNT_NAME\)"/);
  assert.match(
    makefile,
    /deploy-tokenless-and-generate-artifacts: guard-production-deploy/
  );
  assert.match(
    makefile,
    /script\/DeployTokenless\.s\.sol --tc DeployTokenlessScript/
  );
  assert.match(
    makefile,
    /exportTokenlessDeploymentFromBroadcast\.js[\s\S]*generateTokenlessArtifacts\.js/
  );
});

test("deploy wrapper validates local deployment sync before seeding", () => {
  const source = readFileSync(parseArgsScript, "utf8");

  assert.match(
    source,
    /network === "baseSepolia"[\s\S]*"deploy-tokenless-and-generate-artifacts"/
  );

  assert.match(
    source,
    /const LOCAL_DEPLOYMENT_SYNC_CONTRACTS = \[[\s\S]*"LoopReputation"[\s\S]*"ContentRegistry"[\s\S]*"RoundVotingEngine"[\s\S]*"MockWorldIDRouter"[\s\S]*\]/
  );
  assert.match(
    source,
    /validateLocalDeploymentSync\.js"[\s\S]*"deployments",\s*"31337\.json"[\s\S]*"deployedContracts\.ts"[\s\S]*\.\.\.LOCAL_DEPLOYMENT_SYNC_CONTRACTS/
  );
  assert.match(
    source,
    /if \(localDeploymentSyncResult\.status !== 0\) \{[\s\S]*process\.exit\(localDeploymentSyncResult\.status\);[\s\S]*\}[\s\S]*const fundKeeperScript/
  );
});

test("resolveEtherscanVerification skips when the required API key env is missing", () => {
  assert.deepEqual(
    resolveEtherscanVerification({
      etherscanConfig: {
        key: "${BASESCAN_API_KEY}",
        url: "https://api.basescan.org/api",
      },
      env: {},
    }),
    {
      verifyFlags: "",
      reason: "missing-api-key",
      requiredApiKeyEnv: "BASESCAN_API_KEY",
    }
  );
});

test("resolveEtherscanVerification enables verification when the required API key env is present", () => {
  assert.deepEqual(
    resolveEtherscanVerification({
      etherscanConfig: {
        key: "${BASESCAN_API_KEY}",
        url: "https://api.basescan.org/api",
      },
      env: {
        BASESCAN_API_KEY: "abc123",
      },
    }),
    {
      verifyFlags: "--verify",
      reason: "enabled",
      requiredApiKeyEnv: "BASESCAN_API_KEY",
    }
  );
});
