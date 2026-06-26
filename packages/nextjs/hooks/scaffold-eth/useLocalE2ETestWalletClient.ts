"use client";

import { useMemo } from "react";
import { type Address, type WalletClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import {
  RATELOOP_E2E_RPC_URL_STORAGE_KEY,
  RATELOOP_E2E_TEST_WALLET_CHAIN_ID_STORAGE_KEY,
  RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY,
} from "~~/services/thirdweb/testWalletStorage";
import { isLocalE2EProductionBuildEnabled, isLocalE2EWalletBridgeEnabled } from "~~/utils/env/e2eProduction";

const DEFAULT_LOCAL_TEST_CHAIN_ID = foundry.id;
const DEFAULT_LOCAL_TEST_RPC_URL = "http://127.0.0.1:8545";
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SUPPORTED_LOCAL_E2E_CHAINS = {
  [foundry.id]: foundry,
  [baseSepolia.id]: baseSepolia,
} as const;

type LocalE2ETestWalletGate = {
  hostname?: string;
  localE2EProductionBuild?: boolean;
  nodeEnv?: string;
  vercelEnv?: string;
};

type LocalE2ETestWalletClientParams = {
  address?: Address;
  chainId?: number;
  gate?: LocalE2ETestWalletGate;
  storage?: Pick<Storage, "getItem">;
};

function getBrowserHostname() {
  return typeof window === "undefined" ? undefined : window.location.hostname;
}

function getStoredLocalE2EPrivateKey(
  storage: Pick<Storage, "getItem"> | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): `0x${string}` | undefined {
  if (!storage) {
    return undefined;
  }

  const value = storage.getItem(RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY)?.trim();
  if (!value || !PRIVATE_KEY_PATTERN.test(value)) {
    return undefined;
  }

  return value as `0x${string}`;
}

export function getStoredLocalE2ETestWalletChainId(
  storage: Pick<Storage, "getItem"> | undefined = typeof window === "undefined" ? undefined : window.localStorage,
) {
  if (!storage) {
    return undefined;
  }

  const storedValue = storage.getItem(RATELOOP_E2E_TEST_WALLET_CHAIN_ID_STORAGE_KEY);
  if (!storedValue) {
    return DEFAULT_LOCAL_TEST_CHAIN_ID;
  }

  const chainId = Number(storedValue.trim());
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return undefined;
  }

  return chainId;
}

function normalizeRpcUrl(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value.trim()).toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function getStoredLocalE2ETestWalletRpcUrl(
  storage: Pick<Storage, "getItem"> | undefined = typeof window === "undefined" ? undefined : window.localStorage,
  chainId = getStoredLocalE2ETestWalletChainId(storage),
) {
  if (!storage) {
    return undefined;
  }

  const storedValue = storage.getItem(RATELOOP_E2E_RPC_URL_STORAGE_KEY);
  if (!storedValue && chainId === foundry.id) {
    return DEFAULT_LOCAL_TEST_RPC_URL;
  }

  if (!storedValue && chainId === baseSepolia.id) {
    return baseSepolia.rpcUrls.default.http[0];
  }

  return normalizeRpcUrl(storedValue);
}

export function isLocalE2ETestWalletClientEnabled(params: LocalE2ETestWalletGate = {}) {
  const localE2EProductionBuild =
    params.localE2EProductionBuild ??
    isLocalE2EProductionBuildEnabled({
      RATELOOP_E2E_PRODUCTION_BUILD: undefined,
      NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD: process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD,
    });

  if (!localE2EProductionBuild || params.vercelEnv === "production") {
    return false;
  }

  return isLocalE2EWalletBridgeEnabled({
    hostname: params.hostname ?? getBrowserHostname(),
    isProduction: (params.nodeEnv ?? process.env.NODE_ENV) === "production",
    localE2EProductionBuild,
  });
}

export function getLocalE2ETestWalletClient({
  address,
  chainId,
  gate,
  storage = typeof window === "undefined" ? undefined : window.localStorage,
}: LocalE2ETestWalletClientParams): WalletClient | undefined {
  if (!isLocalE2ETestWalletClientEnabled(gate)) {
    return undefined;
  }

  const storedChainId = getStoredLocalE2ETestWalletChainId(storage);
  if (!chainId || storedChainId !== chainId) {
    return undefined;
  }

  const chain = SUPPORTED_LOCAL_E2E_CHAINS[chainId as keyof typeof SUPPORTED_LOCAL_E2E_CHAINS];
  if (!chain) {
    return undefined;
  }

  const privateKey = getStoredLocalE2EPrivateKey(storage);
  if (!privateKey) {
    return undefined;
  }

  const account = privateKeyToAccount(privateKey);
  if (address && account.address.toLowerCase() !== address.toLowerCase()) {
    return undefined;
  }

  const rpcUrl = getStoredLocalE2ETestWalletRpcUrl(storage, chainId);
  if (!rpcUrl) {
    return undefined;
  }

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
}

export function useLocalE2ETestWalletClient(address?: Address, chainId?: number): WalletClient | undefined {
  return useMemo(() => {
    return getLocalE2ETestWalletClient({
      address,
      chainId,
      gate: {
        vercelEnv: process.env.VERCEL_ENV,
      },
    });
  }, [address, chainId]);
}
