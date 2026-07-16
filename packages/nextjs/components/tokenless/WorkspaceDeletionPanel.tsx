"use client";

import { type FormEvent, useState } from "react";

type WorkspaceDeletionPreview = {
  workspace: { workspaceId: string; name: string };
  immediate: boolean;
  blockers: Array<{ code: string; message: string }>;
  impact: {
    otherMembers: number;
    agents: number;
    activeWork: number;
    privateObjects: number;
    publicRecords: number;
    legalHolds: number;
    settledAtomic: string;
    reservedAtomic: string;
    availableAtomic: string;
  };
  warnings: string[];
};

type WorkspaceDeletionPanelProps = {
  workspaceId: string;
  workspaceName: string;
};

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : "The deletion request failed.",
    );
  }
  return body;
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function hasAtomicValue(value: string) {
  try {
    return BigInt(value) !== 0n;
  } catch {
    return true;
  }
}

function usdc(value: string) {
  try {
    const amount = BigInt(value);
    const sign = amount < 0n ? "-" : "";
    const absolute = amount < 0n ? -amount : amount;
    const whole = absolute / 1_000_000n;
    const fraction = absolute % 1_000_000n;
    return `${sign}${whole.toString()}.${fraction.toString().padStart(6, "0").slice(0, 2)}`;
  } catch {
    return value;
  }
}

function impactRows(preview: WorkspaceDeletionPreview) {
  const { impact } = preview;
  return [
    impact.otherMembers
      ? countLabel(impact.otherMembers, "other member will lose access", "other members will lose access")
      : null,
    impact.agents ? countLabel(impact.agents, "agent will be disconnected", "agents will be disconnected") : null,
    impact.activeWork ? countLabel(impact.activeWork, "active task must finish", "active tasks must finish") : null,
    impact.privateObjects
      ? countLabel(impact.privateObjects, "private object will be deleted", "private objects will be deleted")
      : null,
    impact.publicRecords
      ? countLabel(impact.publicRecords, "public record will remain", "public records will remain")
      : null,
    impact.legalHolds
      ? countLabel(impact.legalHolds, "legal hold delays deletion", "legal holds delay deletion")
      : null,
    hasAtomicValue(impact.settledAtomic) ? `${usdc(impact.settledAtomic)} USDC settled` : null,
    hasAtomicValue(impact.reservedAtomic) ? `${usdc(impact.reservedAtomic)} USDC reserved` : null,
    hasAtomicValue(impact.availableAtomic) ? `${usdc(impact.availableAtomic)} USDC available` : null,
  ].filter((value): value is string => Boolean(value));
}

export function WorkspaceDeletionPanel({ workspaceId, workspaceName }: WorkspaceDeletionPanelProps) {
  const [preview, setPreview] = useState<WorkspaceDeletionPreview | null>(null);
  const [confirmationName, setConfirmationName] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    if (preview || loading) return;
    setLoading(true);
    setError(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/deletion`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
      );
      setPreview(body as unknown as WorkspaceDeletionPreview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to check this workspace.");
    } finally {
      setLoading(false);
    }
  }

  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || preview.blockers.length > 0 || confirmationName !== preview.workspace.name) return;
    setSubmitting(true);
    setError(null);
    try {
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/deletion`, {
          method: "POST",
          body: JSON.stringify({ confirmationName }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      window.location.assign("/agents");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete this workspace.");
      setSubmitting(false);
    }
  }

  const impacts = preview ? impactRows(preview) : [];
  const confirmed = preview ? confirmationName === preview.workspace.name : false;

  return (
    <details
      className="surface-card rounded-2xl p-5"
      onToggle={event => {
        if (event.currentTarget.open) void loadPreview();
      }}
    >
      <summary className="cursor-pointer text-sm font-semibold text-base-content/65">Delete workspace</summary>
      <div className="mt-5 border-t border-white/10 pt-5">
        <h2 className="text-lg font-semibold">Delete {preview?.workspace.name ?? workspaceName}</h2>
        {loading ? (
          <p className="mt-3 text-sm text-base-content/55" role="status">
            <span className="loading loading-spinner loading-xs mr-2" /> Checking workspace…
          </p>
        ) : null}

        {preview ? (
          <form className="mt-3" onSubmit={requestDeletion}>
            <p className="text-sm leading-6 text-base-content/65">
              {preview.blockers.length > 0
                ? "Resolve the items below before deleting this workspace."
                : preview.immediate
                  ? "This workspace has no work or funds. Deletion is immediate."
                  : "The workspace closes immediately. Stored objects are deleted afterward, while required records remain restricted."}
            </p>

            {impacts.length > 0 ? (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-base-content/65">
                {impacts.map(value => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            ) : null}

            {preview.warnings.length > 0 ? (
              <div className="mt-4 space-y-2">
                {preview.warnings.map(warning => (
                  <p key={warning} className="rounded-lg bg-amber-300/[0.07] p-3 text-sm leading-6 text-amber-50">
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}

            {preview.blockers.length > 0 ? (
              <div className="mt-4 space-y-2" role="alert">
                {preview.blockers.map(blocker => (
                  <p key={blocker.code} className="rounded-lg bg-red-400/10 p-3 text-sm leading-6 text-red-100">
                    {blocker.message}
                  </p>
                ))}
              </div>
            ) : null}

            {preview.blockers.length === 0 ? (
              <>
                <label className="mt-5 block text-sm text-base-content/65">
                  Type <span className="font-semibold text-base-content">{preview.workspace.name}</span> to confirm
                  <input
                    className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                    value={confirmationName}
                    onChange={event => setConfirmationName(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <button type="submit" className="btn btn-error mt-4 min-h-10 px-4" disabled={submitting || !confirmed}>
                  {submitting ? "Deleting…" : "Delete workspace"}
                </button>
              </>
            ) : null}
          </form>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
