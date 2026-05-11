"use client";

import { BuildingLibraryIcon, CircleStackIcon, ShieldCheckIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { surfaceSectionHeadingClassName } from "~~/components/shared/sectionHeading";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";

function formatBalance(balance: bigint | undefined) {
  if (balance === undefined) return "—";
  return (Number(balance) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

type PoolStatProps = {
  title: string;
  description?: string;
  tooltip: string;
  value: bigint | undefined;
  isLoading: boolean;
  Icon: typeof BuildingLibraryIcon;
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
        <p className="text-2xl font-bold tabular-nums mt-4">{formatBalance(value)} LREP</p>
      )}
    </div>
  );
}

export const TreasuryBalance = () => {
  // Read the on-chain treasury address from ContentRegistry.
  const { data: treasuryAddress, isLoading: treasuryAddressLoading } = useScaffoldReadContract({
    contractName: "ContentRegistry",
    functionName: "treasury",
  });

  // Read LREP balance of treasury
  const { data: treasuryBalanceRaw, isLoading: balanceLoading } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [treasuryAddress],
    query: {
      enabled: !!treasuryAddress,
    },
  });

  const { data: consensusReserve, isLoading: consensusReserveLoading } = useScaffoldReadContract({
    contractName: "RoundVotingEngine",
    functionName: "consensusReserve",
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

  return (
    <div className="surface-card rounded-2xl p-6">
      <div className="flex items-center gap-2">
        <h2 className={surfaceSectionHeadingClassName}>Protocol Pools</h2>
        <InfoTooltip
          text="Live LREP balances across the treasury and protocol-controlled pools."
          className="[&>svg]:opacity-60"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
        <PoolStat
          title="Treasury"
          tooltip="Balance held by the governance-controlled treasury. Funded by the 1% settlement fee, cancellation fees, and forfeited votes."
          value={treasuryBalanceRaw}
          isLoading={treasuryLoading}
          Icon={BuildingLibraryIcon}
        />
        <PoolStat
          title="Consensus Reserve"
          tooltip="Tracked inside RoundVotingEngine and replenished by 5% of losing pools from two-sided rounds."
          value={consensusReserve}
          isLoading={consensusReserveLoading}
          Icon={ShieldCheckIcon}
        />
        <PoolStat
          title="Launch Distribution"
          tooltip="Remaining LREP held by the LaunchDistributionPool for earned rater, verified/referral, and legacy-user rewards."
          value={launchDistributionBalance}
          isLoading={launchDistributionLoading}
          Icon={UserGroupIcon}
        />
        <PoolStat
          title="Supply Cap"
          tooltip="Hard-capped maximum LREP supply. Launch distribution and future programs must fit inside this cap."
          value={maxSupply}
          isLoading={maxSupplyLoading}
          Icon={CircleStackIcon}
        />
      </div>
    </div>
  );
};
