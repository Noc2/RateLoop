"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, ChartBarSquareIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { RATE_ROUTE, SETTINGS_ROUTE } from "~~/constants/routes";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { type PonderRaterParticipationStatusResponse, ponderApi } from "~~/services/ponder/client";

type GetLrepOnboardingProps = {
  address: `0x${string}`;
};

const DEFAULT_ELIGIBILITY_RATING_COUNT = 5;
const DEFAULT_UNVERIFIED_EARNED_RATER_CAP_BPS = 2_500;
const actionCardClassName = "surface-card flex h-full flex-col rounded-3xl p-6";
const actionButtonFooterClassName = "mt-auto flex justify-end pt-6";
const actionButtonClassName = "btn btn-primary gap-2";
const LAUNCH_CREDITS_TOOLTIP =
  "Settled zero-LREP ratings count toward starter LREP after they meet launch-reward checks.";
const EARNED_RATER_CAP_TOOLTIP =
  "The launch LREP this wallet can earn from zero-LREP rating credits. Verified humans can access the full cap.";
const ELIGIBLE_SETTLED_ROUNDS_DOCS_HREF = "/docs/how-it-works#eligible-settled-rounds";
const WORLD_ID_HREF = "https://world.org/world-id";

function formatMicroLrep(value: bigint | string | number | null | undefined) {
  if (value === null || value === undefined) return "0";
  const amount = typeof value === "bigint" ? Number(value) : Number(value);
  return (amount / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function getPolicyNumber(
  policy: PonderRaterParticipationStatusResponse["launchRewards"]["policy"] | undefined,
  key: string,
  fallback: number,
) {
  const value = policy?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function scaleMicroAmount(value: bigint | undefined, bps: number) {
  if (value === undefined) return undefined;
  return (value * BigInt(bps)) / 10_000n;
}

function ActionStat({
  label,
  value,
  detail,
  tooltip,
}: {
  label: string;
  value: string;
  detail?: string;
  tooltip?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-4">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-base-content/55">
          {label}
          {tooltip ? (
            <InfoTooltip
              text={tooltip}
              position="top"
              className="[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-base-content/45 [&>svg]:hover:text-base-content/65"
            />
          ) : null}
        </span>
        <span className="text-right font-mono text-base font-semibold tabular-nums text-base-content">{value}</span>
      </div>
      {detail && <p className="text-sm leading-5 text-base-content/55">{detail}</p>}
    </div>
  );
}

export function GetLrepOnboarding({ address }: GetLrepOnboardingProps) {
  const { data: rewardStatus, isLoading: rewardStatusLoading } = useQuery({
    queryKey: ["get-lrep-onboarding", address],
    queryFn: () => ponderApi.getRaterParticipationStatus(address),
    staleTime: 15_000,
  });

  const { data: currentVerifiedBonus } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "currentVerifiedBonus",
  });
  const { data: currentRaterLaunchCap } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "currentRaterLaunchCap",
  });

  const advisoryVotes = rewardStatus?.advisoryVotes;
  const launchRewards = rewardStatus?.launchRewards;
  const policy = launchRewards?.policy;
  const eligibilityRatingCount = getPolicyNumber(policy, "eligibilityRatingCount", DEFAULT_ELIGIBILITY_RATING_COUNT);
  const unverifiedEarnedRaterCapBps = getPolicyNumber(
    policy,
    "unverifiedEarnedRaterCapBps",
    DEFAULT_UNVERIFIED_EARNED_RATER_CAP_BPS,
  );
  const qualifyingRatingCount = launchRewards?.qualifyingRatingCount ?? 0;
  const creditedCount = advisoryVotes?.creditedCount ?? qualifyingRatingCount;
  const humanVerified = rewardStatus?.humanCredential.status === "verified";
  const verifiedBonusLabel =
    currentVerifiedBonus === undefined ? "..." : `${formatMicroLrep(currentVerifiedBonus)} LREP`;
  const openRaterLaunchCap = scaleMicroAmount(currentRaterLaunchCap, unverifiedEarnedRaterCapBps);
  const launchCapLabel =
    currentRaterLaunchCap === undefined
      ? "..."
      : humanVerified
        ? `${formatMicroLrep(currentRaterLaunchCap)} LREP`
        : `${formatMicroLrep(openRaterLaunchCap)} / ${formatMicroLrep(currentRaterLaunchCap)} LREP`;
  const launchCapDetail = humanVerified ? "Full cap unlocked." : undefined;

  return (
    <div className="space-y-6">
      <section className="surface-card rounded-3xl p-6 sm:p-8">
        <h1 className="text-3xl font-semibold text-base-content sm:text-4xl">Start building reputation</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-base-content/65">
          Verify once or submit useful zero-LREP ratings to earn starter LREP.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={actionCardClassName}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#359EEE]/15 text-[#359EEE]">
              <ShieldCheckIcon className="h-6 w-6" />
            </div>
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-base-content">Verify as human</h2>
          <p className="mt-3 text-base leading-7 text-base-content/65">
            Add a wallet-bound{" "}
            <a href={WORLD_ID_HREF} target="_blank" rel="noopener noreferrer" className="link link-primary">
              World ID
            </a>{" "}
            credential, then claim the launch bonus.
          </p>
          <div className="mt-5 space-y-4">
            <ActionStat
              label="Verified bonus"
              value={humanVerified ? "Ready" : verifiedBonusLabel}
              detail={humanVerified ? "Claim from identity settings." : undefined}
            />
            <ActionStat label="Credential" value={humanVerified ? "Active" : "Not verified"} />
          </div>
          <div className={actionButtonFooterClassName}>
            <Link href={`${SETTINGS_ROUTE}#identity`} className={actionButtonClassName}>
              Verify as human
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </section>

        <section className={actionCardClassName}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#03CEA4]/15 text-[#03CEA4]">
              <ChartBarSquareIcon className="h-6 w-6" />
            </div>
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-base-content">Rate with 0 LREP</h2>
          <p className="mt-3 text-base leading-7 text-base-content/65">
            Submit private ratings without staking;{" "}
            <Link href={ELIGIBLE_SETTLED_ROUNDS_DOCS_HREF} className="link link-primary">
              eligible settled rounds
            </Link>{" "}
            count as launch credits.
          </p>
          <div className="mt-5 space-y-4">
            <ActionStat
              label="Launch credits"
              value={rewardStatusLoading ? "..." : `${qualifyingRatingCount}/${eligibilityRatingCount}`}
              tooltip={LAUNCH_CREDITS_TOOLTIP}
              detail={
                creditedCount > 0
                  ? `${creditedCount.toLocaleString()} credit${creditedCount === 1 ? "" : "s"} recorded.`
                  : undefined
              }
            />
            <ActionStat
              label="Earned-rater cap"
              value={launchCapLabel}
              tooltip={EARNED_RATER_CAP_TOOLTIP}
              detail={launchCapDetail}
            />
          </div>
          <div className={actionButtonFooterClassName}>
            <Link href={RATE_ROUTE} className={actionButtonClassName}>
              Rate with 0 LREP
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
