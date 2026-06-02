"use client";

import { formatUnits } from "viem";
import { RateLoopConnectButton } from "~~/components/scaffold-eth";
import { useWalletRestore } from "~~/contexts/WalletRestoreContext";
import { useLegacyClaim } from "~~/hooks/useLegacyClaim";
import { legacyContributorVestingRows } from "~~/lib/docs/tokenomics";

function formatLrepAmount(value: bigint | undefined) {
  if (value === undefined) return "Loading...";
  const amount = Number(formatUnits(value, 6));
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} LREP`;
}

function formatPercent(numerator: bigint, denominator: bigint | undefined) {
  if (!denominator || denominator === 0n) return "0.0%";
  const basisPoints = (numerator * 10_000n) / denominator;
  return `${(Number(basisPoints) / 100).toFixed(1)}%`;
}

function formatScheduleDate(vestingStart: bigint | undefined, offset: bigint, pendingLabel: string) {
  if (vestingStart === undefined || offset === 0n) return pendingLabel;
  const endSeconds = vestingStart + offset;
  return new Date(Number(endSeconds) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-base-content/10 bg-base-100 p-4">
      <p className="text-sm text-base-content/55">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-base-content">{value}</p>
    </div>
  );
}

export function LegacyClaimPage() {
  const { isRestoringWallet } = useWalletRestore();
  const {
    allocation,
    claim,
    claimDuration,
    claimed,
    claimable,
    claimData,
    error,
    expectedChainName,
    isClaiming,
    isConnected,
    isLoading,
    isWrongChain,
    vested,
    vestingDuration,
    vestingStart,
  } = useLegacyClaim();

  const vestedPercent = formatPercent(vested, allocation);
  const progressWidth =
    allocation && allocation > 0n ? `${Math.min(100, Number((vested * 10_000n) / allocation) / 100)}%` : "0%";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-base-content/10 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Legacy contributors</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-base-content sm:text-4xl">
            Legacy LREP Claim
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-base-content/65">
            The 9M LREP legacy rail recognizes early contributors from the prior allocation snapshot. Eligible wallets
            can claim 1% immediately after root activation, then the remaining 99% unlocks linearly over 24 months.
            Unclaimed balances expire after 27 months and can be swept to the treasury.
          </p>
        </div>
        <div className="shrink-0">
          <RateLoopConnectButton />
        </div>
      </header>

      {!isConnected && isRestoringWallet && (
        <section className="rounded-lg border border-base-content/10 bg-base-200 p-6">
          <span className="loading loading-spinner loading-md" />
        </section>
      )}

      {!isConnected && !isRestoringWallet && (
        <section className="rounded-lg border border-base-content/10 bg-base-200 p-6">
          <h2 className="text-xl font-semibold text-base-content">Connect Wallet</h2>
          <p className="mt-2 text-base leading-7 text-base-content/65">
            Connect the wallet associated with the legacy allocation snapshot to see claim status.
          </p>
          <div className="mt-5">
            <RateLoopConnectButton />
          </div>
        </section>
      )}

      {isConnected && isWrongChain && (
        <section className="rounded-lg border border-warning/30 bg-warning/10 p-6">
          <h2 className="text-xl font-semibold text-base-content">Switch Network</h2>
          <p className="mt-2 text-base leading-7 text-base-content/65">
            Legacy claims are issued on {expectedChainName}. Switch your wallet to that network to see your allocation.
          </p>
        </section>
      )}

      {isConnected && !isWrongChain && isLoading && (
        <section className="rounded-lg border border-base-content/10 bg-base-200 p-6">
          <span className="loading loading-spinner loading-md" />
        </section>
      )}

      {isConnected && error && (
        <section className="rounded-lg border border-error/20 bg-error/10 p-6">
          <h2 className="text-xl font-semibold text-error">Claim Lookup Unavailable</h2>
          <p className="mt-2 text-base leading-7 text-base-content/65">
            The legacy claim lookup could not be loaded. Refresh and try again.
          </p>
        </section>
      )}

      {isConnected && claimData?.status === "not_published" && (
        <section className="rounded-lg border border-base-content/10 bg-base-200 p-6">
          <h2 className="text-xl font-semibold text-base-content">Legacy Claim Root Pending</h2>
          <p className="mt-2 text-base leading-7 text-base-content/65">
            The legacy contributor Merkle root has not been published yet. Once the snapshot is finalized, this page
            will show allocation, vesting, and claimable LREP for eligible wallets.
          </p>
        </section>
      )}

      {isConnected && claimData?.status === "not_eligible" && (
        <section className="rounded-lg border border-base-content/10 bg-base-200 p-6">
          <h2 className="text-xl font-semibold text-base-content">No Legacy Allocation Found</h2>
          <p className="mt-2 text-base leading-7 text-base-content/65">
            This connected wallet is not present in the published legacy contributor snapshot.
          </p>
        </section>
      )}

      {isConnected && claimData?.status === "eligible" && (
        <>
          <section className="rounded-lg border border-base-content/10 bg-base-200 p-4 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Total allocation" value={formatLrepAmount(allocation)} />
              <StatTile label="Vested" value={formatLrepAmount(vested)} />
              <StatTile label="Claimable now" value={formatLrepAmount(claimable)} />
              <StatTile label="Claimed" value={formatLrepAmount(claimed)} />
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm text-base-content/60">
                <span>Vesting progress</span>
                <span className="font-mono">{vestedPercent}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-base-content/10">
                <div className="h-full rounded-full bg-primary" style={{ width: progressWidth }} />
              </div>
              <p className="mt-3 text-sm text-base-content/55">
                Fully vested on {formatScheduleDate(vestingStart, vestingDuration, "Pending root activation")}. Claim
                window closes on {formatScheduleDate(vestingStart, claimDuration, "Pending root activation")}.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-primary mt-6 w-full sm:w-auto"
              disabled={isClaiming || claimable <= 0n}
              onClick={() => {
                void claim();
              }}
            >
              {isClaiming
                ? "Claiming..."
                : claimable > 0n
                  ? `Claim ${formatLrepAmount(claimable)}`
                  : "Nothing claimable yet"}
            </button>
          </section>

          <section className="overflow-x-auto rounded-lg border border-base-content/10 bg-base-200">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Vested amount</th>
                  <th>Claim behavior</th>
                </tr>
              </thead>
              <tbody>
                {legacyContributorVestingRows.map(([when, vestedAmount, claimBehavior]) => (
                  <tr key={when}>
                    <td>{when}</td>
                    <td className="font-mono">{vestedAmount}</td>
                    <td>{claimBehavior}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
