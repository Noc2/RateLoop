"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildAgentConnectionMessage } from "../agentConnectionMessage";
import { AgentSetupProgress } from "./AgentSetupProgress";
import { type AgentSetupScreenStep, agentSetupUrl } from "~~/lib/tokenless/agentSetupNavigation";
import type { WorkspaceAgentSetupView } from "~~/lib/tokenless/workspaceAgentSetup";

type SetupResponse = WorkspaceAgentSetupView;

const ACTIVE_CONNECTION_STATES = new Set([
  "issued",
  "install_required",
  "authorizing",
  "approval_required",
  "testing",
  "action_required",
]);

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The setup request failed.");
  return body;
}

function stepBefore(step: AgentSetupScreenStep): AgentSetupScreenStep | null {
  if (step === "connect") return "workspace";
  if (step === "agent") return "connect";
  if (step === "reviews") return "agent";
  if (step === "people") return "reviews";
  return null;
}

export function AgentSetupFlow({ initialSetup }: { initialSetup: WorkspaceAgentSetupView }) {
  const router = useRouter();
  const [setup, setSetup] = useState(initialSetup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusOnNavigation = useRef(false);
  const currentStep = setup.currentStep === "complete" ? "people" : setup.currentStep;

  const loadStep = useCallback(
    async (step: AgentSetupScreenStep, options?: { replace?: boolean; focus?: boolean }) => {
      const url = agentSetupUrl(setup.workspaceId, step);
      const response = await fetch(
        `/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup?step=${encodeURIComponent(step)}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const next = (await readJson(response)) as unknown as SetupResponse;
      focusOnNavigation.current = options?.focus ?? true;
      setSetup(next);
      if (options?.replace) router.replace(url);
      else router.push(url);
    },
    [router, setup.workspaceId],
  );

  useEffect(() => {
    if (!focusOnNavigation.current) return;
    focusOnNavigation.current = false;
    headingRef.current?.focus();
  }, [currentStep]);

  useEffect(() => {
    if (currentStep !== "connect" || !ACTIVE_CONNECTION_STATES.has(setup.connection.status ?? "")) return;
    let stopped = false;
    let timer: number | null = null;
    const refresh = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const response = await fetch(
          `/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup?step=connect`,
          { cache: "no-store", credentials: "same-origin" },
        );
        const next = (await readJson(response)) as unknown as SetupResponse;
        if (stopped) return;
        setSetup(next);
        if (next.resumeStep === "agent") {
          setAnnouncement("Agent connected. Check its details next.");
          await loadStep("agent", { replace: true, focus: false });
          return;
        }
      } catch {
        if (!stopped)
          setError("Connection status could not refresh. RateLoop will keep trying while this page is open.");
      }
      if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(refresh, 2_500);
    };
    const onVisibility = () => {
      if (!stopped && document.visibilityState === "visible") void refresh();
    };
    timer = window.setTimeout(refresh, 2_500);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [currentStep, loadStep, setup.connection.status, setup.workspaceId]);

  if (!setup.canManage) {
    return (
      <section className="surface-card rounded-2xl p-6">
        <AgentSetupProgress
          currentStep={currentStep}
          stages={setup.stages}
          onNavigate={() => undefined}
          allowNavigation={false}
        />
        <h1 ref={headingRef} tabIndex={-1} className="mt-8 text-2xl font-semibold outline-none">
          Workspace setup is not finished
        </h1>
        <p className="mt-2 text-sm text-base-content/65">Ask a workspace owner to finish the current step.</p>
      </section>
    );
  }

  async function createConnectionMessage() {
    setBusy(true);
    setError(null);
    setManualMessage(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup/connect`, {
          method: "POST",
          body: JSON.stringify({ revision: setup.revision }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      const connectionUrl = typeof body.connectionUrl === "string" ? body.connectionUrl : null;
      if (!connectionUrl) throw new Error("RateLoop did not return a connection message.");
      const message = buildAgentConnectionMessage({ connectionUrl });
      try {
        await navigator.clipboard.writeText(message);
        setAnnouncement("Connection message copied. Paste it once into the agent chat you want to connect.");
      } catch {
        setManualMessage(message);
        setError("Clipboard access was denied. Copy the selected message below once.");
      }
      await loadStep("connect", { replace: true, focus: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the connection message.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup/confirm-agent`, {
          method: "POST",
          body: JSON.stringify({
            revision: setup.revision,
            agent: {
              displayName: form.get("displayName"),
              description: form.get("description") || null,
              provider: form.get("provider") || "unknown",
              model: form.get("model") || "unknown",
              modelVersion: form.get("modelVersion") || null,
              deploymentName: form.get("deploymentName") || null,
              environment: form.get("environment"),
            },
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      await loadStep("reviews");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to confirm the agent.");
    } finally {
      setBusy(false);
    }
  }

  async function configureReviews(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup/configure-reviews`, {
          method: "POST",
          body: JSON.stringify({
            revision: setup.revision,
            review: {
              mode: form.get("mode"),
              reviewerAudience: "private_invited",
              contentBoundary: "private_workspace",
              autonomousAccess: false,
            },
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      await loadStep("people");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save review behavior.");
    } finally {
      setBusy(false);
    }
  }

  async function configurePeople(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const decision = form.get("decision");
    setBusy(true);
    setError(null);
    setInviteToken(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup/people`, {
          method: "POST",
          body: JSON.stringify({
            revision: setup.revision,
            decision,
            createInvitation: decision === "invited",
            intendedEmail: form.get("intendedEmail") || null,
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      const invitation = body.invitation as Record<string, unknown> | null;
      if (invitation && typeof invitation.token === "string") setInviteToken(invitation.token);
      await loadStep("people", { replace: true, focus: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the people step.");
    } finally {
      setBusy(false);
    }
  }

  async function finishSetup() {
    setBusy(true);
    setError(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup/complete`, {
          method: "POST",
          body: JSON.stringify({ revision: setup.revision }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      const destination =
        typeof body.destination === "string"
          ? body.destination
          : `/agents?workspace=${encodeURIComponent(setup.workspaceId)}&tab=overview`;
      window.location.assign(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to finish setup.");
      setBusy(false);
    }
  }

  const back = stepBefore(currentStep);
  return (
    <section className="surface-card rounded-2xl p-5 sm:p-7">
      <AgentSetupProgress currentStep={currentStep} stages={setup.stages} onNavigate={step => void loadStep(step)} />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="mx-auto mt-8 max-w-2xl">
        {currentStep === "workspace" ? (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
              Workspace ready
            </h1>
            <p className="mt-2 text-sm text-base-content/65">{setup.workspaceName}</p>
            <button
              className="rateloop-gradient-action mt-6 px-5"
              type="button"
              onClick={() => void loadStep("connect")}
            >
              Continue
            </button>
          </>
        ) : null}

        {currentStep === "connect" ? (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
              Connect your agent
            </h1>
            <p className="mt-2 text-sm text-base-content/65">
              Copy one message into the agent chat. RateLoop will continue here after the connection is verified.
            </p>
            {setup.connection.status === "connected" ? (
              <button
                className="rateloop-gradient-action mt-6 px-5"
                type="button"
                onClick={() => void loadStep("agent")}
              >
                Check agent
              </button>
            ) : (
              <button
                className="rateloop-gradient-action mt-6 px-5"
                type="button"
                disabled={busy}
                onClick={() => void createConnectionMessage()}
              >
                {busy
                  ? "Creating…"
                  : setup.connection.intentId
                    ? "Create a new connection message"
                    : "Copy connection message"}
              </button>
            )}
            {manualMessage ? (
              <textarea
                className="textarea mt-4 min-h-40 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-xs"
                aria-label="Agent connection message"
                value={manualMessage}
                readOnly
                onFocus={event => event.currentTarget.select()}
              />
            ) : null}
          </>
        ) : null}

        {currentStep === "agent" && setup.agent ? (
          <form onSubmit={confirmAgent}>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
              Check your agent
            </h1>
            <p className="mt-2 text-sm text-base-content/65">
              Confirm what RateLoop observed. Declared provider and model details may remain unknown.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                Agent name
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  name="displayName"
                  defaultValue={setup.agent.displayName}
                  maxLength={120}
                  required
                />
              </label>
              <label className="text-sm">
                Environment
                <select
                  className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  name="environment"
                  defaultValue={setup.agent.environment}
                >
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                </select>
              </label>
              <label className="text-sm sm:col-span-2">
                Description <span className="text-base-content/50">(optional)</span>
                <textarea
                  className="textarea mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  name="description"
                  defaultValue={setup.agent.description ?? ""}
                  maxLength={1000}
                />
              </label>
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
              <p className="font-medium">Observed connection</p>
              <p className="mt-1 text-base-content/60">
                {setup.agent.observedClientName ?? "Unknown client"}
                {setup.agent.observedClientVersion ? ` · ${setup.agent.observedClientVersion}` : ""}
              </p>
              <p className="mt-2 text-base-content/60">
                Safe access only: check review requirements and read aggregate results. No publishing, spending, private
                artifacts, or workspace administration.
              </p>
            </div>
            <details className="mt-4 rounded-xl border border-white/10 p-4">
              <summary className="cursor-pointer font-medium">Declared details</summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  Provider
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    name="provider"
                    defaultValue={setup.agent.provider}
                    maxLength={120}
                  />
                </label>
                <label className="text-sm">
                  Model
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    name="model"
                    defaultValue={setup.agent.model}
                    maxLength={160}
                  />
                </label>
                <label className="text-sm">
                  Model version
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    name="modelVersion"
                    defaultValue={setup.agent.modelVersion ?? ""}
                    maxLength={160}
                  />
                </label>
                <label className="text-sm">
                  Deployment name
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    name="deploymentName"
                    defaultValue={setup.agent.deploymentName ?? ""}
                    maxLength={160}
                  />
                </label>
              </div>
            </details>
            <button className="rateloop-gradient-action mt-6 px-5" disabled={busy}>
              {busy ? "Confirming…" : "Confirm agent"}
            </button>
          </form>
        ) : null}

        {currentStep === "reviews" ? (
          <form onSubmit={configureReviews}>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
              Set review behavior
            </h1>
            <p className="mt-2 text-sm text-base-content/65">
              Choose when this agent should involve people. The agent cannot send or pay for requests autonomously.
            </p>
            <fieldset className="mt-5 space-y-3">
              <legend className="font-medium">When should it use human review?</legend>
              {[
                ["adaptive", "When RateLoop says review is needed", "Recommended"],
                ["always", "For every eligible output", ""],
                ["manual", "Only after I approve a request", ""],
              ].map(([value, label, badge]) => (
                <label key={value} className="flex gap-3 rounded-xl border border-white/10 p-4">
                  <input
                    className="radio mt-0.5"
                    type="radio"
                    name="mode"
                    value={value}
                    defaultChecked={(setup.reviewDraft?.mode ?? "adaptive") === value}
                  />
                  <span>
                    <span className="font-medium">{label}</span>
                    {badge ? <span className="ml-2 text-xs text-primary">{badge}</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
              <p className="font-medium">People you invite · private workspace material</p>
              <p className="mt-1 text-base-content/60">
                This setup prepares a private reviewer group. Autonomous delivery stays off until the assignment-gated
                agent lane is available.
              </p>
            </div>
            <button className="rateloop-gradient-action mt-6 px-5" disabled={busy}>
              {busy ? "Saving…" : "Continue"}
            </button>
          </form>
        ) : null}

        {currentStep === "people" ? (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
              Add people and finish
            </h1>
            {!setup.peopleDecision ? (
              <form className="mt-5" onSubmit={configurePeople}>
                <fieldset className="space-y-3">
                  <legend className="font-medium">Invite a reviewer now?</legend>
                  <label className="flex gap-3 rounded-xl border border-white/10 p-4">
                    <input className="radio mt-0.5" type="radio" name="decision" value="invited" defaultChecked />
                    <span>
                      <span className="font-medium">Create a one-use code</span>
                      <span className="mt-1 block text-sm text-base-content/60">The code expires in seven days.</span>
                    </span>
                  </label>
                  <label className="flex gap-3 rounded-xl border border-white/10 p-4">
                    <input className="radio mt-0.5" type="radio" name="decision" value="later" />
                    <span>
                      <span className="font-medium">Invite later</span>
                      <span className="mt-1 block text-sm text-base-content/60">
                        RateLoop will still prepare the private group.
                      </span>
                    </span>
                  </label>
                </fieldset>
                <label className="mt-4 block text-sm">
                  Bind code to recipient email <span className="text-base-content/50">(optional)</span>
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    type="email"
                    name="intendedEmail"
                    maxLength={320}
                  />
                  <span className="mt-1 block text-xs text-base-content/55">
                    RateLoop does not send this email. The recipient must use the code while signed in with that
                    address.
                  </span>
                </label>
                <button className="rateloop-gradient-action mt-6 px-5" disabled={busy}>
                  {busy ? "Saving…" : "Continue"}
                </button>
              </form>
            ) : (
              <div className="mt-5 space-y-4">
                {inviteToken ? (
                  <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
                    <p className="font-medium">Copy this invitation code now</p>
                    <code className="mt-2 block break-all text-sm">{inviteToken}</code>
                    <button
                      className="btn btn-sm mt-3"
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(inviteToken)}
                    >
                      Copy code
                    </button>
                  </div>
                ) : null}
                <div className="rounded-xl border border-white/10 p-4 text-sm">
                  <p>
                    <span className="text-base-content/55">Agent:</span> {setup.agent?.displayName ?? "Connected agent"}
                  </p>
                  <p className="mt-2">
                    <span className="text-base-content/55">Review:</span>{" "}
                    {setup.reviewDraft?.mode === "always"
                      ? "Every eligible output"
                      : setup.reviewDraft?.mode === "manual"
                        ? "Owner-approved requests"
                        : "When RateLoop says review is needed"}
                  </p>
                  <p className="mt-2">
                    <span className="text-base-content/55">People:</span>{" "}
                    {setup.peopleDecision === "invited" ? "Invitation code created" : "Invite later"}
                  </p>
                  <p className="mt-2">
                    <span className="text-base-content/55">Authority:</span> Safe connection; no autonomous publishing
                    or spending
                  </p>
                </div>
                <button
                  className="rateloop-gradient-action px-5"
                  type="button"
                  disabled={busy}
                  onClick={() => void finishSetup()}
                >
                  {busy ? "Finishing…" : "Finish setup"}
                </button>
              </div>
            )}
          </>
        ) : null}

        {error ? (
          <p id="agent-setup-error" role="alert" className="mt-5 text-sm text-error">
            {error}
          </p>
        ) : null}
        {back ? (
          <button className="btn btn-ghost mt-6" type="button" onClick={() => void loadStep(back)}>
            Back
          </button>
        ) : null}
      </div>
    </section>
  );
}
