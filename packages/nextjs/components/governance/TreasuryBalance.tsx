"use client";

import type { ComponentType, ReactNode } from "react";
import { type Address, erc20Abi } from "viem";
import { useReadContract } from "wagmi";
import { BanknotesIcon, BuildingLibraryIcon, CircleStackIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { surfaceSectionHeadingClassName } from "~~/components/shared/sectionHeading";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { usePageVisibility } from "~~/hooks/usePageVisibility";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { getDefaultUsdcAddress, getDefaultUsdcDisplayName } from "~~/lib/questionRewardPools";

const TOKEN_DISPLAY_DECIMALS = 6;
const BALANCE_STALE_TIME_MS = 60_000;
const LOCAL_BALANCE_REFETCH_MS = 2_000;
const REMOTE_BALANCE_REFETCH_MS = 60_000;

export function formatTokenBalance(balance: bigint | undefined, decimals = TOKEN_DISPLAY_DECIMALS) {
  if (balance === undefined) return "—";
  if (decimals < 0 || !Number.isInteger(decimals)) return balance.toLocaleString();

  const sign = balance < 0n ? "-" : "";
  const absolute = balance < 0n ? -balance : balance;
  const fractionDigits = Math.min(2, decimals);
  const displayScale = 10n ** BigInt(fractionDigits);
  const unitScale = 10n ** BigInt(decimals);
  const rounded = (absolute * displayScale + unitScale / 2n) / unitScale;
  const whole = rounded / displayScale;
  const fraction = rounded % displayScale;
  const fractionText = fractionDigits === 0 ? "" : fraction.toString().padStart(fractionDigits, "0").replace(/0+$/, "");

  return `${sign}${whole.toLocaleString()}${fractionText ? `.${fractionText}` : ""}`;
}

export function truncateAddress(address: string | undefined, start = 6, end = 4) {
  if (!address) return "—";
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

export function treasuryAddressesDiffer(
  protocolTreasuryAddress: string | undefined,
  registryTreasuryAddress: string | undefined,
) {
  return (
    !!protocolTreasuryAddress &&
    !!registryTreasuryAddress &&
    protocolTreasuryAddress.toLowerCase() !== registryTreasuryAddress.toLowerCase()
  );
}

function getAddressExplorerUrl(blockExplorerUrl: string | undefined, address: string | undefined) {
  if (!blockExplorerUrl || !address) return undefined;
  return `${blockExplorerUrl.replace(/\/+$/, "")}/address/${address}`;
}

type PoolStatProps = {
  title: string;
  description?: string;
  tooltip: string;
  value: ReactNode;
  isLoading: boolean;
  Icon: ComponentType<{ className?: string }>;
};

function PoolStat({ title, description, tooltip, value, isLoading, Icon }: PoolStatProps) {
  return (
    <div className="bg-base-300 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="font-medium">{title}</p>
            <InfoTooltip text={tooltip} className="[&>svg]:opacity-50" />
          </div>
          {description ? <p className="text-base text-base-content/50 mt-1">{description}</p> : null}
        </div>
        <Icon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
      </div>

      {isLoading ? (
        <div className="h-8 w-32 bg-base-content/10 rounded animate-pulse mt-4" />
      ) : (
        <div className="text-2xl font-bold tabular-nums mt-4">{value}</div>
      )}
    </div>
  );
}

export const TreasuryBalance = () => {
  const { targetNetwork } = useTargetNetwork();
  const isPageVisible = usePageVisibility();
  const isLocalNetwork = targetNetwork.id === 31337;
  const usdcAddress = getDefaultUsdcAddress(targetNetwork.id);
  const usdcDisplayName = getDefaultUsdcDisplayName(targetNetwork.id);
  const balanceRefetchInterval: number | false = isPageVisible
    ? isLocalNetwork
      ? LOCAL_BALANCE_REFETCH_MS
      : REMOTE_BALANCE_REFETCH_MS
    : false;
  const balanceQuery = {
    staleTime: isLocalNetwork ? 0 : BALANCE_STALE_TIME_MS,
    refetchInterval: balanceRefetchInterval,
  };

  const { data: protocolTreasuryAddressRaw, isLoading: protocolTreasuryAddressLoading } = useScaffoldReadContract({
    contractName: "ProtocolConfig",
    functionName: "treasury",
  });
  const protocolTreasuryAddress =
    typeof protocolTreasuryAddressRaw === "string" ? (protocolTreasuryAddressRaw as Address) : undefined;

  const { data: registryTreasuryAddressRaw, isLoading: registryTreasuryAddressLoading } = useScaffoldReadContract({
    contractName: "ContentRegistry",
    functionName: "treasury",
  });
  const registryTreasuryAddress =
    typeof registryTreasuryAddressRaw === "string" ? (registryTreasuryAddressRaw as Address) : undefined;

  const treasuryAddress = protocolTreasuryAddress ?? registryTreasuryAddress;
  const treasuryAddressLoading =
    protocolTreasuryAddressLoading || (!protocolTreasuryAddress && registryTreasuryAddressLoading);
  const treasuryMismatch = treasuryAddressesDiffer(protocolTreasuryAddress, registryTreasuryAddress);
  const treasuryExplorerUrl = getAddressExplorerUrl(targetNetwork.blockExplorers?.default?.url, treasuryAddress);

  const { data: treasuryBalanceRaw, isLoading: balanceLoading } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: treasuryAddress ? [treasuryAddress] : undefined,
    query: {
      enabled: !!treasuryAddress,
      ...balanceQuery,
    },
  });

  const { data: treasuryUsdcBalanceRaw, isLoading: usdcBalanceLoading } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: treasuryAddress ? [treasuryAddress] : undefined,
    chainId: targetNetwork.id,
    query: {
      enabled: Boolean(treasuryAddress && usdcAddress),
      ...balanceQuery,
    },
  });

  const { data: launchDistributionBalance, isLoading: launchDistributionLoading } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "poolBalance",
  });

  const { data: maxSupply, isLoading: maxSupplyLoading } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "MAX_SUPPLY",
  });

  const treasuryLoading = treasuryAddressLoading || (!!treasuryAddress && balanceLoading);
  const treasuryUsdcLoading = treasuryAddressLoading || (!!treasuryAddress && !!usdcAddress && usdcBalanceLoading);

  return (
    <div className="surface-card rounded-2xl p-6">
      <div className="flex items-center gap-2">
        <h2 className={surfaceSectionHeadingClassName}>Protocol Pools</h2>
        <InfoTooltip
          text="Live treasury balances and protocol-controlled pool balances on the selected network."
          className="[&>svg]:opacity-60"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
        <PoolStat
          title="Treasury Address"
          description={treasuryMismatch ? "ProtocolConfig and ContentRegistry treasury addresses differ." : undefined}
          tooltip="Governance-controlled recipient used by current forfeiture and treasury routes."
          value={
            treasuryExplorerUrl ? (
              <a
                className="link link-hover break-all font-mono text-lg"
                href={treasuryExplorerUrl}
                rel="noreferrer"
                target="_blank"
                title={treasuryAddress}
              >
                {truncateAddress(treasuryAddress)}
              </a>
            ) : (
              <span className="break-all font-mono text-lg" title={treasuryAddress}>
                {truncateAddress(treasuryAddress)}
              </span>
            )
          }
          isLoading={treasuryAddressLoading}
          Icon={BuildingLibraryIcon}
        />
        <PoolStat
          title="Treasury LREP"
          tooltip="LREP held by the governance-controlled treasury."
          value={<p>{formatTokenBalance(treasuryBalanceRaw)} LREP</p>}
          isLoading={treasuryLoading}
          Icon={CircleStackIcon}
        />
        <PoolStat
          title={`Treasury ${usdcDisplayName}`}
          description={usdcAddress ? undefined : "USDC is not configured for this network."}
          tooltip="USDC held by the governance-controlled treasury. This includes forfeited USDC bounty and Feedback Bonus residue after their expiry paths run."
          value={
            <p>
              {formatTokenBalance(treasuryUsdcBalanceRaw)} {usdcDisplayName}
            </p>
          }
          isLoading={treasuryUsdcLoading}
          Icon={BanknotesIcon}
        />
        <PoolStat
          title="Launch Distribution"
          tooltip="Remaining LREP held by the LaunchDistributionPool for earned rater, verified/referral, and legacy-user rewards."
          value={<p>{formatTokenBalance(launchDistributionBalance)} LREP</p>}
          isLoading={launchDistributionLoading}
          Icon={UserGroupIcon}
        />
        <PoolStat
          title="Supply Cap"
          tooltip="Hard-capped maximum LREP supply. Launch distribution and future programs must fit inside this cap."
          value={<p>{formatTokenBalance(maxSupply)} LREP</p>}
          isLoading={maxSupplyLoading}
          Icon={CircleStackIcon}
        />
      </div>
    </div>
  );
};
