"use client";

import { useCallback, useMemo } from "react";
import { useConnectModal } from "thirdweb/react";
import { useConnect } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { getThirdwebWagmiSyncOptions, useThirdwebWagmiSync } from "~~/hooks/useThirdwebWagmiSync";
import { getThirdwebConnectOptions, isThirdwebWalletChain } from "~~/services/thirdweb/client";
import { getDirectWagmiConnector } from "~~/services/web3/wagmiConnectFallback";
import { notification } from "~~/utils/scaffold-eth";

function getConnectFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (/reject|denied|cancel/i.test(message)) {
    return "Wallet connection cancelled.";
  }

  if (/provider|wallet|connector/i.test(message) && /not found|missing|unavailable/i.test(message)) {
    return "No browser wallet was found. Install a wallet extension or configure thirdweb sign-in.";
  }

  return "Could not connect wallet. Check your wallet and try again.";
}

export function useCuryoConnectModal() {
  const { connect, isConnecting: thirdwebConnecting } = useConnectModal();
  const { connectAsync, connectors, isPending: wagmiConnecting } = useConnect();
  const { targetNetwork } = useTargetNetwork();
  const { syncWalletToWagmi } = useThirdwebWagmiSync();
  const connectOptions = useMemo(() => getThirdwebConnectOptions(targetNetwork.id), [targetNetwork.id]);
  const directWagmiConnector = useMemo(() => getDirectWagmiConnector(connectors), [connectors]);
  const thirdwebEnabled = Boolean(connectOptions) && isThirdwebWalletChain(targetNetwork.id);
  const canConnect = thirdwebEnabled || Boolean(directWagmiConnector);

  const openConnectModal = useCallback(async () => {
    try {
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
        await connectAsync({
          chainId: targetNetwork.id,
          connector: directWagmiConnector,
        });
        return directWagmiConnector;
      }

      notification.error("Wallet sign-in is unavailable. Configure thirdweb sign-in or install a browser wallet.", {
        id: "wallet-connect-unavailable",
      });
      return null;
    } catch (error) {
      const failureMessage = getConnectFailureMessage(error);
      if (failureMessage === "Wallet connection cancelled.") {
        notification.info(failureMessage, { id: "wallet-connect-cancelled" });
        return null;
      }

      notification.error(failureMessage, { id: "wallet-connect-failed" });
      return null;
    }
  }, [
    connect,
    connectAsync,
    connectOptions,
    directWagmiConnector,
    syncWalletToWagmi,
    targetNetwork.id,
    thirdwebEnabled,
  ]);

  return {
    openConnectModal,
    isConnecting: thirdwebConnecting || wagmiConnecting,
    canConnect,
    thirdwebEnabled,
  };
}
