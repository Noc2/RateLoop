"use client";

import { createThirdwebClient, defineChain } from "thirdweb";
import type { AutoConnectProps } from "thirdweb/react";
import type { UseConnectModalOptions } from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import type { SmartWalletOptions, Wallet } from "thirdweb/wallets";
import { getThirdwebWalletAuthConfig } from "~~/services/thirdweb/auth";
import { getAvailableThirdwebExternalWalletIds } from "~~/services/web3/injectedWalletProviders";
import { publicEnv } from "~~/utils/env/public";

const THIRDWEB_CONNECT_CHAIN_IDS = new Set([31337, 480, 4801, 8453, 84532]);
const THIRDWEB_EXECUTION_CHAIN_IDS = new Set([480, 4801, 8453, 84532]);
const THIRDWEB_IN_APP_EIP7702_CHAIN_IDS = new Set([480, 8453, 84532]);
const THIRDWEB_IN_APP_EIP4337_CHAIN_IDS = new Set([4801]);
const THIRDWEB_IN_APP_EXECUTION_CHAIN_IDS = new Set([
  ...THIRDWEB_IN_APP_EIP7702_CHAIN_IDS,
  ...THIRDWEB_IN_APP_EIP4337_CHAIN_IDS,
]);
const THIRDWEB_ACTIVE_CHAIN_KEY = "thirdweb:active-chain";
const THIRDWEB_SPONSORSHIP_MODE_KEY = "thirdweb:sponsorship-mode";
const RATELOOP_THIRDWEB_ICON = "/rateloop-logo.svg";
const RATELOOP_THIRDWEB_LOGIN_HERO = "/thirdweb-login-hero.svg";

type ThirdwebWalletExecutionMode =
  | {
      mode: "EOA";
    }
  | {
      mode: "EIP4337";
      smartAccount: SmartWalletOptions;
    }
  | {
      mode: "EIP7702";
      sponsorGas?: boolean;
    };

type ThirdwebSponsorshipMode = "sponsored" | "self-funded";

type CreateThirdwebInAppWalletOptions = {
  forceEoa?: boolean;
  includeWalletAuthOption?: boolean;
  sponsorshipMode?: ThirdwebSponsorshipMode | null;
};

export function isThirdwebInAppWalletId(walletId: string | null | undefined): boolean {
  return walletId === "inApp" || walletId === "in-app-wallet";
}

export function thirdwebWalletAddressMatchesWagmiAddress(params: {
  thirdwebAddress?: string | null;
  wagmiAddress?: string | null;
}) {
  return (
    typeof params.thirdwebAddress === "string" &&
    typeof params.wagmiAddress === "string" &&
    params.thirdwebAddress.toLowerCase() === params.wagmiAddress.toLowerCase()
  );
}

export function currentThirdwebWalletMatchesWagmiAddress(params: {
  activeThirdwebAccountAddress?: string | null;
  activeWalletAccountAddress?: string | null;
  thirdwebAdminAddress?: string | null;
  wagmiAddress?: string | null;
}) {
  if (
    thirdwebWalletAddressMatchesWagmiAddress({
      thirdwebAddress: params.activeWalletAccountAddress,
      wagmiAddress: params.wagmiAddress,
    }) ||
    thirdwebWalletAddressMatchesWagmiAddress({
      thirdwebAddress: params.thirdwebAdminAddress,
      wagmiAddress: params.wagmiAddress,
    })
  ) {
    return true;
  }

  if (params.activeWalletAccountAddress) {
    return false;
  }

  return thirdwebWalletAddressMatchesWagmiAddress({
    thirdwebAddress: params.activeThirdwebAccountAddress,
    wagmiAddress: params.wagmiAddress,
  });
}

export function isThirdwebInAppWalletCurrentForAddress(params: {
  activeWalletId?: string | null;
  connectedAddress?: string | null;
  thirdwebAccountAddress?: string | null;
  thirdwebAdminAddress?: string | null;
}) {
  if (!isThirdwebInAppWalletId(params.activeWalletId)) {
    return false;
  }

  if (!params.connectedAddress) {
    return true;
  }

  return (
    thirdwebWalletAddressMatchesWagmiAddress({
      thirdwebAddress: params.thirdwebAccountAddress,
      wagmiAddress: params.connectedAddress,
    }) ||
    thirdwebWalletAddressMatchesWagmiAddress({
      thirdwebAddress: params.thirdwebAdminAddress,
      wagmiAddress: params.connectedAddress,
    })
  );
}

export function isThirdwebWalletChain(chainId: number | null | undefined): boolean {
  return typeof chainId === "number" && THIRDWEB_CONNECT_CHAIN_IDS.has(chainId);
}

export function supportsThirdwebExecutionCapabilities(chainId: number | null | undefined): boolean {
  return typeof chainId === "number" && THIRDWEB_EXECUTION_CHAIN_IDS.has(chainId);
}

export function supportsThirdwebInAppExecutionCapabilities(chainId: number | null | undefined): boolean {
  return typeof chainId === "number" && THIRDWEB_IN_APP_EXECUTION_CHAIN_IDS.has(chainId);
}

export function usesThirdwebInAppEip7702Execution(chainId: number | null | undefined): boolean {
  return typeof chainId === "number" && THIRDWEB_IN_APP_EIP7702_CHAIN_IDS.has(chainId);
}

function usesThirdwebInAppEip4337Execution(chainId: number | null | undefined): chainId is number {
  return typeof chainId === "number" && THIRDWEB_IN_APP_EIP4337_CHAIN_IDS.has(chainId);
}

export const thirdwebClient = publicEnv.thirdwebClientId
  ? createThirdwebClient({
      clientId: publicEnv.thirdwebClientId,
    })
  : null;

const thirdwebSupportedChains = publicEnv.targetNetworks
  .filter(network => isThirdwebWalletChain(network.id))
  .map(network => defineChain(network));
const thirdwebSupportedChainIds = new Set(thirdwebSupportedChains.map(chain => chain.id));

const thirdwebDefaultChain = thirdwebSupportedChains[0] ?? defineChain(publicEnv.targetNetworks[0]);

function isConfiguredThirdwebWalletChain(chainId: number | null | undefined): chainId is number {
  return typeof chainId === "number" && thirdwebSupportedChainIds.has(chainId);
}

function getStoredThirdwebChainId() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawValue = window.localStorage.getItem(THIRDWEB_ACTIVE_CHAIN_KEY);
    if (!rawValue) {
      return undefined;
    }

    const parsedValue = JSON.parse(rawValue) as { id?: number };
    if (isConfiguredThirdwebWalletChain(parsedValue.id)) {
      return parsedValue.id;
    }

    if (typeof parsedValue.id === "number") {
      window.localStorage.removeItem(THIRDWEB_ACTIVE_CHAIN_KEY);
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export function getPreferredThirdwebChainId(requestedChainId?: number): number {
  if (isConfiguredThirdwebWalletChain(requestedChainId)) {
    return requestedChainId as number;
  }

  const storedChainId = getStoredThirdwebChainId();
  if (isConfiguredThirdwebWalletChain(storedChainId)) {
    return storedChainId as number;
  }

  return thirdwebDefaultChain.id;
}

function getStoredThirdwebSponsorshipMode(): ThirdwebSponsorshipMode | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(THIRDWEB_SPONSORSHIP_MODE_KEY);
    return rawValue === "sponsored" || rawValue === "self-funded" ? rawValue : null;
  } catch {
    return null;
  }
}

export function setStoredThirdwebSponsorshipMode(mode: ThirdwebSponsorshipMode | null) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (!mode) {
      window.localStorage.removeItem(THIRDWEB_SPONSORSHIP_MODE_KEY);
      return;
    }

    window.localStorage.setItem(THIRDWEB_SPONSORSHIP_MODE_KEY, mode);
  } catch {
    // Ignore storage failures in private browsing / restricted environments.
  }
}

export function getThirdwebWalletExecutionMode(
  chainId: number,
  options?: { forceEoa?: boolean; sponsorshipMode?: ThirdwebSponsorshipMode | null },
): ThirdwebWalletExecutionMode {
  if (options?.forceEoa) {
    return {
      mode: "EOA" as const,
    };
  }

  if (usesThirdwebInAppEip7702Execution(chainId)) {
    const sponsorshipMode = options?.sponsorshipMode ?? getStoredThirdwebSponsorshipMode() ?? "sponsored";
    return {
      mode: "EIP7702" as const,
      ...(sponsorshipMode === "sponsored" ? { sponsorGas: true } : {}),
    };
  }

  if (usesThirdwebInAppEip4337Execution(chainId)) {
    const sponsorshipMode = options?.sponsorshipMode ?? getStoredThirdwebSponsorshipMode() ?? "sponsored";
    return {
      mode: "EIP4337" as const,
      smartAccount: {
        chain: defineChain(chainId),
        sponsorGas: sponsorshipMode === "sponsored",
      },
    };
  }

  return {
    mode: "EOA" as const,
  };
}

export function getThirdwebWalletSmartAccountOptions(
  chainId: number,
  options?: { forceEoa?: boolean; sponsorshipMode?: ThirdwebSponsorshipMode | null },
): SmartWalletOptions | undefined {
  const executionMode = getThirdwebWalletExecutionMode(chainId, options);
  return executionMode.mode === "EIP4337" ? executionMode.smartAccount : undefined;
}

export function getThirdwebWalletSponsorshipMode(wallet: Wallet | null | undefined): ThirdwebSponsorshipMode | null {
  if (!wallet || !isThirdwebInAppWalletId(wallet.id)) {
    return null;
  }

  const walletConfig = wallet.getConfig() as
    | {
        executionMode?: {
          mode?: string;
          smartAccount?: { sponsorGas?: boolean };
          sponsorGas?: boolean;
        };
        smartAccount?: { sponsorGas?: boolean };
      }
    | undefined;
  if (walletConfig?.executionMode?.mode === "EIP7702") {
    return walletConfig.executionMode.sponsorGas ? "sponsored" : "self-funded";
  }

  if (walletConfig?.executionMode?.mode === "EIP4337" && walletConfig.executionMode.smartAccount) {
    return walletConfig.executionMode.smartAccount.sponsorGas ? "sponsored" : "self-funded";
  }

  if (walletConfig?.smartAccount) {
    return walletConfig.smartAccount.sponsorGas ? "sponsored" : "self-funded";
  }

  return null;
}

export function createThirdwebInAppWallet(chainId: number, options?: CreateThirdwebInAppWalletOptions) {
  const executionMode = getThirdwebWalletExecutionMode(chainId, options);
  const smartAccount = executionMode.mode === "EIP4337" ? executionMode.smartAccount : undefined;

  return inAppWallet({
    auth: getThirdwebWalletAuthConfig({
      includeWalletOption: options?.includeWalletAuthOption,
    }),
    executionMode,
    metadata: {
      image: {
        alt: "Level Up Your Agent",
        height: 160,
        src: RATELOOP_THIRDWEB_LOGIN_HERO,
        width: 288,
      },
      name: "RateLoop Wallet",
    },
    ...(smartAccount ? { smartAccount } : {}),
  });
}

export function getThirdwebWalletIds(
  win: unknown = typeof window === "undefined" ? undefined : window,
): Array<"inApp" | "io.metamask" | "com.coinbase.wallet" | "me.rainbow"> {
  return ["inApp", ...getAvailableThirdwebExternalWalletIds(win)];
}

export function shouldIncludeThirdwebWalletAuthOption(
  win: unknown = typeof window === "undefined" ? undefined : window,
): boolean {
  return getAvailableThirdwebExternalWalletIds(win).length === 0;
}

export function getThirdwebWallets(
  chainId: number = thirdwebDefaultChain.id,
  win: unknown = typeof window === "undefined" ? undefined : window,
) {
  const walletIds = getThirdwebWalletIds(win);
  const includeWalletAuthOption = walletIds.length === 1;

  return walletIds.map(walletId =>
    walletId === "inApp" ? createThirdwebInAppWallet(chainId, { includeWalletAuthOption }) : createWallet(walletId),
  );
}

export function getThirdwebConnectOptions(chainId?: number): UseConnectModalOptions | null {
  if (!thirdwebClient || thirdwebSupportedChains.length === 0) {
    return null;
  }

  const preferredChainId = getPreferredThirdwebChainId(chainId);
  const chain =
    thirdwebSupportedChains.find(supportedChain => supportedChain.id === preferredChainId) ?? thirdwebDefaultChain;

  return {
    appMetadata: {
      name: "RateLoop",
      logoUrl: RATELOOP_THIRDWEB_ICON,
    },
    chain,
    chains: thirdwebSupportedChains,
    client: thirdwebClient,
    locale: "en_US",
    showThirdwebBranding: false,
    theme: "dark",
    title: "RateLoop",
    titleIcon: RATELOOP_THIRDWEB_ICON,
    ...(publicEnv.walletConnectProjectId
      ? {
          walletConnect: {
            projectId: publicEnv.walletConnectProjectId,
          },
        }
      : {}),
    wallets: getThirdwebWallets(chain.id),
  };
}

export function getThirdwebAutoConnectOptions(): AutoConnectProps | null {
  if (!thirdwebClient || thirdwebSupportedChains.length === 0) {
    return null;
  }

  const preferredChainId = getPreferredThirdwebChainId();
  const chain = thirdwebSupportedChains.find(supportedChain => supportedChain.id === preferredChainId) ?? undefined;

  return {
    appMetadata: {
      name: "RateLoop",
      logoUrl: RATELOOP_THIRDWEB_ICON,
    },
    chain,
    client: thirdwebClient,
    timeout: 15_000,
    wallets: getThirdwebWallets(preferredChainId),
  };
}
