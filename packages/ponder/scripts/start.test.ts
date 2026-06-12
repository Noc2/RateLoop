import { EventEmitter } from "node:events";
import {
  contractsArtifactsExist,
  ensureContractsArtifacts,
  startPonder,
} from "./start.mjs";
import { schemaFromProtocolDeploymentKey } from "./databaseSchema.mjs";

describe("Ponder production launcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("detects when required contracts artifacts already exist", () => {
    const requiredArtifacts = ["/repo/packages/contracts/dist/esm/abis/index.js"];
    const exists = vi.fn(() => true);

    expect(contractsArtifactsExist({ exists, requiredArtifacts })).toBe(true);
    expect(exists).toHaveBeenCalledWith(requiredArtifacts[0]);
  });

  test("does not rebuild contracts when required artifacts exist", () => {
    const spawnSyncImpl = vi.fn();

    expect(
      ensureContractsArtifacts({
        exists: () => true,
        spawnSyncImpl,
        requiredArtifacts: ["/repo/packages/contracts/dist/esm/abis/index.js"],
      }),
    ).toBe(false);
    expect(spawnSyncImpl).not.toHaveBeenCalled();
  });

  test("builds contracts when required artifacts are missing", () => {
    let built = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spawnSyncImpl = vi.fn(() => {
      built = true;
      return { status: 0 };
    });

    expect(
      ensureContractsArtifacts({
        exists: () => built,
        spawnSyncImpl,
        cwd: "/repo",
        requiredArtifacts: ["/repo/packages/contracts/dist/esm/abis/index.js"],
      }),
    ).toBe(true);

    expect(warnSpy).toHaveBeenCalledWith(
      "[ponder:start] Missing @rateloop/contracts build artifacts; building the contracts workspace.",
    );
    expect(spawnSyncImpl).toHaveBeenCalledWith(
      "yarn",
      ["workspace", "@rateloop/contracts", "build"],
      {
        cwd: "/repo",
        stdio: "inherit",
      },
    );
  });

  test("throws when the contracts build fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      ensureContractsArtifacts({
        exists: () => false,
        spawnSyncImpl: () => ({ status: 1 }),
        requiredArtifacts: ["/repo/packages/contracts/dist/esm/abis/index.js"],
      }),
    ).toThrow("Failed to build @rateloop/contracts: yarn exited with status 1.");
  });

  test("starts Ponder with the resolved schema after checking contracts artifacts", () => {
    class FakeChild extends EventEmitter {}

    const child = new FakeChild();
    const ensureContractsArtifactsImpl = vi.fn();
    const spawnImpl = vi.fn(() => child);

    expect(
      startPonder({
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

  test("starts Ponder with a protocol deployment schema when artifacts provide one", () => {
    class FakeChild extends EventEmitter {}

    const child = new FakeChild();
    const deploymentKey =
      "4801:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const ensureContractsArtifactsImpl = vi.fn();
    const resolveProtocolDeploymentKeyImpl = vi.fn(() => deploymentKey);
    const spawnImpl = vi.fn(() => child);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = schemaFromProtocolDeploymentKey(deploymentKey);

    expect(
      startPonder({
        argv: ["--port", "42069"],
        env: { PONDER_NETWORK: "worldchainSepolia" },
        spawnImpl,
        ensureContractsArtifactsImpl,
        resolveProtocolDeploymentKeyImpl,
      }),
    ).toBe(child);

    expect(ensureContractsArtifactsImpl).toHaveBeenCalled();
    expect(resolveProtocolDeploymentKeyImpl).toHaveBeenCalledWith({
      env: { PONDER_NETWORK: "worldchainSepolia" },
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      "ponder",
      ["start", "--schema", schema, "--port", "42069"],
      {
        env: {
          PONDER_NETWORK: "worldchainSepolia",
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
});
