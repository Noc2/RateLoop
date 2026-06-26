"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CredentialRequest, IDKit, type IDKitResult, type RpContext, orbLegacy } from "@worldcoin/idkit";
import type { Abi, Hex } from "viem";
import { ArrowTopRightOnSquareIcon, ExclamationTriangleIcon, QrCodeIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { WorldIdQrCode } from "~~/components/settings/WorldIdQrCode";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useThirdwebBatchedContractWrite } from "~~/hooks/useThirdwebBatchedContractWrite";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useTransactionFlowToast } from "~~/hooks/useTransactionFlowToast";
import { type WorldIdProofMode, getWorldIdClientConfig } from "~~/lib/world-id/config";
import {
  WORLD_CREDENTIAL_PROOF_OF_HUMAN,
  type WorldCredentialKind,
  type WorldIdProofPurpose,
  getWorldCredentialOption,
  getWorldIdSignalForPurpose,
} from "~~/lib/world-id/credentials";
import {
  type WorldIdDiagnosticPhase,
  getConnectorScheme,
  getWorldIdErrorMessage,
  getWorldIdRequestId,
  reportWorldIdDiagnostic,
} from "~~/lib/world-id/diagnostics";
import { parseWorldIdProof } from "~~/lib/world-id/onchainProof";
import {
  getWorldIdProofDialogAutoStartKey,
  getWorldIdProofDialogUnavailableMessage,
} from "~~/lib/world-id/proofDialogStart";
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
  isWorldIdCredentialAttestationRejectedError,
} from "~~/lib/world-id/verificationUiState";
import { notification } from "~~/utils/scaffold-eth";

type RpContextResponse = {
  action: string;
  diagnosticId?: string;
  environment: "production" | "staging";
  proofMode?: WorldIdProofMode;
  purpose: WorldIdProofPurpose;
  rpContext: RpContext;
};

type WorldIdProofDialogProps = {
  address?: string;
  kind: WorldCredentialKind;
  onClose: () => void;
  onSuccess?: () => void | Promise<void>;
  open: boolean;
  purpose: WorldIdProofPurpose;
};

type DialogStatus = "idle" | "loading" | "success" | "error";

export function WorldIdProofDialog({ address, kind, onClose, onSuccess, open, purpose }: WorldIdProofDialogProps) {
  const config = getWorldIdClientConfig();
  const proofMode = config.proofMode;
  const [connectorURI, setConnectorURI] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isAwaitingApproval, setIsAwaitingApproval] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [status, setStatus] = useState<DialogStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const activeRequestRef = useRef(0);
  const autoStartKeyRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { writeContractAsync: writeRaterRegistry, isMining } = useScaffoldWriteContract({
    contractName: "RaterRegistry",
  });
  const { data: raterRegistryContractData } = useDeployedContractInfo({
    contractName: "RaterRegistry",
  });
  const { writeContractOrBatch, canUseBatchedContractWrites } = useThirdwebBatchedContractWrite();
  const { canUseSponsoredSubmitCalls } = useThirdwebSponsoredSubmitCalls();
  const flowToast = useTransactionFlowToast();

  const option = getWorldCredentialOption(kind);
  const appId = config.appId?.startsWith("app_") ? (config.appId as `app_${string}`) : null;
  const signal = useMemo(() => {
    if (!address) return "";
    if (proofMode === "legacy" && kind === WORLD_CREDENTIAL_PROOF_OF_HUMAN && purpose === "credential") {
      return address.toLowerCase();
    }
    return getWorldIdSignalForPurpose(address, kind, purpose);
  }, [address, kind, proofMode, purpose]);
  const autoStartKey = useMemo(
    () => getWorldIdProofDialogAutoStartKey({ address, appId, kind, open, proofMode, purpose, signal }),
    [address, appId, kind, open, proofMode, purpose, signal],
  );
  const unavailableMessage = useMemo(
    () => getWorldIdProofDialogUnavailableMessage({ address, appId, kind, open, proofMode, purpose, signal }),
    [address, appId, kind, open, proofMode, purpose, signal],
  );
  const isSubmittingTransaction = isSubmitting || isMining;
  const isBusy = isPreparing || isAwaitingApproval || isSubmittingTransaction;
  const canCancelRequest = !isSubmittingTransaction;
  const panelState = getWorldIdRequestPanelState({
    connectorURI,
    errorCode,
    isAwaitingUserConfirmation: isAwaitingApproval,
    isError: Boolean(errorCode),
    isHostSubmitting: isSubmitting || isMining,
    isOpen: open,
    isPreparing,
  });

  const reset = useCallback(() => {
    activeRequestRef.current += 1;
    autoStartKeyRef.current = null;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setConnectorURI(null);
    setIsAwaitingApproval(false);
    setIsPreparing(false);
    setIsSubmitting(false);
    setErrorCode(null);
    setStatus("idle");
    setMessage(null);
  }, []);

  const fetchRequestContext = useCallback(async (): Promise<RpContextResponse> => {
    const response = await fetch("/api/world-id/rp-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose }),
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
      purpose,
      rpContext: body.rpContext,
    };
  }, [purpose]);

  const submitProof = useCallback(
    async (result: IDKitResult, requestContext: RpContextResponse) => {
      if (!raterRegistryContractData) {
        throw new Error("Rater registry is unavailable right now.");
      }

      const registryAddress = raterRegistryContractData.address as `0x${string}`;
      const registryAbi = raterRegistryContractData.abi as Abi;
      const parsedProof = parseWorldIdProof(result, {
        expectedAction: requestContext.action,
        expectedCredential: option.identifier,
        expectedSignal: signal,
        proofMode: requestContext.proofMode ?? proofMode,
      });

      const submitAttestation = async (functionName: string, args: readonly unknown[], action: string) => {
        if (canUseBatchedContractWrites) {
          flowToast.beginFlow({
            action,
            sponsored: canUseSponsoredSubmitCalls,
          });
        }
        try {
          await writeContractOrBatch(
            {
              abi: registryAbi,
              address: registryAddress,
              args,
              functionName,
            },
            () =>
              (writeRaterRegistry as any)(
                {
                  functionName,
                  args,
                },
                {
                  action,
                  getErrorMessage: getWorldIdCredentialAttestationErrorMessage,
                  suppressSuccessToast: true,
                },
              ) as Promise<Hex | undefined>,
            {
              action,
              ...(canUseBatchedContractWrites ? flowToast.getFlowBatchOptions() : {}),
            },
          );
        } finally {
          if (canUseBatchedContractWrites) {
            flowToast.endFlow();
          }
        }
      };

      if (parsedProof.protocolVersion === "4.0") {
        assertWorldIdProofHasSubmissionWindow(parsedProof.expiresAtMin);
        await submitAttestation(
          purpose === "presence" ? "attestHumanPresenceWithV4Proof" : "attestWorldCredentialWithV4Proof",
          purpose === "presence"
            ? [kind, parsedProof.nullifierHash, parsedProof.nonce, BigInt(parsedProof.expiresAtMin), parsedProof.proof]
            : [kind, parsedProof.nullifierHash, parsedProof.nonce, BigInt(parsedProof.expiresAtMin), parsedProof.proof],
          purpose === "presence" ? "attest World ID recheck" : "attest World ID credential",
        );
        return;
      }

      if (purpose !== "credential" || kind !== WORLD_CREDENTIAL_PROOF_OF_HUMAN) {
        throw new Error("World ID v3 only supports the Proof of Human credential.");
      }

      await submitAttestation(
        "attestHumanCredentialWithProof",
        [parsedProof.root, parsedProof.nullifierHash, parsedProof.proof],
        "attest World ID credential",
      );
    },
    [
      kind,
      option.identifier,
      proofMode,
      purpose,
      raterRegistryContractData,
      signal,
      writeContractOrBatch,
      writeRaterRegistry,
      canUseBatchedContractWrites,
      canUseSponsoredSubmitCalls,
      flowToast,
    ],
  );

  const start = useCallback(async () => {
    if (!open || !appId || !address || !signal) {
      return;
    }

    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setConnectorURI(null);
    setErrorCode(null);
    setIsAwaitingApproval(false);
    setIsPreparing(true);
    setIsSubmitting(false);
    setMessage(null);
    setStatus("loading");

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
        credential: option.identifier,
        diagnosticId: diagnosticContext.diagnosticId,
        environment: diagnosticContext.environment,
        event,
        phase: extras.phase ?? diagnosticPhase,
        proofMode: diagnosticContext.proofMode ?? proofMode,
        purpose,
        requestId: idkitRequestId,
        rpContextExpiresAt: diagnosticContext.rpContext.expires_at,
        rpId: diagnosticContext.rpContext.rp_id,
        ...extras,
      });
    };

    try {
      const requestContext = await fetchRequestContext();
      diagnosticContext = requestContext;
      diagnosticPhase = "create_request";
      if (activeRequestRef.current !== requestId || abortController.signal.aborted) return;

      const requestBuilder = IDKit.request({
        action: requestContext.action,
        allow_legacy_proofs: (requestContext.proofMode ?? proofMode) !== "v4",
        app_id: appId,
        environment: requestContext.environment,
        ...(purpose === "presence" ? { require_user_presence: true } : {}),
        rp_context: requestContext.rpContext,
      });
      const request =
        (requestContext.proofMode ?? proofMode) === "legacy"
          ? await requestBuilder.preset(orbLegacy({ signal }))
          : await requestBuilder.constraints(
              CredentialRequest(option.identifier, {
                expires_at_min: getWorldIdCredentialRequestExpiresAtMin(purpose),
                signal,
              }),
            );
      idkitRequestId = getWorldIdRequestId(request);
      reportRequestDiagnostic("request_created", {
        connectorScheme: getConnectorScheme(request.connectorURI),
        phase: "poll",
      });
      diagnosticPhase = "poll";
      if (activeRequestRef.current !== requestId || abortController.signal.aborted) return;

      setConnectorURI(request.connectorURI);
      setIsPreparing(false);

      const pollingTimeoutMs = getWorldIdRequestPollingTimeoutMs(requestContext.rpContext);
      if (pollingTimeoutMs !== undefined && pollingTimeoutMs <= 0) {
        setStatus("error");
        setMessage("World ID request expired. Try again with a fresh request.");
        setErrorCode("timeout");
        reportRequestDiagnostic("poll_failed", {
          errorCode: "timeout",
          message: "World ID request expired before polling could start.",
        });
        return;
      }

      const completion = await pollWorldIdRequest(request, {
        onAwaitingConfirmation: value => {
          if (activeRequestRef.current === requestId) setIsAwaitingApproval(value);
        },
        signal: abortController.signal,
        ...(pollingTimeoutMs === undefined ? {} : { timeoutMs: pollingTimeoutMs }),
      });
      if (activeRequestRef.current !== requestId || abortController.signal.aborted) return;

      if (!completion.success) {
        const nextMessage = `World ID returned ${formatWorldIdError(completion.error)}.`;
        setStatus("error");
        setMessage(nextMessage);
        setErrorCode(completion.error);
        reportRequestDiagnostic("poll_failed", {
          errorCode: completion.error,
          message: nextMessage,
        });
        return;
      }

      setIsAwaitingApproval(false);
      setIsSubmitting(true);
      diagnosticPhase = "submit_onchain";
      await submitProof(completion.result, requestContext);
      if (activeRequestRef.current !== requestId || abortController.signal.aborted) return;

      setStatus("success");
      setMessage(purpose === "presence" ? "Fresh recheck recorded." : `${option.shortLabel} credential recorded.`);
      notification.success(purpose === "presence" ? "World ID recheck recorded." : "World ID credential recorded.");
      await onSuccess?.();
      onClose();
    } catch (error) {
      if (activeRequestRef.current !== requestId || abortController.signal.aborted) return;
      const nextMessage = getWorldIdCredentialAttestationErrorMessage(error);
      const nextErrorCode = isWorldIdProofExpiredError(error)
        ? "timeout"
        : isWorldIdCredentialAttestationRejectedError(error)
          ? "user_rejected"
          : "generic_error";
      setStatus("error");
      setMessage(nextMessage);
      setErrorCode(nextErrorCode);
      reportRequestDiagnostic(diagnosticPhase === "create_request" ? "request_create_failed" : "request_exception", {
        errorCode: nextErrorCode,
        message: getWorldIdErrorMessage(error),
      });
    } finally {
      if (activeRequestRef.current === requestId) {
        setIsPreparing(false);
        setIsAwaitingApproval(false);
        setIsSubmitting(false);
      }
    }
  }, [address, appId, fetchRequestContext, onClose, onSuccess, open, option, proofMode, purpose, signal, submitProof]);

  useEffect(() => {
    if (open) return;
    reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open || !unavailableMessage) return;

    autoStartKeyRef.current = null;
    activeRequestRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setConnectorURI(null);
    setErrorCode("generic_error");
    setIsAwaitingApproval(false);
    setIsPreparing(false);
    setIsSubmitting(false);
    setMessage(unavailableMessage);
    setStatus("error");
  }, [open, unavailableMessage]);

  useEffect(() => {
    if (!open || !autoStartKey) return;
    if (autoStartKeyRef.current === autoStartKey) return;

    autoStartKeyRef.current = autoStartKey;
    void start();
  }, [autoStartKey, open, start]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  if (!open) return null;

  const title = purpose === "presence" ? `Recheck ${option.shortLabel}` : `Verify ${option.shortLabel}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={canCancelRequest ? onClose : undefined}
      />
      <div className="surface-card relative w-full max-w-lg rounded-t-2xl p-5 shadow-2xl sm:rounded-2xl">
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3"
          aria-label="Close World ID dialog"
          disabled={!canCancelRequest}
          onClick={onClose}
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        <div className="pr-10">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-base-content/55">
            <QrCodeIcon className="h-4 w-4" />
            World App
          </div>
          <h3 className="mt-2 text-xl font-semibold text-base-content">{title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-base-content/60">
            {purpose === "presence"
              ? "Complete this short-lived proof before submitting the vote."
              : "Complete this credential proof before submitting the vote."}
          </p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
          <div className="mx-auto aspect-square w-48 rounded-2xl border border-base-300 bg-white p-3 shadow-sm sm:w-full">
            {connectorURI ? (
              <WorldIdQrCode data={connectorURI} />
            ) : (
              <div className="flex h-full items-center justify-center text-base-content/35">
                <span className="loading loading-spinner loading-lg" />
              </div>
            )}
          </div>
          <div className="space-y-3">
            <h4 className="text-base font-semibold text-base-content">{panelState.title}</h4>
            <p className="text-sm leading-relaxed text-base-content/60">{message ?? panelState.detail}</p>
            {connectorURI ? (
              <a className="btn btn-secondary btn-sm gap-2" href={connectorURI}>
                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                Open World App
              </a>
            ) : null}
            {status === "error" ? (
              <div className="flex items-start gap-2 rounded-lg bg-error/10 p-3 text-sm text-error">
                <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{message}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-ghost" disabled={!canCancelRequest} onClick={onClose}>
            Cancel
          </button>
          {status === "error" ? (
            <GradientActionButton
              className="sm:min-w-40"
              motion={getGradientActionMotion(isBusy)}
              disabled={isBusy}
              onClick={() => void start()}
            >
              Try again
            </GradientActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
