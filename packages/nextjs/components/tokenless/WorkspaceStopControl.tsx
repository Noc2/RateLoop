"use client";

import { type FormEvent, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { notifyWorkspaceStopChanged, subscribeWorkspaceStop, workspaceStopRevision } from "./workspaceStopSync";
import { useLocale } from "next-intl";
import { LocalizedSharedContent, UntranslatedContent } from "~~/components/tokenless/LocalizedSharedContent";
import { TextareaField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { ConfirmDialog } from "~~/components/tokenless/ui/ConfirmDialog";
import { readJson } from "~~/lib/tokenless/http";

export type WorkspaceStopState = {
  workspaceId: string;
  status: "engaged" | "released";
  reason: string;
  engagedBy: string;
  engagedAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
};

function useWorkspaceStopState(workspaceId: string, revision: number) {
  const [stop, setStop] = useState<WorkspaceStopState | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const body = await readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/stop`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
        );
        if (!controller.signal.aborted) setStop((body.stop as WorkspaceStopState | null) ?? null);
      } catch {
        // The banner and card fail closed to their non-blocking default; the
        // stop itself is enforced server-side regardless of this read.
      }
    })();
    return () => controller.abort();
  }, [workspaceId, revision]);
  return stop;
}

function useWorkspaceStopRevision(workspaceId: string) {
  const subscribe = useCallback((listener: () => void) => subscribeWorkspaceStop(workspaceId, listener), [workspaceId]);
  const getSnapshot = useCallback(() => workspaceStopRevision(workspaceId), [workspaceId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

export function WorkspaceStopBanner({ workspaceId }: { workspaceId: string }) {
  const locale = useLocale();
  const revision = useWorkspaceStopRevision(workspaceId);
  const stop = useWorkspaceStopState(workspaceId, revision);
  if (stop?.status !== "engaged") return null;
  return (
    <LocalizedSharedContent>
      <div className="rounded-xl border border-error/40 bg-error/10 p-4 text-sm leading-6 text-error" role="alert">
        <p className="font-semibold">All agent activity is stopped for this workspace.</p>
        <p className="mt-1 text-error/80">
          {/* The reason is operator-written free text. Unwrapped it goes through the
              phrase catalogue, whose miss path does longest-first substring
              replacement — so an English word inside a German reason, or vice
              versa, comes back mangled. The banner below already guards it. */}
          Stopped {new Date(stop.engagedAt).toLocaleString(locale)} —{" "}
          <UntranslatedContent>{stop.reason}</UntranslatedContent>. New outputs stay blocked and no review-triggered
          release can occur.
        </p>
      </div>
    </LocalizedSharedContent>
  );
}

export function WorkspaceStopPanel({ workspaceId }: { workspaceId: string }) {
  const locale = useLocale();
  const revision = useWorkspaceStopRevision(workspaceId);
  const stop = useWorkspaceStopState(workspaceId, revision);
  const [confirming, setConfirming] = useState(false);
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { capture, clear, fieldErrors, formError } = useFormErrors();
  const refresh = useCallback(() => notifyWorkspaceStopChanged(workspaceId), [workspaceId]);

  async function engage(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      capture(
        { field: "reason", message: "A reason is required to stop all agent activity." },
        "A reason is required.",
      );
      return;
    }
    setBusy(true);
    clear();
    try {
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/stop`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        }),
      );
      setConfirming(false);
      setReason("");
      refresh();
    } catch (cause) {
      capture(cause, "Unable to stop agent activity.");
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setBusy(true);
    clear();
    try {
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/stop`, {
          method: "DELETE",
          credentials: "same-origin",
        }),
      );
      setConfirmingRelease(false);
      refresh();
    } catch (cause) {
      capture(cause, "Unable to release the stop.");
    } finally {
      setBusy(false);
    }
  }

  const engaged = stop?.status === "engaged";
  return (
    <LocalizedSharedContent>
      <section className="p-5 sm:p-6" aria-labelledby="workspace-stop-heading">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 id="workspace-stop-heading" className="font-semibold">
              Stop all agent activity
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-base-content/65">
              Blocks new outputs and holds gated work undelivered.
            </p>
          </div>
          {!engaged && !confirming ? (
            <button
              type="button"
              className="btn btn-sm shrink-0 border-error/40 bg-base-content/[0.06] text-error hover:border-error/60 hover:bg-error/10"
              onClick={() => setConfirming(true)}
            >
              Stop all agent activity
            </button>
          ) : null}
        </div>

        {engaged && stop ? (
          <div className="mt-4 rounded-xl bg-error/10 p-4 text-sm leading-6 text-error" role="status">
            <p className="font-semibold">
              Stop engaged <time dateTime={stop.engagedAt}>{new Date(stop.engagedAt).toLocaleString(locale)}</time>
            </p>
            <p className="mt-1 text-error/80">
              Reason: <UntranslatedContent>{stop.reason}</UntranslatedContent>
            </p>
            <p className="mt-1 text-error/80">
              Agents do not restart when this stop is released. Each agent needs a fresh publishing grant.
            </p>
            <button
              type="button"
              className="btn btn-outline btn-sm mt-3"
              onClick={() => setConfirmingRelease(true)}
              disabled={busy}
            >
              Release stop
            </button>
          </div>
        ) : confirming ? (
          <form className="mt-4 max-w-xl" onSubmit={engage}>
            <TextareaField
              id="workspace-stop-reason"
              label="Give a reason. It will be recorded in the audit chain."
              className="textarea mt-2 w-full border-error/40 bg-[var(--rateloop-field)]"
              value={reason}
              error={fieldErrors.reason}
              onChange={event => {
                clear("reason");
                setReason(event.target.value);
              }}
              maxLength={2000}
              rows={3}
              required
            />
            <div className="mt-3 flex gap-3">
              <button type="submit" className="btn btn-error btn-sm" disabled={busy || !reason.trim()}>
                Confirm: stop all agent activity
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setConfirming(false);
                  clear();
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {formError ? (
          <p className="mt-3 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
            {formError}
          </p>
        ) : null}
        <ConfirmDialog
          open={confirmingRelease}
          title="Release this workspace stop?"
          description="Confirm that you want to release the workspace stop."
          confirmLabel="Release stop"
          busy={busy}
          destructive={false}
          onCancel={() => setConfirmingRelease(false)}
          onConfirm={() => void release()}
        />
      </section>
    </LocalizedSharedContent>
  );
}
