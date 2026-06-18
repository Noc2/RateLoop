"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { defineChain } from "thirdweb";
import { foundry } from "viem/chains";
import { useAccount } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useThirdwebWagmiSync } from "~~/hooks/useThirdwebWagmiSync";
import scaffoldConfig from "~~/scaffold.config";
import { useGlobalState } from "~~/services/store/store";
import { thirdwebClient } from "~~/services/thirdweb/client";
import { createLocalTestWallet } from "~~/services/thirdweb/localTestWallet";
import {
  RATELOOP_E2E_TEST_WALLET_CHAIN_ID_STORAGE_KEY,
  RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY,
} from "~~/services/thirdweb/testWalletStorage";
import { isLocalE2EWalletBridgeEnabled } from "~~/utils/env/e2eProduction";
import { publicEnv } from "~~/utils/env/public";
import { type ChainWithAttributes, NETWORKS_EXTRA_DATA } from "~~/utils/scaffold-eth";

const DEFAULT_LOCAL_TEST_CHAIN_ID = foundry.id;
const allowLocalE2EProductionBuild = process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD === "true";

type LocalTestWalletConfig = {
  chainId: number;
  privateKey: string;
};

function isLocalTestWalletEnabled() {
  if (typeof window === "undefined") {
    return false;
  }

  return isLocalE2EWalletBridgeEnabled({
    hostname: window.location.hostname,
    isProduction: publicEnv.isProduction,
    localE2EProductionBuild: allowLocalE2EProductionBuild,
  });
}

function parseLocalTestChainId(value: string | null | undefined): number {
  const chainId = Number(value);

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return DEFAULT_LOCAL_TEST_CHAIN_ID;
  }

  return chainId;
}

function getConfiguredTargetNetwork(chainId: number): ChainWithAttributes | null {
  const network = scaffoldConfig.targetNetworks.find(targetNetwork => targetNetwork.id === chainId);

  if (!network) {
    return null;
  }

  return {
    ...network,
    ...NETWORKS_EXTRA_DATA[chainId],
  };
}

function getLocalTestWalletConfig(): LocalTestWalletConfig | null {
  if (!isLocalTestWalletEnabled() || !thirdwebClient) {
    return null;
  }

  const privateKey = window.localStorage.getItem(RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY)?.trim();
  if (!privateKey) {
    return null;
  }

  return {
    chainId: parseLocalTestChainId(window.localStorage.getItem(RATELOOP_E2E_TEST_WALLET_CHAIN_ID_STORAGE_KEY)),
    privateKey,
  };
}

function LocalTestWalletBridgeRunner({
  chainId,
  client,
  privateKey,
}: {
  chainId: number;
  client: NonNullable<typeof thirdwebClient>;
  privateKey: string;
}) {
  const { targetNetwork } = useTargetNetwork();
  const { address } = useAccount();
  const { syncWalletToWagmi } = useThirdwebWagmiSync();
  const setTargetNetwork = useGlobalState(state => state.setTargetNetwork);
  const isSyncingRef = useRef(false);
  const thirdwebTargetChain = useMemo(() => defineChain(targetNetwork), [targetNetwork]);

  useEffect(() => {
    if (targetNetwork.id !== chainId) {
      const localTestNetwork = getConfiguredTargetNetwork(chainId);
      if (!localTestNetwork) {
        console.error("Local test wallet chain is not configured as a target network", {
          chainId,
          targetNetworks: scaffoldConfig.targetNetworks.map(network => network.id),
        });
        return;
      }

      setTargetNetwork(localTestNetwork);
      return;
    }

    if (thirdwebTargetChain.id !== chainId) {
      return;
    }

    const wallet = createLocalTestWallet({
      chain: thirdwebTargetChain,
      client,
      privateKey,
    });
    const targetAddress = wallet.getAccount()?.address?.toLowerCase();

    if (!targetAddress) {
      return;
    }

    if (address?.toLowerCase() === targetAddress) {
      return;
    }

    if (isSyncingRef.current) {
      return;
    }

    let cancelled = false;
    isSyncingRef.current = true;

    void (async () => {
      try {
        if (!cancelled && address?.toLowerCase() !== targetAddress) {
          await syncWalletToWagmi(wallet, thirdwebTargetChain.id);
        }
      } catch (error) {
        console.error("Failed to sync local test wallet to wagmi", error);
      } finally {
        isSyncingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      isSyncingRef.current = false;
    };
  }, [
    address,
    chainId,
    client,
    privateKey,
    setTargetNetwork,
    syncWalletToWagmi,
    targetNetwork.id,
    thirdwebTargetChain,
  ]);

  return null;
}

export function LocalTestWalletBridge() {
  const [config, setConfig] = useState<LocalTestWalletConfig | null>(null);

  useEffect(() => {
    setConfig(getLocalTestWalletConfig());
  }, []);

  if (!config || !thirdwebClient) {
    return null;
  }

  return (
    <LocalTestWalletBridgeRunner chainId={config.chainId} client={thirdwebClient} privateKey={config.privateKey} />
  );
}
