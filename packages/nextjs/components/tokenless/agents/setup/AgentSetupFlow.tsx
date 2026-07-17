"use client";

import { type FormEvent, Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildAgentConnectionMessage } from "../agentConnectionMessage";
import { AgentSetupProgress } from "./AgentSetupProgress";
import { SetupActionBar } from "./SetupActionBar";
import { SetupChoiceGroup, SetupRadioChoice } from "./SetupChoiceGroup";
import { SetupStageHeader } from "./SetupStageHeader";
import {
  type ReviewAudienceFormValues,
  buildReviewAudienceRequestProfile,
  privateClassificationsThrough,
  reviewAudienceFormValues,
} from "./reviewAudience";
import {
  REVIEW_USDC_DECIMAL_MAX_LENGTH,
  type ReviewCompensationFormValues,
  buildReviewCompensationConfiguration,
  reviewCompensationFormValues,
  usdcAtomicToDecimal,
} from "./reviewCompensation";
import {
  REVIEW_ANSWER_LABEL_MAX_LENGTH,
  REVIEW_CRITERION_MAX_LENGTH,
  type ReviewCriterionFormValues,
  buildReviewCriterionRequestProfile,
  reviewCriterionFormValues,
} from "./reviewCriterion";
import {
  REVIEWER_EXPERTISE,
  type ReviewExpertiseFormValues,
  buildReviewExpertiseRequestProfile,
  reviewExpertiseEligibilityStatus,
  reviewExpertiseFormValues,
} from "./reviewExpertise";
import {
  type ReviewFrequencyFormValues,
  buildReviewFrequencySelection,
  reviewFrequencyFormValues,
  reviewFrequencySummary,
} from "./reviewFrequency";
import {
  MAX_REVIEW_PANEL_SIZE,
  MAX_REVIEW_RESPONSE_WINDOW_SECONDS,
  MIN_REVIEW_RESPONSE_WINDOW_SECONDS,
  type ReviewTimingFormValues,
  buildReviewTimingRequestProfile,
  reviewTimingFormValues,
} from "./reviewTiming";
import { useRateLoopNotifications } from "~~/components/tokenless/RateLoopNotificationProvider";
import { Button } from "~~/components/tokenless/ui/Button";
import { DurationInput } from "~~/components/ui/DurationInput";
import { type AgentSetupScreenStep, agentSetupUrl } from "~~/lib/tokenless/agentSetupNavigation";
import type { AgentSetupReviewDraft, WorkspaceAgentSetupView } from "~~/lib/tokenless/workspaceAgentSetup";

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

const REVIEW_AUDIENCE_OPTIONS = [
  ["public_network", "Public network", "RateLoop network reviewers."],
  ["private_invited", "Invited reviewers", "Only people you invite can review private workspace material."],
  ["hybrid", "Hybrid", "Invited and RateLoop network reviewers."],
] as const;

const REVIEW_AUTHORITY_OPTIONS = [
  ["check_only", "Check only", "Report whether review is required. Do not prepare or send a request."],
  ["prepare_for_approval", "Prepare for approval", "Prepare a request, then wait for owner approval."],
  [
    "ask_automatically",
    "Ask automatically",
    "Send requests within the saved limits. Requires a separate owner-approved publishing and funding grant.",
  ],
] as const;

type PendingReviewConfirmation = {
  fingerprint: string;
  selection: AgentSetupReviewDraft["selection"];
  requestProfile: Omit<AgentSetupReviewDraft["requestProfile"], "configurationStatus">;
  authority: AgentSetupReviewDraft["authority"];
};

type ExpertiseEligibility = {
  eligible: number;
  feasible: boolean;
  invited: { eligible: number; total: number };
  network: { eligible: number; total: number; ready: boolean };
};

type ExpertiseEligibilityState = { key: string; value: ExpertiseEligibility };

function reviewAudienceSummary(audience: AgentSetupReviewDraft["requestProfile"]["audience"]) {
  if (audience === "public_network") return "RateLoop public network; public, synthetic, or redacted material only";
  if (audience === "hybrid") return "Invited reviewers and the public RateLoop network; public-safe material only";
  return "Invited reviewers only; private workspace material";
}

function reviewAuthoritySummary(authority: AgentSetupReviewDraft["authority"]) {
  if (authority === "prepare_for_approval") return "Prepare each required request and wait for owner approval";
  if (authority === "ask_automatically") return "Send within the exact owner-approved publishing and funding grant";
  return "Check whether review is required; do not prepare, send, or spend";
}

function formatResponseWindow(seconds: number | null) {
  if (seconds === null) return "Not configured";
  if (seconds % 3_600 === 0) return `${seconds / 3_600} ${seconds === 3_600 ? "hour" : "hours"}`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

function formatConsentUsdc(atomic: bigint) {
  if (atomic === 0n) return "0";
  return usdcAtomicToDecimal(atomic.toString());
}

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
  const [reviewAudience, setReviewAudience] = useState<ReviewAudienceFormValues>(() =>
    reviewAudienceFormValues(initialSetup.reviewDraft?.requestProfile),
  );
  const [reviewCriterion, setReviewCriterion] = useState<ReviewCriterionFormValues>(() =>
    reviewCriterionFormValues(initialSetup.reviewDraft?.requestProfile),
  );
  const [reviewExpertise, setReviewExpertise] = useState<ReviewExpertiseFormValues>(() =>
    reviewExpertiseFormValues(initialSetup.reviewDraft?.requestProfile),
  );
  const [expertiseEligibility, setExpertiseEligibility] = useState<ExpertiseEligibilityState | null>(null);
  const [reviewTiming, setReviewTiming] = useState<ReviewTimingFormValues>(() =>
    reviewTimingFormValues(initialSetup.reviewDraft?.requestProfile),
  );
  const [reviewCompensation, setReviewCompensation] = useState<ReviewCompensationFormValues>(() =>
    reviewCompensationFormValues(initialSetup.reviewDraft?.requestProfile, initialSetup.reviewDraft?.authority),
  );
  const [pendingReviewConfirmation, setPendingReviewConfirmation] = useState<PendingReviewConfirmation | null>(null);
  const [confirmedReviewFingerprint, setConfirmedReviewFingerprint] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const connectionMessageRef = useRef<HTMLTextAreaElement>(null);
  const reviewDetailsRef = useRef<HTMLDetailsElement>(null);
  const focusOnNavigation = useRef(false);
  const currentStep = setup.currentStep === "complete" ? "people" : setup.currentStep;
  const currentReviewFingerprint = JSON.stringify({
    reviewAudience,
    reviewCompensation,
    reviewCriterion,
    reviewExpertise,
    reviewFrequency,
    reviewTiming,
  });
  const expertiseEligibilityKey = JSON.stringify({
    audience: reviewAudience.audience,
    privateGroupId: setup.reviewDraft?.requestProfile.privateGroupId ?? setup.privateGroupId,
    requiredExpertiseKeys: reviewExpertise.requiredExpertiseKeys,
    workspaceId: setup.workspaceId,
  });
  const expertiseEligibilityStatus = reviewExpertiseEligibilityStatus({
    audience: reviewAudience.audience,
    eligibility: expertiseEligibility?.key === expertiseEligibilityKey ? expertiseEligibility.value : null,
    panelSize: reviewTiming.panelSize,
    requiredExpertiseCount: reviewExpertise.requiredExpertiseKeys.length,
  });
  const reviewerCount = reviewTiming.panelSize || "—";
  const reviewerDetailsSummary = `${
    reviewAudience.audience === "private_invited" ? "Invited reviewers · private material" : "Public-safe material"
  } · ${reviewerCount} reviewer${reviewerCount === "1" ? "" : "s"} · ${
    reviewCompensation.compensationMode === "usdc" ? `${reviewCompensation.usdcPerReviewer || "—"} USDC each` : "Unpaid"
  }`;
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

  useEffect(
    () => setReviewAudience(reviewAudienceFormValues(setup.reviewDraft?.requestProfile)),
    [setup.reviewDraft?.requestProfile],
  );

  useEffect(
    () => setReviewCriterion(reviewCriterionFormValues(setup.reviewDraft?.requestProfile)),
    [setup.reviewDraft?.requestProfile],
  );

  useEffect(
    () => setReviewExpertise(reviewExpertiseFormValues(setup.reviewDraft?.requestProfile)),
    [setup.reviewDraft?.requestProfile],
  );

  useEffect(() => {
    if (currentStep !== "reviews") return;
    setExpertiseEligibility(null);
    if (reviewExpertise.requiredExpertiseKeys.length === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ audience: reviewAudience.audience });
      const privateGroupId = setup.reviewDraft?.requestProfile.privateGroupId ?? setup.privateGroupId;
      if (privateGroupId) query.set("privateGroupId", privateGroupId);
      for (const key of reviewExpertise.requiredExpertiseKeys) query.append("expertise", key);
      void fetch(
        `/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/reviewer-expertise/eligibility?${query}`,
        { cache: "no-store", credentials: "same-origin", signal: controller.signal },
      )
        .then(async response => (response.ok ? ((await response.json()) as ExpertiseEligibility) : null))
        .then(value => {
          if (!controller.signal.aborted && value) {
            setExpertiseEligibility({ key: expertiseEligibilityKey, value });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setExpertiseEligibility(null);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    currentStep,
    expertiseEligibilityKey,
    reviewAudience.audience,
    reviewExpertise.requiredExpertiseKeys,
    setup.privateGroupId,
    setup.reviewDraft?.requestProfile.privateGroupId,
    setup.workspaceId,
  ]);

  useEffect(
    () => setReviewTiming(reviewTimingFormValues(setup.reviewDraft?.requestProfile)),
    [setup.reviewDraft?.requestProfile],
  );

  useEffect(
    () =>
      setReviewCompensation(
        reviewCompensationFormValues(setup.reviewDraft?.requestProfile, setup.reviewDraft?.authority),
      ),
    [setup.reviewDraft?.authority, setup.reviewDraft?.requestProfile],
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
        <div className="mx-auto mt-8 w-full max-w-4xl">
          <SetupStageHeader
            headingRef={headingRef}
            step={currentStep}
            title="Workspace setup is not finished"
            description="Ask a workspace owner to finish this step."
          />
        </div>
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
    setError(null);
    try {
      if (!expertiseEligibilityStatus.feasible) {
        throw new Error(expertiseEligibilityStatus.summary);
      }
      const draft = setup.reviewDraft;
      if (!draft) throw new Error("Review behavior is unavailable. Reload setup and try again.");
      const selection = buildReviewFrequencySelection(draft.selection, reviewFrequency);
      const audienceProfile = buildReviewAudienceRequestProfile(draft.requestProfile, reviewAudience);
      const criterionProfile = buildReviewCriterionRequestProfile(audienceProfile, reviewCriterion);
      const expertiseProfile = buildReviewExpertiseRequestProfile(criterionProfile, reviewExpertise);
      const timingProfile = buildReviewTimingRequestProfile(expertiseProfile, reviewTiming);
      const { requestProfile, authority } = buildReviewCompensationConfiguration(timingProfile, reviewCompensation);
      if (pendingReviewConfirmation?.fingerprint !== currentReviewFingerprint) {
        setPendingReviewConfirmation({
          fingerprint: currentReviewFingerprint,
          selection,
          requestProfile,
          authority,
        });
        setConfirmedReviewFingerprint(null);
        setAnnouncement("Review the exact human-review terms, then confirm and save them.");
        return;
      }
      if (confirmedReviewFingerprint !== currentReviewFingerprint) {
        throw new Error("Confirm the exact human-review terms before saving them.");
      }
      setBusy(true);
      const audience = requestProfile.audience;
      let privateGroupId =
        audience === "public_network" ? null : (requestProfile.privateGroupId ?? setup.privateGroupId);
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
                policy: {
                  defaultCompensation: "unpaid",
                  dataClassifications: privateClassificationsThrough(reviewAudience.privateSensitivity),
                },
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
              authority,
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
    <Button
      variant="secondary"
      className="rateloop-back-action min-h-11 w-full gap-2 sm:w-auto"
      type="button"
      disabled={busy}
      onClick={() => void loadStep(back)}
    >
      Back
    </Button>
  ) : null;
  return (
    <section className="surface-card rounded-2xl p-5 sm:p-7">
      <AgentSetupProgress currentStep={currentStep} stages={setup.stages} onNavigate={step => void loadStep(step)} />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="mx-auto mt-8 w-full max-w-4xl">
        {currentStep === "workspace" ? (
          <form onSubmit={saveWorkspace} aria-busy={busy}>
            <SetupStageHeader
              headingRef={headingRef}
              step="workspace"
              title="Name your workspace"
              description="Use a team or project name. You can change it later."
            />
            <label className="mt-8 block text-sm font-medium" htmlFor="agent-setup-workspace-name">
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
            <SetupActionBar>
              {backButton}
              <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy || !workspaceName.trim()}>
                {busy ? "Saving…" : workspaceName.trim() === setup.workspaceName ? "Continue" : "Save and continue"}
              </Button>
            </SetupActionBar>
          </form>
        ) : null}

        {currentStep === "connect" ? (
          <>
            <SetupStageHeader
              headingRef={headingRef}
              step="connect"
              title="Connect your agent"
              description="Copy one message into the agent chat. RateLoop continues here after verification."
            />
            <SetupActionBar>
              {backButton}
              {setup.connection.status === "connected" ? (
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  type="button"
                  disabled={busy}
                  onClick={() => void loadStep("agent")}
                >
                  Check agent
                </Button>
              ) : (
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  type="button"
                  disabled={busy}
                  onClick={() => void createConnectionMessage()}
                >
                  {busy
                    ? "Creating…"
                    : setup.connection.intentId
                      ? "Create a new connection message"
                      : "Create connection message"}
                </Button>
              )}
            </SetupActionBar>
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
          <form onSubmit={confirmAgent} aria-busy={busy}>
            <SetupStageHeader
              headingRef={headingRef}
              step="agent"
              title="Name this workflow"
              description="The connected client stays separate from the model, effort, and timing reported for each eligible run."
            />
            <div className="mt-8 grid gap-4">
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
            <SetupActionBar>
              {backButton}
              <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy}>
                {busy ? "Confirming…" : "Confirm workflow"}
              </Button>
            </SetupActionBar>
          </form>
        ) : null}

        {currentStep === "reviews" ? (
          <form
            onSubmit={configureReviews}
            onInvalid={event => {
              if (reviewDetailsRef.current?.contains(event.target as Node)) reviewDetailsRef.current.open = true;
            }}
            aria-busy={busy}
          >
            <SetupStageHeader
              headingRef={headingRef}
              step="reviews"
              title="Set review behavior"
              description="Choose when this workflow needs human review. Nothing is sent or charged during setup."
            />
            <label className="mt-8 block text-sm font-medium">
              Review question
              <textarea
                className="textarea mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                rows={3}
                value={reviewCriterion.criterion}
                onChange={event => setReviewCriterion(current => ({ ...current, criterion: event.target.value }))}
                maxLength={REVIEW_CRITERION_MAX_LENGTH}
                required
              />
            </label>
            <fieldset className="surface-card-nested mt-5 p-4">
              <legend className="px-1 text-sm font-medium">Answer format</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm">
                  Positive label
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={reviewCriterion.positiveLabel}
                    onChange={event =>
                      setReviewCriterion(current => ({ ...current, positiveLabel: event.target.value }))
                    }
                    maxLength={REVIEW_ANSWER_LABEL_MAX_LENGTH}
                    required
                  />
                </label>
                <label className="text-sm">
                  Negative label
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={reviewCriterion.negativeLabel}
                    onChange={event =>
                      setReviewCriterion(current => ({ ...current, negativeLabel: event.target.value }))
                    }
                    maxLength={REVIEW_ANSWER_LABEL_MAX_LENGTH}
                    required
                  />
                </label>
                <label className="text-sm">
                  Rationale
                  <select
                    className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={reviewCriterion.rationaleMode}
                    onChange={event =>
                      setReviewCriterion(current => ({
                        ...current,
                        rationaleMode: event.target.value as ReviewCriterionFormValues["rationaleMode"],
                      }))
                    }
                  >
                    <option value="off">Off</option>
                    <option value="optional">Optional</option>
                    <option value="required">Required</option>
                  </select>
                </label>
              </div>
            </fieldset>
            <fieldset className="mt-7">
              <legend className="text-xl font-semibold">When to review</legend>
              <SetupChoiceGroup>
                {REVIEW_FREQUENCY_OPTIONS.map(([value, label, description, badge]) => (
                  <Fragment key={value}>
                    <SetupRadioChoice
                      id={`agent-setup-review-frequency-${value}`}
                      name="mode"
                      value={value}
                      checked={reviewFrequency.mode === value}
                      onChange={() => setReviewFrequency(current => ({ ...current, mode: value }))}
                      label={label}
                      description={description}
                      badge={badge || undefined}
                    />
                    {reviewFrequency.mode === value && (value === "adaptive" || value === "fixed") ? (
                      <div className="border-b border-white/10 border-l-2 border-l-[var(--rateloop-pink)] bg-black/10 px-4 py-4 sm:ml-10">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="text-sm">
                            {value === "adaptive" ? "Minimum review rate (%)" : "Outputs reviewed (%)"}
                            <input
                              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                              type="number"
                              min={value === "adaptive" ? 10 : 0.01}
                              max={100}
                              step={0.01}
                              inputMode="decimal"
                              value={
                                value === "adaptive"
                                  ? reviewFrequency.adaptiveFloorPercent
                                  : reviewFrequency.fixedPercent
                              }
                              onChange={event =>
                                setReviewFrequency(current => ({
                                  ...current,
                                  [value === "adaptive" ? "adaptiveFloorPercent" : "fixedPercent"]: event.target.value,
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
                                setReviewFrequency(current => ({
                                  ...current,
                                  maximumUnreviewedGap: event.target.value,
                                }))
                              }
                              required
                            />
                          </label>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-base-content/55">
                          {value === "adaptive" ? "Starts at 100% while calibrating. " : ""}
                          Critical, incomplete, or low-confidence outputs can still require review.
                        </p>
                      </div>
                    ) : null}
                    {reviewFrequency.mode === value && value === "rules" ? (
                      <div className="border-b border-white/10 border-l-2 border-l-[var(--rateloop-pink)] bg-black/10 px-4 py-4 sm:ml-10">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="text-sm">
                            Review these risk levels
                            <input
                              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                              value={reviewFrequency.requiredRiskTiers}
                              onChange={event =>
                                setReviewFrequency(current => ({
                                  ...current,
                                  requiredRiskTiers: event.target.value,
                                }))
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
                                setReviewFrequency(current => ({
                                  ...current,
                                  minimumConfidencePercent: event.target.value,
                                }))
                              }
                            />
                          </label>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-base-content/55">
                          Separate risk levels with commas. Critical or incomplete outputs always require review.
                        </p>
                      </div>
                    ) : null}
                  </Fragment>
                ))}
              </SetupChoiceGroup>
            </fieldset>
            <details ref={reviewDetailsRef} className="group mt-7 border-y border-white/10 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-lg font-semibold">Reviewers, timing and payment</span>
                  <span className="mt-1 block text-sm leading-6 text-base-content/55">{reviewerDetailsSummary}</span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-xl text-base-content/55 transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="pb-1 pt-6">
                <fieldset>
                  <legend className="text-lg font-semibold">Who should review?</legend>
                  <SetupChoiceGroup>
                    {REVIEW_AUDIENCE_OPTIONS.map(([value, label, description]) => (
                      <SetupRadioChoice
                        key={value}
                        id={`agent-setup-review-audience-${value}`}
                        name="audience"
                        value={value}
                        checked={reviewAudience.audience === value}
                        onChange={() => {
                          setReviewAudience(current => ({ ...current, audience: value }));
                          if (value !== "private_invited") {
                            setReviewCompensation(current => ({ ...current, compensationMode: "usdc" }));
                          }
                        }}
                        label={label}
                        description={description}
                      />
                    ))}
                  </SetupChoiceGroup>
                </fieldset>
                {reviewAudience.audience !== "private_invited" ? (
                  <p className="mt-4 border-l-2 border-l-[var(--rateloop-yellow)] pl-4 text-sm leading-6 text-base-content/65">
                    Public, synthetic, or safely redacted material only.
                  </p>
                ) : null}
                <fieldset className="mt-6 border-t border-white/10 pt-5">
                  <legend className="text-lg font-semibold">Required reviewer expertise</legend>
                  <p className="mb-3 text-sm text-base-content/60">
                    Optional. A request is blocked unless the selected audience can fill every seat.
                  </p>
                  <div className="surface-card-nested mt-3 grid overflow-hidden sm:grid-cols-2">
                    {REVIEWER_EXPERTISE.map(option => (
                      <label
                        key={option.key}
                        className="flex min-h-12 items-center gap-3 border-b border-white/10 p-3 text-sm sm:odd:border-r"
                      >
                        <input
                          className="checkbox checkbox-sm"
                          type="checkbox"
                          checked={reviewExpertise.requiredExpertiseKeys.includes(option.key)}
                          onChange={event =>
                            setReviewExpertise(current => ({
                              requiredExpertiseKeys: event.target.checked
                                ? [...current.requiredExpertiseKeys, option.key]
                                : current.requiredExpertiseKeys.filter(key => key !== option.key),
                            }))
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  <p
                    className={`mt-3 text-sm ${
                      !expertiseEligibilityStatus.feasible ? "text-error" : "text-base-content/60"
                    }`}
                    aria-live="polite"
                  >
                    {expertiseEligibilityStatus.summary}
                  </p>
                </fieldset>
                <fieldset className="mt-6 border-t border-white/10 pt-5">
                  <legend className="text-lg font-semibold">Review round</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="text-sm">
                      <p>Response window</p>
                      <DurationInput
                        id="agent-setup-review-response-window"
                        className="mt-2"
                        ariaLabel="Response window"
                        valueSeconds={reviewTiming.responseWindowSeconds}
                        minSeconds={MIN_REVIEW_RESPONSE_WINDOW_SECONDS}
                        maxSeconds={MAX_REVIEW_RESPONSE_WINDOW_SECONDS}
                        summarySuffix="Frozen when a request opens"
                        onChangeSeconds={responseWindowSeconds =>
                          setReviewTiming(current => ({ ...current, responseWindowSeconds }))
                        }
                      />
                    </div>
                    <label className="text-sm">
                      Reviewers per request
                      <input
                        className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                        type="number"
                        inputMode="numeric"
                        min={reviewAudience.audience === "private_invited" ? 1 : 3}
                        max={MAX_REVIEW_PANEL_SIZE}
                        step={1}
                        value={reviewTiming.panelSize}
                        onChange={event => setReviewTiming(current => ({ ...current, panelSize: event.target.value }))}
                        required
                      />
                    </label>
                  </div>
                </fieldset>
                <fieldset className="mt-6 border-t border-white/10 pt-5">
                  <legend className="text-lg font-semibold">Guaranteed bounty</legend>
                  <SetupChoiceGroup>
                    <SetupRadioChoice
                      id="agent-setup-compensation-unpaid"
                      name="compensationMode"
                      value="unpaid"
                      checked={
                        reviewAudience.audience === "private_invited" &&
                        reviewCompensation.compensationMode === "unpaid"
                      }
                      disabled={reviewAudience.audience !== "private_invited"}
                      onChange={() => setReviewCompensation(current => ({ ...current, compensationMode: "unpaid" }))}
                      label="No bounty"
                      description="No guaranteed payment."
                    />
                    <SetupRadioChoice
                      id="agent-setup-compensation-usdc"
                      name="compensationMode"
                      value="usdc"
                      checked={
                        reviewAudience.audience !== "private_invited" || reviewCompensation.compensationMode === "usdc"
                      }
                      onChange={() => setReviewCompensation(current => ({ ...current, compensationMode: "usdc" }))}
                      label="Add USDC bounty"
                      description="Pay each accepted reviewer."
                    />
                  </SetupChoiceGroup>
                  {reviewAudience.audience !== "private_invited" ? (
                    <p className="mt-3 text-xs text-base-content/55">
                      Public and hybrid network assignments currently require a guaranteed bounty. Bonus-only network
                      review will appear after its dedicated assignment adapter is available.
                    </p>
                  ) : null}
                  {reviewCompensation.compensationMode === "usdc" ? (
                    <label className="mt-4 block text-sm">
                      USDC per reviewer
                      <input
                        className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]+([.][0-9]{1,6})?"
                        maxLength={REVIEW_USDC_DECIMAL_MAX_LENGTH}
                        value={reviewCompensation.usdcPerReviewer}
                        onChange={event =>
                          setReviewCompensation(current => ({ ...current, usdcPerReviewer: event.target.value }))
                        }
                        required
                      />
                    </label>
                  ) : null}
                </fieldset>
                <fieldset className="mt-6 border-t border-white/10 pt-5">
                  <legend className="text-lg font-semibold">Feedback Bonus</legend>
                  <p className="text-sm text-base-content/60">
                    Optional and separate from the guaranteed bounty. A human later chooses useful written feedback to
                    pay.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
                    <button
                      type="button"
                      aria-pressed={!reviewCompensation.feedbackBonusEnabled}
                      className={`btn btn-sm ${!reviewCompensation.feedbackBonusEnabled ? "btn-primary" : "btn-outline"}`}
                      onClick={() => setReviewCompensation(current => ({ ...current, feedbackBonusEnabled: false }))}
                    >
                      No bonus
                    </button>
                    <button
                      type="button"
                      aria-pressed={reviewCompensation.feedbackBonusEnabled}
                      className={`btn btn-sm ${reviewCompensation.feedbackBonusEnabled ? "btn-primary" : "btn-outline"}`}
                      onClick={() => setReviewCompensation(current => ({ ...current, feedbackBonusEnabled: true }))}
                    >
                      Add bonus
                    </button>
                  </div>
                  {reviewCompensation.feedbackBonusEnabled ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="text-sm">
                        Bonus pool
                        <div className="input mt-2 flex w-full items-center gap-2 border-white/10 bg-[var(--rateloop-field)]">
                          <input
                            className="min-w-0 grow bg-transparent outline-none"
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9]+([.][0-9]{1,6})?"
                            maxLength={REVIEW_USDC_DECIMAL_MAX_LENGTH}
                            value={reviewCompensation.feedbackBonusUsdc}
                            onChange={event =>
                              setReviewCompensation(current => ({ ...current, feedbackBonusUsdc: event.target.value }))
                            }
                            required
                          />
                          <span className="text-base-content/50">USDC</span>
                        </div>
                      </label>
                      <label className="text-sm">
                        Human awarder
                        <select
                          className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                          value={reviewCompensation.feedbackBonusAwarderKind}
                          onChange={event =>
                            setReviewCompensation(current => ({
                              ...current,
                              feedbackBonusAwarderKind: event.target.value as "requester" | "designated",
                            }))
                          }
                        >
                          <option value="requester">Me (requester)</option>
                          <option value="designated">Designated authenticated human</option>
                        </select>
                      </label>
                      {reviewCompensation.feedbackBonusAwarderKind === "designated" ? (
                        <label className="text-sm sm:col-span-2">
                          Awarder account
                          <input
                            className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                            value={reviewCompensation.feedbackBonusAwarderAccount}
                            onChange={event =>
                              setReviewCompensation(current => ({
                                ...current,
                                feedbackBonusAwarderAccount: event.target.value,
                              }))
                            }
                            placeholder="Authenticated RateLoop account"
                            maxLength={320}
                            required
                          />
                        </label>
                      ) : null}
                      <p className="text-xs text-base-content/55 sm:col-span-2">
                        {
                          "The agent may prepare or fund this exact pool within its grant, but it can never select or execute an award."
                        }
                      </p>
                    </div>
                  ) : null}
                </fieldset>
              </div>
            </details>
            <fieldset className="mt-7">
              <legend className="text-xl font-semibold">Agent authority</legend>
              <SetupChoiceGroup>
                {REVIEW_AUTHORITY_OPTIONS.map(([value, label, description]) => (
                  <SetupRadioChoice
                    key={value}
                    id={`agent-setup-authority-${value}`}
                    name="authority"
                    value={value}
                    checked={reviewCompensation.authority === value}
                    onChange={() => setReviewCompensation(current => ({ ...current, authority: value }))}
                    label={label}
                    description={description}
                  />
                ))}
              </SetupChoiceGroup>
            </fieldset>
            {pendingReviewConfirmation?.fingerprint === currentReviewFingerprint ? (
              <section
                aria-labelledby="agent-setup-review-consent-heading"
                className="surface-card-nested mt-7 border-l-2 border-l-[var(--rateloop-pink)] p-5"
              >
                <h2 id="agent-setup-review-consent-heading" className="text-xl font-semibold">
                  Confirm these exact terms
                </h2>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-base-content/55">When</dt>
                    <dd>{reviewFrequencySummary(pendingReviewConfirmation.selection)}</dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Who and what</dt>
                    <dd>{reviewAudienceSummary(pendingReviewConfirmation.requestProfile.audience)}</dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Required expertise</dt>
                    <dd>
                      {pendingReviewConfirmation.requestProfile.requiredExpertiseKeys?.length
                        ? pendingReviewConfirmation.requestProfile.requiredExpertiseKeys
                            .map(key => REVIEWER_EXPERTISE.find(option => option.key === key)?.label ?? key)
                            .join(", ")
                        : "None"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Question</dt>
                    <dd>{pendingReviewConfirmation.requestProfile.criterion}</dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Answers</dt>
                    <dd>
                      {pendingReviewConfirmation.requestProfile.positiveLabel} /{` `}
                      {pendingReviewConfirmation.requestProfile.negativeLabel}; rationale{` `}
                      {pendingReviewConfirmation.requestProfile.rationaleMode}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Round</dt>
                    <dd>
                      {pendingReviewConfirmation.requestProfile.panelSize} reviewers;{` `}
                      {formatResponseWindow(pendingReviewConfirmation.requestProfile.responseWindowSeconds)} to answer
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Base payment</dt>
                    <dd>
                      {pendingReviewConfirmation.requestProfile.compensationMode === "usdc" &&
                      pendingReviewConfirmation.requestProfile.bountyPerSeatAtomic
                        ? `${usdcAtomicToDecimal(pendingReviewConfirmation.requestProfile.bountyPerSeatAtomic)} USDC per accepted reviewer`
                        : "Unpaid; no base reviewer bounty"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Feedback Bonus</dt>
                    <dd>
                      {pendingReviewConfirmation.requestProfile.feedbackBonusEnabled &&
                      pendingReviewConfirmation.requestProfile.feedbackBonusPoolAtomic
                        ? `${usdcAtomicToDecimal(pendingReviewConfirmation.requestProfile.feedbackBonusPoolAtomic)} USDC pool · ${
                            pendingReviewConfirmation.requestProfile.feedbackBonusAwarderKind === "designated"
                              ? "designated human awarder"
                              : "requester awards"
                          }`
                        : "Off"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Maximum payment consent</dt>
                    <dd>
                      {formatConsentUsdc(
                        BigInt(
                          pendingReviewConfirmation.requestProfile.compensationMode === "usdc" &&
                            pendingReviewConfirmation.requestProfile.bountyPerSeatAtomic
                            ? pendingReviewConfirmation.requestProfile.bountyPerSeatAtomic
                            : "0",
                        ) *
                          BigInt(pendingReviewConfirmation.requestProfile.panelSize ?? 0) +
                          BigInt(pendingReviewConfirmation.requestProfile.feedbackBonusPoolAtomic ?? "0"),
                      )}{" "}
                      USDC before base-review fee and attempt reserve
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-base-content/55">Agent authority</dt>
                    <dd>{reviewAuthoritySummary(pendingReviewConfirmation.authority)}</dd>
                  </div>
                </dl>
                <label className="mt-4 flex gap-3 border-t border-white/10 pt-4 text-sm">
                  <input
                    className="checkbox checkbox-sm mt-0.5"
                    type="checkbox"
                    checked={confirmedReviewFingerprint === currentReviewFingerprint}
                    onChange={event =>
                      setConfirmedReviewFingerprint(event.target.checked ? currentReviewFingerprint : null)
                    }
                    required
                  />
                  <span>I confirm this exact human-review configuration.</span>
                </label>
              </section>
            ) : (
              <p className="mt-4 text-xs text-base-content/55">
                Review the exact terms before saving. No request is published and no funds are spent during setup.
              </p>
            )}
            <SetupActionBar>
              {backButton}
              <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy}>
                {busy
                  ? "Saving…"
                  : pendingReviewConfirmation?.fingerprint === currentReviewFingerprint
                    ? "Save and continue"
                    : "Review settings"}
              </Button>
            </SetupActionBar>
          </form>
        ) : null}

        {currentStep === "people" ? (
          <>
            <SetupStageHeader
              headingRef={headingRef}
              step="people"
              title="People and funding"
              description="Choose who can review and confirm how review is funded."
            />
            {!setup.peopleDecision ? (
              <form className="mt-5" onSubmit={configurePeople} aria-busy={busy}>
                {setup.reviewDraft?.requestProfile.audience === "public_network" ? (
                  <>
                    <input type="hidden" name="decision" value="not_required" />
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
                      <p className="font-medium">RateLoop network</p>
                      <p className="mt-1 text-base-content/60">
                        No invitation is needed. Eligible network reviewers can receive public, synthetic, or safely
                        redacted requests.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <fieldset className="space-y-3">
                      <legend className="font-medium">Invite a reviewer now?</legend>
                      <label className="flex gap-3 rounded-xl border border-white/10 p-4">
                        <input
                          className="radio mt-0.5"
                          type="radio"
                          name="decision"
                          value="invited"
                          aria-label="Create a one-use code"
                          defaultChecked
                        />
                        <span>
                          <span className="font-medium">Create a one-use code</span>
                          <span className="mt-1 block text-sm text-base-content/60">
                            The code expires in seven days.
                          </span>
                        </span>
                      </label>
                      <label className="flex gap-3 rounded-xl border border-white/10 p-4">
                        <input
                          className="radio mt-0.5"
                          type="radio"
                          name="decision"
                          value="later"
                          aria-label="Invite later"
                        />
                        <span>
                          <span className="font-medium">Invite later</span>
                          <span className="mt-1 block text-sm text-base-content/60">
                            The saved reviewer group stays ready.
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
                  </>
                )}
                {setup.reviewDraft?.requestProfile.compensationMode === "usdc" ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
                    <p className="font-medium">{reviewCompensation.usdcPerReviewer} USDC per accepted reviewer</p>
                    <p className="mt-1 text-base-content/60">
                      Available workspace funding is checked and reserved only when a request is prepared.
                    </p>
                  </div>
                ) : null}
                {setup.reviewDraft?.requestProfile.feedbackBonusEnabled ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
                    <p className="font-medium">{reviewCompensation.feedbackBonusUsdc} USDC Feedback Bonus pool</p>
                    <p className="mt-1 text-base-content/60">
                      Funded separately before assignment. Only the saved human awarder can choose feedback to pay.
                    </p>
                  </div>
                ) : null}
                <SetupActionBar>
                  {backButton}
                  <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Continue"}
                  </Button>
                </SetupActionBar>
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
                    {setup.peopleDecision === "invited"
                      ? "Invitation code created"
                      : setup.peopleDecision === "not_required"
                        ? "RateLoop network; no invitation needed"
                        : "Invite later"}
                  </p>
                  {setup.reviewDraft?.requestProfile.compensationMode === "usdc" ? (
                    <p className="mt-2">
                      <span className="text-base-content/55">Base bounty:</span> {reviewCompensation.usdcPerReviewer}{" "}
                      USDC per accepted reviewer
                    </p>
                  ) : null}
                  {setup.reviewDraft?.requestProfile.feedbackBonusEnabled ? (
                    <p className="mt-2">
                      <span className="text-base-content/55">Feedback Bonus:</span>{" "}
                      {reviewCompensation.feedbackBonusUsdc} USDC · human-awarded
                    </p>
                  ) : null}
                  <p className="mt-2">
                    <span className="text-base-content/55">Authority:</span>{" "}
                    {reviewAuthoritySummary(setup.reviewDraft?.authority ?? "check_only")}
                  </p>
                </div>
                <SetupActionBar className="mt-0">
                  {backButton}
                  <Button
                    className="min-h-11 w-full sm:w-auto"
                    type="button"
                    disabled={busy}
                    onClick={() => void finishSetup()}
                  >
                    {busy ? "Finishing…" : "Finish setup"}
                  </Button>
                </SetupActionBar>
              </div>
            )}
          </>
        ) : null}

        {error ? (
          <p
            id="agent-setup-error"
            role="alert"
            className="mt-5 rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-sm text-error"
          >
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
