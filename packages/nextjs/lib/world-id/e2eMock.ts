import type { IDKitResult, RpContext } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { encodeAbiParameters, keccak256, stringToHex, toHex } from "viem";

export const RATELOOP_E2E_WORLD_ID_MOCK_STORAGE_KEY = "rateloop:e2e-world-id-mock";

const RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY = "rateloop:e2e-test-wallet-private-key";
const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const E2E_WORLD_ID_PROOF = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n] as const;

type BuildE2EWorldIdLegacyResultParams = {
  action: string;
  environment?: "production" | "staging";
  signal: string;
};

export type LocalE2EWorldIdMock = {
  action: string;
  appId: `app_${string}`;
  connectorURI: string;
  environment: "production" | "staging";
  result: IDKitResult;
  rpContext: RpContext;
};

function isLocalE2EHost() {
  return typeof window !== "undefined" && LOCALHOST_HOSTNAMES.has(window.location.hostname);
}

function isLocalE2EWalletSessionPresent() {
  return Boolean(window.localStorage.getItem(RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY)?.trim());
}

function isLocalE2EWorldIdMock(value: unknown): value is LocalE2EWorldIdMock {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<LocalE2EWorldIdMock>;
  return (
    typeof candidate.action === "string" &&
    typeof candidate.appId === "string" &&
    candidate.appId.startsWith("app_") &&
    typeof candidate.connectorURI === "string" &&
    (candidate.environment === "production" || candidate.environment === "staging") &&
    Boolean(candidate.rpContext) &&
    Boolean(candidate.result)
  );
}

export function readLocalE2EWorldIdMock(): LocalE2EWorldIdMock | null {
  if (!isLocalE2EHost() || !isLocalE2EWalletSessionPresent()) {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(RATELOOP_E2E_WORLD_ID_MOCK_STORAGE_KEY);
    if (!storedValue) {
      return null;
    }

    const parsed = JSON.parse(storedValue) as unknown;
    return isLocalE2EWorldIdMock(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function buildE2EWorldIdLegacyResult({
  action,
  environment = "staging",
  signal,
}: BuildE2EWorldIdLegacyResultParams): IDKitResult {
  const nullifier = keccak256(stringToHex(`rateloop:e2e-world-id:${action}:${signal.toLowerCase()}`));

  return {
    protocol_version: "3.0",
    nonce: "0x1",
    action,
    environment,
    responses: [
      {
        identifier: "orb",
        signal_hash: hashSignal(signal),
        proof: encodeAbiParameters([{ type: "uint256[8]" }], [[...E2E_WORLD_ID_PROOF]]),
        merkle_root: toHex(42n),
        nullifier,
      },
    ],
  };
}
