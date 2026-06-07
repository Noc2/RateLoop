"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CredentialRequest, IDKit, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { ArrowTopRightOnSquareIcon, ExclamationTriangleIcon, QrCodeIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { WorldIdQrCode } from "~~/components/settings/WorldIdQrCode";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { getWorldIdClientConfig } from "~~/lib/world-id/config";
import {
  type WorldCredentialKind,
  type WorldIdProofPurpose,
  getWorldCredentialOption,
  getWorldIdSignalForPurpose,
} from "~~/lib/world-id/credentials";
import { parseWorldIdProof } from "~~/lib/world-id/onchainProof";
import {
  assertWorldIdProofHasSubmissionWindow,
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

type RpContextResponse = {
  action: string;
  environment: "production" | "staging";
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
  const [connectorURI, setConnectorURI] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isAwaitingApproval, setIsAwaitingApproval] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [status, setStatus] = useState<DialogStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const activeRequestRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { writeContractAsync: writeRaterRegistry, isMining } = useScaffoldWriteContract({
    contractName: "RaterRegistry",
  });

  const option = getWorldCredentialOption(kind);
  const appId = config.appId?.startsWith("app_") ? (config.appId as `app_${string}`) : null;
  const signal = useMemo(
    () => (address ? getWorldIdSignalForPurpose(address, kind, purpose) : ""),
    [address, kind, purpose],
  );
  const isBusy = isPreparing || isAwaitingApproval || isSubmitting || isMining;
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
      environment: body.environment,
      purpose,
      rpContext: body.rpContext,
    };
  }, [purpose]);

  const submitProof = useCallback(
    async (result: IDKitResult, requestContext: RpContextResponse) => {
      const parsedProof = parseWorldIdProof(result, {
        expectedAction: requestContext.action,
        expectedCredential: option.identifier,
        expectedSignal: signal,
      });
      assertWorldIdProofHasSubmissionWindow(parsedProof.expiresAtMin);

      await (writeRaterRegistry as any)(
        {
          functionName: purpose === "presence" ? "attestHumanPresenceWithV4Proof" : "attestWorldCredentialWithV4Proof",
          args:
            purpose === "presence"
              ? [
                  kind,
                  parsedProof.nullifierHash,
                  parsedProof.nonce,
                  BigInt(parsedProof.expiresAtMin),
                  parsedProof.proof,
                ]
              : [
                  kind,
                  parsedProof.nullifierHash,
                  parsedProof.nonce,
                  BigInt(parsedProof.expiresAtMin),
                  parsedProof.proof,
                ],
        },
        {
          action: purpose === "presence" ? "attest World ID recheck" : "attest World ID credential",
          getErrorMessage: getWorldIdCredentialAttestationErrorMessage,
          suppressSuccessToast: true,
        },
      );
    },
    [kind, option.identifier, purpose, signal, writeRaterRegistry],
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

    try {
      const requestContext = await fetchRequestContext();
      if (activeRequestRef.current !== requestId || abortController.signal.aborted) return;

      const request = await IDKit.request({
        action: requestContext.action,
        allow_legacy_proofs: false,
        app_id: appId,
        environment: requestContext.environment,
        ...(purpose === "presence" ? { require_user_presence: true } : {}),
        rp_context: requestContext.rpContext,
      }).constraints(CredentialRequest(option.identifier, { signal }));
      if (activeRequestRef.current !== requestId || abortController.signal.aborted) return;

      setConnectorURI(request.connectorURI);
      setIsPreparing(false);

      const pollingTimeoutMs = getWorldIdRequestPollingTimeoutMs(requestContext.rpContext);
      if (pollingTimeoutMs !== undefined && pollingTimeoutMs <= 0) {
        setStatus("error");
        setMessage("World ID request expired. Try again with a fresh request.");
        setErrorCode("timeout");
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
        return;
      }

      setIsAwaitingApproval(false);
      setIsSubmitting(true);
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
      setStatus("error");
      setMessage(nextMessage);
      setErrorCode(isWorldIdProofExpiredError(error) ? "timeout" : "generic_error");
    } finally {
      if (activeRequestRef.current === requestId) {
        setIsPreparing(false);
        setIsAwaitingApproval(false);
        setIsSubmitting(false);
      }
    }
  }, [address, appId, fetchRequestContext, onClose, onSuccess, open, option, purpose, signal, submitProof]);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    void start();
  }, [open, reset, start]);

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
        onClick={isBusy ? undefined : onClose}
      />
      <div className="surface-card relative w-full max-w-lg rounded-t-2xl p-5 shadow-2xl sm:rounded-2xl">
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3"
          aria-label="Close World ID dialog"
          disabled={isBusy}
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
          <button type="button" className="btn btn-ghost" disabled={isBusy} onClick={onClose}>
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
