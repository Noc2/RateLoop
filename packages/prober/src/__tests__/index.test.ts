import { afterEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x9999999999999999999999999999999999999999" as const;
const REGISTRY = "0x3333333333333333333333333333333333333333" as const;

async function loadProberIndex() {
  vi.resetModules();

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const validateProberConnectivity = vi.fn().mockResolvedValue(undefined);
  const validateProberContracts = vi.fn().mockResolvedValue({ probeRole: `0x${"44".repeat(32)}` });
  const getBalance = vi.fn().mockResolvedValue(1500n);
  const getWalletClient = vi.fn(() => ({ kind: "wallet" }));
  const getAccount = vi.fn(() => ({ address: ACCOUNT }));
  const runProberCycle = vi.fn().mockResolvedValue({
    candidatesDiscovered: 1,
    candidatesProcessed: 1,
    candidatesSkipped: 0,
    probeResultsRecorded: 1,
    driftFlagsRecorded: 0,
    failedDetections: 0,
    pendingCount: 0,
    latestBlock: 200n,
    lastScannedBlock: 180n,
  });
  const setGauge = vi.fn();
  const recordRun = vi.fn();
  const recordError = vi.fn();
  const getConsecutiveErrors = vi.fn(() => 0);
  const startMetricsServer = vi.fn(() => ({ close: vi.fn() }));
  const setIntervalMock = vi.fn(() => 1 as unknown as NodeJS.Timeout);
  const clearIntervalMock = vi.fn();

  vi.stubGlobal("setInterval", setIntervalMock);
  vi.stubGlobal("clearInterval", clearIntervalMock);

  vi.doMock("../config.js", () => ({
    config: {
      chainName: "Foundry",
      chainId: 31337,
      contracts: {
        raterDeclarationRegistry: REGISTRY,
      },
      startBlock: 100,
      intervalMs: 30_000,
      startupJitterMs: 0,
      roleWallet: undefined,
      minGasBalanceWei: "100",
      maxGasPerTx: 750000,
      metricsEnabled: false,
      metricsPort: 9091,
      metricsBindAddress: "127.0.0.1",
      logFormat: "text",
      detectorKind: "mock",
      detectorBundleHash: `0x${"11".repeat(32)}`,
      probeLibraryHash: `0x${"22".repeat(32)}`,
      recentBlockLookback: 5000,
      declarationScanBatchBlocks: 2000,
      maxCandidatesPerTick: 10,
    },
  }));
  vi.doMock("../logger.js", () => ({
    createLogger: () => logger,
  }));
  vi.doMock("../client.js", () => ({
    publicClient: {
      getBalance,
    },
    getWalletClient,
    getAccount,
    chain: { id: 31337 },
    validateProberConnectivity,
  }));
  vi.doMock("../registry.js", () => ({
    createPendingProbeTracker: vi.fn(() => ({ kind: "tracker" })),
    validateProberContracts,
  }));
  vi.doMock("../prober.js", () => ({
    runProberCycle,
  }));
  vi.doMock("../detectors/index.js", () => ({
    buildDetectorPipeline: vi.fn(() => ({ kind: "pipeline" })),
  }));
  vi.doMock("../artifacts.js", () => ({
    createLogArtifactStore: vi.fn(() => ({ kind: "artifact-store" })),
  }));
  vi.doMock("../metrics.js", () => ({
    startMetricsServer,
    setHealthThreshold: vi.fn(),
    recordRun,
    recordError,
    setGauge,
    getConsecutiveErrors,
  }));
  vi.spyOn(process, "on").mockImplementation(((..._args: any[]) => process) as typeof process.on);

  await import("../index.js");
  await vi.dynamicImportSettled();

  return {
    validateProberConnectivity,
    validateProberContracts,
    getBalance,
    runProberCycle,
    setGauge,
    recordRun,
    recordError,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("prober index", () => {
  it("validates connectivity and runs the first prober tick", async () => {
    const prober = await loadProberIndex();

    expect(prober.validateProberConnectivity).toHaveBeenCalledWith(expect.anything());
    expect(prober.validateProberContracts).toHaveBeenCalledWith(expect.anything(), REGISTRY, ACCOUNT);
    expect(prober.getBalance).toHaveBeenCalledWith({ address: ACCOUNT });
    expect(prober.runProberCycle).toHaveBeenCalledOnce();
    expect(prober.setGauge).toHaveBeenCalledWith("prober_wallet_balance_wei", 1500);
    expect(prober.setGauge).toHaveBeenCalledWith("prober_last_scanned_block", 180);
    expect(prober.setGauge).toHaveBeenCalledWith("prober_latest_block", 200);
    expect(prober.setGauge).toHaveBeenCalledWith("prober_pending_candidates", 0);
    expect(prober.recordRun).toHaveBeenCalledOnce();
    expect(prober.recordError).not.toHaveBeenCalled();
  });
});
