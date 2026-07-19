/**
 * Foundry keystore helpers for the keeper.
 */
import { getKeystoreAccountFromCredentials } from "@rateloop/node-utils/keystore";
import type { PrivateKeyAccount } from "viem/accounts";

let cachedAccount: PrivateKeyAccount | null | undefined;

export function getKeystoreAccount(): PrivateKeyAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;

  const name = process.env.KEYSTORE_ACCOUNT;
  const password = process.env.KEYSTORE_PASSWORD;

  if (!name || !password) {
    cachedAccount = null;
    return null;
  }

  try {
    cachedAccount = getKeystoreAccountFromCredentials(name, password);
    return cachedAccount;
  } catch (err: unknown) {
    // A decryption failure with KEYSTORE_ACCOUNT/KEYSTORE_PASSWORD set is fatal.
    // Returning null here used to silently fall back to KEEPER_PRIVATE_KEY (a
    // wrong password switched the keeper's local-test signing identity) or surface
    // as a misleading "No wallet configured" error.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to decrypt keystore account "${name}": ${message}. ` +
        `Check KEYSTORE_ACCOUNT/KEYSTORE_PASSWORD; refusing local-test fallback to KEEPER_PRIVATE_KEY.`,
      { cause: err },
    );
  }
}
