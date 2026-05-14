"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, ChartBarSquareIcon, CheckCircleIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { RATE_ROUTE, SETTINGS_ROUTE } from "~~/constants/routes";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { type PonderRaterParticipationStatusResponse, ponderApi } from "~~/services/ponder/client";

type GetLrepOnboardingProps = {
  address: `0x${string}`;
};

const DEFAULT_ELIGIBILITY_RATING_COUNT = 5;
const DEFAULT_MIN_QUALIFYING_SCORE_BPS = 7_000;
const DEFAULT_MIN_DISTINCT_VERIFIED_ANCHORS = 2;
const DEFAULT_MIN_DISTINCT_ANCHOR_ROUNDS = 2;
const DEFAULT_UNVERIFIED_EARNED_RATER_CAP_BPS = 2_500;
const actionCardClassName = "surface-card flex h-full flex-col rounded-3xl p-6";
const actionButtonClassName = "btn btn-primary mt-auto self-end gap-2";

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

function ActionStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-4">
        <span className="text-sm font-medium text-base-content/55">{label}</span>
        <span className="text-right font-mono text-base font-semibold tabular-nums text-base-content">{value}</span>
      </div>
      {detail && <p className="text-sm leading-5 text-base-content/55">{detail}</p>}
    </div>
  );
}

function PathStep({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2 text-sm leading-6 text-base-content/65">
      <CheckCircleIcon className="mt-1 h-4 w-4 shrink-0 text-primary" />
      <span>{children}</span>
    </li>
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
  const minQualifyingScoreBps = getPolicyNumber(policy, "minQualifyingScoreBps", DEFAULT_MIN_QUALIFYING_SCORE_BPS);
  const minDistinctVerifiedAnchors = getPolicyNumber(
    policy,
    "minDistinctVerifiedAnchors",
    DEFAULT_MIN_DISTINCT_VERIFIED_ANCHORS,
  );
  const minDistinctAnchorRounds = getPolicyNumber(
    policy,
    "minDistinctAnchorRounds",
    DEFAULT_MIN_DISTINCT_ANCHOR_ROUNDS,
  );
  const unverifiedEarnedRaterCapBps = getPolicyNumber(
    policy,
    "unverifiedEarnedRaterCapBps",
    DEFAULT_UNVERIFIED_EARNED_RATER_CAP_BPS,
  );
  const qualifyingRatingCount = launchRewards?.qualifyingRatingCount ?? 0;
  const creditedCount = advisoryVotes?.creditedCount ?? qualifyingRatingCount;
  const humanVerified = rewardStatus?.humanCredential.status === "verified";
  const scorePercent = (minQualifyingScoreBps / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const verifiedBonusLabel =
    currentVerifiedBonus === undefined ? "..." : `${formatMicroLrep(currentVerifiedBonus)} LREP`;
  const openRaterLaunchCap = scaleMicroAmount(currentRaterLaunchCap, unverifiedEarnedRaterCapBps);
  const launchCapLabel =
    currentRaterLaunchCap === undefined
      ? "..."
      : humanVerified
        ? `${formatMicroLrep(currentRaterLaunchCap)} LREP`
        : `${formatMicroLrep(openRaterLaunchCap)} / ${formatMicroLrep(currentRaterLaunchCap)} LREP`;
  const launchCapDetail = humanVerified ? "Full cap unlocked." : "Verify to unlock the full cap.";

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
            Add a wallet-bound World ID credential, then claim the launch bonus.
          </p>
          <div className="mt-5 space-y-4">
            <ActionStat
              label="Verified bonus"
              value={humanVerified ? "Ready" : verifiedBonusLabel}
              detail={humanVerified ? "Claim from identity settings." : "Available after verification."}
            />
            <ActionStat
              label="Credential"
              value={humanVerified ? "Active" : "Not verified"}
              detail="No permanent reward multiplier."
            />
          </div>
          <Link href={`${SETTINGS_ROUTE}#identity`} className={actionButtonClassName}>
            Verify as human
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </section>

        <section className={actionCardClassName}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#03CEA4]/15 text-[#03CEA4]">
              <ChartBarSquareIcon className="h-6 w-6" />
            </div>
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-base-content">Rate with 0 LREP</h2>
          <p className="mt-3 text-base leading-7 text-base-content/65">
            Submit private ratings without staking; eligible settled rounds count as launch credits.
          </p>
          <div className="mt-5 space-y-4">
            <ActionStat
              label="Launch credits"
              value={rewardStatusLoading ? "..." : `${qualifyingRatingCount}/${eligibilityRatingCount}`}
              detail={
                creditedCount > 0
                  ? `${creditedCount.toLocaleString()} credit${creditedCount === 1 ? "" : "s"} recorded.`
                  : undefined
              }
            />
            <ActionStat label="Earned-rater cap" value={launchCapLabel} detail={launchCapDetail} />
          </div>
          <ul className="mt-5 space-y-2">
            <PathStep>{scorePercent}%+ RBTS score</PathStep>
            <PathStep>
              {minDistinctVerifiedAnchors} verified anchors in {minDistinctAnchorRounds} rounds
            </PathStep>
            <PathStep>Keeper-assisted claim</PathStep>
          </ul>
          <Link href={RATE_ROUTE} className={actionButtonClassName}>
            Rate with 0 LREP
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
