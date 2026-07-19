"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

export type WorkspaceStopState = {
  workspaceId: string;
  status: "engaged" | "released";
  reason: string;
  engagedBy: string;
  engagedAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
};

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

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

export function WorkspaceStopBanner({ workspaceId }: { workspaceId: string }) {
  const stop = useWorkspaceStopState(workspaceId, 0);
  if (stop?.status !== "engaged") return null;
  return (
    <div className="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-sm leading-6 text-red-100" role="alert">
      <p className="font-semibold">All agent activity is stopped for this workspace.</p>
      <p className="mt-1 text-red-100/80">
        Stopped {new Date(stop.engagedAt).toLocaleString()} — {stop.reason}. New outputs stay blocked and no
        review-triggered release can occur. Releasing the stop resumes nothing automatically; each agent needs a fresh
        publishing grant.
      </p>
    </div>
  );
}

export function WorkspaceStopPanel({ workspaceId }: { workspaceId: string }) {
  const [revision, setRevision] = useState(0);
  const stop = useWorkspaceStopState(workspaceId, revision);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  async function engage(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setError("A reason is required to stop all agent activity.");
      return;
    }
    setBusy(true);
    setError(null);
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
      setError(cause instanceof Error ? cause.message : "Unable to stop agent activity.");
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/stop`, {
          method: "DELETE",
          credentials: "same-origin",
        }),
      );
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to release the stop.");
    } finally {
      setBusy(false);
    }
  }

  const engaged = stop?.status === "engaged";
  return (
    <section className="p-5 sm:p-6" aria-labelledby="workspace-stop-heading">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id="workspace-stop-heading" className="font-semibold">
            Stop all agent activity
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-base-content/65">
            Blocks new outputs and holds gated work undelivered. Agents do not restart when the stop is released; each
            needs a fresh publishing grant.
          </p>
        </div>
        {!engaged && !confirming ? (
          <button
            type="button"
            className="btn btn-sm shrink-0 border-red-400/40 bg-base-content/[0.06] text-red-200 hover:border-red-400/60 hover:bg-red-400/10"
            onClick={() => setConfirming(true)}
          >
            Stop all agent activity
          </button>
        ) : null}
      </div>

      {engaged && stop ? (
        <div className="mt-4 rounded-xl bg-red-400/10 p-4 text-sm leading-6 text-red-100" role="status">
          <p className="font-semibold">Stop engaged {new Date(stop.engagedAt).toLocaleString()}</p>
          <p className="mt-1 text-red-100/80">Reason: {stop.reason}</p>
          <button type="button" className="btn btn-outline btn-sm mt-3" onClick={release} disabled={busy}>
            Release stop (agents stay halted until re-granted)
          </button>
        </div>
      ) : confirming ? (
        <form className="mt-4 max-w-xl" onSubmit={engage}>
          <label className="text-sm text-base-content/65" htmlFor="workspace-stop-reason">
            Give a reason. It will be recorded in the audit chain.
          </label>
          <textarea
            id="workspace-stop-reason"
            className="textarea mt-2 w-full border-red-400/40 bg-[var(--rateloop-field)]"
            value={reason}
            onChange={event => setReason(event.target.value)}
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
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg bg-red-400/10 p-3 text-sm text-red-100" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
