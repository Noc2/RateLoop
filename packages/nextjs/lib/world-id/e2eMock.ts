import type { IDKitResult, RpContext } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { keccak256, stringToHex, toHex } from "viem";
import type { WorldIdCredentialIdentifier } from "~~/lib/world-id/credentials";

export const RATELOOP_E2E_WORLD_ID_MOCK_STORAGE_KEY = "rateloop:e2e-world-id-mock";

const RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY = "rateloop:e2e-test-wallet-private-key";
const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const E2E_WORLD_ID_PROOF = [1n, 2n, 3n, 4n, 5n] as const;

type BuildE2EWorldIdV4ResultParams = {
  action: string;
  credential?: WorldIdCredentialIdentifier;
  environment?: "production" | "staging";
  expiresAtMin?: number;
  issuerSchemaId?: number;
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

function getDefaultIssuerSchemaId(credential: WorldIdCredentialIdentifier) {
  switch (credential) {
    case "face":
      return 11;
    case "passport":
      return 9303;
    case "proof_of_human":
    default:
      return 1;
  }
}

export function buildE2EWorldIdV4Result({
  action,
  credential = "proof_of_human",
  environment = "staging",
  expiresAtMin = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  issuerSchemaId = getDefaultIssuerSchemaId(credential),
  signal,
}: BuildE2EWorldIdV4ResultParams): IDKitResult {
  const nullifier = keccak256(stringToHex(`rateloop:e2e-world-id-v4:${action}:${credential}:${signal.toLowerCase()}`));

  return {
    protocol_version: "4.0",
    nonce: "0x1",
    action,
    environment,
    responses: [
      {
        identifier: credential,
        signal_hash: hashSignal(signal),
        proof: E2E_WORLD_ID_PROOF.map(value => toHex(value)),
        nullifier,
        issuer_schema_id: issuerSchemaId,
        expires_at_min: expiresAtMin,
      },
    ],
  };
}
