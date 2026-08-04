"use client";

import { type FormEvent, useState } from "react";
import { useLocale } from "next-intl";
import { LocalizedSharedContent, UntranslatedContent } from "~~/components/tokenless/LocalizedSharedContent";
import { Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { readJson } from "~~/lib/tokenless/http";

type WorkspaceDeletionPreview = {
  workspace: { workspaceId: string; name: string };
  immediate: boolean;
  blockers: Array<{ code: string; message: string }>;
  impact: {
    otherMembers: number;
    agents: number;
    activeWork: number;
    privateObjects: number;
    retainedPrivateQuotes: number;
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

type WorkspaceDeletionResult =
  | { deleted: true; status: "completed" }
  | {
      deleted: false;
      requestId: string;
      resolutionId: string;
      status: "blocked_by_funds";
    };

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

function usdc(value: string, locale: string) {
  try {
    const amount = BigInt(value);
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Number(amount) / 1_000_000,
    );
  } catch {
    return value;
  }
}

function impactRows(preview: WorkspaceDeletionPreview, locale: string) {
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
    impact.retainedPrivateQuotes
      ? countLabel(
          impact.retainedPrivateQuotes,
          "referenced private quote will remain restricted",
          "referenced private quotes will remain restricted",
        )
      : null,
    impact.publicRecords
      ? countLabel(impact.publicRecords, "public record will remain", "public records will remain")
      : null,
    impact.legalHolds
      ? countLabel(impact.legalHolds, "legal hold delays deletion", "legal holds delay deletion")
      : null,
    hasAtomicValue(impact.settledAtomic) ? `${usdc(impact.settledAtomic, locale)} USDC settled` : null,
    hasAtomicValue(impact.reservedAtomic) ? `${usdc(impact.reservedAtomic, locale)} USDC reserved` : null,
    hasAtomicValue(impact.availableAtomic) ? `${usdc(impact.availableAtomic, locale)} USDC available` : null,
  ].filter((value): value is string => Boolean(value));
}

function requiresFundResolution(preview: WorkspaceDeletionPreview) {
  return preview.blockers.length === 1 && preview.blockers[0]?.code === "workspace_funds_active";
}

export function WorkspaceDeletionPanel({ workspaceId, workspaceName }: WorkspaceDeletionPanelProps) {
  const locale = useLocale();
  const [preview, setPreview] = useState<WorkspaceDeletionPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resolutionQueued, setResolutionQueued] = useState<string | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  async function loadPreview() {
    if (preview || loading) return;
    setLoading(true);
    clear();
    try {
      const body = await readJson<WorkspaceDeletionPreview>(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/deletion`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
      );
      setPreview(body);
    } catch (cause) {
      capture(cause, "Unable to check this workspace.");
    } finally {
      setLoading(false);
    }
  }

  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || (preview.blockers.length > 0 && !requiresFundResolution(preview)) || confirmation !== "DELETE") {
      return;
    }
    setSubmitting(true);
    clear();
    try {
      const result = await readJson<WorkspaceDeletionResult>(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/deletion`, {
          method: "POST",
          body: JSON.stringify({ confirmation }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      if (!result.deleted && result.status === "blocked_by_funds") {
        setResolutionQueued(result.resolutionId);
        setSubmitting(false);
        return;
      }
      window.location.assign("/agents/overview");
    } catch (cause) {
      capture(cause, "Unable to delete this workspace.");
      setSubmitting(false);
    }
  }

  const impacts = preview ? impactRows(preview, locale) : [];
  const confirmed = confirmation === "DELETE";
  const fundResolutionRequired = preview ? requiresFundResolution(preview) : false;
  const canRequest = preview ? preview.blockers.length === 0 || fundResolutionRequired : false;

  return (
    <LocalizedSharedContent>
      <section className="p-5 sm:p-6" aria-labelledby="workspace-deletion-heading">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 id="workspace-deletion-heading" className="font-semibold">
              Delete workspace
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-base-content/65">
              Permanently closes <UntranslatedContent>{workspaceName}</UntranslatedContent> and removes its private
              data. Records that must be retained stay restricted.
            </p>
          </div>
          {!preview ? (
            <button
              type="button"
              className="btn btn-sm shrink-0 border-error/40 bg-base-content/[0.06] text-error hover:border-error/60 hover:bg-error/10"
              onClick={() => void loadPreview()}
              disabled={loading}
            >
              {loading ? "Checking…" : "Delete workspace"}
            </button>
          ) : null}
        </div>

        {preview ? (
          <div className="mt-5 border-t border-error/20 pt-5">
            <h4 className="font-semibold">
              Delete <UntranslatedContent>{preview.workspace.name}</UntranslatedContent>
            </h4>

            <form className="mt-3" onSubmit={requestDeletion}>
              <p className="text-sm leading-6 text-base-content/65">
                {fundResolutionRequired
                  ? "Confirm the request to queue verified fund resolution. The workspace and its balance remain active until an operator records the external refund."
                  : preview.blockers.length > 0
                    ? "Resolve the items below before deleting this workspace."
                    : preview.immediate
                      ? "This workspace has no work or funds. Deletion is immediate."
                      : "The workspace closes immediately. Stored objects are deleted afterward, while required records remain restricted."}
              </p>

              {impacts.length > 0 ? (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-base-content/65">
                  {impacts.map(value => (
                    <li key={value}>
                      <UntranslatedContent>{value}</UntranslatedContent>
                    </li>
                  ))}
                </ul>
              ) : null}

              {preview.warnings.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {preview.warnings.map(warning => (
                    <p key={warning} className="rounded-lg bg-warning/[0.07] p-3 text-sm leading-6 text-warning">
                      <UntranslatedContent>{warning}</UntranslatedContent>
                    </p>
                  ))}
                </div>
              ) : null}

              {preview.blockers.length > 0 ? (
                <div className="mt-4 space-y-2" role="alert">
                  {preview.blockers.map(blocker => (
                    <p key={blocker.code} className="rounded-lg bg-error/10 p-3 text-sm leading-6 text-error">
                      <UntranslatedContent>{blocker.message}</UntranslatedContent>
                    </p>
                  ))}
                </div>
              ) : null}

              {canRequest ? (
                <div className="mt-5">
                  <Field
                    label="Type DELETE to confirm"
                    className="rounded-lg border-base-content/10 bg-[var(--rateloop-field)]"
                    value={confirmation}
                    error={fieldErrors.confirmation}
                    onChange={event => {
                      clear("confirmation");
                      setConfirmation(event.target.value);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              ) : null}

              {resolutionQueued ? (
                <p className="mt-4 rounded-lg bg-success/[0.08] p-3 text-sm text-success" role="status">
                  Fund resolution queued. Your balance has not been forfeited. Reference:{" "}
                  <span className="font-mono text-xs">
                    <UntranslatedContent>{resolutionQueued}</UntranslatedContent>
                  </span>
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                {canRequest ? (
                  <button
                    type="submit"
                    className="btn btn-error min-h-10 px-4"
                    disabled={submitting || !confirmed || Boolean(resolutionQueued)}
                  >
                    {submitting
                      ? fundResolutionRequired
                        ? "Queuing…"
                        : "Deleting…"
                      : fundResolutionRequired
                        ? "Request verified refund"
                        : "Delete workspace"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost min-h-10 px-4"
                  disabled={submitting}
                  onClick={() => {
                    setPreview(null);
                    setConfirmation("");
                    setResolutionQueued(null);
                    clear();
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {formError ? (
          <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
            {formError}
          </p>
        ) : null}
      </section>
    </LocalizedSharedContent>
  );
}
