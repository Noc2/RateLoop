"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildAgentConnectionMessage } from "../agentConnectionMessage";
import { AgentSetupProgress } from "./AgentSetupProgress";
import {
  type ReviewFrequencyFormValues,
  buildReviewFrequencySelection,
  reviewFrequencyFormValues,
  reviewFrequencySummary,
} from "./reviewFrequency";
import { useRateLoopNotifications } from "~~/components/tokenless/RateLoopNotificationProvider";
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

const REVIEW_FREQUENCY_OPTIONS = [
  ["adaptive", "Adaptive", "Learns from results and reduces review coverage safely.", "Recommended"],
  ["always", "Every output", "Reviews every eligible output.", ""],
  ["fixed", "Fixed percentage", "Reviews a fixed share of eligible outputs.", ""],
  ["rules", "Rules and conditions", "Reviews outputs that match risk or confidence conditions.", ""],
  ["manual", "Only after I approve", "RateLoop recommends a handoff; the agent cannot send it.", ""],
] as const;

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
  const notifications = useRateLoopNotifications();
  const [setup, setSetup] = useState(initialSetup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState(initialSetup.workspaceName);
  const [reviewFrequency, setReviewFrequency] = useState<ReviewFrequencyFormValues>(() =>
    reviewFrequencyFormValues(initialSetup.reviewDraft?.selection),
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const connectionMessageRef = useRef<HTMLTextAreaElement>(null);
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

  useEffect(() => setWorkspaceName(setup.workspaceName), [setup.workspaceName]);

  useEffect(
    () => setReviewFrequency(reviewFrequencyFormValues(setup.reviewDraft?.selection)),
    [setup.reviewDraft?.selection],
  );

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
    setConnectionMessage(null);
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
      setConnectionMessage(message);
      try {
        await navigator.clipboard.writeText(message);
        setAnnouncement("Connection message copied to clipboard.");
        notifications.success("Connection message copied to clipboard.");
      } catch {
        setError("Clipboard access was denied. Copy the visible message below once.");
        notifications.error("Clipboard access was blocked. Copy the visible message manually.");
      }
      await loadStep("connect", { replace: true, focus: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the connection message.");
    } finally {
      setBusy(false);
    }
  }

  async function copyVisibleConnectionMessage() {
    if (!connectionMessage) return;
    try {
      await navigator.clipboard.writeText(connectionMessage);
      setAnnouncement("Connection message copied to clipboard.");
      notifications.success("Connection message copied to clipboard.");
    } catch {
      connectionMessageRef.current?.focus();
      connectionMessageRef.current?.select();
      setError("Clipboard access was denied. The visible message is selected for manual copying.");
      notifications.error("Clipboard access was blocked. The message is selected for manual copying.");
    }
  }

  async function copyInvitationCode() {
    if (!inviteToken) return;
    try {
      await navigator.clipboard.writeText(inviteToken);
      setAnnouncement("Invitation code copied to clipboard.");
      notifications.success("Invitation code copied to clipboard.");
    } catch {
      setError("Clipboard access was denied. Select and copy the visible invitation code manually.");
      notifications.error("Clipboard access was blocked. Copy the invitation code manually.");
    }
  }

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workspaceName.trim();
    setBusy(true);
    setError(null);
    try {
      if (name !== setup.workspaceName) {
        await readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup/workspace`, {
            method: "POST",
            body: JSON.stringify({ revision: setup.revision, name }),
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      await loadStep("connect");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the workspace name.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const connectedAgent = setup.agent;
    if (!connectedAgent) {
      setError("The connected agent details are unavailable. Reconnect the agent and try again.");
      return;
    }
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
              provider: "unknown",
              model: "unknown",
              modelVersion: null,
              deploymentName: form.get("deploymentName") || null,
              environment: connectedAgent.environment,
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
    const connectedAgent = setup.agent;
    if (!connectedAgent) {
      setError("The connected agent details are unavailable. Reconnect the agent and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = setup.reviewDraft;
      if (!draft) throw new Error("Review behavior is unavailable. Reload setup and try again.");
      if (
        draft.requestProfile.configurationStatus !== "ready" ||
        !Number.isSafeInteger(draft.requestProfile.responseWindowSeconds) ||
        Number(draft.requestProfile.responseWindowSeconds) < 1_200 ||
        !Number.isSafeInteger(draft.requestProfile.panelSize) ||
        Number(draft.requestProfile.panelSize) < 1
      ) {
        throw new Error("Choose a response window and panel size before saving review behavior.");
      }
      const selection = buildReviewFrequencySelection(draft.selection, reviewFrequency);
      const requestProfile = {
        criterion: draft.requestProfile.criterion,
        positiveLabel: draft.requestProfile.positiveLabel,
        negativeLabel: draft.requestProfile.negativeLabel,
        rationaleMode: draft.requestProfile.rationaleMode,
        audience: draft.requestProfile.audience,
        contentBoundary: draft.requestProfile.contentBoundary,
        privateSensitivity: draft.requestProfile.privateSensitivity,
        responseWindowSeconds: draft.requestProfile.responseWindowSeconds,
        panelSize: draft.requestProfile.panelSize,
        compensationMode: draft.requestProfile.compensationMode,
        bountyPerSeatAtomic: draft.requestProfile.bountyPerSeatAtomic,
      };
      const audience = draft.requestProfile.audience;
      let privateGroupId = draft.requestProfile.privateGroupId ?? setup.privateGroupId;
      if ((audience === "private_invited" || audience === "hybrid") && !privateGroupId) {
        const groupsBody = await readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/private-groups`, {
            cache: "no-store",
            credentials: "same-origin",
          }),
        );
        const groups = Array.isArray(groupsBody.groups) ? (groupsBody.groups as Record<string, unknown>[]) : [];
        const existing = groups.find(group => group.name === "Reviewers" && group.status === "active");
        if (typeof existing?.groupId === "string") privateGroupId = existing.groupId;
        else {
          const created = await readJson(
            await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/private-groups`, {
              method: "POST",
              body: JSON.stringify({
                name: "Reviewers",
                purpose: "People invited to review this workspace's private material.",
                policy: { defaultCompensation: "unpaid", dataClassifications: ["internal", "confidential"] },
              }),
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
            }),
          );
          const group = created.group as Record<string, unknown> | undefined;
          if (typeof group?.groupId !== "string") throw new Error("The reviewer group could not be prepared.");
          privateGroupId = group.groupId;
        }
      }
      const ownerView = await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agents/${encodeURIComponent(connectedAgent.agentId)}/human-review`,
          {
            method: "PUT",
            body: JSON.stringify({
              expectedBindingVersion: draft.bindingRevision,
              selection,
              requestProfile: { ...requestProfile, privateGroupId },
              authority: draft.authority,
            }),
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      if (!Number.isSafeInteger(ownerView.bindingRevision) || Number(ownerView.bindingRevision) < 1) {
        throw new Error("The saved review configuration could not be confirmed.");
      }
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup/configure-reviews`, {
          method: "POST",
          body: JSON.stringify({
            revision: setup.revision,
            bindingRevision: ownerView.bindingRevision,
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
  const backButton = back ? (
    <button
      className="btn rateloop-secondary-action rateloop-back-action h-auto self-stretch gap-2 px-5"
      type="button"
      onClick={() => void loadStep(back)}
    >
      Back
    </button>
  ) : null;
  return (
    <section className="surface-card rounded-2xl p-5 sm:p-7">
      <AgentSetupProgress currentStep={currentStep} stages={setup.stages} onNavigate={step => void loadStep(step)} />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="mt-8 max-w-2xl">
        {currentStep === "workspace" ? (
          <form onSubmit={saveWorkspace}>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
              Workspace
            </h1>
            <label className="mt-5 block text-sm text-base-content/70" htmlFor="agent-setup-workspace-name">
              Workspace name
            </label>
            <input
              id="agent-setup-workspace-name"
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={workspaceName}
              onChange={event => setWorkspaceName(event.target.value)}
              autoComplete="organization"
              maxLength={120}
              required
            />
            <div className="mt-6 flex items-center gap-3">
              {backButton}
              <button className="rateloop-gradient-action px-5" disabled={busy || !workspaceName.trim()}>
                {busy ? "Saving…" : workspaceName.trim() === setup.workspaceName ? "Continue" : "Save and continue"}
              </button>
            </div>
          </form>
        ) : null}

        {currentStep === "connect" ? (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
              Connect your agent
            </h1>
            <p className="mt-2 text-sm text-base-content/65">
              Copy one message into the agent chat. RateLoop will continue here after the connection is verified.
            </p>
            <div className="mt-6 flex items-center gap-3">
              {backButton}
              {setup.connection.status === "connected" ? (
                <button className="rateloop-gradient-action px-5" type="button" onClick={() => void loadStep("agent")}>
                  Check agent
                </button>
              ) : (
                <button
                  className="rateloop-gradient-action px-5"
                  type="button"
                  disabled={busy}
                  onClick={() => void createConnectionMessage()}
                >
                  {busy
                    ? "Creating…"
                    : setup.connection.intentId
                      ? "Create a new connection message"
                      : "Create connection message"}
                </button>
              )}
            </div>
            {connectionMessage ? (
              <div className="mt-5">
                <label className="block text-sm font-medium" htmlFor="agent-setup-connection-message">
                  Connection message
                </label>
                <textarea
                  ref={connectionMessageRef}
                  id="agent-setup-connection-message"
                  className="textarea mt-2 min-h-40 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-xs leading-5"
                  value={connectionMessage}
                  readOnly
                  onFocus={event => event.currentTarget.select()}
                />
                <button
                  className="btn rateloop-secondary-action mt-3 px-5"
                  type="button"
                  onClick={() => void copyVisibleConnectionMessage()}
                >
                  Copy message
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {currentStep === "agent" && setup.agent ? (
          <form onSubmit={confirmAgent}>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
              Name this workflow
            </h1>
            <p className="mt-2 text-sm text-base-content/65">
              The connected client stays separate from the model, effort, and timing reported for each eligible run.
            </p>
            <div className="mt-5 grid gap-4">
              <label className="text-sm">
                Workflow name
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  name="displayName"
                  defaultValue={setup.agent.displayName}
                  maxLength={120}
                  required
                />
              </label>
              <label className="text-sm">
                Description <span className="text-base-content/50">(optional)</span>
                <textarea
                  className="textarea mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  name="description"
                  defaultValue={setup.agent.description ?? ""}
                  maxLength={1000}
                />
              </label>
              <label className="text-sm">
                Deployment name <span className="text-base-content/50">(optional)</span>
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  name="deploymentName"
                  defaultValue={setup.agent.deploymentName ?? ""}
                  maxLength={160}
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
            <div className="mt-6 flex items-center gap-3">
              {backButton}
              <button className="rateloop-gradient-action px-5" disabled={busy}>
                {busy ? "Confirming…" : "Confirm workflow"}
              </button>
            </div>
          </form>
        ) : null}

        {currentStep === "reviews" ? (
          <form onSubmit={configureReviews}>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
              Set review behavior
            </h1>
            <p className="mt-2 text-sm text-base-content/65">
              Choose when RateLoop should mark an eligible output for human review. This saves a review policy; the safe
              connection does not send requests or pay reviewers.
            </p>
            <fieldset className="mt-5 space-y-3">
              <legend className="font-medium">How often should RateLoop require human review?</legend>
              {REVIEW_FREQUENCY_OPTIONS.map(([value, label, description, badge]) => (
                <label key={value} className="flex gap-3 rounded-xl border border-white/10 p-4">
                  <input
                    className="radio mt-0.5"
                    type="radio"
                    name="mode"
                    value={value}
                    checked={reviewFrequency.mode === value}
                    onChange={() => setReviewFrequency(current => ({ ...current, mode: value }))}
                  />
                  <span>
                    <span className="font-medium">{label}</span>
                    {badge ? <span className="ml-2 text-xs text-primary">{badge}</span> : null}
                    <span className="mt-1 block text-sm text-base-content/60">{description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {reviewFrequency.mode === "adaptive" || reviewFrequency.mode === "fixed" ? (
              <div className="mt-4 grid gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-2">
                <label className="text-sm">
                  {reviewFrequency.mode === "adaptive" ? "Minimum review rate (%)" : "Outputs reviewed (%)"}
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    type="number"
                    min={reviewFrequency.mode === "adaptive" ? 10 : 0.01}
                    max={100}
                    step={0.01}
                    inputMode="decimal"
                    value={
                      reviewFrequency.mode === "adaptive"
                        ? reviewFrequency.adaptiveFloorPercent
                        : reviewFrequency.fixedPercent
                    }
                    onChange={event =>
                      setReviewFrequency(current => ({
                        ...current,
                        [reviewFrequency.mode === "adaptive" ? "adaptiveFloorPercent" : "fixedPercent"]:
                          event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label className="text-sm">
                  Maximum outputs between reviews
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    type="number"
                    min={1}
                    max={10_000}
                    step={1}
                    inputMode="numeric"
                    value={reviewFrequency.maximumUnreviewedGap}
                    onChange={event =>
                      setReviewFrequency(current => ({ ...current, maximumUnreviewedGap: event.target.value }))
                    }
                    required
                  />
                </label>
                <p className="text-xs text-base-content/55 sm:col-span-2">
                  {reviewFrequency.mode === "adaptive" ? "Starts at 100% while calibrating. " : ""}
                  Critical, incomplete, or low-confidence outputs can require additional review.
                </p>
              </div>
            ) : null}
            {reviewFrequency.mode === "rules" ? (
              <div className="mt-4 grid gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-2">
                <label className="text-sm">
                  Review these risk levels
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={reviewFrequency.requiredRiskTiers}
                    onChange={event =>
                      setReviewFrequency(current => ({ ...current, requiredRiskTiers: event.target.value }))
                    }
                    placeholder="high, legal"
                    maxLength={320}
                  />
                </label>
                <label className="text-sm">
                  Review below confidence (%) <span className="text-base-content/50">(optional)</span>
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    inputMode="decimal"
                    value={reviewFrequency.minimumConfidencePercent}
                    onChange={event =>
                      setReviewFrequency(current => ({ ...current, minimumConfidencePercent: event.target.value }))
                    }
                  />
                </label>
                <p className="text-xs text-base-content/55 sm:col-span-2">
                  Separate risk levels with commas. Critical or incomplete outputs always require review.
                </p>
              </div>
            ) : null}
            <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
              <p className="font-medium">Invited reviewers · private workspace material</p>
              <p className="mt-1 text-base-content/60">
                This saves the private-review audience and prepares an invitation in the next step. The safe connection
                does not assign or deliver work to reviewers.
              </p>
            </div>
            <div className="mt-6 flex items-center gap-3">
              {backButton}
              <button className="rateloop-gradient-action px-5" disabled={busy}>
                {busy ? "Saving…" : "Continue"}
              </button>
            </div>
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
                <div className="mt-6 flex items-center gap-3">
                  {backButton}
                  <button className="rateloop-gradient-action px-5" disabled={busy}>
                    {busy ? "Saving…" : "Continue"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-5 space-y-4">
                {inviteToken ? (
                  <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
                    <p className="font-medium">Copy this invitation code now</p>
                    <code className="mt-2 block break-all text-sm">{inviteToken}</code>
                    <button
                      className="btn btn-sm rateloop-secondary-action mt-3"
                      type="button"
                      onClick={() => void copyInvitationCode()}
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
                    {reviewFrequencySummary(setup.reviewDraft?.selection)}
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
                <div className="flex items-center gap-3">
                  {backButton}
                  <button
                    className="rateloop-gradient-action px-5"
                    type="button"
                    disabled={busy}
                    onClick={() => void finishSetup()}
                  >
                    {busy ? "Finishing…" : "Finish setup"}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}

        {error ? (
          <p id="agent-setup-error" role="alert" className="mt-5 text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
