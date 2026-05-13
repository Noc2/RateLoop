"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { IDKit, type IDKitResult, type RpContext, orbLegacy } from "@worldcoin/idkit";
import { formatUnits, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import {
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { WorldIdQrCode } from "~~/components/settings/WorldIdQrCode";
import { useCopyToClipboard, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { getLaunchReferralInputState, resolveLaunchClaimReferrer } from "~~/lib/referrals/launchReferral";
import {
  buildReferralLandingUrl,
  clearStoredReferralAttribution,
  getStoredReferralAddress,
  storeReferralAttributionFromValue,
} from "~~/lib/referrals/referralAttribution";
import { getWorldIdClientConfig } from "~~/lib/world-id/config";
import { readLocalE2EWorldIdMock } from "~~/lib/world-id/e2eMock";
import { parseWorldIdLegacyProof } from "~~/lib/world-id/onchainProof";
import { pollWorldIdRequest } from "~~/lib/world-id/requestPolling";
import { formatWorldIdError, getWorldIdRequestPanelState } from "~~/lib/world-id/verificationUiState";
import { notification } from "~~/utils/scaffold-eth";

const LREP_DECIMALS = 6;
const REFERRAL_BONUS_BPS = 5_000n;

type RpContextResponse = {
  action: string;
  environment: "production" | "staging";
  rpContext: RpContext;
};

type VerificationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "verified"; nullifier: string | null; verifiedAt: string }
  | { status: "error"; message: string };

function getWorldIdSignal(address: string | undefined) {
  return address?.toLowerCase() ?? "";
}

function formatLrepAmount(amount: bigint | undefined) {
  if (amount === undefined) {
    return "--";
  }

  const value = Number(formatUnits(amount, LREP_DECIMALS));
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 10 ? 2 : 0,
  }).format(value);
}

function publishWorldIdConnectorURI(connectorURI: string) {
  if (typeof window === "undefined") return;

  (window as typeof window & { __rateloopWorldIdConnectorURI?: string }).__rateloopWorldIdConnectorURI = connectorURI;
  window.dispatchEvent(new CustomEvent("rateloop:world-id-connector-uri", { detail: { connectorURI } }));
}

export function WorldIdVerificationCard({ address }: { address?: string }) {
  const config = getWorldIdClientConfig();
  const { chain } = useAccount();
  const [open, setOpen] = useState(false);
  const [rpContextResponse, setRpContextResponse] = useState<RpContextResponse | null>(null);
  const [connectorURI, setConnectorURI] = useState<string | null>(null);
  const [isPreparingWorldIdRequest, setIsPreparingWorldIdRequest] = useState(false);
  const [isAwaitingWorldIdApproval, setIsAwaitingWorldIdApproval] = useState(false);
  const [isSubmittingWorldIdCredential, setIsSubmittingWorldIdCredential] = useState(false);
  const [worldIdErrorCode, setWorldIdErrorCode] = useState<string | null>(null);
  const [verificationState, setVerificationState] = useState<VerificationState>({ status: "idle" });
  const [referralInput, setReferralInput] = useState("");
  const [shareLink, setShareLink] = useState("");
  const activeWorldIdRequestRef = useRef(0);
  const worldIdAbortControllerRef = useRef<AbortController | null>(null);
  const referralInputId = useId();
  const referralHintId = useId();
  const { copyToClipboard, isCopiedToClipboard } = useCopyToClipboard({ successDurationMs: 1_600 });
  const localE2EWorldIdMock = readLocalE2EWorldIdMock();
  const appId = config.appId?.startsWith("app_")
    ? (config.appId as `app_${string}`)
    : (localE2EWorldIdMock?.appId ?? null);
  const signal = getWorldIdSignal(address);
  const walletAddress = address as `0x${string}` | undefined;
  const isConfigured = Boolean((appId && config.enabled) || localE2EWorldIdMock);
  const canVerify = Boolean(isConfigured && address);
  const { data: hasActiveCredential, refetch: refetchHasActiveCredential } = useScaffoldReadContract({
    contractName: "RaterRegistry",
    functionName: "hasActiveHumanCredential",
    args: [walletAddress],
    query: { enabled: Boolean(walletAddress) },
  });
  const { data: verifiedBonusClaimed, refetch: refetchVerifiedBonusClaimed } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "verifiedBonusClaimedByAccount",
    args: [walletAddress],
    query: { enabled: Boolean(walletAddress) },
  });
  const { data: currentVerifiedBonus, refetch: refetchCurrentVerifiedBonus } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "currentVerifiedBonus",
  });
  const { data: referralEarnings, refetch: refetchReferralEarnings } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "referralEarnings",
    args: [walletAddress],
    query: { enabled: Boolean(walletAddress) },
  });
  const { data: raterLaunchCap, refetch: refetchRaterLaunchCap } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "raterLaunchCap",
    args: [walletAddress],
    query: { enabled: Boolean(walletAddress) },
  });
  const { data: raterFullLaunchCap, refetch: refetchRaterFullLaunchCap } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "raterFullLaunchCap",
    args: [walletAddress],
    query: { enabled: Boolean(walletAddress) },
  });
  const { data: raterFullLaunchCapUnlocked, refetch: refetchRaterFullLaunchCapUnlocked } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "raterFullLaunchCapUnlocked",
    args: [walletAddress],
    query: { enabled: Boolean(walletAddress) },
  });
  const { writeContractAsync: claimVerifiedBonus, isPending: isClaimPending } = useScaffoldWriteContract({
    contractName: "LaunchDistributionPool",
  });
  const { writeContractAsync: unlockFullEarnedRaterCap, isPending: isUnlockPending } = useScaffoldWriteContract({
    contractName: "LaunchDistributionPool",
  });
  const { writeContractAsync: attestWorldIdCredential, isMining: isAttestingCredential } = useScaffoldWriteContract({
    contractName: "RaterRegistry",
  });
  const referralInputState = useMemo(
    () => getLaunchReferralInputState({ connectedAddress: address, inputValue: referralInput }),
    [address, referralInput],
  );
  const referralAddress = referralInputState.canUseReferrer ? referralInputState.normalizedReferrer : undefined;
  const { data: referrerHasActiveCredential } = useScaffoldReadContract({
    contractName: "RaterRegistry",
    functionName: "hasActiveHumanCredential",
    args: [referralAddress],
    query: { enabled: Boolean(referralAddress) },
  });
  const claimReferrer = useMemo(
    () => resolveLaunchClaimReferrer({ connectedAddress: address, inputValue: referralInput }),
    [address, referralInput],
  );
  const referralBonusPreview =
    currentVerifiedBonus !== undefined ? (currentVerifiedBonus * REFERRAL_BONUS_BPS) / 10_000n : undefined;
  const isCredentialActive = hasActiveCredential === true;
  const isVerifiedBonusClaimed = verifiedBonusClaimed === true;
  const activeEarnedRaterCap = typeof raterLaunchCap === "bigint" ? raterLaunchCap : undefined;
  const fullEarnedRaterCap = typeof raterFullLaunchCap === "bigint" ? raterFullLaunchCap : undefined;
  const launchCapUnlockAmount =
    fullEarnedRaterCap !== undefined && activeEarnedRaterCap !== undefined && fullEarnedRaterCap > activeEarnedRaterCap
      ? fullEarnedRaterCap - activeEarnedRaterCap
      : 0n;
  const canUnlockFullEarnedRaterCap = Boolean(
    walletAddress &&
      isCredentialActive &&
      raterFullLaunchCapUnlocked === false &&
      launchCapUnlockAmount > 0n &&
      !isUnlockPending,
  );
  const hasInvalidReferral = referralInputState.status === "invalid" || referralInputState.status === "self";
  const referralHint = referralInputState.message
    ? referralInputState.message
    : referralInputState.canUseReferrer
      ? referrerHasActiveCredential === undefined
        ? "Checking referrer credential..."
        : referrerHasActiveCredential
          ? `Referrer can earn ${formatLrepAmount(referralBonusPreview)} LREP when you claim.`
          : "This referrer is not verified yet, so no referral bonus will be paid."
      : "Paste a referral address or use a referral link before claiming.";
  const canClaimVerifiedBonus = Boolean(
    walletAddress &&
      isCredentialActive &&
      !isVerifiedBonusClaimed &&
      currentVerifiedBonus !== undefined &&
      currentVerifiedBonus > 0n &&
      !hasInvalidReferral &&
      !isClaimPending,
  );
  const claimDisabledReason = !walletAddress
    ? "Connect a wallet to claim the launch bonus."
    : !isCredentialActive
      ? "Verify with World ID before claiming the launch bonus."
      : isVerifiedBonusClaimed
        ? "This wallet already claimed the verified launch bonus."
        : hasInvalidReferral
          ? referralInputState.message
          : null;
  const worldIdRequestPanelState = getWorldIdRequestPanelState({
    connectorURI,
    errorCode: worldIdErrorCode,
    isAwaitingUserConfirmation: isAwaitingWorldIdApproval,
    isError: Boolean(worldIdErrorCode),
    isHostSubmitting: isAttestingCredential || isSubmittingWorldIdCredential,
    isOpen: open,
    isPreparing: isPreparingWorldIdRequest,
  });
  const isWorldIdRequestBusy =
    worldIdRequestPanelState.step === "preparing" ||
    worldIdRequestPanelState.step === "qrReady" ||
    worldIdRequestPanelState.step === "awaitingApproval" ||
    worldIdRequestPanelState.step === "submittingTx";

  useEffect(() => {
    setReferralInput(getStoredReferralAddress() ?? "");
  }, [address]);

  useEffect(() => {
    return () => {
      worldIdAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!address || typeof window === "undefined") {
      setShareLink("");
      return;
    }

    setShareLink(buildReferralLandingUrl(window.location.origin, address));
  }, [address]);

  const fetchWorldIdRequestContext = useCallback(async (): Promise<RpContextResponse> => {
    const response = await fetch("/api/world-id/rp-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const body = (await response.json().catch(() => ({}))) as Partial<RpContextResponse> & { error?: string };

    if (!response.ok || !body.rpContext || !body.action || !body.environment) {
      throw new Error(body.error ?? "World ID is not ready for this deployment.");
    }

    return {
      action: body.action,
      environment: body.environment,
      rpContext: body.rpContext,
    };
  }, []);

  const refreshLaunchReads = useCallback(async () => {
    await Promise.all([
      refetchHasActiveCredential(),
      refetchVerifiedBonusClaimed(),
      refetchCurrentVerifiedBonus(),
      refetchReferralEarnings(),
      refetchRaterLaunchCap(),
      refetchRaterFullLaunchCap(),
      refetchRaterFullLaunchCapUnlocked(),
    ]);
  }, [
    refetchCurrentVerifiedBonus,
    refetchHasActiveCredential,
    refetchRaterFullLaunchCap,
    refetchRaterFullLaunchCapUnlocked,
    refetchRaterLaunchCap,
    refetchReferralEarnings,
    refetchVerifiedBonusClaimed,
  ]);

  const handleReferralBlur = useCallback(() => {
    if (referralInputState.canUseReferrer) {
      storeReferralAttributionFromValue(referralInputState.normalizedReferrer, { source: "manual" });
      return;
    }

    if (referralInput.trim().length === 0) {
      clearStoredReferralAttribution();
    }
  }, [referralInput, referralInputState]);

  const handleClearReferral = useCallback(() => {
    setReferralInput("");
    clearStoredReferralAttribution();
  }, []);

  const handleCopyReferralLink = useCallback(async () => {
    if (!shareLink) {
      return;
    }

    await copyToClipboard(shareLink);
  }, [copyToClipboard, shareLink]);

  const handleVerify = useCallback(
    async (idkitResponse: IDKitResult, requestContext: RpContextResponse | null = rpContextResponse) => {
      if (!address || !chain?.id) {
        const message = "Connect a wallet on a supported chain before verifying.";
        setVerificationState({ status: "error", message });
        throw new Error(message);
      }

      if (!requestContext) {
        const message = "World ID is not ready for this deployment.";
        setVerificationState({ status: "error", message });
        throw new Error(message);
      }

      try {
        const parsedProof = parseWorldIdLegacyProof(idkitResponse, {
          expectedAction: requestContext.action,
          expectedSignal: signal,
        });

        const transactionHash = await attestWorldIdCredential(
          {
            functionName: "attestHumanCredentialWithProof",
            args: [parsedProof.root, parsedProof.nullifierHash, parsedProof.proof],
          },
          {
            action: "attest World ID credential",
            suppressSuccessToast: true,
          },
        );
        if (!transactionHash) {
          throw new Error("World ID credential transaction was not submitted.");
        }

        if (
          !isVerifiedBonusClaimed &&
          currentVerifiedBonus !== undefined &&
          currentVerifiedBonus > 0n &&
          !hasInvalidReferral
        ) {
          try {
            await claimVerifiedBonus(
              {
                functionName: "claimVerifiedBonus",
                args: [claimReferrer],
              },
              {
                action: "claim launch bonus",
                suppressSuccessToast: true,
              },
            );
            if (claimReferrer !== zeroAddress) {
              clearStoredReferralAttribution();
              setReferralInput("");
            }
            notification.success("Launch bonus claimed.");
          } catch {
            // Verification succeeded. The separate claim control remains available if the bonus claim needs a retry.
          }
        }

        if (
          walletAddress &&
          raterFullLaunchCapUnlocked === false &&
          fullEarnedRaterCap !== undefined &&
          activeEarnedRaterCap !== undefined &&
          fullEarnedRaterCap > activeEarnedRaterCap
        ) {
          try {
            await unlockFullEarnedRaterCap(
              {
                functionName: "unlockFullEarnedRaterCap",
                args: [walletAddress],
              },
              {
                action: "unlock full earned-rater cap",
                suppressSuccessToast: true,
              },
            );
            notification.success("Full earned-rater launch cap unlocked.");
          } catch {
            // Verification succeeded. The separate unlock control remains available if catch-up needs a retry.
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "World ID credential attestation failed.";
        setVerificationState({ status: "error", message });
        throw new Error(message);
      }

      await refreshLaunchReads();
    },
    [
      activeEarnedRaterCap,
      address,
      attestWorldIdCredential,
      chain?.id,
      claimReferrer,
      claimVerifiedBonus,
      currentVerifiedBonus,
      fullEarnedRaterCap,
      hasInvalidReferral,
      isVerifiedBonusClaimed,
      raterFullLaunchCapUnlocked,
      refreshLaunchReads,
      signal,
      unlockFullEarnedRaterCap,
      walletAddress,
      rpContextResponse,
    ],
  );

  const handleClaimVerifiedBonus = useCallback(async () => {
    if (!canClaimVerifiedBonus) {
      return;
    }

    try {
      await claimVerifiedBonus(
        {
          functionName: "claimVerifiedBonus",
          args: [claimReferrer],
        },
        {
          action: "claim launch bonus",
          suppressSuccessToast: true,
        },
      );
      notification.success("Launch bonus claimed.");
      if (claimReferrer !== zeroAddress) {
        clearStoredReferralAttribution();
        setReferralInput("");
      }
      await refreshLaunchReads();
    } catch {
      // The transaction wrapper already renders the parsed contract error.
    }
  }, [canClaimVerifiedBonus, claimReferrer, claimVerifiedBonus, refreshLaunchReads]);

  const handleUnlockFullEarnedRaterCap = useCallback(async () => {
    if (!canUnlockFullEarnedRaterCap || !walletAddress) {
      return;
    }

    try {
      await unlockFullEarnedRaterCap(
        {
          functionName: "unlockFullEarnedRaterCap",
          args: [walletAddress],
        },
        {
          action: "unlock full earned-rater cap",
          suppressSuccessToast: true,
        },
      );
      notification.success("Full earned-rater launch cap unlocked.");
      await refreshLaunchReads();
    } catch {
      // The transaction wrapper already renders the parsed contract error.
    }
  }, [canUnlockFullEarnedRaterCap, refreshLaunchReads, unlockFullEarnedRaterCap, walletAddress]);

  const handleSuccess = useCallback(
    async (result: IDKitResult) => {
      const nullifier =
        "session_id" in result
          ? result.session_id
          : (result.responses.find(response => "nullifier" in response)?.nullifier ?? null);
      const verifiedAt = new Date().toISOString();
      setVerificationState({ status: "verified", nullifier, verifiedAt });
      setOpen(false);
      await refreshLaunchReads();

      try {
        localStorage.setItem(
          "rateloop_world_id_verification",
          JSON.stringify({
            nullifier,
            verifiedAt,
          }),
        );
      } catch {
        // Local persistence is only a convenience badge for this browser.
      }
    },
    [refreshLaunchReads],
  );

  const resetWorldIdRequest = useCallback((nextVerificationState: VerificationState = { status: "idle" }) => {
    activeWorldIdRequestRef.current += 1;
    worldIdAbortControllerRef.current?.abort();
    worldIdAbortControllerRef.current = null;
    setOpen(false);
    setConnectorURI(null);
    setIsAwaitingWorldIdApproval(false);
    setIsPreparingWorldIdRequest(false);
    setIsSubmittingWorldIdCredential(false);
    setRpContextResponse(null);
    setVerificationState(nextVerificationState);
    setWorldIdErrorCode(null);
  }, []);

  const handleStart = useCallback(async () => {
    if (!appId || !address) {
      return;
    }

    const requestId = activeWorldIdRequestRef.current + 1;
    activeWorldIdRequestRef.current = requestId;
    worldIdAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    worldIdAbortControllerRef.current = abortController;

    setOpen(true);
    setConnectorURI(null);
    setIsAwaitingWorldIdApproval(false);
    setIsPreparingWorldIdRequest(true);
    setRpContextResponse(null);
    setVerificationState({ status: "loading" });
    setWorldIdErrorCode(null);

    try {
      const localMock = readLocalE2EWorldIdMock();
      const requestContext = localMock
        ? {
            action: localMock.action,
            environment: localMock.environment,
            rpContext: localMock.rpContext,
          }
        : await fetchWorldIdRequestContext();
      if (activeWorldIdRequestRef.current !== requestId || abortController.signal.aborted) {
        return;
      }

      setRpContextResponse(requestContext);
      if (localMock) {
        setConnectorURI(localMock.connectorURI);
        setIsPreparingWorldIdRequest(false);
        setIsAwaitingWorldIdApproval(true);
        await new Promise(resolve => window.setTimeout(resolve, 100));
        if (activeWorldIdRequestRef.current !== requestId || abortController.signal.aborted) {
          return;
        }

        setIsAwaitingWorldIdApproval(false);
        setIsSubmittingWorldIdCredential(true);
        try {
          await handleVerify(localMock.result, requestContext);
          if (activeWorldIdRequestRef.current !== requestId || abortController.signal.aborted) {
            return;
          }

          await handleSuccess(localMock.result);
        } finally {
          if (activeWorldIdRequestRef.current === requestId) {
            setIsSubmittingWorldIdCredential(false);
          }
        }
        return;
      }

      const request = await IDKit.request({
        action: requestContext.action,
        allow_legacy_proofs: true,
        app_id: appId,
        environment: requestContext.environment,
        rp_context: requestContext.rpContext,
      }).preset(orbLegacy({ signal }));
      if (activeWorldIdRequestRef.current !== requestId || abortController.signal.aborted) {
        return;
      }

      setConnectorURI(request.connectorURI);
      publishWorldIdConnectorURI(request.connectorURI);
      setIsPreparingWorldIdRequest(false);

      const completion = await pollWorldIdRequest(request, {
        onAwaitingConfirmation: value => {
          if (activeWorldIdRequestRef.current === requestId) {
            setIsAwaitingWorldIdApproval(value);
          }
        },
        signal: abortController.signal,
      });
      if (activeWorldIdRequestRef.current !== requestId || abortController.signal.aborted) {
        return;
      }

      if (!completion.success) {
        const message = `World ID returned ${formatWorldIdError(completion.error)}.`;
        setVerificationState({ status: "error", message });
        setWorldIdErrorCode(completion.error);
        return;
      }

      setIsSubmittingWorldIdCredential(true);
      try {
        await handleVerify(completion.result, requestContext);
        if (activeWorldIdRequestRef.current !== requestId || abortController.signal.aborted) {
          return;
        }

        await handleSuccess(completion.result);
      } finally {
        if (activeWorldIdRequestRef.current === requestId) {
          setIsSubmittingWorldIdCredential(false);
        }
      }
    } catch (error) {
      if (activeWorldIdRequestRef.current !== requestId || abortController.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : "World ID is not ready for this deployment.";
      setVerificationState({
        status: "error",
        message,
      });
      setWorldIdErrorCode("generic_error");
    } finally {
      if (activeWorldIdRequestRef.current === requestId) {
        setIsPreparingWorldIdRequest(false);
        setIsAwaitingWorldIdApproval(false);
      }
    }
  }, [address, appId, fetchWorldIdRequestContext, handleSuccess, handleVerify, signal]);

  return (
    <section className="surface-card rounded-2xl p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-base-content/55">
            <ShieldCheckIcon className="h-4 w-4" />
            World ID
          </div>
          <h3 className="mt-3 text-2xl font-semibold text-base-content">Human credential</h3>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-base-content/65">
            Add an optional World ID proof to this wallet. Rating and LREP participation stay open without it.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:min-w-56">
          <button
            type="button"
            className="btn btn-primary gap-2"
            disabled={!canVerify || isWorldIdRequestBusy}
            onClick={() => void handleStart()}
          >
            <ShieldCheckIcon className="h-5 w-5" />
            {isWorldIdRequestBusy ? "Verifying..." : "Verify with World ID"}
          </button>
          {!isConfigured ? (
            <p className="text-sm leading-relaxed text-base-content/55">
              World ID is not configured for this deployment.
            </p>
          ) : !address ? (
            <p className="text-sm leading-relaxed text-base-content/55">Connect a wallet to request a credential.</p>
          ) : null}
        </div>
      </div>

      {open && worldIdRequestPanelState.step !== "idle" ? (
        <div className="mt-5 border-t border-base-300 pt-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:items-center">
            <div className="hidden justify-center md:flex">
              <div className="aspect-square w-full max-w-64 rounded-2xl border border-base-300 bg-white p-3 shadow-sm">
                {connectorURI ? (
                  <WorldIdQrCode data={connectorURI} />
                ) : (
                  <div className="flex h-full items-center justify-center text-base-content/35">
                    <span className="loading loading-spinner loading-lg" />
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-base-content/55">
                  <QrCodeIcon className="h-4 w-4" />
                  World App
                </div>
                <h4 className="mt-2 text-xl font-semibold text-base-content">{worldIdRequestPanelState.title}</h4>
                <p className="mt-2 text-sm leading-relaxed text-base-content/60">{worldIdRequestPanelState.detail}</p>
              </div>

              {connectorURI ? (
                <div className="flex flex-wrap gap-2">
                  <a className="btn btn-secondary gap-2 md:btn-outline" href={connectorURI}>
                    <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                    Open World App
                  </a>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {worldIdRequestPanelState.canRetry ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleStart()}>
                    Try again
                  </button>
                ) : null}
                {worldIdRequestPanelState.canCancel ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => resetWorldIdRequest()}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {verificationState.status === "verified" ? (
        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">World ID verified</p>
            <p className="mt-1 text-success/80">
              This browser has a verified proof for the connected wallet
              {verificationState.nullifier ? ` (${verificationState.nullifier.slice(0, 10)}...)` : ""}.
            </p>
          </div>
        </div>
      ) : null}

      {verificationState.status === "error" ? (
        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-error/10 px-4 py-3 text-sm text-error">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{verificationState.message}</p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 border-t border-base-300 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-lg font-semibold text-base-content">Launch referral</h4>
              <p className="mt-1 text-sm leading-relaxed text-base-content/60">
                Referral attribution is optional and is applied when the verified launch bonus is claimed.
              </p>
            </div>
            {referralInput ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square shrink-0"
                aria-label="Clear referral"
                onClick={handleClearReferral}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="space-y-2">
            <label htmlFor={referralInputId} className="text-sm font-medium text-base-content/70">
              Referrer address
            </label>
            <input
              id={referralInputId}
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="0x..."
              aria-describedby={referralHintId}
              className={`input input-bordered w-full bg-base-100 font-mono text-sm ${
                hasInvalidReferral ? "input-error" : ""
              }`}
              value={referralInput}
              onBlur={handleReferralBlur}
              onChange={event => setReferralInput(event.target.value)}
            />
            <p id={referralHintId} className={`text-sm ${hasInvalidReferral ? "text-error" : "text-base-content/55"}`}>
              {referralHint}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor={`${referralInputId}-share`} className="text-sm font-medium text-base-content/70">
              Your referral link
            </label>
            <div className="flex gap-2">
              <input
                id={`${referralInputId}-share`}
                type="text"
                readOnly
                className="input input-bordered min-w-0 flex-1 bg-base-100 font-mono text-xs"
                value={shareLink}
                placeholder="Connect a wallet to generate a link"
              />
              <button
                type="button"
                className="btn btn-secondary btn-square shrink-0"
                aria-label="Copy referral link"
                disabled={!shareLink}
                onClick={() => void handleCopyReferralLink()}
              >
                <ClipboardDocumentIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-base-content/55">
              {isCopiedToClipboard ? "Referral link copied." : "Verified referrers receive a bounded referral bonus."}
            </p>
          </div>
        </div>

        <div className="space-y-4 lg:border-l lg:border-base-300 lg:pl-6">
          <div>
            <h4 className="text-lg font-semibold text-base-content">Verified launch bonus</h4>
            <p className="mt-1 text-sm leading-relaxed text-base-content/60">
              The one-time verified bonus decays as more wallets claim it.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-base-content/55">Current bonus</dt>
            <dd className="text-right font-semibold text-base-content">
              {formatLrepAmount(currentVerifiedBonus)} LREP
            </dd>
            <dt className="text-base-content/55">Referral earned</dt>
            <dd className="text-right font-semibold text-base-content">{formatLrepAmount(referralEarnings)} LREP</dd>
            <dt className="text-base-content/55">Credential</dt>
            <dd className="text-right font-semibold text-base-content">
              {isCredentialActive ? "Active" : "Not active"}
            </dd>
            <dt className="text-base-content/55">Bonus status</dt>
            <dd className="text-right font-semibold text-base-content">
              {isVerifiedBonusClaimed ? "Claimed" : "Unclaimed"}
            </dd>
          </dl>

          <button
            type="button"
            className="btn btn-primary w-full gap-2"
            disabled={!canClaimVerifiedBonus}
            onClick={() => void handleClaimVerifiedBonus()}
          >
            {isClaimPending ? (
              <>
                <span className="loading loading-spinner loading-sm" />
                Claiming...
              </>
            ) : (
              `Claim ${formatLrepAmount(currentVerifiedBonus)} LREP`
            )}
          </button>
          {claimDisabledReason ? (
            <p className="text-sm leading-relaxed text-base-content/55">{claimDisabledReason}</p>
          ) : null}
          {launchCapUnlockAmount > 0n || raterFullLaunchCapUnlocked === true ? (
            <div className="rounded-xl border border-base-content/10 p-3 text-sm text-base-content/65">
              <div className="flex items-center justify-between gap-3">
                <span>Earned-rater cap</span>
                <span className="font-semibold text-base-content">
                  {raterFullLaunchCapUnlocked === true
                    ? "Full cap active"
                    : `${formatLrepAmount(launchCapUnlockAmount)} LREP unlockable`}
                </span>
              </div>
              {raterFullLaunchCapUnlocked === true ? null : (
                <button
                  type="button"
                  className="btn btn-outline btn-sm mt-3 w-full"
                  disabled={!canUnlockFullEarnedRaterCap}
                  onClick={() => void handleUnlockFullEarnedRaterCap()}
                >
                  {isUnlockPending ? (
                    <>
                      <span className="loading loading-spinner loading-xs" />
                      Unlocking...
                    </>
                  ) : (
                    "Unlock full earned cap"
                  )}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
