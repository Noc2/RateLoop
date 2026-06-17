"use client";

import { useMemo } from "react";
import { useActiveAccount, useActiveWallet, useActiveWalletChain, useCapabilities } from "thirdweb/react";
import type { GetCapabilitiesResult } from "thirdweb/wallets/eip5792";
import { useAccount } from "wagmi";
import {
  currentThirdwebWalletMatchesWagmiAddress,
  getThirdwebWalletSponsorshipMode,
  isThirdwebInAppWalletCurrentForAddress,
  isThirdwebInAppWalletId,
  supportsThirdwebExecutionCapabilities,
  supportsThirdwebInAppExecutionCapabilities,
} from "~~/services/thirdweb/client";

export type WalletExecutionMode = "sponsored_7702" | "self_funded_7702" | "fee_currency" | "direct_evm";

export function resolveWalletExecutionMode(params: {
  hasSendCalls: boolean;
  isThirdwebInApp: boolean;
  supportedChain: boolean;
  thirdwebSponsorshipMode: "sponsored" | "self-funded" | null;
}): WalletExecutionMode {
  if (params.supportedChain && params.isThirdwebInApp && params.thirdwebSponsorshipMode === "sponsored") {
    return "sponsored_7702";
  }

  if (params.supportedChain && params.isThirdwebInApp && params.thirdwebSponsorshipMode === "self-funded") {
    return "self_funded_7702";
  }

  if (params.isThirdwebInApp) {
    return "direct_evm";
  }

  if (params.supportedChain) {
    // External wallets may expose `sendCalls`, but hardware-backed accounts
    // can still reject the EIP-7702 upgrade path. Keep them on plain EVM txs.
    return "fee_currency";
  }

  return "direct_evm";
}

export function resolveWalletExecutionChainId(
  wagmiChainId: number | null | undefined,
  thirdwebChainId: number | null | undefined,
) {
  if (typeof wagmiChainId === "number") {
    return wagmiChainId;
  }

  if (typeof thirdwebChainId === "number") {
    return thirdwebChainId;
  }

  return undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function resolveWalletCapabilitiesForChain(
  capabilities: GetCapabilitiesResult | undefined,
  chainId: number | null | undefined,
) {
  if (!capabilities || typeof chainId !== "number") {
    return undefined;
  }

  const chainCapabilities = (capabilities as Record<string, unknown>)[chainId];
  if (isObjectRecord(chainCapabilities)) {
    return chainCapabilities;
  }

  if (isObjectRecord((capabilities as Record<string, unknown>).paymasterService)) {
    return capabilities as Record<string, unknown>;
  }

  if (isObjectRecord((capabilities as Record<string, unknown>).atomic)) {
    return capabilities as Record<string, unknown>;
  }

  return undefined;
}

export function walletCapabilitiesSupportPaymasterService(capabilities: Record<string, unknown> | undefined) {
  const paymasterService = capabilities?.paymasterService;
  return isObjectRecord(paymasterService) && paymasterService.supported === true;
}

export function walletCapabilitiesSupportAtomicBatch(capabilities: Record<string, unknown> | undefined) {
  const atomic = capabilities?.atomic;
  if (!isObjectRecord(atomic)) {
    return false;
  }

  return atomic.status === "supported" || atomic.status === "ready";
}

export function shouldQueryWalletCapabilities(params: {
  chainId: number | undefined;
  hasSendCalls?: boolean;
  supportedChain: boolean;
  walletId: string | undefined;
}) {
  return (
    (isThirdwebInAppWalletId(params.walletId) || params.hasSendCalls === true) &&
    typeof params.chainId === "number" &&
    params.supportedChain
  );
}

export function useWalletExecutionCapabilities() {
  const wallet = useActiveWallet();
  const thirdwebAccount = useActiveAccount();
  const activeWalletChain = useActiveWalletChain();
  const { address, chainId: wagmiChainId } = useAccount();
  const chainId = resolveWalletExecutionChainId(wagmiChainId, activeWalletChain?.id);
  const supportedChain = supportsThirdwebExecutionCapabilities(chainId);
  const supportsInAppExecution = supportsThirdwebInAppExecutionCapabilities(chainId);
  const walletId = wallet?.id;
  const activeWalletAccount = wallet?.getAccount();
  const activeThirdwebAccountAddress = thirdwebAccount?.address;
  const activeThirdwebAccountSendCalls = thirdwebAccount?.sendCalls;
  const thirdwebAccountMatchesActiveWallet = currentThirdwebWalletMatchesWagmiAddress({
    activeThirdwebAccountAddress,
    activeWalletAccountAddress: activeWalletAccount?.address,
    wagmiAddress: activeWalletAccount?.address,
  });
  const currentThirdwebAccountAddress =
    thirdwebAccountMatchesActiveWallet || !activeWalletAccount?.address ? activeThirdwebAccountAddress : undefined;
  const currentThirdwebAccountSendCalls =
    thirdwebAccountMatchesActiveWallet || !activeWalletAccount?.address ? activeThirdwebAccountSendCalls : undefined;
  const hasSendCallsForQuery = Boolean(activeWalletAccount?.sendCalls ?? currentThirdwebAccountSendCalls);
  const thirdwebAccountAddress = activeWalletAccount?.address ?? currentThirdwebAccountAddress;
  const thirdwebAdminAddress = wallet?.getAdminAccount?.()?.address;
  const isThirdwebInAppWallet = isThirdwebInAppWalletCurrentForAddress({
    activeWalletId: walletId,
    connectedAddress: address,
    thirdwebAccountAddress,
    thirdwebAdminAddress,
  });
  const shouldQueryCapabilities = shouldQueryWalletCapabilities({
    chainId,
    hasSendCalls: hasSendCallsForQuery,
    supportedChain: isThirdwebInAppWallet ? supportsInAppExecution : supportedChain,
    walletId,
  });
  const { data: capabilities } = useCapabilities({
    chainId,
    queryOptions: {
      enabled: shouldQueryCapabilities,
      retry: 0,
    },
  });

  return useMemo(() => {
    const activeCapabilities = resolveWalletCapabilitiesForChain(capabilities, chainId);
    const walletAccount = wallet?.getAccount();
    const activeThirdwebAccountMatchesWallet = currentThirdwebWalletMatchesWagmiAddress({
      activeThirdwebAccountAddress,
      activeWalletAccountAddress: walletAccount?.address,
      wagmiAddress: walletAccount?.address,
    });
    const resolvedThirdwebAccountSendCalls =
      activeThirdwebAccountMatchesWallet || !walletAccount?.address ? activeThirdwebAccountSendCalls : undefined;
    const hasSendCalls = Boolean(walletAccount?.sendCalls ?? resolvedThirdwebAccountSendCalls);
    const isThirdwebInApp = isThirdwebInAppWallet;
    const walletExecutionSupported = isThirdwebInApp ? supportsInAppExecution : supportedChain;
    const thirdwebSponsorshipMode = isThirdwebInApp ? getThirdwebWalletSponsorshipMode(wallet) : null;
    const supportsAtomicBatchCalls = walletCapabilitiesSupportAtomicBatch(activeCapabilities);
    const supportsPaymasterService = walletCapabilitiesSupportPaymasterService(activeCapabilities);

    const executionMode = resolveWalletExecutionMode({
      hasSendCalls: Boolean(hasSendCalls && wallet),
      isThirdwebInApp,
      supportedChain: walletExecutionSupported,
      thirdwebSponsorshipMode,
    });

    return {
      capabilities: activeCapabilities,
      executionMode,
      hasSendCalls,
      isThirdwebInApp,
      supportsAtomicBatchCalls,
      supportsFeeCurrencyFallback: walletExecutionSupported,
      supportsPaymasterService,
      supportsSponsoredCalls: executionMode === "sponsored_7702",
    };
  }, [
    capabilities,
    activeThirdwebAccountAddress,
    activeThirdwebAccountSendCalls,
    chainId,
    isThirdwebInAppWallet,
    supportedChain,
    supportsInAppExecution,
    wallet,
  ]);
}
