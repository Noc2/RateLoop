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
      <h2 className="text-xl font-semibold">World ID 4 assurance</h2>
      {status ? (
        <div className="mt-4">
          <WorldIdAssuranceClient verified={status.verified} onVerified={refresh} />
          {status.verifiedAt ? (
            <p className="mt-3 text-xs text-base-content/55">
              Enrolled <time dateTime={status.verifiedAt}>{new Date(status.verifiedAt).toLocaleDateString()}</time>
            </p>
          ) : null}
        </div>
      ) : (
        <p role="status" className="mt-5 text-sm text-base-content/55">
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
