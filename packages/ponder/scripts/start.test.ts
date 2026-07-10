import { EventEmitter } from "node:events";
import {
  assertProductionRpcChainId,
  contractsArtifactsExist,
  ensureRuntimeWorkspaceArtifacts,
  runtimeWorkspaceArtifactsExist,
  resolveProtocolDeploymentKeyFromArtifacts,
  startPonder,
} from "./start.mjs";
import { schemaFromProtocolDeploymentKey } from "./databaseSchema.mjs";

describe("Ponder production launcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("detects when required contracts artifacts already exist", () => {
    const requiredArtifacts = [
      "/repo/packages/contracts/dist/esm/abis/index.js",
    ];
    const exists = vi.fn(() => true);

    expect(contractsArtifactsExist({ exists, requiredArtifacts })).toBe(true);
    expect(exists).toHaveBeenCalledWith(requiredArtifacts[0]);
  });

  test("detects when required runtime workspace artifacts already exist", () => {
    const requiredArtifacts = [
      "/repo/packages/contracts/dist/esm/abis/index.js",
      "/repo/packages/node-utils/dist/esm/correlationScoring.js",
    ];
    const exists = vi.fn(() => true);

    expect(runtimeWorkspaceArtifactsExist({ exists, requiredArtifacts })).toBe(
      true,
    );
    expect(exists).toHaveBeenCalledTimes(requiredArtifacts.length);
  });

  test("does not rebuild runtime workspace deps when required artifacts exist", () => {
    const spawnSyncImpl = vi.fn();

    expect(
      ensureRuntimeWorkspaceArtifacts({
        exists: () => true,
        spawnSyncImpl,
        requiredArtifacts: ["/repo/packages/contracts/dist/esm/abis/index.js"],
      }),
    ).toBe(false);
    expect(spawnSyncImpl).not.toHaveBeenCalled();
  });

  test("builds runtime workspace deps when a required artifact is missing", () => {
    let built = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spawnSyncImpl = vi.fn(() => {
      built = true;
      return { status: 0 };
    });

    expect(
      ensureRuntimeWorkspaceArtifacts({
        exists: () => built,
        spawnSyncImpl,
        cwd: "/repo",
        requiredArtifacts: [
          "/repo/packages/contracts/dist/esm/abis/index.js",
          "/repo/packages/node-utils/dist/esm/correlationScoring.js",
        ],
      }),
    ).toBe(true);

    expect(warnSpy).toHaveBeenCalledWith(
      "[ponder:start] Missing runtime workspace build artifacts; building Ponder workspace dependencies.",
    );
    expect(spawnSyncImpl).toHaveBeenCalledWith(
      "yarn",
      ["workspace", "@rateloop/ponder", "build:workspace-deps"],
      {
        cwd: "/repo",
        stdio: "inherit",
      },
    );
  });

  test("throws when the runtime workspace build fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      ensureRuntimeWorkspaceArtifacts({
        exists: () => false,
        spawnSyncImpl: () => ({ status: 1 }),
        requiredArtifacts: ["/repo/packages/contracts/dist/esm/abis/index.js"],
      }),
    ).toThrow(
      "Failed to build Ponder workspace dependencies: yarn exited with status 1.",
    );
  });

  test("validates the production RPC chain id before startup", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: "0x2105" }),
    }));

    await expect(
      assertProductionRpcChainId({
        env: {
          NODE_ENV: "production",
          PONDER_NETWORK: "base",
          PONDER_RPC_URL_8453: "https://mainnet.base.org",
        },
        fetchImpl,
      }),
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://mainnet.base.org",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
        headers: { "content-type": "application/json" },
      }),
    );
  });

  test("rejects malformed JSON-RPC chain id quantities", async () => {
    await expect(
      assertProductionRpcChainId({
        env: {
          NODE_ENV: "production",
          PONDER_NETWORK: "base",
          PONDER_RPC_URL_8453: "https://mainnet.base.org",
        },
        fetchImpl: vi.fn(async () => ({
          ok: true,
          json: async () => ({ result: "0x2105junk" }),
        })),
      }),
    ).rejects.toThrow("PONDER_RPC_URL_8453 eth_chainId probe returned no chainId.");
  });

  test("rejects malformed production chain ids before probing RPC", async () => {
    const fetchImpl = vi.fn();

    await expect(
      assertProductionRpcChainId({
        env: {
          NODE_ENV: "production",
          PONDER_NETWORK: "base",
          PONDER_CHAIN_ID: "8453junk",
          PONDER_RPC_URL_8453: "https://mainnet.base.org",
        },
        fetchImpl,
      }),
    ).rejects.toThrow("PONDER_CHAIN_ID must be a positive integer.");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects wrong-chain production RPCs before startup", async () => {
    await expect(
      assertProductionRpcChainId({
        env: {
          NODE_ENV: "production",
        PONDER_NETWORK: "base",
        PONDER_RPC_URL_8453: "https://mainnet.base.org",
      },
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: "0x7a69" }),
      })),
    }),
  ).rejects.toThrow(
      "PONDER_RPC_URL_8453 reports chainId 31337 but 8453 expected.",
    );
  });

  test("does not spawn Ponder when the production RPC reports the wrong chain", async () => {
    const ensureContractsArtifactsImpl = vi.fn();
    const spawnImpl = vi.fn();

    await expect(
      startPonder({
        env: {
          NODE_ENV: "production",
          PONDER_NETWORK: "base",
          PONDER_RPC_URL_8453: "https://mainnet.base.org",
        },
        spawnImpl,
        ensureContractsArtifactsImpl,
        assertProductionRpcChainIdImpl: async () => {
          throw new Error(
            "PONDER_RPC_URL_8453 reports chainId 31337 but 8453 expected.",
          );
        },
      }),
    ).rejects.toThrow(
      "PONDER_RPC_URL_8453 reports chainId 31337 but 8453 expected.",
    );

    expect(ensureContractsArtifactsImpl).toHaveBeenCalled();
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  test("starts Ponder with the resolved schema after checking contracts artifacts", async () => {
    class FakeChild extends EventEmitter {}

    const child = new FakeChild();
    const ensureContractsArtifactsImpl = vi.fn();
    const spawnImpl = vi.fn(() => child);

    expect(
      await startPonder({
        argv: ["--port", "42069"],
        env: { DATABASE_SCHEMA: "rateloop_ponder_preview" },
        spawnImpl,
        ensureContractsArtifactsImpl,
      }),
    ).toBe(child);

    expect(ensureContractsArtifactsImpl).toHaveBeenCalled();
    expect(spawnImpl).toHaveBeenCalledWith(
      "ponder",
      ["start", "--schema", "rateloop_ponder_preview", "--port", "42069"],
      {
        env: {
          DATABASE_SCHEMA: "rateloop_ponder_preview",
        },
        stdio: "inherit",
      },
    );
  });

  test("starts Ponder with a protocol deployment schema when artifacts provide one", async () => {
    class FakeChild extends EventEmitter {}

    const child = new FakeChild();
    const deploymentKey =
      "8453:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const ensureContractsArtifactsImpl = vi.fn();
    const resolveProtocolDeploymentKeyImpl = vi.fn(() => deploymentKey);
    const spawnImpl = vi.fn(() => child);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = schemaFromProtocolDeploymentKey(deploymentKey);

    expect(
      await startPonder({
        argv: ["--port", "42069"],
        env: { PONDER_NETWORK: "base" },
        spawnImpl,
        ensureContractsArtifactsImpl,
        resolveProtocolDeploymentKeyImpl,
      }),
    ).toBe(child);

    expect(ensureContractsArtifactsImpl).toHaveBeenCalled();
    expect(resolveProtocolDeploymentKeyImpl).toHaveBeenCalledWith({
      env: { PONDER_NETWORK: "base" },
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      "ponder",
      ["start", "--schema", schema, "--port", "42069"],
      {
        env: {
          PONDER_NETWORK: "base",
          RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
          DATABASE_SCHEMA: schema,
        },
        stdio: "inherit",
      },
    );
    expect(warnSpy).toHaveBeenCalledWith(
      `[ponder:start] Using protocol deployment-scoped Ponder schema ${schema}.`,
    );
  });

  test("keeps artifact deployment schemas ahead of Railway deployment IDs", async () => {
    class FakeChild extends EventEmitter {}

    const child = new FakeChild();
    const deploymentKey =
      "8453:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const railwayDeploymentId = "123e4567-e89b-12d3-a456-426614174000";
    const schema = schemaFromProtocolDeploymentKey(deploymentKey);
    const ensureContractsArtifactsImpl = vi.fn();
    const resolveProtocolDeploymentKeyImpl = vi.fn(() => deploymentKey);
    const spawnImpl = vi.fn(() => child);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      await startPonder({
        argv: ["--port", "42069"],
        env: {
          PONDER_NETWORK: "base",
          RAILWAY_DEPLOYMENT_ID: railwayDeploymentId,
        },
        spawnImpl,
        ensureContractsArtifactsImpl,
        resolveProtocolDeploymentKeyImpl,
      }),
    ).toBe(child);

    expect(spawnImpl).toHaveBeenCalledWith(
      "ponder",
      ["start", "--schema", schema, "--port", "42069"],
      {
        env: {
          PONDER_NETWORK: "base",
          RAILWAY_DEPLOYMENT_ID: railwayDeploymentId,
          RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
          DATABASE_SCHEMA: schema,
        },
        stdio: "inherit",
      },
    );
    expect(warnSpy).toHaveBeenCalledWith(
      `[ponder:start] Using protocol deployment-scoped Ponder schema ${schema}.`,
    );
  });

  test("rejects explicit protocol deployment keys that conflict with shared artifacts", async () => {
    const configuredDeploymentKey =
      "8453:0x2000000000000000000000000000000000000001:0x2000000000000000000000000000000000000002";
    const artifactDeploymentKey =
      "8453:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const spawnImpl = vi.fn();

    await expect(
      startPonder({
        env: {
          NODE_ENV: "production",
          PONDER_NETWORK: "base",
          RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: configuredDeploymentKey,
        },
        spawnImpl,
        ensureContractsArtifactsImpl: vi.fn(),
        assertProductionRpcChainIdImpl: vi.fn(async () => true),
        resolveProtocolDeploymentKeyImpl: vi.fn(() => artifactDeploymentKey),
      }),
    ).rejects.toThrow(
      "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY=8453:0x2000000000000000000000000000000000000001:0x2000000000000000000000000000000000000002 does not match the shared deployment artifacts",
    );

    expect(spawnImpl).not.toHaveBeenCalled();
  });

  test("keeps deliberate local hardhat protocol deployment key overrides", async () => {
    class FakeChild extends EventEmitter {}

    const configuredDeploymentKey =
      "31337:0x2000000000000000000000000000000000000001:0x2000000000000000000000000000000000000002";
    const artifactDeploymentKey =
      "31337:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => child);

    await expect(
      startPonder({
        env: {
          PONDER_NETWORK: "hardhat",
          RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: configuredDeploymentKey,
        },
        spawnImpl,
        ensureContractsArtifactsImpl: vi.fn(),
        assertProductionRpcChainIdImpl: vi.fn(async () => false),
        resolveProtocolDeploymentKeyImpl: vi.fn(() => artifactDeploymentKey),
      }),
    ).resolves.toBe(child);

    expect(spawnImpl).toHaveBeenCalledWith(
      "ponder",
      ["start", "--schema", schemaFromProtocolDeploymentKey(configuredDeploymentKey)],
      expect.objectContaining({
        env: expect.objectContaining({
          RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: configuredDeploymentKey,
        }),
      }),
    );
  });

  test("rejects artifact deployment keys when PONDER_CHAIN_ID conflicts with PONDER_NETWORK", () => {
    expect(() =>
      resolveProtocolDeploymentKeyFromArtifacts({
        env: {
          PONDER_NETWORK: "hardhat",
          PONDER_CHAIN_ID: "8453",
        },
        requireImpl: vi.fn(),
      }),
    ).toThrow(
      "PONDER_CHAIN_ID 8453 does not match PONDER_NETWORK hardhat (31337).",
    );
  });
});
