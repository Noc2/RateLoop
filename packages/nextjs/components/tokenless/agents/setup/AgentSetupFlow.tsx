"use client";

import { type FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AgentConnectionTroubleshooting } from "../AgentConnectionTroubleshooting";
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
} from "./reviewCompensation";
import {
  REVIEW_ANSWER_LABEL_MAX_LENGTH,
  REVIEW_CRITERION_MAX_LENGTH,
  type ReviewCriterionFormValues,
  buildReviewCriterionRequestProfile,
  reviewCriterionFormValues,
} from "./reviewCriterion";
import {
  type ReviewExpertiseFormValues,
  buildReviewExpertiseRequestProfile,
  expertiseRequirementLabel,
  hydrateLegacyExpertiseRequirements,
  requirementForDefinition,
  requirementsForAudience,
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
import { humanReviewConfirmationMessage } from "~~/components/tokenless/agents/humanReviewConfirmation";
import { Button } from "~~/components/tokenless/ui/Button";
import { DurationInput } from "~~/components/ui/DurationInput";
import { type AgentSetupScreenStep, agentSetupUrl } from "~~/lib/tokenless/agentSetupNavigation";
import type {
  ReviewerExpertiseDefinition,
  ReviewerExpertiseRequirement,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
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

type ExpertiseDefinitionsResponse = {
  definitions: ReviewerExpertiseDefinition[];
  suggestedDefinitionIds: string[];
};

type PrivateExpertiseCoverage = {
  ready: boolean;
  status: "ready" | "action_required";
  requirements: Array<
    ReviewerExpertiseRequirement & {
      label: string;
      confirmedSeats: number;
      pendingInvitationSeats: number;
      missingSeats: number;
      status: "ready" | "pending_confirmation" | "missing";
    }
  >;
};

function reviewAuthoritySummary(authority: AgentSetupReviewDraft["authority"]) {
  if (authority === "prepare_for_approval") return "Prepare each required request and wait for owner approval";
  if (authority === "ask_automatically") return "Send within the exact owner-approved publishing and funding grant";
  return "Check whether review is required; do not prepare, send, or spend";
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
  const [expertiseDefinitions, setExpertiseDefinitions] = useState<ReviewerExpertiseDefinition[]>([]);
  const [suggestedExpertiseIds, setSuggestedExpertiseIds] = useState<string[]>([]);
  const [expertiseDefinitionsLoading, setExpertiseDefinitionsLoading] = useState(false);
  const [expertiseDefinitionsError, setExpertiseDefinitionsError] = useState<string | null>(null);
  const [showCustomExpertise, setShowCustomExpertise] = useState(false);
  const [customExpertiseLabel, setCustomExpertiseLabel] = useState("");
  const [customExpertiseDescription, setCustomExpertiseDescription] = useState("");
  const [creatingCustomExpertise, setCreatingCustomExpertise] = useState(false);
  const [reviewTiming, setReviewTiming] = useState<ReviewTimingFormValues>(() =>
    reviewTimingFormValues(initialSetup.reviewDraft?.requestProfile),
  );
  const [reviewCompensation, setReviewCompensation] = useState<ReviewCompensationFormValues>(() =>
    reviewCompensationFormValues(initialSetup.reviewDraft?.requestProfile, initialSetup.reviewDraft?.authority),
  );
  const [peopleDecision, setPeopleDecision] = useState<"invited" | "later">("invited");
  const [invitationExpertiseIds, setInvitationExpertiseIds] = useState<string[]>(() =>
    (initialSetup.reviewDraft?.requestProfile.expertiseRequirements ?? [])
      .filter(requirement => requirement.sourceScope === "customer_invited")
      .map(requirement => requirement.definitionId),
  );
  const [expertiseCoverage, setExpertiseCoverage] = useState<PrivateExpertiseCoverage | null>(null);
  const [expertiseCoverageLoading, setExpertiseCoverageLoading] = useState(false);
  const [expertiseCoverageError, setExpertiseCoverageError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const connectionMessageRef = useRef<HTMLTextAreaElement>(null);
  const reviewDetailsRef = useRef<HTMLDetailsElement>(null);
  const invitationExpertiseInitialized = useRef(false);
  const focusOnNavigation = useRef(false);
  const currentStep = setup.currentStep === "complete" ? "people" : setup.currentStep;
  const privateExpertiseRequirements = useMemo(
    () =>
      (setup.reviewDraft?.requestProfile.expertiseRequirements ?? []).filter(
        requirement => requirement.sourceScope === "customer_invited",
      ),
    [setup.reviewDraft?.requestProfile.expertiseRequirements],
  );
  const privateExpertiseCoverageKey = JSON.stringify({
    groupId: setup.reviewDraft?.requestProfile.privateGroupId ?? setup.privateGroupId,
    requirements: privateExpertiseRequirements,
    responseWindowSeconds: setup.reviewDraft?.requestProfile.responseWindowSeconds,
  });
  const expertiseSuggestionContext = [
    setup.agent?.displayName,
    setup.agent?.description,
    reviewCriterion.criterion,
    reviewFrequency.requiredRiskTiers,
  ]
    .filter(Boolean)
    .join(" ");
  const reviewerCount = reviewTiming.panelSize || "—";
  const reviewerDetailsSummary = `${
    reviewAudience.audience === "private_invited" ? "Invited reviewers · private material" : "Public-safe material"
  } · ${reviewerCount} reviewer${reviewerCount === "1" ? "" : "s"} · ${
    reviewCompensation.compensationMode === "usdc" ? `${reviewCompensation.usdcPerReviewer || "—"} USDC each` : "Unpaid"
  }`;
  const selectedExpertiseIds = new Set(reviewExpertise.requirements.map(requirement => requirement.definitionId));
  const selectableExpertiseDefinitions = expertiseDefinitions.filter(
    definition =>
      !selectedExpertiseIds.has(definition.definitionId) &&
      (reviewAudience.audience === "private_invited" || (definition.scope === "global" && definition.networkEligible)),
  );
  const suggestedExpertiseDefinitions = suggestedExpertiseIds
    .map(definitionId => selectableExpertiseDefinitions.find(definition => definition.definitionId === definitionId))
    .filter((definition): definition is ReviewerExpertiseDefinition => Boolean(definition));
  const exampleExpertiseDefinitions = (
    suggestedExpertiseDefinitions.length > 0
      ? suggestedExpertiseDefinitions
      : selectableExpertiseDefinitions.filter(definition => definition.scope === "global")
  ).slice(0, 3);
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
    if (currentStep !== "reviews" && currentStep !== "people") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams();
      if (expertiseSuggestionContext.trim()) query.set("context", expertiseSuggestionContext);
      setExpertiseDefinitionsLoading(true);
      setExpertiseDefinitionsError(null);
      void fetch(
        `/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/reviewer-expertise/definitions?${query}`,
        { cache: "no-store", credentials: "same-origin", signal: controller.signal },
      )
        .then(readJson)
        .then(body => {
          if (controller.signal.aborted) return;
          const result = body as unknown as ExpertiseDefinitionsResponse;
          const definitions = Array.isArray(result.definitions) ? result.definitions : [];
          setExpertiseDefinitions(definitions);
          setSuggestedExpertiseIds(Array.isArray(result.suggestedDefinitionIds) ? result.suggestedDefinitionIds : []);
          setReviewExpertise(current =>
            hydrateLegacyExpertiseRequirements({
              audience: reviewAudience.audience,
              definitions,
              panelSize: reviewTiming.panelSize,
              values: current,
            }),
          );
        })
        .catch(cause => {
          if (!controller.signal.aborted) {
            setExpertiseDefinitionsError(
              cause instanceof Error ? cause.message : "Specialist areas could not be loaded.",
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setExpertiseDefinitionsLoading(false);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [currentStep, expertiseSuggestionContext, reviewAudience.audience, reviewTiming.panelSize, setup.workspaceId]);

  useEffect(() => {
    if (currentStep !== "people") return;
    const allowedDefinitionIds = privateExpertiseRequirements.map(requirement => requirement.definitionId);
    setInvitationExpertiseIds(current => {
      if (!invitationExpertiseInitialized.current) {
        invitationExpertiseInitialized.current = true;
        return allowedDefinitionIds;
      }
      return current.filter(definitionId => allowedDefinitionIds.includes(definitionId));
    });
  }, [currentStep, privateExpertiseCoverageKey, privateExpertiseRequirements]);

  useEffect(() => {
    if (currentStep !== "people") return;
    const groupId = setup.reviewDraft?.requestProfile.privateGroupId ?? setup.privateGroupId;
    if (!groupId || privateExpertiseRequirements.length === 0) {
      setExpertiseCoverage(null);
      setExpertiseCoverageError(null);
      setExpertiseCoverageLoading(false);
      return;
    }
    const controller = new AbortController();
    const responseWindowSeconds = setup.reviewDraft?.requestProfile.responseWindowSeconds ?? 3_600;
    const responseDeadline = new Date(Date.now() + Math.max(60, responseWindowSeconds) * 1_000).toISOString();
    setExpertiseCoverageLoading(true);
    setExpertiseCoverageError(null);
    void fetch(
      `/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/private-groups/${encodeURIComponent(groupId)}/expertise-coverage`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements: privateExpertiseRequirements, responseDeadline }),
        signal: controller.signal,
      },
    )
      .then(readJson)
      .then(body => {
        if (!controller.signal.aborted) {
          setExpertiseCoverage((body as { coverage?: PrivateExpertiseCoverage }).coverage ?? null);
        }
      })
      .catch(cause => {
        if (!controller.signal.aborted) {
          setExpertiseCoverage(null);
          setExpertiseCoverageError(
            cause instanceof Error ? cause.message : "Specialist coverage could not be checked.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setExpertiseCoverageLoading(false);
      });
    return () => controller.abort();
  }, [
    currentStep,
    privateExpertiseCoverageKey,
    privateExpertiseRequirements,
    setup.privateGroupId,
    setup.reviewDraft?.requestProfile.privateGroupId,
    setup.reviewDraft?.requestProfile.responseWindowSeconds,
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

  function addExpertiseDefinition(definition: ReviewerExpertiseDefinition) {
    setReviewExpertise(current => {
      if (
        current.requirements.some(requirement => requirement.definitionId === definition.definitionId) ||
        current.requirements.length >= 8
      ) {
        return current;
      }
      return {
        ...current,
        needsSpecialists: true,
        requirements: [
          ...current.requirements,
          requirementForDefinition({
            audience: reviewAudience.audience,
            definition,
            panelSize: reviewTiming.panelSize,
          }),
        ],
      };
    });
    setError(null);
  }

  function removeExpertiseRequirement(definitionId: string) {
    setReviewExpertise(current => ({
      ...current,
      requirements: current.requirements.filter(requirement => requirement.definitionId !== definitionId),
      legacyRequiredExpertiseKeys: current.legacyRequiredExpertiseKeys.filter(key => {
        const definition = expertiseDefinitions.find(candidate => candidate.key === key);
        return definition?.definitionId !== definitionId;
      }),
    }));
  }

  function changeReviewAudience(audience: AgentSetupReviewDraft["requestProfile"]["audience"]) {
    setReviewAudience(current => ({ ...current, audience }));
    const requirements = requirementsForAudience({
      audience,
      definitions: expertiseDefinitions,
      panelSize: reviewTiming.panelSize,
      requirements: reviewExpertise.requirements,
    });
    if (audience === "hybrid" && reviewExpertise.needsSpecialists) {
      setAnnouncement(
        reviewExpertise.legacyRequiredExpertiseKeys.length
          ? "The saved legacy all-seat specialist requirement remains active for the hybrid panel."
          : "Hybrid specialist seats need separate invited and network policies and are not available yet.",
      );
    } else if (requirements.length < reviewExpertise.requirements.length) {
      setAnnouncement(
        "Workspace-only specialist areas were removed because network review requires RateLoop-verified areas.",
      );
    }
    setReviewExpertise(current => {
      const next = {
        ...current,
        needsSpecialists:
          audience === "hybrid" ? current.legacyRequiredExpertiseKeys.length > 0 : current.needsSpecialists,
        requirements,
        legacyRequiredExpertiseKeys:
          audience === "hybrid" && current.legacyRequiredExpertiseKeys.length === 0
            ? []
            : current.legacyRequiredExpertiseKeys,
      };
      return audience === "hybrid" && next.legacyRequiredExpertiseKeys.length
        ? hydrateLegacyExpertiseRequirements({
            audience,
            definitions: expertiseDefinitions,
            panelSize: reviewTiming.panelSize,
            values: next,
          })
        : next;
    });
    if (audience !== "private_invited") {
      setShowCustomExpertise(false);
      setReviewCompensation(current => ({ ...current, compensationMode: "usdc" }));
    }
  }

  function changeQuestionAuthority(questionAuthority: ReviewCriterionFormValues["questionAuthority"]) {
    setReviewCriterion(current => ({ ...current, questionAuthority }));
    if (questionAuthority === "agent_per_request") {
      setReviewFrequency(current => (current.mode === "adaptive" ? { ...current, mode: "always" } : current));
      changeReviewAudience("public_network");
      setAnnouncement("Agent-written questions use public-network feedback and cannot change adaptive coverage.");
    }
  }

  async function createCustomExpertiseDefinition() {
    const label = customExpertiseLabel.trim();
    const description = customExpertiseDescription.trim();
    if (!label || !description) {
      setError("Name the specialist area and explain what qualifies someone.");
      return;
    }
    setCreatingCustomExpertise(true);
    setError(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/reviewer-expertise/definitions`, {
          method: "POST",
          body: JSON.stringify({ label, description }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      const definition = body.definition as ReviewerExpertiseDefinition | undefined;
      if (!definition?.definitionId) throw new Error("The specialist area could not be confirmed.");
      setExpertiseDefinitions(current => [...current, definition]);
      addExpertiseDefinition(definition);
      setCustomExpertiseLabel("");
      setCustomExpertiseDescription("");
      setShowCustomExpertise(false);
      setAnnouncement(`${definition.label} was added to this workspace and selected.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the specialist area.");
    } finally {
      setCreatingCustomExpertise(false);
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
      const draft = setup.reviewDraft;
      if (!draft) throw new Error("Review behavior is unavailable. Reload setup and try again.");
      const selection = buildReviewFrequencySelection(draft.selection, reviewFrequency);
      const audienceProfile = buildReviewAudienceRequestProfile(draft.requestProfile, reviewAudience);
      const criterionProfile = buildReviewCriterionRequestProfile(audienceProfile, reviewCriterion);
      const expertiseProfile = buildReviewExpertiseRequestProfile(
        criterionProfile,
        reviewExpertise,
        reviewTiming.panelSize,
      );
      const timingProfile = buildReviewTimingRequestProfile(expertiseProfile, reviewTiming);
      const { requestProfile, authority } = buildReviewCompensationConfiguration(timingProfile, reviewCompensation);
      const confirmation = humanReviewConfirmationMessage({
        authority,
        bountyPerSeatAtomic: requestProfile.compensationMode === "usdc" ? requestProfile.bountyPerSeatAtomic : null,
        feedbackBonusPoolAtomic: requestProfile.feedbackBonusEnabled
          ? (requestProfile.feedbackBonusPoolAtomic ?? null)
          : null,
        panelSize: requestProfile.panelSize,
      });
      if (confirmation && !window.confirm(confirmation)) return;
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
            expertiseDefinitionIds: decision === "invited" ? invitationExpertiseIds : [],
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
      className="rateloop-secondary-action rateloop-back-action min-h-11 w-full gap-2 sm:w-auto"
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
                <AgentConnectionTroubleshooting />
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
            <fieldset className="mt-8">
              <legend className="text-xl font-semibold">Who writes the question?</legend>
              <SetupChoiceGroup>
                <SetupRadioChoice
                  id="agent-setup-question-owner-fixed"
                  name="questionAuthority"
                  value="owner_fixed"
                  checked={reviewCriterion.questionAuthority === "owner_fixed"}
                  onChange={() => changeQuestionAuthority("owner_fixed")}
                  label="Use one question"
                  description="Set one question and answer format for every review."
                />
                <SetupRadioChoice
                  id="agent-setup-question-agent-per-request"
                  name="questionAuthority"
                  value="agent_per_request"
                  checked={reviewCriterion.questionAuthority === "agent_per_request"}
                  onChange={() => changeQuestionAuthority("agent_per_request")}
                  label="Let the agent ask each time"
                  description="The agent supplies a question and two answers for each review."
                />
              </SetupChoiceGroup>
            </fieldset>
            {reviewCriterion.questionAuthority === "owner_fixed" ? (
              <label className="mt-6 block text-sm font-medium">
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
            ) : (
              <p className="mt-5 border-l-2 border-l-[var(--rateloop-yellow)] pl-4 text-sm leading-6 text-base-content/65">
                Agent-written questions collect feedback only. They use RateLoop network reviewers and never change
                adaptive review coverage.
              </p>
            )}
            <fieldset className="surface-card-nested mt-5 p-4">
              <legend className="px-1 text-sm font-medium">
                {reviewCriterion.questionAuthority === "owner_fixed" ? "Answer format" : "Written feedback"}
              </legend>
              <div className="grid gap-4 sm:grid-cols-3">
                {reviewCriterion.questionAuthority === "owner_fixed" ? (
                  <>
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
                  </>
                ) : null}
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
                      badge={reviewCriterion.questionAuthority === "agent_per_request" ? undefined : badge || undefined}
                      disabled={reviewCriterion.questionAuthority === "agent_per_request" && value === "adaptive"}
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
                        onChange={() => changeReviewAudience(value)}
                        label={label}
                        description={description}
                        disabled={
                          reviewCriterion.questionAuthority === "agent_per_request" && value !== "public_network"
                        }
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
                  <legend className="text-lg font-semibold">Does this review need specialist knowledge?</legend>
                  <p className="mt-1 text-sm leading-6 text-base-content/60">
                    Choose knowledge needed to answer the review question. You&apos;ll confirm suitable people in the
                    next step.
                  </p>
                  <SetupChoiceGroup>
                    <SetupRadioChoice
                      id="agent-setup-specialists-no"
                      name="specialistKnowledge"
                      value="no"
                      checked={!reviewExpertise.needsSpecialists}
                      onChange={() =>
                        setReviewExpertise(current => ({
                          ...current,
                          needsSpecialists: false,
                          requirements: [],
                          legacyRequiredExpertiseKeys: [],
                        }))
                      }
                      label="No specialist needed"
                      description="Any otherwise eligible reviewer may take a seat."
                    />
                    <SetupRadioChoice
                      id="agent-setup-specialists-yes"
                      name="specialistKnowledge"
                      value="yes"
                      checked={reviewExpertise.needsSpecialists}
                      onChange={() => setReviewExpertise(current => ({ ...current, needsSpecialists: true }))}
                      label="Require specialist knowledge"
                      description="Choose one or more areas and the seats each area must cover."
                      disabled={reviewAudience.audience === "hybrid"}
                    />
                  </SetupChoiceGroup>
                  {reviewAudience.audience === "hybrid" ? (
                    <p className="mt-3 text-sm leading-6 text-base-content/60">
                      {reviewExpertise.legacyRequiredExpertiseKeys.length
                        ? "This saved all-seat requirement remains active. New hybrid specialist rules need separately frozen invited and network seats."
                        : "Hybrid specialist panels need separately frozen invited and network seats. Choose one reviewer source to require specialist knowledge today."}
                    </p>
                  ) : null}
                </fieldset>
                {reviewExpertise.needsSpecialists ? (
                  <section
                    className="mt-5 border-l-2 border-l-[var(--rateloop-pink)] pl-4"
                    aria-labelledby="agent-setup-specialist-areas-heading"
                  >
                    <h3 id="agent-setup-specialist-areas-heading" className="font-semibold">
                      Specialist areas
                    </h3>
                    {reviewExpertise.requirements.length ? (
                      <ul className="mt-3 space-y-3">
                        {reviewExpertise.requirements.map(requirement => {
                          const definition = expertiseDefinitions.find(
                            candidate => candidate.definitionId === requirement.definitionId,
                          );
                          return (
                            <li key={requirement.definitionId} className="surface-card-nested rounded-xl p-4">
                              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="font-medium">
                                    {definition?.label ?? expertiseRequirementLabel(requirement, expertiseDefinitions)}
                                  </p>
                                  {definition?.description ? (
                                    <p className="mt-1 text-sm leading-6 text-base-content/55">
                                      {definition.description}
                                    </p>
                                  ) : null}
                                </div>
                                <button
                                  className="btn btn-sm rateloop-secondary-action shrink-0"
                                  type="button"
                                  onClick={() => removeExpertiseRequirement(requirement.definitionId)}
                                >
                                  Remove
                                </button>
                              </div>
                              {reviewAudience.audience === "private_invited" ? (
                                <label className="mt-3 block max-w-48 text-sm">
                                  Reviewers needed
                                  <input
                                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                                    type="number"
                                    min={1}
                                    max={Math.max(1, Number(reviewTiming.panelSize) || 1)}
                                    step={1}
                                    inputMode="numeric"
                                    value={requirement.minimumSeats}
                                    onChange={event =>
                                      setReviewExpertise(current => ({
                                        ...current,
                                        requirements: current.requirements.map(candidate =>
                                          candidate.definitionId === requirement.definitionId
                                            ? { ...candidate, minimumSeats: Number(event.target.value) }
                                            : candidate,
                                        ),
                                      }))
                                    }
                                    required
                                  />
                                </label>
                              ) : (
                                <p className="mt-3 text-sm text-base-content/60">
                                  Required for all {reviewTiming.panelSize || "—"} network reviewers.
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-base-content/60">Choose at least one specialist area.</p>
                    )}

                    {exampleExpertiseDefinitions.length ? (
                      <div className="mt-5">
                        <p className="text-sm font-medium">
                          {suggestedExpertiseDefinitions.length ? "Suggested for this workflow" : "Examples"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {exampleExpertiseDefinitions.map(definition => (
                            <button
                              key={definition.definitionId}
                              className="btn btn-sm rateloop-secondary-action"
                              type="button"
                              onClick={() => addExpertiseDefinition(definition)}
                            >
                              + {definition.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {expertiseDefinitionsLoading ? (
                      <p className="mt-4 text-sm text-base-content/55" role="status">
                        Loading specialist areas…
                      </p>
                    ) : null}
                    {expertiseDefinitionsError ? (
                      <p className="mt-4 text-sm text-error" role="alert">
                        {expertiseDefinitionsError}
                      </p>
                    ) : null}

                    {selectableExpertiseDefinitions.length ? (
                      <details className="mt-4 rounded-xl border border-white/10 p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-base-content/75">
                          Browse specialist areas
                        </summary>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {selectableExpertiseDefinitions.map(definition => (
                            <button
                              key={definition.definitionId}
                              className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-left text-sm hover:border-white/20"
                              type="button"
                              onClick={() => addExpertiseDefinition(definition)}
                            >
                              <span className="font-medium">{definition.label}</span>
                              <span className="mt-1 block text-xs leading-5 text-base-content/50">
                                {definition.description}
                              </span>
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    {reviewAudience.audience === "private_invited" ? (
                      <div className="mt-4">
                        {!showCustomExpertise ? (
                          <button
                            className="btn btn-sm rateloop-secondary-action"
                            type="button"
                            onClick={() => setShowCustomExpertise(true)}
                            disabled={reviewExpertise.requirements.length >= 8}
                          >
                            Define another specialist area
                          </button>
                        ) : (
                          <div className="surface-card-nested rounded-xl p-4">
                            <p className="font-medium">New workspace specialist area</p>
                            <div className="mt-3 grid gap-3">
                              <label className="text-sm">
                                Name
                                <input
                                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                                  value={customExpertiseLabel}
                                  onChange={event => setCustomExpertiseLabel(event.target.value)}
                                  maxLength={80}
                                  placeholder="German employment law"
                                />
                              </label>
                              <label className="text-sm">
                                What qualifies someone?
                                <textarea
                                  className="textarea mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                                  rows={2}
                                  value={customExpertiseDescription}
                                  onChange={event => setCustomExpertiseDescription(event.target.value)}
                                  maxLength={320}
                                  placeholder="Experience reviewing German employment contracts"
                                />
                              </label>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                className="btn btn-sm rateloop-secondary-action"
                                type="button"
                                disabled={creatingCustomExpertise}
                                onClick={() => void createCustomExpertiseDefinition()}
                              >
                                {creatingCustomExpertise ? "Adding…" : "Add area"}
                              </button>
                              <button
                                className="btn btn-sm border-transparent bg-transparent"
                                type="button"
                                disabled={creatingCustomExpertise}
                                onClick={() => setShowCustomExpertise(false)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="mt-4 text-xs leading-5 text-base-content/55">
                        Network review uses RateLoop-verified areas and requires every reviewer to qualify.
                      </p>
                    )}
                  </section>
                ) : null}
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
                        onChange={event => {
                          const nextPanelSize = event.target.value;
                          setReviewTiming(current => ({ ...current, panelSize: nextPanelSize }));
                          setReviewExpertise(current => ({
                            ...current,
                            requirements: requirementsForAudience({
                              audience: reviewAudience.audience,
                              definitions: expertiseDefinitions,
                              panelSize: nextPanelSize,
                              requirements: current.requirements,
                            }),
                          }));
                        }}
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
            <SetupActionBar>
              {backButton}
              <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save and continue"}
              </Button>
            </SetupActionBar>
          </form>
        ) : null}

        {currentStep === "people" ? (
          <>
            <SetupStageHeader
              headingRef={headingRef}
              step="people"
              title="People"
              description="Invite reviewers and check that required specialist seats are covered."
            />
            {privateExpertiseRequirements.length > 0 ? (
              <section className="surface-card-nested mt-5 p-4" aria-labelledby="setup-specialist-coverage-heading">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 id="setup-specialist-coverage-heading" className="font-semibold">
                      Specialist coverage
                    </h3>
                    <p className="mt-1 text-sm text-base-content/60">
                      Pending invitations do not make a request ready. Confirm each person&apos;s knowledge after they
                      join.
                    </p>
                  </div>
                  {expertiseCoverage ? (
                    <span
                      className={`rounded-md px-2 py-1 text-xs font-medium ${
                        expertiseCoverage.ready
                          ? "bg-emerald-300/10 text-emerald-100"
                          : "bg-amber-200/10 text-amber-100"
                      }`}
                    >
                      {expertiseCoverage.ready ? "Ready" : "Action required"}
                    </span>
                  ) : null}
                </div>
                {expertiseCoverageLoading ? (
                  <p className="mt-4 text-sm text-base-content/55" aria-live="polite">
                    Checking coverage…
                  </p>
                ) : expertiseCoverageError ? (
                  <p className="mt-4 text-sm text-error" role="alert">
                    {expertiseCoverageError}
                  </p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {privateExpertiseRequirements.map(requirement => {
                      const coverage = expertiseCoverage?.requirements.find(
                        candidate => candidate.definitionId === requirement.definitionId,
                      );
                      return (
                        <li
                          key={`${requirement.definitionId}:${requirement.definitionVersion}:${requirement.definitionHash}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm"
                        >
                          <span>{coverage?.label ?? expertiseRequirementLabel(requirement, expertiseDefinitions)}</span>
                          <span className="text-base-content/55">
                            {coverage
                              ? `${coverage.confirmedSeats}/${requirement.minimumSeats} confirmed${
                                  coverage.pendingInvitationSeats ? ` · ${coverage.pendingInvitationSeats} pending` : ""
                                }`
                              : `${requirement.minimumSeats} needed`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ) : null}
            {!setup.peopleDecision ? (
              <form className="mt-5" onSubmit={configurePeople} aria-busy={busy}>
                {setup.reviewDraft?.requestProfile.audience === "public_network" ? (
                  <>
                    <input type="hidden" name="decision" value="not_required" />
                    <div className="surface-card-nested p-4 text-sm">
                      <p className="font-medium">RateLoop network</p>
                      <p className="mt-1 text-base-content/60">
                        No invitation is needed. Eligible network reviewers can receive public, synthetic, or safely
                        redacted requests.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <fieldset>
                      <legend className="font-medium">Invite a reviewer now?</legend>
                      <SetupChoiceGroup>
                        <SetupRadioChoice
                          id="agent-setup-people-invited"
                          name="decision"
                          value="invited"
                          checked={peopleDecision === "invited"}
                          onChange={() => setPeopleDecision("invited")}
                          label="Create a one-use code"
                          description="The code expires in seven days."
                        />
                        <SetupRadioChoice
                          id="agent-setup-people-later"
                          name="decision"
                          value="later"
                          checked={peopleDecision === "later"}
                          onChange={() => setPeopleDecision("later")}
                          label="Invite later"
                          description="The saved reviewer group stays ready."
                        />
                      </SetupChoiceGroup>
                    </fieldset>
                    {peopleDecision === "invited" ? (
                      <div className="mt-4 space-y-4">
                        <label className="block text-sm">
                          Bind code to recipient email{" "}
                          {invitationExpertiseIds.length === 0 ? (
                            <span className="text-base-content/50">(optional)</span>
                          ) : null}
                          <input
                            className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                            type="email"
                            name="intendedEmail"
                            maxLength={320}
                            required={invitationExpertiseIds.length > 0}
                          />
                          <span className="mt-1 block text-xs text-base-content/55">
                            RateLoop does not send this email. The recipient must use the code while signed in with that
                            address.
                          </span>
                        </label>
                        {privateExpertiseRequirements.length > 0 ? (
                          <fieldset className="rounded-lg border border-white/10 p-4">
                            <legend className="px-1 text-sm font-medium">Intended specialist areas</legend>
                            <p className="mt-1 text-xs leading-5 text-base-content/55">
                              Choose what you expect this person to cover. These remain pending until you confirm them
                              after redemption.
                            </p>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {privateExpertiseRequirements.map(requirement => (
                                <label
                                  key={`${requirement.definitionId}:${requirement.definitionVersion}:${requirement.definitionHash}`}
                                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 p-3 text-sm"
                                >
                                  <input
                                    type="checkbox"
                                    className="checkbox checkbox-sm mt-0.5"
                                    checked={invitationExpertiseIds.includes(requirement.definitionId)}
                                    onChange={event =>
                                      setInvitationExpertiseIds(current =>
                                        event.target.checked
                                          ? [...current, requirement.definitionId]
                                          : current.filter(definitionId => definitionId !== requirement.definitionId),
                                      )
                                    }
                                  />
                                  <span>{expertiseRequirementLabel(requirement, expertiseDefinitions)}</span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
                {setup.reviewDraft?.requestProfile.compensationMode === "usdc" ? (
                  <div className="surface-card-nested mt-4 p-4 text-sm">
                    <p className="font-medium">{reviewCompensation.usdcPerReviewer} USDC per accepted reviewer</p>
                    <p className="mt-1 text-base-content/60">
                      Available workspace funding is checked and reserved only when a request is prepared.
                    </p>
                  </div>
                ) : null}
                {setup.reviewDraft?.requestProfile.feedbackBonusEnabled ? (
                  <div className="surface-card-nested mt-4 p-4 text-sm">
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
                <div className="surface-card-nested p-4 text-sm">
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
