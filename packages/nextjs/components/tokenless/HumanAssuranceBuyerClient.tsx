"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Workspace = { workspaceId: string; name: string; role: string };
type Project = {
  projectId: string;
  name: string;
  description: string | null;
  dataClassification: string;
  status: string;
  retentionDays: number;
  suiteCount: number;
  runCount: number;
  updatedAt: string;
};

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.message === "string" ? body.message : "The assurance request failed.");
  }
  return body;
}

export function HumanAssuranceBuyerClient() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [projectName, setProjectName] = useState("AI support quality loop");
  const [caseTitle, setCaseTitle] = useState("Routine refund request");
  const [criterion, setCriterion] = useState(
    "Which response is more accurate, clear, useful, and aligned with the declared support policy?",
  );
  const [baseline, setBaseline] = useState("");
  const [candidate, setCandidate] = useState("");
  const [dataClassification, setDataClassification] = useState<"internal" | "confidential">("internal");
  const [retentionDays, setRetentionDays] = useState(30);
  const [confirmedRedacted, setConfirmedRedacted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ manifestHash: string; projectId: string; suiteId: string } | null>(null);

  const loadProjects = useCallback(async (nextWorkspaceId: string) => {
    if (!nextWorkspaceId) {
      setProjects([]);
      return;
    }
    const body = await readJson(
      await fetch(`/api/account/workspaces/${encodeURIComponent(nextWorkspaceId)}/assurance/projects`, {
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
    setProjects(body.projects as Project[]);
  }, []);

  const loadWorkspaces = useCallback(async () => {
    const body = await readJson(
      await fetch("/api/account/workspaces", { cache: "no-store", credentials: "same-origin" }),
    );
    const next = body.workspaces as Workspace[];
    setWorkspaces(next);
    setWorkspaceId(current =>
      current && next.some(item => item.workspaceId === current) ? current : (next[0]?.workspaceId ?? ""),
    );
  }, []);

  useEffect(() => {
    void loadWorkspaces().catch(cause =>
      setError(cause instanceof Error ? cause.message : "Sign in to load buyer workspaces."),
    );
  }, [loadWorkspaces]);

  useEffect(() => {
    void loadProjects(workspaceId).catch(cause =>
      setError(cause instanceof Error ? cause.message : "Unable to load assurance projects."),
    );
  }, [loadProjects, workspaceId]);

  const ready = useMemo(
    () =>
      Boolean(
        workspaceId &&
          projectName.trim() &&
          caseTitle.trim() &&
          criterion.trim().length >= 10 &&
          baseline.trim() &&
          candidate.trim() &&
          baseline.trim() !== candidate.trim() &&
          confirmedRedacted,
      ),
    [baseline, candidate, caseTitle, confirmedRedacted, criterion, projectName, workspaceId],
  );

  async function createWorkspace() {
    setBusy(true);
    setError(null);
    try {
      const body = await readJson(
        await fetch("/api/account/workspaces", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: workspaceName }),
        }),
      );
      setWorkspaceName("");
      await loadWorkspaces();
      setWorkspaceId(String(body.workspaceId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function createPilot(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/pilots`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectName,
            caseTitle,
            criterion,
            baseline,
            candidate,
            dataClassification,
            retentionDays,
            confirmedRedacted,
          }),
        }),
      );
      setCreated({
        manifestHash: String(body.manifestHash),
        projectId: String(body.projectId),
        suiteId: String(body.suiteId),
      });
      setBaseline("");
      setCandidate("");
      setConfirmedRedacted(false);
      await loadProjects(workspaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the assurance suite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <div className="max-w-4xl border-l-2 border-[var(--rateloop-blue)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Buyer workspace</p>
        <h1 className="display-section mt-3 text-4xl sm:text-5xl">Validate an AI-enabled workflow</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-base-content/60">
          Freeze a baseline, a candidate, and the quality rule before reviewers see either result. The current isolated
          release creates a private, reusable suite; reviewer configuration and funding remain a separate approval step.
        </p>
      </div>

      <div className="mt-10 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form className="rateloop-surface-card space-y-7 p-5 sm:p-7" onSubmit={createPilot}>
          <fieldset>
            <legend className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">
              01 · Decision context
            </legend>
            {workspaces.length ? (
              <label className="mt-4 block text-sm text-base-content/60">
                Client-isolated workspace
                <select
                  className="select mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={workspaceId}
                  onChange={event => setWorkspaceId(event.target.value)}
                >
                  {workspaces.map(workspace => (
                    <option key={workspace.workspaceId} value={workspace.workspaceId}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="mt-4 rounded-lg border border-white/10 p-4">
                <p className="text-sm leading-6 text-base-content/60">
                  Sign in with Base Account from the header, then create a client-isolated workspace.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    className="input min-w-0 flex-1 rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                    value={workspaceName}
                    onChange={event => setWorkspaceName(event.target.value)}
                    placeholder="Client or team workspace"
                    maxLength={120}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !workspaceName.trim()}
                    onClick={() => void createWorkspace()}
                  >
                    Create
                  </button>
                </div>
              </div>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-base-content/60">
                Project
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={projectName}
                  onChange={event => setProjectName(event.target.value)}
                  maxLength={160}
                />
              </label>
              <label className="text-sm text-base-content/60">
                Representative case
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={caseTitle}
                  onChange={event => setCaseTitle(event.target.value)}
                  maxLength={200}
                />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
              02 · Blinded comparison
            </legend>
            <label className="mt-4 block text-sm text-base-content/60">
              Frozen quality criterion
              <textarea
                className="textarea mt-2 min-h-24 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                value={criterion}
                onChange={event => setCriterion(event.target.value)}
                maxLength={500}
              />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-base-content/60">
                Current baseline
                <textarea
                  className="textarea mt-2 min-h-48 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={baseline}
                  onChange={event => setBaseline(event.target.value)}
                  maxLength={25_000}
                  placeholder="Paste a redacted example from the current workflow."
                />
              </label>
              <label className="text-sm text-base-content/60">
                Candidate workflow
                <textarea
                  className="textarea mt-2 min-h-48 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={candidate}
                  onChange={event => setCandidate(event.target.value)}
                  maxLength={25_000}
                  placeholder="Paste the corresponding redacted AI-enabled output."
                />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
              03 · Privacy and retention
            </legend>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-base-content/60">
                Classification
                <select
                  className="select mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={dataClassification}
                  onChange={event => setDataClassification(event.target.value as "internal" | "confidential")}
                >
                  <option value="internal">Internal, redacted</option>
                  <option value="confidential">Confidential, redacted</option>
                </select>
              </label>
              <label className="text-sm text-base-content/60">
                Retention
                <select
                  className="select mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={retentionDays}
                  onChange={event => setRetentionDays(Number(event.target.value))}
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </label>
            </div>
            <label className="mt-4 flex items-start gap-3 rounded-lg border border-white/10 p-4 text-sm leading-6 text-base-content/65">
              <input
                type="checkbox"
                className="checkbox mt-1"
                checked={confirmedRedacted}
                onChange={event => setConfirmedRedacted(event.target.checked)}
              />
              <span>
                I removed secrets, credentials, special-category personal data, and details reviewers do not need.
              </span>
            </label>
          </fieldset>

          <button type="submit" className="rateloop-gradient-action w-full px-6" disabled={busy || !ready}>
            {busy ? "Encrypting and freezing…" : "Create private evaluation suite"}
          </button>
          {error ? <p className="rounded-lg bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
          {created ? (
            <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-50">
              <p className="font-semibold">Suite frozen successfully.</p>
              <p className="mt-2 break-all font-mono text-xs text-emerald-100/70">{created.manifestHash}</p>
              <p className="mt-2 text-emerald-50/75">
                Next: choose customer-invited, RateLoop network, hybrid, or sandbox reviewers and approve the exact run
                manifest before collection starts.
              </p>
            </div>
          ) : null}
        </form>

        <aside className="space-y-5 lg:sticky lg:top-24">
          <section className="rateloop-surface-card p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">Reviewer modes</p>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-base-content/60">
              <li>
                <strong className="text-base-content">Bring your own people:</strong> named employees, customers, or
                experts.
              </li>
              <li>
                <strong className="text-base-content">RateLoop network:</strong> an external paid panel with disclosed
                qualifications.
              </li>
              <li>
                <strong className="text-base-content">Hybrid:</strong> separate invited and external results, never one
                opaque score.
              </li>
              <li>
                <strong className="text-base-content">Sandbox:</strong> simulated test data, never human evidence.
              </li>
            </ul>
          </section>
          <section className="rateloop-surface-card p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">Recent projects</p>
                <h2 className="mt-2 text-xl font-semibold">Quality loops</h2>
              </div>
              <Link href="/settings/workspace" className="text-xs underline underline-offset-4">
                Settings
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {projects.slice(0, 5).map(project => (
                <div key={project.projectId} className="rounded-lg border border-white/10 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{project.name}</span>
                    <span className="font-mono text-[10px] uppercase text-base-content/40">{project.status}</span>
                  </div>
                  <p className="mt-2 text-xs text-base-content/45">
                    {project.suiteCount} suite{project.suiteCount === 1 ? "" : "s"} · {project.runCount} run
                    {project.runCount === 1 ? "" : "s"} · {project.retentionDays}d retention
                  </p>
                </div>
              ))}
              {!projects.length ? <p className="text-sm text-base-content/45">No assurance project yet.</p> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
