"use client";

import { useState } from "react";
import { CredentialRequest, IDKitRequestWidget, type IDKitResult, type RpContext } from "@worldcoin/idkit";

type WorldIdContext = {
  requestId: string;
  mode: "initial_unique";
  appId: `app_${string}`;
  action?: string;
  environment: "production" | "staging";
  signal: string;
  credentialExpiresAtMin: number;
  rpContext: RpContext;
};

type Props = {
  verified: boolean;
  onVerified: () => Promise<void>;
};

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : "World ID assurance failed.",
    );
  }
  return body;
}

export function WorldIdAssuranceClient({ verified, onVerified }: Props) {
  const [context, setContext] = useState<WorldIdContext | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const body = (await readJson(
        await fetch("/api/rater/assurance/world-id/context", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      )) as WorldIdContext;
      setContext(body);
      setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start World ID assurance.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(result: IDKitResult) {
    await readJson(
      await fetch("/api/rater/assurance/world-id/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      }),
    );
  }

  async function completed() {
    setOpen(false);
    setContext(null);
    setError(null);
    await onVerified();
  }

  return (
    <div className="border-l-2 border-sky-300 pl-4 sm:col-span-2">
      <span className="text-xs text-base-content/45">RateLoop-network assurance</span>
      <strong className="mt-1 block">{verified ? "Unique human verified" : "World ID Proof of Human required"}</strong>
      <p className="mt-2 text-xs leading-5 text-base-content/55">
        This adds a provider-scoped uniqueness assertion for network panels. It does not replace legal, tax, sanctions,
        age, or payout checks. Verification is a one-time enrollment bound to this RateLoop account. It records that a
        unique World ID verified during enrollment; it is not an ongoing liveness or credential-validity check.
      </p>
      {!verified ? (
        <button
          type="button"
          className="mt-3 rounded-md border border-white/15 px-3 py-2 text-xs font-medium text-base-content/80 transition hover:border-white/30 disabled:opacity-50"
          disabled={busy}
          onClick={() => void begin()}
        >
          {busy ? "Preparing World ID…" : "Verify with World ID"}
        </button>
      ) : null}
      {error ? <p className="mt-3 text-xs leading-5 text-red-200">{error}</p> : null}
      {context?.mode === "initial_unique" && context.action ? (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={context.appId}
          action={context.action}
          rp_context={context.rpContext}
          environment={context.environment}
          allow_legacy_proofs={false}
          constraints={CredentialRequest("proof_of_human", {
            signal: context.signal,
            expires_at_min: context.credentialExpiresAtMin,
          })}
          handleVerify={verify}
          onSuccess={completed}
          onError={code => setError(`World ID could not complete this request (${code}).`)}
        />
      ) : null}
    </div>
  );
}
