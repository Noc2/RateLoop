"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAutoConnect } from "thirdweb/react";
import type { AutoConnectProps } from "thirdweb/react";
import type { Wallet } from "thirdweb/wallets";
import { useWalletRestoreActions } from "~~/contexts/WalletRestoreContext";
import { getThirdwebWagmiSyncOptions, useThirdwebWagmiSync } from "~~/hooks/useThirdwebWagmiSync";
import { getThirdwebAutoConnectOptions } from "~~/services/thirdweb/client";
import { RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY } from "~~/services/thirdweb/testWalletStorage";
import { clearWalletState } from "~~/services/thirdweb/walletStateCleanup";

function clearTimedOutAutoConnectState() {
  if (typeof window === "undefined") {
    return;
  }

  clearWalletState(window.localStorage);
  clearWalletState(window.sessionStorage);
}

function ThirdwebAutoConnectStatus({ status }: { status: "disabled" | "error" | "settled" }) {
  const { setAutoConnectStatus } = useWalletRestoreActions();

  useEffect(() => {
    setAutoConnectStatus(status);
  }, [setAutoConnectStatus, status]);

  return null;
}

function ThirdwebAutoConnectRunner({ autoConnectOptions }: { autoConnectOptions: AutoConnectProps }) {
  const { setAutoConnectStatus } = useWalletRestoreActions();
  const { syncWalletToWagmi } = useThirdwebWagmiSync();
  const isSyncingToWagmiRef = useRef(false);
  const autoConnectProps = useMemo<AutoConnectProps>(
    () => ({
      ...autoConnectOptions,
      onTimeout: () => {
        autoConnectOptions.onTimeout?.();
        clearTimedOutAutoConnectState();
        setAutoConnectStatus("settled");
      },
      onConnect: (wallet: Wallet, allConnectedWallets: Wallet[]) => {
        autoConnectOptions.onConnect?.(wallet, allConnectedWallets);
        isSyncingToWagmiRef.current = true;
        setAutoConnectStatus("syncing");

        void syncWalletToWagmi(wallet, undefined, getThirdwebWagmiSyncOptions(wallet, { source: "autoConnect" }))
          .then(() => {
            setAutoConnectStatus("settled");
          })
          .catch(error => {
            console.error("Failed to sync autoconnected thirdweb wallet to wagmi", error);
            setAutoConnectStatus("error");
          })
          .finally(() => {
            isSyncingToWagmiRef.current = false;
          });
      },
    }),
    [autoConnectOptions, setAutoConnectStatus, syncWalletToWagmi],
  );
  const autoConnect = useAutoConnect(autoConnectProps);

  useEffect(() => {
    if (autoConnect.isLoading) {
      setAutoConnectStatus("pending");
      return;
    }

    if (isSyncingToWagmiRef.current) {
      return;
    }

    setAutoConnectStatus(autoConnect.isError ? "error" : "settled");
  }, [autoConnect.isError, autoConnect.isLoading, setAutoConnectStatus]);

  return null;
}

export function ThirdwebAutoConnectBridge() {
  const autoConnectOptions = useMemo(() => {
    if (
      typeof window !== "undefined" &&
      window.localStorage.getItem(RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY)
    ) {
      return null;
    }

    return getThirdwebAutoConnectOptions();
  }, []);

  if (!autoConnectOptions) {
    return <ThirdwebAutoConnectStatus status="disabled" />;
  }

  return <ThirdwebAutoConnectRunner autoConnectOptions={autoConnectOptions} />;
}
