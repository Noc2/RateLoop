"use client";

import { useCallback, useMemo } from "react";
import { useConnectModal } from "thirdweb/react";
import { injectedProvider } from "thirdweb/wallets";
import { useConnect } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { getThirdwebWagmiSyncOptions, useThirdwebWagmiSync } from "~~/hooks/useThirdwebWagmiSync";
import { addAndSwitchEthereumChain, isUnknownWalletChainError } from "~~/hooks/useWalletRpcRecovery";
import { getThirdwebConnectOptions, isThirdwebWalletChain } from "~~/services/thirdweb/client";
import { getDirectWagmiConnector } from "~~/services/web3/wagmiConnectFallback";
import { getTargetNetworks, notification } from "~~/utils/scaffold-eth";

const LOCAL_FOUNDRY_CHAIN_ID = 31337;

export function shouldPreferDirectWagmiConnect(params: { chainId: number; hasDirectWagmiConnector: boolean }) {
  return params.chainId === LOCAL_FOUNDRY_CHAIN_ID && params.hasDirectWagmiConnector;
}

function getConnectFailureMessage(error: unknown, targetNetworkName: string): string {
  const message = error instanceof Error ? error.message : "";

  if (/reject|denied|cancel/i.test(message)) {
    return "Wallet connection cancelled.";
  }

  if (/provider|wallet|connector/i.test(message) && /not found|missing|unavailable/i.test(message)) {
    return "No browser wallet was found. Install a wallet extension or configure thirdweb sign-in.";
  }

  if (isUnknownWalletChainError(error)) {
    return `Add or switch MetaMask to ${targetNetworkName}, then try again.`;
  }

  if (/chain|network/i.test(message) && /switch|unsupported|wrong|unrecognized|not configured/i.test(message)) {
    return `Switch MetaMask to ${targetNetworkName}, then try again.`;
  }

  return "Could not connect wallet. Check your wallet and try again.";
}

export function useRateLoopConnectModal() {
  const { connect, isConnecting: thirdwebConnecting } = useConnectModal();
  const { connectAsync, connectors, isPending: wagmiConnecting } = useConnect();
  const { targetNetwork } = useTargetNetwork();
  const { syncWalletToWagmi } = useThirdwebWagmiSync();
  const connectOptions = useMemo(() => getThirdwebConnectOptions(targetNetwork.id), [targetNetwork.id]);
  const directWagmiConnector = useMemo(() => getDirectWagmiConnector(connectors), [connectors]);
  const thirdwebEnabled = Boolean(connectOptions) && isThirdwebWalletChain(targetNetwork.id);
  const canConnect = thirdwebEnabled || Boolean(directWagmiConnector);
  const preferDirectWagmiConnect = shouldPreferDirectWagmiConnect({
    chainId: targetNetwork.id,
    hasDirectWagmiConnector: Boolean(directWagmiConnector),
  });

  const connectDirectWagmi = useCallback(async () => {
    if (!directWagmiConnector) {
      return null;
    }

    try {
      await connectAsync({
        chainId: targetNetwork.id,
        connector: directWagmiConnector,
      });
      return directWagmiConnector;
    } catch (error) {
      const targetChain = getTargetNetworks().find(network => network.id === targetNetwork.id);

      if (directWagmiConnector.id !== "io.metamask" || !targetChain || !isUnknownWalletChainError(error)) {
        throw error;
      }

      const provider = injectedProvider(directWagmiConnector.id);
      if (!provider) {
        throw error;
      }

      await addAndSwitchEthereumChain(provider, targetChain);
      await connectAsync({
        chainId: targetNetwork.id,
        connector: directWagmiConnector,
      });
      return directWagmiConnector;
    }
  }, [connectAsync, directWagmiConnector, targetNetwork.id]);

  const openConnectModal = useCallback(async () => {
    try {
      if (preferDirectWagmiConnect) {
        return await connectDirectWagmi();
      }

      if (thirdwebEnabled && connectOptions) {
        const wallet = await connect(connectOptions);
        await syncWalletToWagmi(
          wallet,
          targetNetwork.id,
          getThirdwebWagmiSyncOptions(wallet, { source: "manualConnect" }),
        );
        return wallet;
      }

      if (directWagmiConnector) {
        return await connectDirectWagmi();
      }

      notification.error("Wallet sign-in is unavailable. Configure thirdweb sign-in or install a browser wallet.", {
        id: "wallet-connect-unavailable",
      });
      return null;
    } catch (error) {
      const failureMessage = getConnectFailureMessage(error, targetNetwork.name);
      if (failureMessage === "Wallet connection cancelled.") {
        notification.info(failureMessage, { id: "wallet-connect-cancelled" });
        return null;
      }

      notification.error(failureMessage, { id: "wallet-connect-failed" });
      return null;
    }
  }, [
    connect,
    connectDirectWagmi,
    connectOptions,
    directWagmiConnector,
    preferDirectWagmiConnect,
    syncWalletToWagmi,
    targetNetwork.id,
    targetNetwork.name,
    thirdwebEnabled,
  ]);

  return {
    openConnectModal,
    isConnecting: thirdwebConnecting || wagmiConnecting,
    canConnect,
    thirdwebEnabled,
  };
}
