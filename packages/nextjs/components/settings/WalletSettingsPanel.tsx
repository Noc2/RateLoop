"use client";

import { type ReactNode, useCallback } from "react";
import { defineChain } from "thirdweb";
import { formatEther, isAddress } from "viem";
import { useAccount, useBalance } from "wagmi";
import { ArrowsRightLeftIcon, WalletIcon } from "@heroicons/react/24/outline";
import { DelegationSection } from "~~/components/profile/DelegationSection";
import { useWalletFunding } from "~~/components/shared/WalletFundingProvider";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useRateLoopSwitchNetwork } from "~~/hooks/useRateLoopSwitchNetwork";
import { useWalletSummaryData } from "~~/hooks/useWalletSummaryData";
import { getDefaultUsdcAddress, getDefaultUsdcDisplayName } from "~~/lib/questionRewardPools";
import {
  getThirdwebWalletFundingUnavailableMessage,
  supportsThirdwebWalletFunding,
} from "~~/lib/thirdweb/walletFunding";
import { thirdwebClient } from "~~/services/thirdweb/client";

const LOCAL_FOUNDRY_CHAIN_ID = 31337;
const DEFAULT_ETH_TOP_UP_AMOUNT = "1";
const ETH_TOP_UP_PRESET_OPTIONS: [number, number, number] = [5, 10, 20];
const DEFAULT_USDC_TOP_UP_AMOUNT = "10";
const USDC_TOP_UP_PRESET_OPTIONS: [number, number, number] = [5, 10, 20];

function formatEthBalance(value: bigint | undefined) {
  if (value === undefined) return "Loading...";

  const formatted = Number(formatEther(value));
  return `${formatted.toLocaleString(undefined, {
    maximumFractionDigits: formatted >= 1 ? 3 : 6,
    minimumFractionDigits: 0,
  })} ETH`;
}

function formatMicroBalance(value: bigint | undefined, symbol: string) {
  if (value === undefined) return "Loading...";

  const whole = value / 1_000_000n;
  const fractional = value % 1_000_000n;
  const wholeText = whole.toLocaleString();
  const fractionalText = fractional.toString().padStart(6, "0").replace(/0+$/, "");
  return `${fractionalText ? `${wholeText}.${fractionalText}` : wholeText} ${symbol}`;
}

function WalletSnapshotRow({
  label,
  testId,
  value,
  action,
  valueClassName,
}: {
  action?: ReactNode;
  label: string;
  testId: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-baseline">
      <dt className="text-xs font-semibold uppercase tracking-wide text-base-content/45">{label}</dt>
      <dd
        className={`min-w-0 text-sm font-medium text-base-content ${valueClassName ?? "tabular-nums"}`}
        data-testid={testId}
      >
        {value}
      </dd>
      {action ? <div className="sm:justify-self-end">{action}</div> : null}
    </div>
  );
}

export function WalletSettingsPanel({ address }: { address?: string }) {
  const { chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { switchToChain, switchingChainId } = useRateLoopSwitchNetwork();
  const { openWalletFunding } = useWalletFunding();
  const walletAddress = address && isAddress(address) ? (address as `0x${string}`) : undefined;
  const nativeBalanceChainId = chain?.id ?? targetNetwork.id;
  const targetSupportsEthTopUp = targetNetwork.id !== LOCAL_FOUNDRY_CHAIN_ID;
  const targetSupportsThirdwebFunding = supportsThirdwebWalletFunding(targetNetwork.id);
  const connectedToTargetNetwork = chain?.id === targetNetwork.id;
  const thirdwebTargetChain = defineChain(targetNetwork);
  const usdcAddress = getDefaultUsdcAddress(targetNetwork.id);
  const usdcDisplayName = getDefaultUsdcDisplayName(targetNetwork.id);
  const { lrepBalance, usdcBalance } = useWalletSummaryData(walletAddress);
  const { data: ethBalance } = useBalance({
    address: walletAddress,
    chainId: nativeBalanceChainId,
    query: {
      enabled: Boolean(walletAddress && nativeBalanceChainId),
    },
  });
  const canUseEthTopUp = Boolean(
    thirdwebClient &&
      walletAddress &&
      targetSupportsEthTopUp &&
      targetSupportsThirdwebFunding &&
      connectedToTargetNetwork,
  );
  const canUseUsdcTopUp = Boolean(
    thirdwebClient &&
      walletAddress &&
      usdcAddress &&
      targetSupportsEthTopUp &&
      targetSupportsThirdwebFunding &&
      connectedToTargetNetwork,
  );

  const ethUnavailableMessage = !thirdwebClient
    ? "ETH top-up is unavailable until thirdweb is configured for this deployment."
    : !targetSupportsEthTopUp
      ? "ETH top-up is available on live deployments."
      : !targetSupportsThirdwebFunding
        ? getThirdwebWalletFundingUnavailableMessage({
            asset: "ETH",
            chainId: targetNetwork.id,
            chainName: targetNetwork.name,
          })
        : !connectedToTargetNetwork
          ? `Switch to ${targetNetwork.name} to buy ETH for gas.`
          : "Connect a wallet to buy ETH for gas.";
  const usdcUnavailableMessage = !thirdwebClient
    ? "USDC top-up is unavailable until thirdweb is configured for this deployment."
    : !targetSupportsEthTopUp
      ? "USDC top-up is available on live deployments."
      : !usdcAddress
        ? "USDC is not configured for this network."
        : !targetSupportsThirdwebFunding
          ? getThirdwebWalletFundingUnavailableMessage({
              asset: "USDC",
              chainId: targetNetwork.id,
              chainName: targetNetwork.name,
            })
          : !connectedToTargetNetwork
            ? `Switch to ${targetNetwork.name} to buy USDC.`
            : "Connect a wallet to buy USDC.";

  const handleOpenEthFunding = useCallback(() => {
    if (!walletAddress) return;

    openWalletFunding({
      amount: DEFAULT_ETH_TOP_UP_AMOUNT,
      asset: "ETH",
      buttonLabel: "Add ETH",
      chain: thirdwebTargetChain,
      description: `Fund your connected wallet with native ETH for ${targetNetwork.name} gas costs.`,
      presetOptions: ETH_TOP_UP_PRESET_OPTIONS,
      receiverAddress: walletAddress,
      title: "Add ETH",
      unavailableMessage: ethUnavailableMessage,
    });
  }, [ethUnavailableMessage, openWalletFunding, targetNetwork.name, thirdwebTargetChain, walletAddress]);

  const handleOpenUsdcFunding = useCallback(() => {
    if (!walletAddress || !usdcAddress) return;

    openWalletFunding({
      amount: DEFAULT_USDC_TOP_UP_AMOUNT,
      asset: "USDC",
      buttonLabel: "Add USDC",
      chain: thirdwebTargetChain,
      description: `Fund your connected wallet with ${usdcDisplayName}.`,
      presetOptions: USDC_TOP_UP_PRESET_OPTIONS,
      receiverAddress: walletAddress,
      title: `Add ${usdcDisplayName}`,
      tokenAddress: usdcAddress,
      unavailableMessage: usdcUnavailableMessage,
    });
  }, [openWalletFunding, thirdwebTargetChain, usdcAddress, usdcDisplayName, usdcUnavailableMessage, walletAddress]);

  return (
    <section className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:items-start">
        <div className="surface-card rounded-2xl p-6">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-base-content/55">
            <WalletIcon className="h-4 w-4" />
            Wallet
          </div>
          <h2 className="mt-3 text-3xl font-semibold text-base-content sm:text-4xl">Gas And Wallet Funding</h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-base-content/65">
            RateLoop uses the configured target network. External wallets need a small native ETH balance for
            transaction fees, while bounties and agent asks use LREP or USDC.
          </p>

          {targetSupportsEthTopUp && !connectedToTargetNetwork ? (
            <button
              type="button"
              className="btn btn-primary mt-5 gap-2"
              disabled={switchingChainId === targetNetwork.id}
              onClick={() => void switchToChain(targetNetwork.id)}
            >
              <ArrowsRightLeftIcon className="h-5 w-5" />
              {switchingChainId === targetNetwork.id ? "Switching..." : `Switch to ${targetNetwork.name}`}
            </button>
          ) : null}

          <dl className="mt-6 w-full divide-y divide-base-content/10 border-y border-base-content/10">
            <WalletSnapshotRow
              label="Address"
              testId="wallet-snapshot-address"
              value={walletAddress ?? "Not connected"}
              valueClassName="break-all tabular-nums"
            />
            <WalletSnapshotRow
              label="ETH"
              testId="wallet-snapshot-eth"
              value={formatEthBalance(ethBalance?.value)}
              action={
                <button
                  type="button"
                  className="btn btn-outline btn-xs"
                  disabled={!canUseEthTopUp}
                  onClick={handleOpenEthFunding}
                >
                  Add ETH
                </button>
              }
            />
            <WalletSnapshotRow
              label="LREP"
              testId="wallet-snapshot-lrep"
              value={formatMicroBalance(lrepBalance, "LREP")}
            />
            <WalletSnapshotRow
              label="USDC"
              testId="wallet-snapshot-usdc"
              value={formatMicroBalance(usdcBalance, usdcDisplayName)}
              action={
                <button
                  type="button"
                  className="btn btn-outline btn-xs"
                  disabled={!canUseUsdcTopUp}
                  onClick={handleOpenUsdcFunding}
                >
                  Add USDC
                </button>
              }
            />
          </dl>
        </div>

        <div className="min-w-0 lg:w-[400px] lg:max-w-full" data-testid="eth-top-up-panel">
          <div className="surface-card-nested rounded-2xl p-5">
            <h3 className="text-lg font-semibold text-base-content">Add Funds</h3>
            <p className="mt-2 text-sm leading-relaxed text-base-content/65">
              Add native ETH for gas costs or {usdcDisplayName} for bounties and agent asks on {targetNetwork.name}.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!canUseEthTopUp}
                onClick={handleOpenEthFunding}
              >
                Add ETH
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={!canUseUsdcTopUp}
                onClick={handleOpenUsdcFunding}
              >
                Add USDC
              </button>
            </div>
            {!canUseEthTopUp || !canUseUsdcTopUp ? (
              <p className="mt-4 text-sm leading-relaxed text-base-content/60">
                {!canUseEthTopUp ? ethUnavailableMessage : usdcUnavailableMessage}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <DelegationSection />
    </section>
  );
}
