"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RATER_TYPE_OPTIONS } from "@rateloop/node-utils/profileSelfReport";
import { useAccount } from "wagmi";
import { FollowScopeToggle } from "~~/components/leaderboard/FollowScopeToggle";
import { FollowProfileButton } from "~~/components/shared/FollowProfileButton";
import { surfaceSectionHeadingClassName } from "~~/components/shared/sectionHeading";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useCategoryRegistry } from "~~/hooks/useCategoryRegistry";
import { useFollowedProfiles } from "~~/hooks/useFollowedProfiles";
import { useRateLoopConnectModal } from "~~/hooks/useRateLoopConnectModal";
import { FOLLOWED_CURATOR_TOAST_ID } from "~~/lib/notifications/followedActivity";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { formatUsdAmount } from "~~/lib/questionRewardPools";
import { formatLrepAmount } from "~~/lib/vote/voteIncentives";
import {
  PonderAccuracyLeaderboardItem,
  PonderAccuracyLeaderboardWindow,
  PonderEarningsLeaderboardAsset,
  PonderEarningsLeaderboardItem,
  PonderEarningsLeaderboardSource,
  ponderApi,
} from "~~/services/ponder/client";
import { getReputationAvatarStatsCacheKey, getReputationAvatarUrl } from "~~/utils/profileImage";
import { notification } from "~~/utils/scaffold-eth";

type LeaderboardMode = "accuracy" | "earnings";
type SortOption = "signalScore" | "winRate" | "wins" | "stakeWon" | "settledVotes";
type MinVotesOption = "3" | "5" | "10";
type WindowOption = PonderAccuracyLeaderboardWindow;
type RaterTypeFilter = "" | "1" | "2" | "3" | "4";

export function AccuracyLeaderboard() {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const deployment = useMemo(() => resolveProtocolDeploymentScope(targetNetwork.id), [targetNetwork.id]);
  const { openConnectModal } = useRateLoopConnectModal();
  const { categories } = useCategoryRegistry();
  const { followedWallets, toggleFollow, isPending: isFollowPending } = useFollowedProfiles(connectedAddress);

  const [mode, setMode] = useState<LeaderboardMode>("accuracy");
  const [items, setItems] = useState<PonderAccuracyLeaderboardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [earningsItems, setEarningsItems] = useState<PonderEarningsLeaderboardItem[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsFetchError, setEarningsFetchError] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("signalScore");
  const [minVotes, setMinVotes] = useState<MinVotesOption>("5");
  const [window, setWindow] = useState<WindowOption>("30d");
  const [categoryId, setCategoryId] = useState<string>("");
  const [raterType, setRaterType] = useState<RaterTypeFilter>("");
  const [earningsAsset, setEarningsAsset] = useState<PonderEarningsLeaderboardAsset>("all");
  const [earningsSource, setEarningsSource] = useState<PonderEarningsLeaderboardSource>("all");
  const [scope, setScope] = useState<"all" | "following">("all");

  useEffect(() => {
    if (mode !== "accuracy") return;
    let cancelled = false;
    const fetchData = async () => {
      setIsLoading(true);
      setFetchError(false);
      try {
        const params: Record<string, string> = {
          sortBy,
          window,
          minVotes,
          limit: "50",
          includeReputation: "1",
        };
        if (sortBy === "signalScore") params.minSignalVotes = minVotes;
        if (categoryId) params.categoryId = categoryId;
        if (raterType) params.raterType = raterType;
        const data = await ponderApi.getAccuracyLeaderboard(params, {
          chainId: targetNetwork.id,
          deploymentKey: deployment?.deploymentKey,
        });
        if (!cancelled) setItems(data.items);
      } catch (err) {
        console.error("Failed to fetch accuracy leaderboard:", err);
        if (!cancelled) {
          setItems([]);
          setFetchError(true);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [mode, sortBy, window, minVotes, categoryId, raterType, targetNetwork.id, deployment?.deploymentKey]);

  useEffect(() => {
    if (mode !== "earnings") return;
    let cancelled = false;
    const fetchData = async () => {
      setEarningsLoading(true);
      setEarningsFetchError(false);
      try {
        const data = await ponderApi.getEarningsLeaderboard(
          {
            window,
            asset: earningsAsset,
            source: earningsSource,
            limit: "50",
          },
          {
            chainId: targetNetwork.id,
            deploymentKey: deployment?.deploymentKey,
          },
        );
        if (!cancelled) setEarningsItems(data.items);
      } catch (err) {
        console.error("Failed to fetch earnings leaderboard:", err);
        if (!cancelled) {
          setEarningsItems([]);
          setEarningsFetchError(true);
        }
      } finally {
        if (!cancelled) setEarningsLoading(false);
      }
    };
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [mode, window, earningsAsset, earningsSource, targetNetwork.id, deployment?.deploymentKey]);

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const formatRate = (rate: number) => `${(rate * 100).toFixed(1)}%`;
  const formatSignalScore = (entry: PonderAccuracyLeaderboardItem) => {
    const signalScore =
      typeof entry.signalScore === "number"
        ? entry.signalScore
        : typeof entry.signalScoreBps === "number"
          ? entry.signalScoreBps / 10_000
          : entry.winRate;
    return formatRate(signalScore);
  };
  const formatStake = (s: string) => {
    const num = Number(s) / 1e6;
    return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };
  const formatEarningsPair = (entry: PonderEarningsLeaderboardItem) => {
    const usdc = BigInt(entry.totalUsdcEarned);
    const lrep = BigInt(entry.totalLrepEarned);
    if (earningsAsset === "usdc") return formatUsdAmount(usdc);
    if (earningsAsset === "lrep") return `${formatLrepAmount(lrep)} LREP`;
    if (usdc > 0n && lrep > 0n) return `${formatUsdAmount(usdc)} + ${formatLrepAmount(lrep)} LREP`;
    if (usdc > 0n) return formatUsdAmount(usdc);
    return `${formatLrepAmount(lrep)} LREP`;
  };
  const formatLrepCell = (value: string) => `${formatLrepAmount(BigInt(value))} LREP`;

  const approvedCategories = categories;
  const showStreakColumn = window === "all" && !categoryId;
  const visibleItems = useMemo(() => {
    return items.flatMap((entry, index) => {
      if (scope === "following" && !followedWallets.has(entry.voter.toLowerCase())) {
        return [];
      }
      return [{ entry, rank: index + 1 }];
    });
  }, [followedWallets, items, scope]);
  const visibleEarningsItems = useMemo(() => {
    return earningsItems.flatMap((entry, index) => {
      if (scope === "following" && !followedWallets.has(entry.voter.toLowerCase())) {
        return [];
      }
      return [{ entry, rank: index + 1 }];
    });
  }, [earningsItems, followedWallets, scope]);

  const handleToggleFollow = useCallback(
    async (targetAddress: string) => {
      const result = await toggleFollow(targetAddress);

      if (!result.ok) {
        if (result.reason === "not_connected") {
          notification.info("Sign in to follow curators.", { id: FOLLOWED_CURATOR_TOAST_ID });
          void openConnectModal();
          return;
        }

        if (result.reason === "self_follow" || result.reason === "rejected") {
          return;
        }

        notification.error(result.error || "Failed to update follows", { id: FOLLOWED_CURATOR_TOAST_ID });
        return;
      }

      const curatorName =
        (mode === "earnings" ? earningsItems : items).find(
          entry => entry.voter.toLowerCase() === targetAddress.toLowerCase(),
        )?.profileName || "curator";
      const followMessage = result.following ? `Following ${curatorName}` : `Unfollowed ${curatorName}`;
      notification.success(followMessage, {
        id: FOLLOWED_CURATOR_TOAST_ID,
      });
    },
    [earningsItems, items, mode, openConnectModal, toggleFollow],
  );

  const handleScopeChange = useCallback(
    async (nextScope: "all" | "following") => {
      if (nextScope === "all") {
        setScope("all");
        return;
      }

      if (!connectedAddress) {
        notification.info("Sign in to filter by curators you follow.");
        void openConnectModal();
        return;
      }

      setScope("following");
    },
    [connectedAddress, openConnectModal],
  );

  return (
    <div className="surface-card rounded-2xl p-6 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className={surfaceSectionHeadingClassName}>Leaderboard</h2>
        <div className="flex w-full gap-2 sm:w-auto">
          <button
            type="button"
            className={`btn btn-sm h-11 min-h-11 flex-1 px-4 text-base font-medium sm:flex-none ${
              mode === "accuracy" ? "btn-primary" : "btn-secondary"
            }`}
            onClick={() => setMode("accuracy")}
          >
            Accuracy
          </button>
          <button
            type="button"
            className={`btn btn-sm h-11 min-h-11 flex-1 px-4 text-base font-medium sm:flex-none ${
              mode === "earnings" ? "btn-primary" : "btn-secondary"
            }`}
            onClick={() => {
              if (earningsItems.length === 0) setEarningsLoading(true);
              setMode("earnings");
            }}
          >
            Earnings
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <FollowScopeToggle value={scope} onChange={value => void handleScopeChange(value)} />

        <select
          className="select select-sm bg-base-200 text-base rounded-full"
          value={window}
          aria-label="Time range"
          onChange={e => setWindow(e.target.value as WindowOption)}
        >
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="365d">Last 365 days</option>
          <option value="season">Current season</option>
        </select>

        {mode === "accuracy" ? (
          <>
            <select
              className="select select-sm bg-base-200 text-base rounded-full"
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {approvedCategories.map(cat => (
                <option key={String(cat.id)} value={String(cat.id)}>
                  {cat.name}
                </option>
              ))}
            </select>

            <select
              className="select select-sm bg-base-200 text-base rounded-full"
              value={raterType}
              onChange={e => setRaterType(e.target.value as RaterTypeFilter)}
              aria-label="Filter by rater type"
            >
              <option value="">All raters</option>
              {RATER_TYPE_OPTIONS.map(option => (
                <option key={option.value} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              className="select select-sm bg-base-200 text-base rounded-full"
              value={sortBy}
              aria-label="Sort by"
              onChange={e => setSortBy(e.target.value as SortOption)}
            >
              <option value="signalScore">Signal Score</option>
              <option value="winRate">Win Rate</option>
              <option value="wins">Wins</option>
              <option value="stakeWon">Stake Won</option>
              <option value="settledVotes">Settled Votes</option>
            </select>

            <select
              className="select select-sm bg-base-200 text-base rounded-full"
              aria-label="Minimum votes"
              value={minVotes}
              onChange={e => setMinVotes(e.target.value as MinVotesOption)}
            >
              <option value="3">Min 3 votes</option>
              <option value="5">Min 5 votes</option>
              <option value="10">Min 10 votes</option>
            </select>
          </>
        ) : (
          <>
            <select
              className="select select-sm bg-base-200 text-base rounded-full"
              value={earningsAsset}
              aria-label="Earnings asset"
              onChange={e => {
                setEarningsLoading(true);
                setEarningsAsset(e.target.value as PonderEarningsLeaderboardAsset);
              }}
            >
              <option value="all">All assets</option>
              <option value="usdc">USDC</option>
              <option value="lrep">LREP</option>
            </select>

            <select
              className="select select-sm bg-base-200 text-base rounded-full"
              value={earningsSource}
              aria-label="Earnings source"
              onChange={e => {
                setEarningsLoading(true);
                setEarningsSource(e.target.value as PonderEarningsLeaderboardSource);
              }}
            >
              <option value="all">All earnings</option>
              <option value="bounty">Bounties</option>
              <option value="feedback">Feedback Bonuses</option>
              <option value="round">Round rewards</option>
            </select>
          </>
        )}
      </div>

      {mode === "accuracy" ? (
        isLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : fetchError ? (
          <div className="text-center py-12 text-base-content/50">
            <p>Failed to load leaderboard</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-base-content/50">
            <p>
              {raterType
                ? "No voters in this rater cohort have enough resolved votes yet."
                : "No voters with enough resolved votes in this range yet"}
            </p>
          </div>
        ) : scope === "following" && visibleItems.length === 0 ? (
          <div className="text-center py-12 text-base-content/50">
            <p>You aren&apos;t following any qualifying voters yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr className="text-base-content/60">
                  <th className="w-16 text-center">Rank</th>
                  <th>User</th>
                  <th className="text-right">Signal Score</th>
                  <th className="text-right">Win Rate</th>
                  <th className="text-right">W / L</th>
                  {showStreakColumn && <th className="text-right">Streak</th>}
                  <th className="text-right">Stake Won</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(({ entry, rank }) => {
                  const isCurrentUser = connectedAddress?.toLowerCase() === entry.voter.toLowerCase();
                  const streak = entry.currentStreak;
                  const streakLabel =
                    streak !== undefined
                      ? streak > 0
                        ? `${streak}W`
                        : streak < 0
                          ? `${Math.abs(streak)}L`
                          : "0"
                      : "-";
                  const avatarStatsCacheKey = getReputationAvatarStatsCacheKey({
                    totalSettledVotes: entry.totalSettledVotes,
                    totalWins: entry.totalWins,
                    totalLosses: entry.totalLosses,
                    currentStreak: entry.currentStreak ?? 0,
                    bestWinStreak: entry.bestWinStreak ?? 0,
                    winRate: entry.winRate,
                  });
                  const avatarSrc =
                    getReputationAvatarUrl(entry.voter, 32, null, targetNetwork.id, avatarStatsCacheKey) || "";

                  return (
                    <tr
                      key={entry.voter}
                      className={`${isCurrentUser ? "bg-primary/10 font-semibold" : ""} hover:bg-base-200/50`}
                    >
                      <td className="text-center">
                        {rank <= 3 ? (
                          <span className="text-lg">
                            {rank === 1 ? "\u{1F947}" : rank === 2 ? "\u{1F948}" : "\u{1F949}"}
                          </span>
                        ) : (
                          <span className="text-base-content/60">#{rank}</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center justify-between gap-3">
                          <Link
                            href={`/profiles/${entry.voter}`}
                            className="group flex min-w-0 items-center gap-3"
                            aria-label={`View profile for ${entry.profileName || truncateAddress(entry.voter)}`}
                          >
                            <img
                              src={avatarSrc}
                              width={32}
                              height={32}
                              className="w-8 h-8 rounded-full object-cover shrink-0"
                              alt={`${entry.profileName || truncateAddress(entry.voter)} avatar`}
                              loading="lazy"
                            />
                            <div className="flex min-w-0 flex-col">
                              {entry.profileName ? (
                                <>
                                  <span className="truncate font-medium transition-colors group-hover:text-primary">
                                    {entry.profileName}
                                  </span>
                                  <span className="text-base text-base-content/50">{truncateAddress(entry.voter)}</span>
                                </>
                              ) : (
                                <span className="font-mono transition-colors group-hover:text-primary">
                                  {truncateAddress(entry.voter)}
                                </span>
                              )}
                              {isCurrentUser && <span className="text-base text-primary">(You)</span>}
                              {entry.reputation ? (
                                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-base-content/60">
                                  {entry.reputation.raterTypeName !== "Unknown" ? (
                                    <span className="rounded-full bg-base-content/[0.06] px-2 py-0.5">
                                      {entry.reputation.raterTypeName}
                                    </span>
                                  ) : null}
                                  <span className="rounded-full bg-base-content/[0.06] px-2 py-0.5">
                                    {entry.reputation.humanCredentialStatus === "verified"
                                      ? "Verified human"
                                      : "Open capped"}
                                  </span>
                                  <span className="rounded-full bg-base-content/[0.06] px-2 py-0.5">
                                    {entry.reputation.participationLane === "verified_human"
                                      ? "Launch anchor"
                                      : "Participation open"}
                                  </span>
                                  <span className="rounded-full bg-base-content/[0.06] px-2 py-0.5">
                                    {entry.reputation.followerCount} followers
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </Link>
                          {!isCurrentUser ? (
                            <FollowProfileButton
                              following={followedWallets.has(entry.voter.toLowerCase())}
                              pending={isFollowPending(entry.voter)}
                              onClick={() => {
                                void handleToggleFollow(entry.voter);
                              }}
                              variant="pill"
                            />
                          ) : null}
                        </div>
                      </td>
                      <td className="text-right font-mono">{formatSignalScore(entry)}</td>
                      <td className="text-right font-mono">{formatRate(entry.winRate)}</td>
                      <td className="text-right font-mono">
                        {entry.totalWins} / {entry.totalLosses}
                      </td>
                      {showStreakColumn && <td className="text-right font-mono">{streakLabel}</td>}
                      <td className="text-right font-mono">{formatStake(entry.totalStakeWon)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : earningsLoading ? (
        <div className="flex items-center justify-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : earningsFetchError ? (
        <div className="text-center py-12 text-base-content/50">
          <p>Failed to load earnings leaderboard</p>
        </div>
      ) : earningsItems.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <p>No paid earnings in this range yet.</p>
        </div>
      ) : scope === "following" && visibleEarningsItems.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <p>You aren&apos;t following any earners in this range yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr className="text-base-content/60">
                <th className="w-16 text-center">Rank</th>
                <th>User</th>
                <th className="text-right">Total Earned</th>
                <th className="text-right">Bounties</th>
                <th className="text-right">Feedback Bonuses</th>
                <th className="text-right">Round LREP</th>
                <th className="text-right">Paid Events</th>
              </tr>
            </thead>
            <tbody>
              {visibleEarningsItems.map(({ entry, rank }) => {
                const isCurrentUser = connectedAddress?.toLowerCase() === entry.voter.toLowerCase();
                const avatarSrc = getReputationAvatarUrl(entry.voter, 32, null, targetNetwork.id) || "";

                return (
                  <tr
                    key={entry.voter}
                    className={`${isCurrentUser ? "bg-primary/10 font-semibold" : ""} hover:bg-base-200/50`}
                  >
                    <td className="text-center">
                      {rank <= 3 ? (
                        <span className="text-lg">
                          {rank === 1 ? "\u{1F947}" : rank === 2 ? "\u{1F948}" : "\u{1F949}"}
                        </span>
                      ) : (
                        <span className="text-base-content/60">#{rank}</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-between gap-3">
                        <Link
                          href={`/profiles/${entry.voter}`}
                          className="group flex min-w-0 items-center gap-3"
                          aria-label={`View profile for ${entry.profileName || truncateAddress(entry.voter)}`}
                        >
                          <img
                            src={avatarSrc}
                            width={32}
                            height={32}
                            className="w-8 h-8 rounded-full object-cover shrink-0"
                            alt={`${entry.profileName || truncateAddress(entry.voter)} avatar`}
                            loading="lazy"
                          />
                          <div className="flex min-w-0 flex-col">
                            {entry.profileName ? (
                              <>
                                <span className="truncate font-medium transition-colors group-hover:text-primary">
                                  {entry.profileName}
                                </span>
                                <span className="text-base text-base-content/50">{truncateAddress(entry.voter)}</span>
                              </>
                            ) : (
                              <span className="font-mono transition-colors group-hover:text-primary">
                                {truncateAddress(entry.voter)}
                              </span>
                            )}
                            {isCurrentUser && <span className="text-base text-primary">(You)</span>}
                          </div>
                        </Link>
                        {!isCurrentUser ? (
                          <FollowProfileButton
                            following={followedWallets.has(entry.voter.toLowerCase())}
                            pending={isFollowPending(entry.voter)}
                            onClick={() => {
                              void handleToggleFollow(entry.voter);
                            }}
                            variant="pill"
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="text-right font-mono">{formatEarningsPair(entry)}</td>
                    <td className="text-right font-mono">
                      {formatUsdAmount(BigInt(entry.bountyUsdcEarned))} / {formatLrepCell(entry.bountyLrepEarned)}
                    </td>
                    <td className="text-right font-mono">
                      {formatUsdAmount(BigInt(entry.feedbackUsdcEarned))} / {formatLrepCell(entry.feedbackLrepEarned)}
                    </td>
                    <td className="text-right font-mono">{formatLrepCell(entry.roundLrepEarned)}</td>
                    <td className="text-right font-mono">{entry.paidEventCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
