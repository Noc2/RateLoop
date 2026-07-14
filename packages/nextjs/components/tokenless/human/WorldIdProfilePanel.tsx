"use client";

import { useCallback, useEffect, useState } from "react";
import { WorldIdAssuranceClient } from "~~/components/tokenless/WorldIdAssuranceClient";

type WorldIdStatus = {
  verified: boolean;
  providerId: string;
  validityModel: string | null;
  verifiedAt: string | null;
};

async function readStatus() {
  const response = await fetch("/api/rater/assurance/world-id/status", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.message === "string" ? body.message : "Unable to load World ID assurance.");
  }
  return body as WorldIdStatus;
}

export function WorldIdProfilePanel() {
  const [status, setStatus] = useState<WorldIdStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setStatus(await readStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load World ID assurance.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="surface-card rounded-2xl p-6">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Proof of Human</p>
      <h2 className="mt-2 text-xl font-semibold">World ID 4 assurance</h2>
      <p className="mt-3 text-sm leading-6 text-base-content/60">
        Browser sign-in, Proof of Human, and paid-work eligibility are separate checks. World ID records a one-time,
        provider-scoped uniqueness enrollment for RateLoop-network panels; it is not ongoing liveness or legal
        eligibility.
      </p>
      {status ? (
        <div className="mt-5">
          <WorldIdAssuranceClient verified={status.verified} onVerified={refresh} />
          {status.verifiedAt ? (
            <p className="mt-3 text-xs text-base-content/45">
              Enrolled <time dateTime={status.verifiedAt}>{new Date(status.verifiedAt).toLocaleDateString()}</time>
            </p>
          ) : null}
        </div>
      ) : (
        <p role="status" className="mt-5 text-sm text-base-content/50">
          Loading Proof of Human status…
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </section>
  );
}
