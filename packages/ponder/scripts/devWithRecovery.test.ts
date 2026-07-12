import {
  canRetryWithoutPgliteReset,
  getRecoveryReason,
  outputIndicatesClosedPglite,
  outputIndicatesConfiguredPortFallback,
  outputIndicatesPonderServerTransition,
  resolvePonderStatusUrl,
  resolveDevRawScript,
  shouldRecover,
  shouldResetPglite,
} from "./devWithRecovery.mjs";

describe("devWithRecovery", () => {
  test("uses dev:raw by default and accepts an alternate raw dev script", () => {
    expect(resolveDevRawScript([])).toBe("dev:raw");
    expect(resolveDevRawScript(["dev:raw:isolated"])).toBe(
      "dev:raw:isolated",
    );
    expect(resolveDevRawScript([""])).toBe("dev:raw");
  });

  test("recovers from PGlite corruption", () => {
    const output =
      "RuntimeError: Aborted()\n@electric-sql/pglite\nInitWalRecovery";

    expect(shouldRecover(output)).toBe(true);
    expect(getRecoveryReason(output)).toBe("corrupted PGlite state");
    expect(shouldResetPglite(output)).toBe(true);
  });

  test("recovers from local hardhat chain rewind errors", () => {
    const output =
      'BlockNotFoundError: Block at number "235" could not be found.';

    expect(
      shouldRecover(output, {
        PONDER_NETWORK: "hardhat",
        PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
      }),
    ).toBe(true);
    expect(
      getRecoveryReason(output, {
        PONDER_NETWORK: "hardhat",
        PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
      }),
    ).toBe(
      "stale local Ponder sync state after the hardhat/anvil chain was reset",
    );
    expect(
      shouldResetPglite(output, {
        PONDER_NETWORK: "hardhat",
        PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
      }),
    ).toBe(true);
  });

  test("does not auto-reset for block-not-found on non-local networks", () => {
    const output =
      'BlockNotFoundError: Block at number "235" could not be found.';

    expect(
      shouldRecover(output, {
        PONDER_NETWORK: "baseSepolia",
        PONDER_RPC_URL_84532: "https://sepolia.base.org",
      }),
    ).toBe(false);
    expect(
      getRecoveryReason(output, {
        PONDER_NETWORK: "baseSepolia",
        PONDER_RPC_URL_84532: "https://sepolia.base.org",
      }),
    ).toBeNull();
  });

  test("resets PGlite after a stuck Ponder database shutdown", () => {
    const output =
      "ShutdownError: occurred while handling /status\nPONDER_SHUTDOWN_ERROR_STUCK";

    expect(shouldRecover(output)).toBe(true);
    expect(getRecoveryReason(output)).toBe(
      "stuck Ponder database shutdown state",
    );
    expect(shouldResetPglite(output)).toBe(true);
    expect(
      canRetryWithoutPgliteReset("stuck Ponder database shutdown state"),
    ).toBe(true);
  });

  test("resets PGlite after the database handle is closed", () => {
    const output = "[ponder-api] Unhandled error: PGlite is closed";

    expect(outputIndicatesClosedPglite(output)).toBe(true);
    expect(shouldRecover(output)).toBe(true);
    expect(getRecoveryReason(output)).toBe("closed PGlite database handle");
    expect(shouldResetPglite(output)).toBe(true);
    expect(canRetryWithoutPgliteReset("closed PGlite database handle")).toBe(
      false,
    );
  });

  test("retries without resetting PGlite after Ponder hot-reload closes the pool", () => {
    const output = [
      "ERROR process Caught unhandledRejection event",
      "Error: Failed query: CREATE INDEX IF NOT EXISTS",
      "Error: Cannot use a pool after calling end on the pool",
    ].join("\n");

    expect(shouldRecover(output)).toBe(true);
    expect(getRecoveryReason(output)).toBe("Ponder hot-reload shutdown race");
    expect(shouldResetPglite(output)).toBe(false);
  });

  test("detects when Ponder moves off the configured port", () => {
    const output =
      "8:06:54 AM WARN  server     Port 42069 was in use, trying port 42070";
    const statusUrl = new URL("http://127.0.0.1:42069/status");

    expect(outputIndicatesConfiguredPortFallback(output, statusUrl)).toBe(true);
    expect(
      outputIndicatesConfiguredPortFallback(
        output,
        new URL("http://127.0.0.1:42070/status"),
      ),
    ).toBe(false);
  });

  test("preserves NEXT_PUBLIC_PONDER_URL path prefixes when building the status URL", () => {
    expect(
      resolvePonderStatusUrl({
        NEXT_PUBLIC_PONDER_URL: "http://127.0.0.1:42069/ponder",
      })?.toString(),
    ).toBe("http://127.0.0.1:42069/ponder/status");

    expect(
      resolvePonderStatusUrl({
        NEXT_PUBLIC_PONDER_URL: "http://127.0.0.1:42069/ponder/?stale=1#old",
      })?.toString(),
    ).toBe("http://127.0.0.1:42069/ponder/status");
  });

  test("treats PONDER_STATUS_URL as the exact polling endpoint", () => {
    expect(
      resolvePonderStatusUrl({
        PONDER_STATUS_URL:
          "http://127.0.0.1:42069/ponder/custom-status?check=1",
        NEXT_PUBLIC_PONDER_URL: "http://127.0.0.1:42069/ponder",
      })?.toString(),
    ).toBe("http://127.0.0.1:42069/ponder/custom-status?check=1");
  });

  test("resets PGlite after configured port fallback recovery is requested", () => {
    const output = "PONDER_CONFIGURED_PORT_FALLBACK_STUCK";

    expect(shouldRecover(output)).toBe(true);
    expect(getRecoveryReason(output)).toBe(
      "Ponder moved off the configured port",
    );
    expect(shouldResetPglite(output)).toBe(true);
    expect(canRetryWithoutPgliteReset("Ponder moved off the configured port")).toBe(
      true,
    );
  });

  test("treats hot reload and port fallback logs as server transitions", () => {
    expect(
      outputIndicatesPonderServerTransition(
        "INFO build Hot reload '../contracts/src/deployments.ts'",
      ),
    ).toBe(true);
    expect(
      outputIndicatesPonderServerTransition(
        "WARN server Port 42069 was in use, trying port 42070",
      ),
    ).toBe(true);
    expect(
      outputIndicatesPonderServerTransition("INFO indexing Indexed 10 events"),
    ).toBe(false);
  });
});
