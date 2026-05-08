"use client";

import { useCallback, useMemo, useState } from "react";
import { CredentialRequest, IDKitRequestWidget, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { CheckCircleIcon, ExclamationTriangleIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { getWorldIdClientConfig } from "~~/lib/world-id/config";

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

function formatWorldIdError(errorCode: string) {
  return errorCode.replace(/_/g, " ");
}

function getWorldIdSignal(configuredSignal: string | undefined, address: string | undefined) {
  if (configuredSignal) {
    return configuredSignal;
  }

  return address?.toLowerCase() ?? "";
}

export function WorldIdVerificationCard({ address }: { address?: string }) {
  const config = getWorldIdClientConfig();
  const [open, setOpen] = useState(false);
  const [rpContextResponse, setRpContextResponse] = useState<RpContextResponse | null>(null);
  const [verificationState, setVerificationState] = useState<VerificationState>({ status: "idle" });
  const appId = config.appId?.startsWith("app_") ? (config.appId as `app_${string}`) : null;
  const signal = getWorldIdSignal(config.signal, address);
  const constraints = useMemo(() => CredentialRequest("proof_of_human", { signal }), [signal]);
  const isConfigured = Boolean(appId && config.enabled);
  const canVerify = Boolean(isConfigured && address);

  const prepareWorldIdRequest = useCallback(async () => {
    setVerificationState({ status: "loading" });

    const response = await fetch("/api/world-id/rp-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const body = (await response.json().catch(() => ({}))) as Partial<RpContextResponse> & { error?: string };

    if (!response.ok || !body.rpContext || !body.action || !body.environment) {
      throw new Error(body.error ?? "World ID is not ready for this deployment.");
    }

    setRpContextResponse({
      action: body.action,
      environment: body.environment,
      rpContext: body.rpContext,
    });
    setOpen(true);
  }, []);

  const handleVerify = useCallback(
    async (idkitResponse: IDKitResult) => {
      const response = await fetch("/api/world-id/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idkitResponse, signal }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "World ID verification failed.");
      }
    },
    [signal],
  );

  const handleSuccess = useCallback(async (result: IDKitResult) => {
    const nullifier =
      "session_id" in result
        ? result.session_id
        : (result.responses.find(response => "nullifier" in response)?.nullifier ?? null);
    const verifiedAt = new Date().toISOString();
    setVerificationState({ status: "verified", nullifier, verifiedAt });
    setOpen(false);

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
  }, []);

  const handleStart = useCallback(async () => {
    try {
      await prepareWorldIdRequest();
    } catch (error) {
      setVerificationState({
        status: "error",
        message: error instanceof Error ? error.message : "World ID is not ready for this deployment.",
      });
    }
  }, [prepareWorldIdRequest]);

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
            Add an optional World ID proof to this wallet. Rating, rewards, and governance stay open without it.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:min-w-56">
          <button
            type="button"
            className="btn btn-primary gap-2"
            disabled={!canVerify || verificationState.status === "loading"}
            onClick={() => void handleStart()}
          >
            <ShieldCheckIcon className="h-5 w-5" />
            {verificationState.status === "loading" ? "Preparing..." : "Verify with World ID"}
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

      {appId && rpContextResponse ? (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={appId}
          action={rpContextResponse.action}
          rp_context={rpContextResponse.rpContext}
          allow_legacy_proofs={false}
          constraints={constraints}
          environment={rpContextResponse.environment}
          handleVerify={handleVerify}
          onError={errorCode => {
            setVerificationState({ status: "error", message: `World ID returned ${formatWorldIdError(errorCode)}.` });
          }}
          onSuccess={handleSuccess}
        />
      ) : null}
    </section>
  );
}
