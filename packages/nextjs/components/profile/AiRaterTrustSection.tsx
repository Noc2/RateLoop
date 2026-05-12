"use client";

import { type ReactNode, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useCuryoSwitchNetwork } from "~~/hooks/useCuryoSwitchNetwork";
import {
  buildAiChallengeEvidenceHash,
  computeChallengeExpiresAt,
  formatAiChallengeStatus,
  formatAiProbeStatus,
  formatAiRaterTierName,
  formatUnixTimestamp,
  truncateHash,
} from "~~/lib/aiRater";
import { formatSubmissionRewardAmount, getDefaultUsdcAddress } from "~~/lib/questionRewardPools";
import {
  type PonderAiRaterDeclarationChallenge,
  type PonderAiRaterDriftFlag,
  type PonderAiRaterProbeResult,
  type PonderRaterParticipationStatusResponse,
  ponderApi,
} from "~~/services/ponder/client";
import { notification } from "~~/utils/scaffold-eth";

function HistoryItem({
  label,
  meta,
  value,
  children,
}: {
  children?: ReactNode;
  label: string;
  meta?: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-base-content/[0.04] px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-base-content/70">{label}</div>
          {meta ? <div className="mt-1 text-xs text-base-content/45">{meta}</div> : null}
        </div>
        <div className="max-w-[55%] text-right text-sm text-base-content/75">{value}</div>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

function buildErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AiRaterTrustSection({ address, ownProfile = false }: { address: `0x${string}`; ownProfile?: boolean }) {
  const { address: connectedAddress, chain } = useAccount();
  const { switchToChain, switchingChainId } = useCuryoSwitchNetwork();
  const { targetNetwork } = useTargetNetwork();
  const { data: registryInfo } = useDeployedContractInfo({ contractName: "RaterDeclarationRegistry" });
  const registryAddress = registryInfo?.address as `0x${string}` | undefined;
  const usdcAddress = getDefaultUsdcAddress(targetNetwork.id);
  const [challengeSummary, setChallengeSummary] = useState("");
  const [challengeSourceUrl, setChallengeSourceUrl] = useState("");
  const [challengeDetails, setChallengeDetails] = useState("");
  const [isOpeningChallenge, setIsOpeningChallenge] = useState(false);
  const [expiringChallengeId, setExpiringChallengeId] = useState<string | null>(null);

  const rewardStatusQuery = useQuery({
    queryKey: ["ai-rater-trust", "participation-status", address],
    queryFn: () => ponderApi.getRaterParticipationStatus(address),
    staleTime: 15_000,
  });
  const probeResultsQuery = useQuery({
    queryKey: ["ai-rater-trust", "probes", address],
    queryFn: () => ponderApi.getAiRaterProbeResults(address, { limit: "5" }),
    staleTime: 15_000,
  });
  const driftFlagsQuery = useQuery({
    queryKey: ["ai-rater-trust", "drift", address],
    queryFn: () => ponderApi.getAiRaterDriftFlags(address, { limit: "5" }),
    staleTime: 15_000,
  });
  const challengesQuery = useQuery({
    queryKey: ["ai-rater-trust", "challenges", address],
    queryFn: () => ponderApi.getAiRaterDeclarationChallenges(address, { limit: "5" }),
    staleTime: 15_000,
  });

  const rewardStatus = rewardStatusQuery.data as PonderRaterParticipationStatusResponse | undefined;
  const aiDeclaration = rewardStatus?.aiDeclaration;
  const openChallengeCount = rewardStatus?.challengeStatus.openCount ?? 0;
  const probeResults = probeResultsQuery.data?.items ?? [];
  const driftFlags = driftFlagsQuery.data?.items ?? [];
  const challenges = challengesQuery.data?.items ?? [];

  const { data: challengeBondUsdc, refetch: refetchChallengeBondUsdc } = useScaffoldReadContract({
    contractName: "RaterDeclarationRegistry",
    functionName: "challengeBondUsdc",
  });
  const { data: challengeResolutionWindow, refetch: refetchChallengeResolutionWindow } = useScaffoldReadContract({
    contractName: "RaterDeclarationRegistry",
    functionName: "challengeResolutionWindow",
  });
  const { data: usdcBalance, refetch: refetchUsdcBalance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress && usdcAddress) },
  });
  const { data: usdcAllowance, refetch: refetchUsdcAllowance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress && registryAddress ? [connectedAddress, registryAddress] : undefined,
    query: { enabled: Boolean(connectedAddress && registryAddress && usdcAddress) },
  });
  const { writeContractAsync: writeUsdc } = useWriteContract();
  const { writeContractAsync: writeRegistry } = useScaffoldWriteContract({
    contractName: "RaterDeclarationRegistry",
  });

  const challengeEvidenceHash = useMemo(
    () =>
      challengeSummary.trim()
        ? buildAiChallengeEvidenceHash({
            summary: challengeSummary,
            sourceUrl: challengeSourceUrl,
            details: challengeDetails,
          })
        : null,
    [challengeDetails, challengeSourceUrl, challengeSummary],
  );

  const refreshAll = async () => {
    await Promise.all([
      rewardStatusQuery.refetch(),
      probeResultsQuery.refetch(),
      driftFlagsQuery.refetch(),
      challengesQuery.refetch(),
      refetchChallengeBondUsdc(),
      refetchChallengeResolutionWindow(),
      refetchUsdcBalance(),
      refetchUsdcAllowance(),
    ]);
  };

  const ensureTargetChain = async () => {
    if (chain?.id === targetNetwork.id) return;
    await switchToChain(targetNetwork.id);
  };

  const handleOpenChallenge = async () => {
    if (!connectedAddress || !registryAddress) {
      notification.error("Connect a wallet to challenge this declaration.");
      return;
    }
    if (!aiDeclaration?.active) {
      notification.error("Only active declarations can be challenged.");
      return;
    }
    if (!challengeEvidenceHash) {
      notification.error("Add a challenge summary before posting the bond.");
      return;
    }
    if (!usdcAddress) {
      notification.error("USDC is not configured for this network.");
      return;
    }
    if ((usdcBalance ?? 0n) < (challengeBondUsdc ?? 0n)) {
      notification.error("Not enough USDC to open this challenge.");
      return;
    }

    setIsOpeningChallenge(true);
    try {
      await ensureTargetChain();

      if ((challengeBondUsdc ?? 0n) > 0n && (usdcAllowance ?? 0n) < (challengeBondUsdc ?? 0n)) {
        await writeUsdc({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [registryAddress, challengeBondUsdc ?? 0n],
        });
      }

      await writeRegistry({
        functionName: "openChallenge",
        args: [address, challengeEvidenceHash],
      });

      notification.success("Challenge opened.");
      setChallengeSummary("");
      setChallengeSourceUrl("");
      setChallengeDetails("");
      await refreshAll();
    } catch (error) {
      notification.error(buildErrorMessage(error, "Failed to open challenge."));
    } finally {
      setIsOpeningChallenge(false);
    }
  };

  const handleExpireChallenge = async (challengeId: string) => {
    setExpiringChallengeId(challengeId);
    try {
      await ensureTargetChain();
      await writeRegistry({
        functionName: "expireChallenge",
        args: [BigInt(challengeId)],
      });
      notification.success("Challenge expired.");
      await refreshAll();
    } catch (error) {
      notification.error(buildErrorMessage(error, "Failed to expire challenge."));
    } finally {
      setExpiringChallengeId(current => (current === challengeId ? null : current));
    }
  };

  if (!aiDeclaration?.declared && !rewardStatusQuery.isLoading) {
    return null;
  }

  return (
    <div className="surface-card rounded-3xl p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-base-content">AI rater trust</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/60">
            Bonded declarations, probe outcomes, drift flags, and community challenges for this rater wallet.
          </p>
        </div>
        {aiDeclaration ? (
          <div className="rounded-full bg-base-content/[0.05] px-4 py-2 text-sm font-medium text-base-content/70">
            {aiDeclaration.active
              ? formatAiRaterTierName(aiDeclaration.tier)
              : `Inactive: ${aiDeclaration.inactiveReason}`}
          </div>
        ) : null}
      </div>

      {rewardStatusQuery.isLoading ? (
        <div className="mt-6 flex items-center gap-3 text-base-content/55">
          <span className="loading loading-spinner loading-sm text-primary" />
          <span>Loading AI rater trust state...</span>
        </div>
      ) : rewardStatusQuery.error ? (
        <div className="mt-6 rounded-2xl bg-error/10 px-4 py-3 text-sm text-error">
          {buildErrorMessage(rewardStatusQuery.error, "Failed to load AI rater trust state.")}
        </div>
      ) : aiDeclaration ? (
        <>
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <HistoryItem
              label="Current tier"
              meta={`Declared ${formatUnixTimestamp(aiDeclaration.declaredAt)}${aiDeclaration.expiresAt ? ` • expires ${formatUnixTimestamp(aiDeclaration.expiresAt)}` : ""}`}
              value={formatAiRaterTierName(aiDeclaration.tier)}
            />
            <HistoryItem
              label="Operator"
              meta={`Version ${aiDeclaration.version}`}
              value={truncateHash(aiDeclaration.operator)}
            />
            <HistoryItem
              label="Probe status"
              meta={`Open challenges ${rewardStatus?.challengeStatus.openCount ?? 0}`}
              value={
                aiDeclaration.latestProbe
                  ? `${formatAiProbeStatus(aiDeclaration.latestProbe.passed)} ${(aiDeclaration.latestProbe.confidenceBps / 100).toFixed(2)}%`
                  : aiDeclaration.probePending
                    ? "Pending"
                    : "None"
              }
            />
            <HistoryItem
              label="Reward weight"
              meta={
                ownProfile
                  ? "AI declaration does not multiply future rating rewards."
                  : "This is accountability metadata, not proof of identity."
              }
              value="Base"
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <div>
              <h3 className="mb-3 text-base font-medium text-base-content/60">Recent probe results</h3>
              <div className="space-y-3">
                {probeResults.length > 0 ? (
                  probeResults.map((item: PonderAiRaterProbeResult) => (
                    <HistoryItem
                      key={item.id}
                      label={`Version ${item.version} • ${formatAiProbeStatus(item.passed)}`}
                      meta={`${(item.confidenceBps / 100).toFixed(2)}% confidence • ${formatUnixTimestamp(item.recordedAt)}`}
                      value={truncateHash(item.resultHash)}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl bg-base-content/[0.04] px-4 py-6 text-sm text-base-content/55">
                    No probe results yet.
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-base font-medium text-base-content/60">Behavioral drift flags</h3>
              <div className="space-y-3">
                {driftFlags.length > 0 ? (
                  driftFlags.map((item: PonderAiRaterDriftFlag) => (
                    <HistoryItem
                      key={item.id}
                      label={`Version ${item.version} • ${(item.driftScoreBps / 100).toFixed(2)}% drift`}
                      meta={formatUnixTimestamp(item.flaggedAt)}
                      value={truncateHash(item.evidenceHash)}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl bg-base-content/[0.04] px-4 py-6 text-sm text-base-content/55">
                    No drift flags recorded.
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-base font-medium text-base-content/60">Challenges</h3>
              <div className="space-y-3">
                {challenges.length > 0 ? (
                  challenges.map((item: PonderAiRaterDeclarationChallenge) => {
                    const expiresAt =
                      challengeResolutionWindow !== undefined
                        ? computeChallengeExpiresAt(item.openedAt, challengeResolutionWindow)
                        : null;
                    const canExpire =
                      item.status === 1 && expiresAt !== null && expiresAt <= BigInt(Math.floor(Date.now() / 1000));

                    return (
                      <HistoryItem
                        key={item.challengeId}
                        label={`#${item.challengeId} • ${formatAiChallengeStatus(item.status)}`}
                        meta={`${formatSubmissionRewardAmount(item.bondAmount, "usdc")} • opened ${formatUnixTimestamp(item.openedAt)}`}
                        value={truncateHash(item.evidenceHash)}
                      >
                        {canExpire ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm border border-base-300"
                            disabled={expiringChallengeId === item.challengeId || switchingChainId === targetNetwork.id}
                            onClick={() => void handleExpireChallenge(item.challengeId)}
                          >
                            {expiringChallengeId === item.challengeId ? "Expiring..." : "Expire challenge"}
                          </button>
                        ) : null}
                      </HistoryItem>
                    );
                  })
                ) : (
                  <div className="rounded-2xl bg-base-content/[0.04] px-4 py-6 text-sm text-base-content/55">
                    No challenges posted.
                  </div>
                )}
              </div>
            </div>
          </div>

          {!ownProfile ? (
            <div className="mt-6 rounded-2xl bg-base-content/[0.04] p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-base-content">Challenge this declaration</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/60">
                    Post the challenge bond, hash your evidence locally, and open a public declaration challenge.
                  </p>
                </div>
                <div className="rounded-full bg-base-100 px-4 py-2 text-sm text-base-content/65">
                  Bond {formatSubmissionRewardAmount(challengeBondUsdc, "usdc")}
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <label className="form-control lg:col-span-2">
                  <span className="label-text text-base-content/65">Challenge summary</span>
                  <input
                    className="input input-bordered mt-2 w-full bg-base-100"
                    placeholder="Declared provider and observed provider do not match."
                    value={challengeSummary}
                    onChange={event => setChallengeSummary(event.target.value)}
                  />
                </label>

                <label className="form-control lg:col-span-2">
                  <span className="label-text text-base-content/65">Evidence source URL</span>
                  <input
                    className="input input-bordered mt-2 w-full bg-base-100"
                    placeholder="https://example.com/transcript"
                    value={challengeSourceUrl}
                    onChange={event => setChallengeSourceUrl(event.target.value)}
                  />
                </label>

                <label className="form-control lg:col-span-2">
                  <span className="label-text text-base-content/65">Supporting details</span>
                  <textarea
                    className="textarea textarea-bordered mt-2 min-h-28 w-full bg-base-100"
                    placeholder="What changed, how you observed it, and why the declaration looks stale or false."
                    value={challengeDetails}
                    onChange={event => setChallengeDetails(event.target.value)}
                  />
                </label>
              </div>

              <div className="mt-4 text-sm text-base-content/55">
                Evidence hash {challengeEvidenceHash ? truncateHash(challengeEvidenceHash, 14, 10) : "—"} • allowance{" "}
                {formatSubmissionRewardAmount(usdcAllowance, "usdc")}
              </div>

              {openChallengeCount > 0 ? (
                <div className="mt-3 text-sm text-base-content/60">
                  A challenge is already open for this declaration version.
                </div>
              ) : null}
              {!connectedAddress ? (
                <div className="mt-3 text-sm text-base-content/60">Connect a wallet to post the challenge bond.</div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn btn-submit"
                  disabled={!aiDeclaration.active || isOpeningChallenge || openChallengeCount > 0}
                  onClick={() => void handleOpenChallenge()}
                >
                  {isOpeningChallenge ? "Opening..." : "Open challenge"}
                </button>
                <span className="text-sm text-base-content/55">
                  Connected balance {formatSubmissionRewardAmount(usdcBalance, "usdc")}
                </span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
