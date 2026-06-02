"use client";

import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useAccount } from "wagmi";

export type WalletAutoConnectStatus = "pending" | "syncing" | "settled" | "disabled" | "error";

type WalletRestoreContextValue = {
  autoConnectStatus: WalletAutoConnectStatus;
  hasResolvedInitialWallet: boolean;
  isRestoringWallet: boolean;
};

type WalletRestoreActionsContextValue = {
  setAutoConnectStatus: (status: WalletAutoConnectStatus) => void;
};

const DEFAULT_WALLET_RESTORE_CONTEXT: WalletRestoreContextValue = {
  autoConnectStatus: "disabled",
  hasResolvedInitialWallet: true,
  isRestoringWallet: false,
};

const WalletRestoreContext = createContext<WalletRestoreContextValue>(DEFAULT_WALLET_RESTORE_CONTEXT);
const WalletRestoreActionsContext = createContext<WalletRestoreActionsContextValue>({
  setAutoConnectStatus: () => {},
});

export function WalletRestoreProvider({ children }: { children: ReactNode }) {
  const { address, status } = useAccount();
  const activeThirdwebAccount = useActiveAccount();
  const [hasMounted, setHasMounted] = useState(false);
  const [autoConnectStatus, setAutoConnectStatus] = useState<WalletAutoConnectStatus>("pending");

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const isWagmiRestoring = status === "connecting" || status === "reconnecting";
  const isAutoConnectRestoring = autoConnectStatus === "pending" || autoConnectStatus === "syncing";
  const isThirdwebSyncPending = Boolean(activeThirdwebAccount?.address && !address);
  const isRestoringWallet = !hasMounted || isWagmiRestoring || isAutoConnectRestoring || isThirdwebSyncPending;

  const value = useMemo<WalletRestoreContextValue>(
    () => ({
      autoConnectStatus,
      hasResolvedInitialWallet: !isRestoringWallet,
      isRestoringWallet,
    }),
    [autoConnectStatus, isRestoringWallet],
  );

  const actions = useMemo<WalletRestoreActionsContextValue>(
    () => ({
      setAutoConnectStatus,
    }),
    [],
  );

  return (
    <WalletRestoreActionsContext.Provider value={actions}>
      <WalletRestoreContext.Provider value={value}>{children}</WalletRestoreContext.Provider>
    </WalletRestoreActionsContext.Provider>
  );
}

export function useWalletRestore() {
  return useContext(WalletRestoreContext);
}

export function useWalletRestoreActions() {
  return useContext(WalletRestoreActionsContext);
}
