"use client";

import { useCallback, useEffect, useState } from "react";
import { OneTimeSecretNotice } from "./OneTimeSecretNotice";
import { formatEvidenceDeliveryDate, readEvidenceDeliveryJson } from "./evidenceDeliveryClient";

type MetricsCredential = {
  credentialId: string;
  label: string;
  status: "active" | "rotated" | "revoked";
  issuedAt: string;
  lastUsedAt: string | null;
};
type IssuedMetricsCredential = { credential: MetricsCredential; token: string };

export function MetricsEvidenceAccess({ workspaceId }: { workspaceId: string }) {
  const endpoint = `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/metrics/credentials`;
  const [credentials, setCredentials] = useState<MetricsCredential[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    const body = await readEvidenceDeliveryJson<{ credentials: MetricsCredential[] }>(
      await fetch(endpoint, { cache: "no-store", credentials: "same-origin" }),
    );
    setCredentials(body.credentials);
  }, [endpoint]);

  useEffect(() => {
    void load().catch(error => setMessage(error instanceof Error ? error.message : "Unable to load metrics access."));
  }, [load]);

  const revoke = async (credential: MetricsCredential) => {
    setBusy(true);
    setMessage(null);
    try {
      await readEvidenceDeliveryJson(
        await fetch(`${endpoint}/${encodeURIComponent(credential.credentialId)}`, {
          method: "DELETE",
          credentials: "same-origin",
        }),
      );
      await load();
      setMessage("Credential revoked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update metrics access.");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (credential: MetricsCredential) => {
    setBusy(true);
    setMessage(null);
    try {
      const created = await readEvidenceDeliveryJson<IssuedMetricsCredential>(
        await fetch(`${endpoint}/${encodeURIComponent(credential.credentialId)}/rotate`, {
          method: "POST",
          credentials: "same-origin",
        }),
      );
      setOneTimeToken(created.token);
      await load();
      setMessage("Credential rotated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to rotate metrics credential.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface-card-nested rounded-xl p-5" aria-labelledby="metrics-access-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="metrics-access-heading" className="font-semibold">
            Metrics access
          </h3>
          <p className="mt-2 text-sm leading-6 text-base-content/55">
            Manage bearer credentials for the workspace OpenMetrics endpoint.
          </p>
        </div>
        <span className="badge badge-ghost">
          {credentials.filter(credential => credential.status === "active").length} active
        </span>
      </div>
      {credentials.length > 0 ? (
        <div className="mt-4 space-y-3">
          {credentials.map(credential => (
            <article key={credential.credentialId} className="rounded-xl border border-white/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{credential.label}</p>
                  <p className="mt-1 font-mono text-xs text-base-content/45">{credential.credentialId}</p>
                </div>
                <span
                  className={`badge border-0 capitalize ${credential.status === "active" ? "bg-emerald-300/10 text-emerald-100" : "bg-white/[0.06] text-base-content/55"}`}
                >
                  {credential.status}
                </span>
              </div>
              <p className="mt-3 text-xs text-base-content/45">
                Last used: {formatEvidenceDeliveryDate(credential.lastUsedAt)}
              </p>
              {credential.status === "active" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-xs border-white/10 bg-white/[0.06]"
                    disabled={busy || oneTimeToken !== null}
                    onClick={() => void rotate(credential)}
                  >
                    Rotate
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs border-red-300/20 bg-red-300/[0.04] text-red-100"
                    disabled={busy}
                    onClick={() => void revoke(credential)}
                  >
                    Revoke
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/50">No metrics credential has been issued.</p>
      )}
      {oneTimeToken ? (
        <OneTimeSecretNotice
          label="Metrics bearer token"
          value={oneTimeToken}
          onDismiss={() => setOneTimeToken(null)}
        />
      ) : null}
      <form
        className="mt-4 flex flex-col gap-3 rounded-xl border border-white/10 p-4 sm:flex-row sm:items-end"
        onSubmit={event => {
          event.preventDefault();
          setBusy(true);
          setMessage(null);
          void fetch(endpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label }),
          })
            .then(response => readEvidenceDeliveryJson<IssuedMetricsCredential>(response))
            .then(created => {
              setOneTimeToken(created.token);
              return load();
            })
            .then(() => {
              setLabel("");
              setMessage("Credential issued.");
            })
            .catch(error => setMessage(error instanceof Error ? error.message : "Unable to issue metrics credential."))
            .finally(() => setBusy(false));
        }}
      >
        <label className="w-full text-sm text-base-content/65 sm:max-w-md">
          Issue credential
          <input
            className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
            value={label}
            onChange={event => setLabel(event.target.value)}
            placeholder="Security operations"
            required
            maxLength={100}
          />
        </label>
        <button type="submit" className="btn btn-sm rateloop-gradient-action" disabled={busy || oneTimeToken !== null}>
          {busy ? "Issuing…" : "Issue credential"}
        </button>
      </form>
      {message ? (
        <p className="mt-4 text-xs text-base-content/60" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
