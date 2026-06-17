"use client";

import { defineChain } from "thirdweb";
import { BuyWidget } from "thirdweb/react";
import { formatEther, isAddress } from "viem";
import { useAccount, useBalance } from "wagmi";
import { ArrowsRightLeftIcon, WalletIcon } from "@heroicons/react/24/outline";
import { DelegationSection } from "~~/components/profile/DelegationSection";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useRateLoopSwitchNetwork } from "~~/hooks/useRateLoopSwitchNetwork";
import { useWalletSummaryData } from "~~/hooks/useWalletSummaryData";
import { thirdwebClient } from "~~/services/thirdweb/client";

const LOCAL_FOUNDRY_CHAIN_ID = 31337;
const DEFAULT_ETH_TOP_UP_AMOUNT = "1";
const ETH_TOP_UP_PRESET_OPTIONS: [number, number, number] = [5, 10, 20];

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
  valueClassName,
}: {
  label: string;
  testId: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-baseline">
      <dt className="text-xs font-semibold uppercase tracking-wide text-base-content/45">{label}</dt>
      <dd
        className={`min-w-0 text-sm font-medium text-base-content ${valueClassName ?? "tabular-nums"}`}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

export function WalletSettingsPanel({ address }: { address?: string }) {
  const { chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { switchToChain, switchingChainId } = useRateLoopSwitchNetwork();
  const walletAddress = address && isAddress(address) ? (address as `0x${string}`) : undefined;
  const nativeBalanceChainId = chain?.id ?? targetNetwork.id;
  const targetSupportsEthTopUp = targetNetwork.id !== LOCAL_FOUNDRY_CHAIN_ID;
  const connectedToTargetNetwork = chain?.id === targetNetwork.id;
  const thirdwebTargetChain = defineChain(targetNetwork);
  const { lrepBalance, usdcBalance } = useWalletSummaryData(walletAddress);
  const { data: ethBalance } = useBalance({
    address: walletAddress,
    chainId: nativeBalanceChainId,
    query: {
      enabled: Boolean(walletAddress && nativeBalanceChainId),
    },
  });
  const canUseEthTopUp = Boolean(thirdwebClient && walletAddress && targetSupportsEthTopUp && connectedToTargetNetwork);

  const unavailableMessage = !thirdwebClient
    ? "ETH top-up is unavailable until thirdweb is configured for this deployment."
    : !targetSupportsEthTopUp
      ? "ETH top-up is available on live deployments."
      : !connectedToTargetNetwork
        ? `Switch to ${targetNetwork.name} to buy ETH for gas.`
        : "Connect a wallet to buy ETH for gas.";

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
              valueClassName="break-all font-mono text-xs leading-5 text-base-content/80"
            />
            <WalletSnapshotRow label="ETH" testId="wallet-snapshot-eth" value={formatEthBalance(ethBalance?.value)} />
            <WalletSnapshotRow
              label="LREP"
              testId="wallet-snapshot-lrep"
              value={formatMicroBalance(lrepBalance, "LREP")}
            />
            <WalletSnapshotRow
              label="USDC"
              testId="wallet-snapshot-usdc"
              value={formatMicroBalance(usdcBalance, "USDC")}
            />
          </dl>
        </div>

        <div className="min-w-0 lg:w-[400px] lg:max-w-full" data-testid="eth-top-up-panel">
          {canUseEthTopUp && thirdwebClient && walletAddress ? (
            <BuyWidget
              amount={DEFAULT_ETH_TOP_UP_AMOUNT}
              amountEditable
              buttonLabel="Add ETH"
              chain={thirdwebTargetChain}
              client={thirdwebClient}
              description={`Fund your connected wallet with native ETH for ${targetNetwork.name} gas costs.`}
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

      <DelegationSection />
    </section>
  );
}
