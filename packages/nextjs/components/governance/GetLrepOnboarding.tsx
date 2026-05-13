"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  ChartBarSquareIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
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

function ProgressMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border-t border-base-content/10 py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-base-content/55">{label}</span>
        <span className="font-mono text-lg font-semibold tabular-nums text-base-content">{value}</span>
      </div>
      <p className="mt-1 text-sm leading-5 text-base-content/55">{detail}</p>
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
  const launchCapDetail = humanVerified
    ? "Full earned-rater cap is available after eligibility."
    : "Open wallets can start with a partial cap; verification unlocks the full cap.";

  return (
    <div className="space-y-6">
      <section className="surface-card rounded-3xl p-6 sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.45fr)]">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-primary/90">
              <SparklesIcon className="h-4 w-4" />0 LREP
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-base-content sm:text-4xl">Start building reputation</h1>
            <p className="mt-4 text-base leading-7 text-base-content/65">
              You can earn LREP through protocol participation without buying it. The two useful paths for a new wallet
              are a one-time verified-human launch bonus, and zero-LREP ratings that can become earned-rater launch
              credits after rounds settle.
            </p>
          </div>

          <div className="lg:border-l lg:border-base-content/10 lg:pl-6">
            <ProgressMetric
              label="Verified bonus"
              value={humanVerified ? "Ready" : verifiedBonusLabel}
              detail={humanVerified ? "Open identity settings to claim it." : "Verify once, then claim from settings."}
            />
            <ProgressMetric
              label="Launch credits"
              value={rewardStatusLoading ? "..." : `${qualifyingRatingCount}/${eligibilityRatingCount}`}
              detail={`${creditedCount.toLocaleString()} zero-LREP credit${creditedCount === 1 ? "" : "s"} recorded.`}
            />
            <ProgressMetric label="Earned-rater cap" value={launchCapLabel} detail={launchCapDetail} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Link
          href={`${SETTINGS_ROUTE}#identity`}
          className="group rounded-3xl border border-base-content/10 bg-base-100/80 p-6 transition-colors hover:border-primary/45 hover:bg-base-100"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <ShieldCheckIcon className="h-6 w-6" />
            </div>
            <ArrowRightIcon className="mt-2 h-5 w-5 shrink-0 text-base-content/35 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-base-content">Verify as human</h2>
          <p className="mt-3 text-base leading-7 text-base-content/65">
            Add a wallet-bound World ID credential and claim the decaying verified launch bonus. A verified wallet also
            helps anchor rounds for other raters.
          </p>
          <ul className="mt-5 space-y-2">
            <PathStep>
              {humanVerified ? "Credential active on this wallet" : "One optional uniqueness credential"}
            </PathStep>
            <PathStep>Claim the launch bonus from identity settings</PathStep>
            <PathStep>No permanent reward-weight multiplier</PathStep>
          </ul>
        </Link>

        <Link
          href={RATE_ROUTE}
          className="group rounded-3xl border border-base-content/10 bg-base-100/80 p-6 transition-colors hover:border-[#20D6A3]/50 hover:bg-base-100"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#20D6A3]/15 text-[#20D6A3]">
              <ChartBarSquareIcon className="h-6 w-6" />
            </div>
            <ArrowRightIcon className="mt-2 h-5 w-5 shrink-0 text-base-content/35 transition-transform group-hover:translate-x-1 group-hover:text-[#20D6A3]" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-base-content">Rate with 0 LREP</h2>
          <p className="mt-3 text-base leading-7 text-base-content/65">
            Submit a private thumbs-up or thumbs-down rating and a crowd prediction without staking. Good revealed
            advisory ratings can receive launch credit after eligible rounds settle.
          </p>
          <ul className="mt-5 space-y-2">
            <PathStep>{scorePercent}%+ RBTS score target for launch credit</PathStep>
            <PathStep>
              {minDistinctVerifiedAnchors} verified anchors across {minDistinctAnchorRounds} anchored rounds
            </PathStep>
            <PathStep>Keeper-assisted reveal and advisory credit claim</PathStep>
          </ul>
        </Link>
      </div>

      <section className="surface-card rounded-3xl p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-base-content">Other launch rails</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/60">
              The launch pool also has fixed legacy claims and referral rewards, but for a fresh 0-LREP wallet the
              actionable protocol routes are verification and useful zero-LREP rating.
            </p>
          </div>
          <Link href="/docs/tokenomics" className="btn btn-ghost border border-base-content/10">
            Tokenomics
          </Link>
        </div>
      </section>
    </div>
  );
}
