"use client";

import { useEffect, useState } from "react";

type Ask = {
  operationKey: string;
  workspaceId: string;
  status: string;
  verdictStatus: string | null;
  visibility: string;
  dataClassification: string;
};
type Project = {
  projectId: string;
  name: string;
  dataClassification: string;
  status: string;
  suiteCount: number;
  runCount: number;
};

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "History request failed.");
  return body;
}

export function AskHistoryClient() {
  const [asks, setAsks] = useState<Ask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const asksBody = await readJson(
        await fetch("/api/account/ask-history", { cache: "no-store", credentials: "same-origin" }),
      );
      setAsks((asksBody.asks ?? []) as Ask[]);
      const workspacesBody = await readJson(
        await fetch("/api/account/workspaces", { cache: "no-store", credentials: "same-origin" }),
      );
      const workspaces = (workspacesBody.workspaces ?? []) as Array<{ workspaceId: string }>;
      const projectBodies = await Promise.all(
        workspaces.map(workspace =>
          fetch(`/api/account/workspaces/${encodeURIComponent(workspace.workspaceId)}/assurance/projects`, {
            cache: "no-store",
            credentials: "same-origin",
          }).then(readJson),
        ),
      );
      setProjects(projectBodies.flatMap(body => (body.projects ?? []) as Project[]));
    })().catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load Ask history."));
  }, []);

  return (
    <section className="mt-8 space-y-5">
      <div className="rateloop-surface-card p-5 sm:p-7">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Public questions</p>
        <h2 className="mt-2 text-xl font-semibold">Your submitted questions</h2>
        {asks.length ? (
          <div className="mt-5 space-y-3">
            {asks.map(ask => (
              <article key={ask.operationKey} className="rounded-lg border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="font-mono text-xs text-base-content/60">{ask.operationKey}</span>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs">{ask.status}</span>
                </div>
                <p className="mt-3 text-xs text-base-content/50">
                  {ask.visibility} · {ask.dataClassification} · {ask.verdictStatus ?? "awaiting result"}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-base-content/50">No public questions submitted from this account.</p>
        )}
      </div>
      <div className="rateloop-surface-card p-5 sm:p-7">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">Private evaluations</p>
        <h2 className="mt-2 text-xl font-semibold">Workspace project history</h2>
        {projects.length ? (
          <div className="mt-5 space-y-3">
            {projects.map(project => (
              <article key={project.projectId} className="rounded-lg border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="font-semibold">{project.name}</span>
                  <span className="text-xs text-base-content/50">{project.status}</span>
                </div>
                <p className="mt-2 text-xs text-base-content/50">
                  {project.dataClassification} · {project.suiteCount} suite{project.suiteCount === 1 ? "" : "s"} ·{" "}
                  {project.runCount} run{project.runCount === 1 ? "" : "s"}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-base-content/50">No private evaluation projects yet.</p>
        )}
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-400/10 p-4 text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </section>
  );
}
