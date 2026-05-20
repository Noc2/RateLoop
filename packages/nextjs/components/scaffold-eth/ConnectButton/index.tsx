"use client";

// @refresh reset
import { AddressInfoDropdown } from "./AddressInfoDropdown";
import { WrongNetworkDropdown } from "./WrongNetworkDropdown";
import { useActiveWalletChain } from "thirdweb/react";
import { Address } from "viem";
import { useAccount } from "wagmi";
import { HumanSignInButton } from "~~/components/shared/HumanSignInButton";
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
  const activeThirdwebChain = useActiveWalletChain();
  const resolvedChain = chain ?? activeThirdwebChain;

  if (!address || !resolvedChain) {
    return (
      <HumanSignInButton
        className="btn btn-sm btn-primary border-none"
        data-testid="auth-connect-button"
        style={{ fontSize: "16px" }}
      >
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
