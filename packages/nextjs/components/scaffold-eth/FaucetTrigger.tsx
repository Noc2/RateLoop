"use client";

import { hardhat } from "viem/chains";
import { useAccount } from "wagmi";
import { GiftIcon } from "@heroicons/react/24/outline";

export const FAUCET_MODAL_ID = "faucet-modal";

type FaucetTriggerProps = {
  className?: string;
  textClassName?: string;
};

export const FaucetTrigger = ({
  className = "flex items-center justify-center xl:justify-start gap-3 xl:px-4 py-3 rounded-xl transition-colors text-base-content/60 hover:text-base-content hover:bg-base-200 w-full cursor-pointer",
  textClassName = "hidden xl:inline",
}: FaucetTriggerProps) => {
  const { chain: connectedChain } = useAccount();

  if (connectedChain?.id !== hardhat.id) {
    return null;
  }

  return (
    <label htmlFor={FAUCET_MODAL_ID} className={className}>
      <GiftIcon className="w-6 h-6 shrink-0" />
      <span className={textClassName}>Faucet</span>
    </label>
  );
};
