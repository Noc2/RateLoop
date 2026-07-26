import { evmSigningLedger } from "./signingLedger";
import { EvmSigningError, type EvmSigningLedger } from "@rateloop/node-utils/evm-signing-audit";
import {
  type PlatformSecretEvmAccountConfiguration,
  createAuditedPlatformSecretEvmAccount,
} from "@rateloop/node-utils/platform-secret-evm-account";
import "server-only";
import { type Address, type Hex, getAddress } from "viem";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const KEY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export type TokenlessPlatformSecretRole =
  | "CREDENTIAL_ISSUER"
  | "PREPAID_FUNDER"
  | "SURPRISE_BONUS_FUNDER"
  | "X402_RELAYER";

const roleConfiguration = {
  CREDENTIAL_ISSUER: {
    envPrefix: "TOKENLESS_CREDENTIAL_ISSUER_SIGNER",
    signerRole: "credential_issuer",
  },
  PREPAID_FUNDER: {
    envPrefix: "TOKENLESS_PREPAID_FUNDER",
    signerRole: "prepaid_funder",
  },
  SURPRISE_BONUS_FUNDER: {
    envPrefix: "TOKENLESS_SURPRISE_BONUS_FUNDER",
    signerRole: "surprise_bonus_funder",
  },
  X402_RELAYER: {
    envPrefix: "TOKENLESS_X402_RELAYER",
    signerRole: "x402_relayer",
  },
} as const;

export type TokenlessPlatformSecretAccountConfiguration = PlatformSecretEvmAccountConfiguration & {
  signerRole: Exclude<PlatformSecretEvmAccountConfiguration["signerRole"], "keeper">;
};

export function loadPlatformSecretEthereumAccountConfiguration(input: {
  env?: NodeJS.ProcessEnv;
  role: TokenlessPlatformSecretRole;
}): TokenlessPlatformSecretAccountConfiguration {
  const env = input.env ?? process.env;
  const definition = roleConfiguration[input.role];
  const required = (suffix: string) => {
    const name = `${definition.envPrefix}_${suffix}`;
    const value = env[name]?.trim();
    if (!value) {
      throw new Error(`${name} is required for platform-secret signing.`);
    }
    return value;
  };
  const privateKey = required("PRIVATE_KEY");
  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error(`${definition.envPrefix}_PRIVATE_KEY must be a 32-byte hex private key.`);
  }
  const keyVersion = required("KEY_VERSION");
  if (!KEY_VERSION_PATTERN.test(keyVersion)) {
    throw new Error(`${definition.envPrefix}_KEY_VERSION is invalid.`);
  }
  return {
    expectedAddress: getAddress(required("EXPECTED_ADDRESS")) as Address,
    keyVersion,
    privateKey: privateKey as Hex,
    signerRole: definition.signerRole,
  };
}

function serviceError(error: EvmSigningError) {
  const codes = {
    timeout: "managed_signer_timeout",
    throttling: "managed_signer_throttled",
    access_or_key_configuration: "managed_signer_configuration",
    malformed_response_or_recovery: "managed_signer_response_invalid",
    outage: "managed_signer_outage",
  } as const;
  const unavailable = new TokenlessServiceError(
    "Managed signer is unavailable.",
    503,
    codes[error.errorClass],
    error.retryable,
  );
  unavailable.cause = error;
  return unavailable;
}

export function createPlatformSecretEthereumAccount(input: {
  configuration: TokenlessPlatformSecretAccountConfiguration;
  ledger?: EvmSigningLedger;
}) {
  return createAuditedPlatformSecretEvmAccount({
    configuration: input.configuration,
    ledger: input.ledger ?? evmSigningLedger,
    mapError: serviceError,
  });
}
