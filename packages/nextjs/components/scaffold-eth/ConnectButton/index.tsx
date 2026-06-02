"use client";

// @refresh reset
import { AddressInfoDropdown } from "./AddressInfoDropdown";
import { WrongNetworkDropdown } from "./WrongNetworkDropdown";
import { useActiveWalletChain } from "thirdweb/react";
import { Address } from "viem";
import { useAccount } from "wagmi";
import { HumanSignInButton } from "~~/components/shared/HumanSignInButton";
import { useWalletRestore } from "~~/contexts/WalletRestoreContext";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { HUMAN_SIGN_IN_LABEL } from "~~/lib/home/humanSignInRoute";

export const RateLoopConnectButton = ({
  inlineMenu = false,
  compact = false,
}: {
  inlineMenu?: boolean;
  compact?: boolean;
}) => {
  const { targetNetwork } = useTargetNetwork();
  const { address, chain } = useAccount();
  const { isRestoringWallet } = useWalletRestore();
  const activeThirdwebChain = useActiveWalletChain();
  const resolvedChain = chain ?? activeThirdwebChain;
  const signInMotion = compact || inlineMenu ? "idle" : "intro";

  if (!address || !resolvedChain) {
    if (isRestoringWallet) {
      return (
        <HumanSignInButton disabled gradientMotion="processing" gradientSize="sm" data-testid="auth-connect-loading">
          <span className="inline-flex items-center gap-2">
            <span className="loading loading-spinner loading-xs" aria-hidden="true" />
            Loading...
          </span>
        </HumanSignInButton>
      );
    }

    return (
      <HumanSignInButton gradientMotion={signInMotion} gradientSize="sm" data-testid="auth-connect-button">
        {HUMAN_SIGN_IN_LABEL}
      </HumanSignInButton>
    );
  }

  if (resolvedChain.id !== targetNetwork.id) {
    return <WrongNetworkDropdown />;
  }

  return (
    <>
      <AddressInfoDropdown
        address={address as Address}
        displayName={`${address?.slice(0, 6)}...${address?.slice(-4)}`}
        compact={compact}
        inlineMenu={inlineMenu}
      />
    </>
  );
};
