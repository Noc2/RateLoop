"use client";

import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getAccount, watchAccount } from "@wagmi/core";
import { useActiveAccount } from "thirdweb/react";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

type WalletAutoConnectStatus = "pending" | "syncing" | "settled" | "disabled" | "error";

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

type WagmiAccountSnapshot = {
  address: string | undefined;
  status: "connected" | "connecting" | "disconnected" | "reconnecting";
};

function deferStateUpdate(callback: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }

  void Promise.resolve().then(callback);
}

function getWagmiAccountSnapshot(): WagmiAccountSnapshot {
  const { address, status } = getAccount(wagmiConfig);

  return {
    address,
    status,
  };
}

function isSameWagmiAccountSnapshot(left: WagmiAccountSnapshot, right: WagmiAccountSnapshot) {
  return left.address === right.address && left.status === right.status;
}

function useDeferredWagmiAccount() {
  const [account, setAccount] = useState(getWagmiAccountSnapshot);
  const isMountedRef = useRef(false);
  const pendingAccountRef = useRef<WagmiAccountSnapshot | null>(null);
  const isFlushScheduledRef = useRef(false);

  const applyAccount = useCallback((nextAccount: WagmiAccountSnapshot) => {
    setAccount(currentAccount =>
      isSameWagmiAccountSnapshot(currentAccount, nextAccount) ? currentAccount : nextAccount,
    );
  }, []);

  const scheduleAccount = useCallback(
    (nextAccount: WagmiAccountSnapshot) => {
      pendingAccountRef.current = nextAccount;

      if (isFlushScheduledRef.current) {
        return;
      }

      isFlushScheduledRef.current = true;
      deferStateUpdate(() => {
        isFlushScheduledRef.current = false;
        const pendingAccount = pendingAccountRef.current;
        pendingAccountRef.current = null;

        if (!pendingAccount || !isMountedRef.current) {
          return;
        }

        applyAccount(pendingAccount);
      });
    },
    [applyAccount],
  );

  useEffect(() => {
    isMountedRef.current = true;
    applyAccount(getWagmiAccountSnapshot());

    const unsubscribe = watchAccount(wagmiConfig, {
      onChange(account) {
        scheduleAccount({
          address: account.address,
          status: account.status,
        });
      },
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [applyAccount, scheduleAccount]);

  return account;
}

export function WalletRestoreProvider({ children }: { children: ReactNode }) {
  const { address, status } = useDeferredWagmiAccount();
  const activeThirdwebAccount = useActiveAccount();
  const [hasMounted, setHasMounted] = useState(false);
  const [autoConnectStatus, setAutoConnectStatus] = useState<WalletAutoConnectStatus>("pending");
  const isMountedRef = useRef(false);
  const pendingAutoConnectStatusRef = useRef<WalletAutoConnectStatus | null>(null);
  const isAutoConnectFlushScheduledRef = useRef(false);

  const setAutoConnectStatusSafely = useCallback((status: WalletAutoConnectStatus) => {
    pendingAutoConnectStatusRef.current = status;

    if (isAutoConnectFlushScheduledRef.current) {
      return;
    }

    isAutoConnectFlushScheduledRef.current = true;
    deferStateUpdate(() => {
      isAutoConnectFlushScheduledRef.current = false;
      const pendingStatus = pendingAutoConnectStatusRef.current;
      pendingAutoConnectStatusRef.current = null;

      if (!pendingStatus || !isMountedRef.current) {
        return;
      }

      setAutoConnectStatus(currentStatus => (currentStatus === pendingStatus ? currentStatus : pendingStatus));
    });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    setHasMounted(true);

    return () => {
      isMountedRef.current = false;
    };
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
      setAutoConnectStatus: setAutoConnectStatusSafely,
    }),
    [setAutoConnectStatusSafely],
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
