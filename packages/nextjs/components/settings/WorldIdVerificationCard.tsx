"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CredentialRequest, IDKit, type IDKitResult, type RpContext, orbLegacy } from "@worldcoin/idkit";
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
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import {
  useCopyToClipboard,
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
} from "~~/hooks/scaffold-eth";
import { useRaterRegistryIdentity } from "~~/hooks/useRaterRegistryIdentity";
import { useRefreshWalletBalances } from "~~/hooks/useRefreshWalletBalances";
import { useThirdwebRaterDelegationLink } from "~~/hooks/useThirdwebRaterDelegationLink";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { getLaunchReferralInputState, resolveLaunchClaimReferrer } from "~~/lib/referrals/launchReferral";
import {
  buildReferralLandingUrl,
  clearStoredReferralAttribution,
  getStoredReferralAddress,
  storeReferralAttributionFromValue,
} from "~~/lib/referrals/referralAttribution";
import { type WorldIdProofMode, getWorldIdClientConfig } from "~~/lib/world-id/config";
import {
  type WorldIdDiagnosticPhase,
  getConnectorScheme,
  getWorldIdErrorMessage,
  getWorldIdRequestId,
  reportWorldIdDiagnostic,
} from "~~/lib/world-id/diagnostics";
import { readLocalE2EWorldIdMock } from "~~/lib/world-id/e2eMock";
import { parseWorldIdProof } from "~~/lib/world-id/onchainProof";
import {
  assertWorldIdProofHasSubmissionWindow,
  getWorldIdCredentialRequestExpiresAtMin,
  getWorldIdRequestPollingTimeoutMs,
  isWorldIdProofExpiredError,
} from "~~/lib/world-id/proofExpiry";
import { pollWorldIdRequest } from "~~/lib/world-id/requestPolling";
import {
  formatWorldIdError,
  getWorldIdCredentialAttestationErrorMessage,
  getWorldIdRequestPanelState,
} from "~~/lib/world-id/verificationUiState";
import { notification } from "~~/utils/scaffold-eth";

const LREP_DECIMALS = 6;
const REFERRAL_BONUS_BPS = 5_000n;
const WORLD_ID_LEGACY_ATTEST_FUNCTION_NAME = "attestHumanCredentialWithProof";
const WORLD_ID_V4_ATTEST_FUNCTION_NAME = "attestHumanCredentialWithV4Proof";

type RpContextResponse = {
  action: string;
  diagnosticId?: string;
  environment: "production" | "staging";
  proofMode?: WorldIdProofMode;
  purpose?: "credential" | "presence";
  rpContext: RpContext;
};

type ContractAbiItem = { type: string; name?: string };

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

function formatShortAddress(address: string | null | undefined) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "unknown holder";
}

// M-12 (2026-05-22 audit): previously published the connector URI to a public window
// global plus a global CustomEvent. Both surfaces were readable by any third-party
// script on the page (analytics, embedded widgets) which let other code observe the
// active World ID session. There are no in-repo consumers, so the publish is dropped
// entirely — re-introduce a module-local emitter if a consumer ever needs it.

export function WorldIdVerificationCard({ address }: { address?: string }) {
  const config = getWorldIdClientConfig();
  const worldIdProofMode = config.proofMode;
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
  const refreshWalletBalances = useRefreshWalletBalances();
  const localE2EWorldIdMock = readLocalE2EWorldIdMock();
  const appId = config.appId?.startsWith("app_")
    ? (config.appId as `app_${string}`)
    : (localE2EWorldIdMock?.appId ?? null);
  const signal = getWorldIdSignal(address);
  const walletAddress = address as `0x${string}` | undefined;
  const isConfigured = Boolean((appId && config.enabled) || localE2EWorldIdMock);
  const canVerify = Boolean(isConfigured && address);
  const resolvedIdentity = useRaterRegistryIdentity(walletAddress);
  const thirdwebCredentialLink = useThirdwebRaterDelegationLink({ enabled: Boolean(walletAddress) });
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
  const { refetch: refetchLrepBalance } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [walletAddress],
    query: { enabled: Boolean(walletAddress) },
  });
  const { writeContractAsync: claimVerifiedBonus, isMining: isClaimingVerifiedBonus } = useScaffoldWriteContract({
    contractName: "LaunchDistributionPool",
  });
  const { writeContractAsync: unlockFullEarnedRaterCap } = useScaffoldWriteContract({
    contractName: "LaunchDistributionPool",
  });
  const { writeContractAsync: attestWorldIdCredential, isMining: isAttestingCredential } = useScaffoldWriteContract({
    contractName: "RaterRegistry",
  });
  const { data: raterRegistryContractData } = useDeployedContractInfo({
    contractName: "RaterRegistry",
  });
  const hasWorldIdV4AttestFunction = useMemo(
    () =>
      Boolean(
        raterRegistryContractData?.abi.some(
          item =>
            (item as ContractAbiItem).type === "function" &&
            (item as ContractAbiItem).name === WORLD_ID_V4_ATTEST_FUNCTION_NAME,
        ),
      ),
    [raterRegistryContractData],
  );
  const hasWorldIdLegacyAttestFunction = useMemo(
    () =>
      Boolean(
        raterRegistryContractData?.abi.some(
          item =>
            (item as ContractAbiItem).type === "function" &&
            (item as ContractAbiItem).name === WORLD_ID_LEGACY_ATTEST_FUNCTION_NAME,
        ),
      ),
    [raterRegistryContractData],
  );
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
  const hasDirectCredential = hasActiveCredential === true;
  const isCredentialActive = hasDirectCredential || resolvedIdentity.hasActiveHumanCredential;
  const linkedHolderLabel = formatShortAddress(resolvedIdentity.holder);
  const canClaimVerifiedBonus =
    hasDirectCredential &&
    verifiedBonusClaimed === false &&
    currentVerifiedBonus !== undefined &&
    currentVerifiedBonus > 0n;
  const activeEarnedRaterCap = typeof raterLaunchCap === "bigint" ? raterLaunchCap : undefined;
  const fullEarnedRaterCap = typeof raterFullLaunchCap === "bigint" ? raterFullLaunchCap : undefined;
  const hasInvalidReferral = referralInputState.status === "invalid" || referralInputState.status === "self";
  const referralHint = referralInputState.message
    ? referralInputState.message
    : referralInputState.canUseReferrer
      ? referrerHasActiveCredential === undefined
        ? "Checking referrer credential..."
        : referrerHasActiveCredential
          ? `Referrer can earn ${formatLrepAmount(referralBonusPreview)} LREP when you claim.`
          : "This referrer is not verified yet, so no referral bonus will be paid."
      : undefined;
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
      body: JSON.stringify({ purpose: "credential" }),
    });
    const body = (await response.json().catch(() => ({}))) as Partial<RpContextResponse> & { error?: string };

    if (!response.ok || !body.rpContext || !body.action || !body.environment) {
      throw new Error(body.error ?? "World ID is not ready for this deployment.");
    }

    return {
      action: body.action,
      diagnosticId: typeof body.diagnosticId === "string" ? body.diagnosticId : undefined,
      environment: body.environment,
      proofMode: body.proofMode === "compat" || body.proofMode === "v4" ? body.proofMode : "legacy",
      purpose: "credential",
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
      refetchLrepBalance(),
    ]);
    await refreshWalletBalances(walletAddress);
  }, [
    refetchCurrentVerifiedBonus,
    refetchHasActiveCredential,
    refetchLrepBalance,
    refetchRaterFullLaunchCap,
    refetchRaterFullLaunchCapUnlocked,
    refetchRaterLaunchCap,
    refetchReferralEarnings,
    refetchVerifiedBonusClaimed,
    refreshWalletBalances,
    walletAddress,
  ]);

  const claimVerifiedLaunchBonusIfAvailable = useCallback(async () => {
    if (!walletAddress) {
      return false;
    }

    const [latestVerifiedBonusClaimedResult, latestVerifiedBonusResult] = await Promise.all([
      refetchVerifiedBonusClaimed(),
      refetchCurrentVerifiedBonus(),
    ]);
    const latestVerifiedBonusClaimed = latestVerifiedBonusClaimedResult.data === true;
    const latestVerifiedBonus =
      typeof latestVerifiedBonusResult.data === "bigint" ? latestVerifiedBonusResult.data : undefined;

    if (latestVerifiedBonusClaimed || latestVerifiedBonus === undefined || latestVerifiedBonus <= 0n) {
      return false;
    }

    const verifiedBonusReferrer = hasInvalidReferral ? zeroAddress : claimReferrer;

    await claimVerifiedBonus(
      {
        functionName: "claimVerifiedBonus",
        args: [verifiedBonusReferrer],
      },
      {
        action: "claim launch bonus",
        suppressSuccessToast: true,
      },
    );
    if (verifiedBonusReferrer !== zeroAddress) {
      clearStoredReferralAttribution();
      setReferralInput("");
    }
    notification.success("Launch bonus claimed.");
    return true;
  }, [
    claimReferrer,
    claimVerifiedBonus,
    hasInvalidReferral,
    refetchCurrentVerifiedBonus,
    refetchVerifiedBonusClaimed,
    walletAddress,
  ]);

  const handleClaimVerifiedBonus = useCallback(async () => {
    try {
      await claimVerifiedLaunchBonusIfAvailable();
    } finally {
      await refreshLaunchReads();
    }
  }, [claimVerifiedLaunchBonusIfAvailable, refreshLaunchReads]);

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
        const parsedProof = parseWorldIdProof(idkitResponse, {
          expectedAction: requestContext.action,
          expectedCredential: "proof_of_human",
          expectedSignal: signal,
          proofMode: requestContext.proofMode ?? worldIdProofMode,
        });

        let transactionHash;
        if (parsedProof.protocolVersion === "4.0") {
          assertWorldIdProofHasSubmissionWindow(parsedProof.expiresAtMin);
          if (!hasWorldIdV4AttestFunction) {
            throw new Error(`This RaterRegistry deployment does not expose ${WORLD_ID_V4_ATTEST_FUNCTION_NAME}.`);
          }

          transactionHash = await (attestWorldIdCredential as any)(
            {
              functionName: WORLD_ID_V4_ATTEST_FUNCTION_NAME,
              args: [parsedProof.nullifierHash, parsedProof.nonce, BigInt(parsedProof.expiresAtMin), parsedProof.proof],
            },
            {
              action: "attest World ID credential",
              getErrorMessage: getWorldIdCredentialAttestationErrorMessage,
              suppressSuccessToast: true,
            },
          );
        } else {
          if (!hasWorldIdLegacyAttestFunction) {
            throw new Error(`This RaterRegistry deployment does not expose ${WORLD_ID_LEGACY_ATTEST_FUNCTION_NAME}.`);
          }

          transactionHash = await (attestWorldIdCredential as any)(
            {
              functionName: WORLD_ID_LEGACY_ATTEST_FUNCTION_NAME,
              args: [parsedProof.root, parsedProof.nullifierHash, parsedProof.proof],
            },
            {
              action: "attest World ID credential",
              getErrorMessage: getWorldIdCredentialAttestationErrorMessage,
              suppressSuccessToast: true,
            },
          );
        }

        if (!transactionHash) {
          throw new Error("World ID credential transaction was not submitted.");
        }

        try {
          await claimVerifiedLaunchBonusIfAvailable();
        } catch {
          // Verification succeeded even if the follow-up launch bonus claim needs a retry.
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
        const message = getWorldIdCredentialAttestationErrorMessage(error);
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
      claimVerifiedLaunchBonusIfAvailable,
      fullEarnedRaterCap,
      hasWorldIdLegacyAttestFunction,
      hasWorldIdV4AttestFunction,
      raterFullLaunchCapUnlocked,
      refreshLaunchReads,
      signal,
      unlockFullEarnedRaterCap,
      walletAddress,
      worldIdProofMode,
      rpContextResponse,
    ],
  );

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

    let diagnosticContext: RpContextResponse | null = null;
    let diagnosticPhase: WorldIdDiagnosticPhase = "rp_context";
    let idkitRequestId: string | null = null;
    const reportRequestDiagnostic = (
      event: "request_created" | "request_create_failed" | "poll_failed" | "request_exception",
      extras: {
        connectorScheme?: string | null;
        errorCode?: string | null;
        message?: string | null;
        phase?: WorldIdDiagnosticPhase;
      } = {},
    ) => {
      if (!diagnosticContext) {
        return;
      }

      void reportWorldIdDiagnostic({
        action: diagnosticContext.action,
        appId,
        credential: "proof_of_human",
        diagnosticId: diagnosticContext.diagnosticId,
        environment: diagnosticContext.environment,
        event,
        phase: extras.phase ?? diagnosticPhase,
        proofMode: diagnosticContext.proofMode ?? worldIdProofMode,
        purpose: "credential",
        requestId: idkitRequestId,
        rpContextExpiresAt: diagnosticContext.rpContext.expires_at,
        rpId: diagnosticContext.rpContext.rp_id,
        ...extras,
      });
    };

    try {
      const localMock = readLocalE2EWorldIdMock();
      const requestContext = localMock
        ? {
            action: localMock.action,
            environment: localMock.environment,
            proofMode: "legacy" as const,
            purpose: "credential" as const,
            rpContext: localMock.rpContext,
          }
        : await fetchWorldIdRequestContext();
      diagnosticContext = requestContext;
      diagnosticPhase = "create_request";
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

      const requestBuilder = IDKit.request({
        action: requestContext.action,
        allow_legacy_proofs: (requestContext.proofMode ?? worldIdProofMode) !== "v4",
        app_id: appId,
        environment: requestContext.environment,
        rp_context: requestContext.rpContext,
      });
      const request =
        (requestContext.proofMode ?? worldIdProofMode) === "legacy"
          ? await requestBuilder.preset(orbLegacy({ signal }))
          : await requestBuilder.constraints(
              CredentialRequest("proof_of_human", {
                expires_at_min: getWorldIdCredentialRequestExpiresAtMin("credential"),
                signal,
              }),
            );
      idkitRequestId = getWorldIdRequestId(request);
      reportRequestDiagnostic("request_created", {
        connectorScheme: getConnectorScheme(request.connectorURI),
        phase: "poll",
      });
      diagnosticPhase = "poll";
      if (activeWorldIdRequestRef.current !== requestId || abortController.signal.aborted) {
        return;
      }

      setConnectorURI(request.connectorURI);
      setIsPreparingWorldIdRequest(false);

      const pollingTimeoutMs = getWorldIdRequestPollingTimeoutMs(requestContext.rpContext);
      if (pollingTimeoutMs !== undefined && pollingTimeoutMs <= 0) {
        setVerificationState({
          status: "error",
          message: "World ID request expired. Try again with a fresh request.",
        });
        setWorldIdErrorCode("timeout");
        reportRequestDiagnostic("poll_failed", {
          errorCode: "timeout",
          message: "World ID request expired before polling could start.",
        });
        return;
      }

      const completion = await pollWorldIdRequest(request, {
        onAwaitingConfirmation: value => {
          if (activeWorldIdRequestRef.current === requestId) {
            setIsAwaitingWorldIdApproval(value);
          }
        },
        signal: abortController.signal,
        ...(pollingTimeoutMs === undefined ? {} : { timeoutMs: pollingTimeoutMs }),
      });
      if (activeWorldIdRequestRef.current !== requestId || abortController.signal.aborted) {
        return;
      }

      if (!completion.success) {
        const message = `World ID returned ${formatWorldIdError(completion.error)}.`;
        setVerificationState({ status: "error", message });
        setWorldIdErrorCode(completion.error);
        reportRequestDiagnostic("poll_failed", {
          errorCode: completion.error,
          message,
        });
        return;
      }

      setIsSubmittingWorldIdCredential(true);
      diagnosticPhase = "submit_onchain";
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
      setWorldIdErrorCode(isWorldIdProofExpiredError(error) ? "timeout" : "generic_error");
      reportRequestDiagnostic(diagnosticPhase === "create_request" ? "request_create_failed" : "request_exception", {
        errorCode: isWorldIdProofExpiredError(error) ? "timeout" : "generic_error",
        message: getWorldIdErrorMessage(error),
      });
    } finally {
      if (activeWorldIdRequestRef.current === requestId) {
        setIsPreparingWorldIdRequest(false);
        setIsAwaitingWorldIdApproval(false);
      }
    }
  }, [address, appId, fetchWorldIdRequestContext, handleSuccess, handleVerify, signal, worldIdProofMode]);

  const handleLinkThirdwebCredential = useCallback(async () => {
    try {
      await thirdwebCredentialLink.link();
      await Promise.all([refetchHasActiveCredential(), resolvedIdentity.refetch()]);
      notification.success("Human credential linked to this wallet.");
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not link this wallet identity.");
    }
  }, [refetchHasActiveCredential, resolvedIdentity, thirdwebCredentialLink]);

  return (
    <section className="surface-card rounded-2xl p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-base-content/55">
            <ShieldCheckIcon className="h-4 w-4" />
            World ID
          </div>
          <h3 className="mt-3 inline-flex items-center gap-2 text-2xl font-semibold text-base-content">
            Human Credential
            <InfoTooltip text="Only Orb verification is supported right now." position="top" />
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-base-content/60">
            World ID lets you prove you are a unique human while keeping personal details private. RateLoop uses this
            wallet-bound proof to unlock human credential rewards;{" "}
            <a
              href="https://world.org/world-id"
              target="_blank"
              rel="noopener noreferrer"
              className="link link-primary"
            >
              learn more about World ID
            </a>
            .
          </p>
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
        <div className="surface-card-nested mt-5 flex items-start gap-3 rounded-2xl px-4 py-3 text-sm text-error">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{verificationState.message}</p>
        </div>
      ) : null}

      {thirdwebCredentialLink.canLink ? (
        <div className="surface-card-nested mt-5 flex flex-col gap-3 rounded-2xl px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-base-content">Legacy human credential available</p>
            <p className="mt-1 text-base-content/60">
              Your thirdweb Google wallet can link its legacy human credential to this RateLoop wallet.
            </p>
            {thirdwebCredentialLink.error ? (
              <p className="mt-2 font-medium text-error">{thirdwebCredentialLink.error}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm shrink-0"
            disabled={thirdwebCredentialLink.isLinking}
            onClick={() => void handleLinkThirdwebCredential()}
          >
            {thirdwebCredentialLink.isLinking ? <span className="loading loading-spinner loading-xs" /> : null}
            Link Credential
          </button>
        </div>
      ) : null}

      {isCredentialActive && resolvedIdentity.delegated && !hasDirectCredential ? (
        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Human credential linked</p>
            <p className="mt-1 text-success/80">This wallet resolves to the human credential on {linkedHolderLabel}.</p>
          </div>
        </div>
      ) : null}

      {isCredentialActive ? (
        <div className="mt-6 grid gap-6 border-t border-base-300 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)]">
          <div className="space-y-2">
            <label htmlFor={`${referralInputId}-share`} className="text-sm font-medium text-base-content/70">
              Your Referral Link
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
            {isCopiedToClipboard ? <p className="text-sm text-base-content/55">Referral link copied.</p> : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:block lg:space-y-2 lg:text-right">
            <dt className="text-base-content/55">Referral Earned</dt>
            <dd className="font-semibold text-base-content">{formatLrepAmount(referralEarnings)} LREP</dd>
            {canClaimVerifiedBonus ? (
              <>
                <dt className="text-base-content/55">Launch Bonus</dt>
                <dd>
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    disabled={isClaimingVerifiedBonus}
                    onClick={() => void handleClaimVerifiedBonus()}
                  >
                    {isClaimingVerifiedBonus ? "Claiming..." : `Claim ${formatLrepAmount(currentVerifiedBonus)} LREP`}
                  </button>
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : (
        <div className="mt-6 border-t border-base-300 pt-5">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)]">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <label htmlFor={referralInputId} className="text-sm font-medium text-base-content/70">
                  Referrer Address
                </label>
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
              <input
                id={referralInputId}
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder="0x..."
                aria-describedby={referralHint ? referralHintId : undefined}
                className={`input input-bordered w-full bg-base-100 font-mono text-sm ${
                  hasInvalidReferral ? "input-error" : ""
                }`}
                value={referralInput}
                onBlur={handleReferralBlur}
                onChange={event => setReferralInput(event.target.value)}
              />
              {referralHint ? (
                <p
                  id={referralHintId}
                  className={`text-sm ${hasInvalidReferral ? "text-error" : "text-base-content/55"}`}
                >
                  {referralHint}
                </p>
              ) : null}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:block lg:space-y-2 lg:text-right">
              <dt className="text-base-content/55">Current Bonus</dt>
              <dd className="font-semibold text-base-content">{formatLrepAmount(currentVerifiedBonus)} LREP</dd>
            </dl>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-h-5">
              {!isConfigured ? (
                <p className="text-sm leading-relaxed text-base-content/55">
                  World ID is not configured for this deployment.
                </p>
              ) : !address ? (
                <p className="text-sm leading-relaxed text-base-content/55">
                  Connect a wallet to request a credential.
                </p>
              ) : null}
            </div>
            <GradientActionButton
              className="sm:min-w-56"
              disabled={!canVerify || isWorldIdRequestBusy}
              motion={getGradientActionMotion(isWorldIdRequestBusy)}
              onClick={() => void handleStart()}
            >
              <ShieldCheckIcon className="h-5 w-5" />
              {isWorldIdRequestBusy ? "Verifying..." : "Verify with World ID"}
            </GradientActionButton>
          </div>
        </div>
      )}
    </section>
  );
}
