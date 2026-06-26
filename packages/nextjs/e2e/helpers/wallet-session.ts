import { TERMS_ACCEPTED_KEY, TERMS_VERSION } from "../../constants/termsAcceptance";
import {
  RATELOOP_E2E_RPC_URL_STORAGE_KEY,
  RATELOOP_E2E_TEST_WALLET_CHAIN_ID_STORAGE_KEY,
  RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY,
} from "../../services/thirdweb/testWalletStorage";
import { WALLET_STATE_EXACT_KEYS, WALLET_STATE_PREFIXES } from "../../services/thirdweb/walletStateCleanup";
import { E2E_RPC_URL } from "./service-urls";
import { gotoWithRetry } from "./wait-helpers";
import type { Page } from "@playwright/test";

type WalletSessionStorageEntry = readonly [string, string];

const DEFAULT_E2E_CHAIN_ID = 31337;

function getWalletSessionStorageEntries(
  privateKey: string,
  rpcUrl: string,
  chainId: number = DEFAULT_E2E_CHAIN_ID,
): WalletSessionStorageEntry[] {
  return [
    [RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY, privateKey],
    [RATELOOP_E2E_TEST_WALLET_CHAIN_ID_STORAGE_KEY, String(chainId)],
    [RATELOOP_E2E_RPC_URL_STORAGE_KEY, rpcUrl],
    ["thirdweb:active-chain", JSON.stringify({ id: chainId })],
    [
      TERMS_ACCEPTED_KEY,
      JSON.stringify({
        version: TERMS_VERSION,
        timestamp: Date.now(),
        termsAccepted: true,
        privacyAcknowledged: true,
      }),
    ],
    [
      "rateloop_onboarding",
      JSON.stringify({
        firstVoteCompleted: true,
        guideShown: true,
      }),
    ],
  ];
}

/**
 * Build a script that pre-seeds localStorage for the localhost thirdweb test wallet flow.
 *
 * How it works:
 * 1. Clears stale thirdweb/wagmi wallet session data from earlier runs.
 * 2. Stores the target Anvil private key for the localhost-only thirdweb test bridge.
 * 3. Accepts terms + onboarding so the tests can focus on app behavior.
 *
 * Must run BEFORE any page navigation (via page.addInitScript).
 */
function seedWalletSessionScript(privateKey: string, rpcUrl: string, chainId: number = DEFAULT_E2E_CHAIN_ID): string {
  const storageEntries = getWalletSessionStorageEntries(privateKey, rpcUrl, chainId);

  return `
    const walletStateExactKeys = ${JSON.stringify(WALLET_STATE_EXACT_KEYS)};
    const walletStatePrefixes = ${JSON.stringify(WALLET_STATE_PREFIXES)};
    const walletSessionStorageEntries = ${JSON.stringify(storageEntries)};

    const clearWalletState = storage => {
      if (!storage) return;

      const keysToRemove = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key) continue;
        if (walletStateExactKeys.includes(key) || walletStatePrefixes.some(prefix => key.startsWith(prefix))) {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        storage.removeItem(key);
      }
    };

    clearWalletState(localStorage);
    clearWalletState(sessionStorage);

    for (const [key, value] of walletSessionStorageEntries) {
      localStorage.setItem(key, value);
    }
  `;
}

/** Inject wallet session state into a page before navigation. */
export async function setupWallet(
  page: Page,
  privateKey: string,
  options: { bootstrap?: boolean; chainId?: number; rpcUrl?: string } = {},
): Promise<void> {
  const { bootstrap = true, chainId = DEFAULT_E2E_CHAIN_ID, rpcUrl = E2E_RPC_URL } = options;
  await page.addInitScript(seedWalletSessionScript(privateKey, rpcUrl, chainId));

  if (bootstrap && page.url() === "about:blank") {
    await gotoWithRetry(page, "/", {
      skipInjectedWalletConnectionCheck: true,
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });
  }
}

/** Replace the injected local wallet session after a page has already loaded. */
export async function swapWalletSession(
  page: Page,
  privateKey: string,
  options: { chainId?: number; rpcUrl?: string } = {},
): Promise<void> {
  const { chainId = DEFAULT_E2E_CHAIN_ID, rpcUrl = E2E_RPC_URL } = options;

  await page.evaluate(
    ({ exactKeys, prefixes, storageEntries }) => {
      const exactKeySet = new Set<string>(exactKeys);
      const clearWalletState = (storage: Storage | null) => {
        if (!storage) return;

        const keysToRemove: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (!key) continue;
          if (exactKeySet.has(key) || prefixes.some(prefix => key.startsWith(prefix))) {
            keysToRemove.push(key);
          }
        }

        for (const key of keysToRemove) {
          storage.removeItem(key);
        }
      };

      clearWalletState(localStorage);
      clearWalletState(sessionStorage);

      for (const [key, value] of storageEntries) {
        localStorage.setItem(key, value);
      }
    },
    {
      exactKeys: [...WALLET_STATE_EXACT_KEYS],
      prefixes: [...WALLET_STATE_PREFIXES],
      storageEntries: getWalletSessionStorageEntries(privateKey, rpcUrl, chainId),
    },
  );
}
