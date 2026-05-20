"use client";

import { defineChain } from "thirdweb";
import { BuyWidget } from "thirdweb/react";
import { formatEther, isAddress } from "viem";
import { worldchain } from "viem/chains";
import { useAccount, useBalance } from "wagmi";
import { ArrowsRightLeftIcon, BanknotesIcon, WalletIcon } from "@heroicons/react/24/outline";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useRateLoopSwitchNetwork } from "~~/hooks/useRateLoopSwitchNetwork";
import { thirdwebClient } from "~~/services/thirdweb/client";

const WORLD_CHAIN_MAINNET_CHAIN_ID = 480;
const DEFAULT_ETH_TOP_UP_AMOUNT = "1";
const ETH_TOP_UP_PRESET_OPTIONS: [number, number, number] = [5, 10, 20];
const THIRDWEB_WORLD_CHAIN = defineChain(worldchain);

function formatEthBalance(value: bigint | undefined) {
  if (value === undefined) return "Loading...";

  const formatted = Number(formatEther(value));
  return `${formatted.toLocaleString(undefined, {
    maximumFractionDigits: formatted >= 1 ? 3 : 6,
    minimumFractionDigits: 0,
  })} ETH`;
}

function shortAddress(value: string | undefined) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Not connected";
}

export function WalletSettingsPanel({ address }: { address?: string }) {
  const { chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { switchToChain, switchingChainId } = useRateLoopSwitchNetwork();
  const walletAddress = address && isAddress(address) ? (address as `0x${string}`) : undefined;
  const targetIsWorldChain = targetNetwork.id === WORLD_CHAIN_MAINNET_CHAIN_ID;
  const connectedToWorldChain = chain?.id === WORLD_CHAIN_MAINNET_CHAIN_ID;
  const { data: ethBalance } = useBalance({
    address: walletAddress,
    chainId: WORLD_CHAIN_MAINNET_CHAIN_ID,
    query: {
      enabled: Boolean(walletAddress && targetIsWorldChain),
    },
  });
  const canUseEthTopUp = Boolean(thirdwebClient && walletAddress && targetIsWorldChain && connectedToWorldChain);

  const unavailableMessage = !thirdwebClient
    ? "ETH top-up is unavailable until thirdweb is configured for this deployment."
    : !targetIsWorldChain
      ? "ETH top-up is available on World Chain mainnet deployments."
      : !connectedToWorldChain
        ? "Switch to World Chain mainnet to buy ETH for gas."
        : "Connect a wallet to buy ETH for gas.";

  return (
    <section className="space-y-6">
      <div className="surface-card rounded-2xl p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-base-content/55">
              <WalletIcon className="h-4 w-4" />
              Wallet
            </div>
            <h2 className="mt-3 text-3xl font-semibold text-base-content sm:text-4xl">Gas and wallet funding</h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-base-content/65">
              RateLoop uses World Chain. External wallets need a small native ETH balance for transaction fees, while
              bounties and agent asks still use LREP or World Chain USDC.
            </p>
          </div>

          <div className="rounded-2xl bg-base-300 px-4 py-3 text-sm text-base-content/70">
            <p className="font-medium text-base-content">{shortAddress(walletAddress)}</p>
            <p className="mt-1">
              {targetIsWorldChain ? formatEthBalance(ethBalance?.value) : "World Chain mainnet required"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(340px,1.1fr)]">
        <div className="surface-card rounded-2xl p-6">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-base-content/55">
            <BanknotesIcon className="h-4 w-4" />
            ETH for gas
          </div>
          <h3 className="mt-3 text-2xl font-semibold text-base-content">Top up network fees</h3>
          <p className="mt-3 text-base leading-relaxed text-base-content/65">
            Buy native ETH directly to the connected wallet. ETH covers World Chain gas for normal wallet transactions
            after sponsored RateLoop Wallet transactions are used or unavailable.
          </p>

          {targetIsWorldChain && !connectedToWorldChain ? (
            <button
              type="button"
              className="btn btn-primary mt-5 gap-2"
              disabled={switchingChainId === WORLD_CHAIN_MAINNET_CHAIN_ID}
              onClick={() => void switchToChain(WORLD_CHAIN_MAINNET_CHAIN_ID)}
            >
              <ArrowsRightLeftIcon className="h-5 w-5" />
              {switchingChainId === WORLD_CHAIN_MAINNET_CHAIN_ID ? "Switching..." : "Switch to World Chain"}
            </button>
          ) : null}
        </div>

        <div className="min-w-0">
          {canUseEthTopUp && thirdwebClient && walletAddress ? (
            <BuyWidget
              amount={DEFAULT_ETH_TOP_UP_AMOUNT}
              amountEditable
              buttonLabel="Add ETH"
              chain={THIRDWEB_WORLD_CHAIN}
              client={thirdwebClient}
              description="Fund your connected wallet with native ETH for World Chain gas costs."
              presetOptions={ETH_TOP_UP_PRESET_OPTIONS}
              receiverAddress={walletAddress}
              showThirdwebBranding={false}
              theme="dark"
              title="Add ETH"
              tokenEditable={false}
            />
          ) : (
            <div className="surface-card-nested rounded-2xl p-5">
              <p className="text-sm leading-relaxed text-base-content/65">{unavailableMessage}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
