"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useSignMessage } from "wagmi";

type SignMessageArgs = {
  message: string;
};

type WalletMessageAccount = {
  address?: string;
  signMessage?: (args: SignMessageArgs) => Promise<`0x${string}`>;
};

type WalletMessageClient = {
  account?: { address?: string } | string | null | undefined;
  signMessage?: (args: any) => Promise<`0x${string}`>;
};

type SignMessageWithPreferredWalletParams = {
  expectedAddress?: string;
  localWalletClient?: WalletMessageClient;
  message: string;
  thirdwebAccount?: WalletMessageAccount | null;
  wagmiSignMessage: (args: SignMessageArgs) => Promise<`0x${string}`>;
};

function normalizeAddress(value: string | undefined | null) {
  return value?.toLowerCase() ?? null;
}

function getWalletClientAccountAddress(walletClient: WalletMessageClient | undefined) {
  const account = walletClient?.account;
  if (typeof account === "string") {
    return account;
  }

  return account?.address;
}

function signerMatchesAddress(signerAddress: string | undefined, expectedAddress: string | undefined) {
  const normalizedSignerAddress = normalizeAddress(signerAddress);
  const normalizedExpectedAddress = normalizeAddress(expectedAddress);
  return Boolean(normalizedSignerAddress && normalizedSignerAddress === normalizedExpectedAddress);
}

export async function signMessageWithPreferredWallet({
  expectedAddress,
  localWalletClient,
  message,
  thirdwebAccount,
  wagmiSignMessage,
}: SignMessageWithPreferredWalletParams) {
  if (
    typeof localWalletClient?.signMessage === "function" &&
    signerMatchesAddress(getWalletClientAccountAddress(localWalletClient), expectedAddress)
  ) {
    return localWalletClient.signMessage({
      account: localWalletClient.account,
      message,
    });
  }

  if (
    typeof thirdwebAccount?.signMessage === "function" &&
    signerMatchesAddress(thirdwebAccount.address, expectedAddress)
  ) {
    return thirdwebAccount.signMessage({ message });
  }

  return wagmiSignMessage({ message });
}

export function useWalletMessageSigner({
  address,
  localWalletClient,
}: {
  address?: string;
  localWalletClient?: WalletMessageClient;
} = {}) {
  const activeThirdwebAccount = useActiveAccount() as WalletMessageAccount | undefined;
  const { signMessageAsync: wagmiSignMessageAsync, isPending: isWagmiSigningMessage } = useSignMessage();
  const [isPreferredWalletSigning, setIsPreferredWalletSigning] = useState(false);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const signMessageAsync = useCallback(
    async ({ message }: SignMessageArgs) => {
      setIsPreferredWalletSigning(true);
      try {
        return await signMessageWithPreferredWallet({
          expectedAddress: address,
          localWalletClient,
          message,
          thirdwebAccount: activeThirdwebAccount,
          wagmiSignMessage: wagmiSignMessageAsync,
        });
      } finally {
        if (isMountedRef.current) {
          setIsPreferredWalletSigning(false);
        }
      }
    },
    [activeThirdwebAccount, address, localWalletClient, wagmiSignMessageAsync],
  );

  return {
    isPending: isWagmiSigningMessage || isPreferredWalletSigning,
    signMessageAsync,
  };
}
