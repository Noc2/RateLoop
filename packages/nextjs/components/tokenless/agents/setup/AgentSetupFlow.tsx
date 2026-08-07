"use client";

import { type FormEvent, Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AgentConnectionTroubleshooting } from "../AgentConnectionTroubleshooting";
import { AgentText } from "../AgentText";
import { useAgentTranslations } from "../AgentsLocaleProvider";
import {
  ReviewAuthorityFields,
  ReviewFrequencyFields,
  type ReviewRoutingMode,
  reviewRoutingStateForMode,
} from "../ReviewRoutingFields";
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
import { reconcileSetupAutomaticAuthority, setupAutomaticSendingEligibility } from "./reviewAutomaticSending";
import {
  REVIEW_USDC_DECIMAL_MAX_LENGTH,
  type ReviewCompensationFormValues,
  buildReviewCompensationConfiguration,
  reviewCompensationFormValues,
} from "./reviewCompensation";
import { saveReviewConfigurationAndAdvance } from "./reviewConfigurationSave";
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
} from "./reviewFrequency";
import {
  MAX_REVIEW_PANEL_SIZE,
  MAX_REVIEW_RESPONSE_WINDOW_SECONDS,
  MIN_REVIEW_PANEL_SIZE,
  MIN_REVIEW_RESPONSE_WINDOW_SECONDS,
  type ReviewTimingFormValues,
  buildReviewTimingRequestProfile,
  reviewTimingFormValues,
} from "./reviewTiming";
import type { SetupLocalization } from "./setupMessages";
import { InfoPopover } from "~~/components/tokenless/InfoPopover";
import { useRateLoopNotifications } from "~~/components/tokenless/RateLoopNotificationProvider";
import { humanReviewConfirmationMessage } from "~~/components/tokenless/agents/humanReviewConfirmation";
import { useLocalizedReviewPolicyCopy } from "~~/components/tokenless/agents/reviewPolicyCopy";
import { ChoiceInput, Field, SelectField, TextareaField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { WorkspacePublicContentLink } from "~~/components/tokenless/navigation/WorkspacePublicContentLink";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { SegmentedChoice } from "~~/components/tokenless/ui/SegmentedChoice";
import { useConfirmDialog } from "~~/components/tokenless/ui/useConfirmDialog";
import { DurationInput } from "~~/components/ui/DurationInput";
import { useRouter } from "~~/i18n/navigation";
import { ADAPTIVE_MONITORING_FLOOR_BPS } from "~~/lib/tokenless/adaptiveReviewPolicy";
import { type AgentSetupScreenStep, agentSetupUrl } from "~~/lib/tokenless/agentSetupNavigation";
import {
  configuredHumanReviewLaneForSelection,
  configuredHumanReviewMutationCapability,
} from "~~/lib/tokenless/reviewCapabilities";
import type {
  ReviewerExpertiseDefinition,
  ReviewerExpertiseRequirement,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import type { AgentSetupReviewDraft, WorkspaceAgentSetupView } from "~~/lib/tokenless/workspaceAgentSetup";

type SetupResponse = WorkspaceAgentSetupView;

type SetupFinalizationPostcondition = {
  canSend?: boolean;
  deliveryAuthority?: AgentSetupReviewDraft["authority"] | null;
  reviewerRoutingStatus?: "ready" | "action_required" | "not_required";
  privateRouting?: {
    reason?: string;
    panelSize?: number;
    syncedReviewerCount?: number;
    selectedReviewerCount?: number;
  } | null;
};

const ACTIVE_CONNECTION_STATES = new Set([
  "issued",
  "install_required",
  "authorizing",
  "approval_required",
  "testing",
  "action_required",
]);

function configuredAudienceOption(audience: ReviewAudienceFormValues["audience"]) {
  const governed = configuredHumanReviewMutationCapability({ audience, feedbackBonusEnabled: false });
  if (!governed.available) return governed;
  return configuredHumanReviewLaneForSelection(audience, audience === "private_invited" ? "unpaid" : "usdc");
}

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

function automaticGrantReady(offer: WorkspaceAgentSetupView["capabilities"]["automaticGrantOffer"]) {
  return Boolean(offer?.available && offer.integrationId && offer.allowedWorkflowKeys.length > 0);
}

function draftAutomaticSendingEligibility(
  draft: AgentSetupReviewDraft | null | undefined,
  grantAvailable: boolean,
  localization?: SetupLocalization,
) {
  const values = reviewCompensationFormValues(draft?.requestProfile, draft?.authority, localization);
  return setupAutomaticSendingEligibility({
    audience: draft?.requestProfile.audience ?? "private_invited",
    compensationMode: values.compensationMode,
    feedbackBonusEnabled: values.feedbackBonusEnabled === true,
    grantAvailable,
  });
}

function reviewCompensationValues(
  draft: AgentSetupReviewDraft | null | undefined,
  grantAvailable: boolean,
  localization?: SetupLocalization,
) {
  const values = reviewCompensationFormValues(draft?.requestProfile, draft?.authority, localization);
  if (draft?.selection.mode === "manual") return { ...values, authority: "check_only" as const };
  return {
    ...values,
    authority: reconcileSetupAutomaticAuthority(
      values.authority,
      draftAutomaticSendingEligibility(draft, grantAvailable, localization),
    ).authority,
  };
}

function savedAutomaticAuthorityNeedsFallback(
  draft: AgentSetupReviewDraft | null | undefined,
  grantAvailable: boolean,
  localization?: SetupLocalization,
) {
  if (draft?.selection.mode === "manual") return false;
  const values = reviewCompensationFormValues(draft?.requestProfile, draft?.authority, localization);
  return reconcileSetupAutomaticAuthority(
    values.authority,
    draftAutomaticSendingEligibility(draft, grantAvailable, localization),
  ).changed;
}

class SetupRequestError extends Error {
  field: string | null;

  constructor(message: string, field: string | null) {
    super(message);
    this.field = field;
  }
}

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new SetupRequestError(
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : "The setup request failed.",
      typeof body.field === "string" ? body.field : null,
    );
  }
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
  const t = useAgentTranslations("setupFlow");
  const completion = useAgentTranslations("setupCompletion");
  const errors = useAgentTranslations("errors");
  const statusCopy = useAgentTranslations("status");
  const confirmationCopy = useAgentTranslations("reviewConfirmation");
  // Shared with AgentHumanReviewEditor so the same field reports the same
  // sentence in both surfaces rather than growing a second wording.
  const fieldValidationCopy = useAgentTranslations("reviewEditor");
  const policyCopy = useLocalizedReviewPolicyCopy();
  // One object threaded into every step builder so each validation error is
  // raised in the reader's language, matching the label rendered above it.
  const setupLocalization = useMemo(
    () => ({ editor: fieldValidationCopy, flow: t, policy: policyCopy }),
    [fieldValidationCopy, policyCopy, t],
  );
  const router = useRouter();
  const reviewAudienceOptions = (
    [
      ["public_network", policyCopy.audience.rateLoopNetwork, t("audienceNetworkDescription")],
      ["private_invited", policyCopy.audience.invited, t("audienceInvitedDescription")],
    ] as const
  ).filter(([audience]) => configuredAudienceOption(audience).available);
  const feedbackBonusAvailable = configuredHumanReviewMutationCapability({
    audience: "private_invited",
    feedbackBonusEnabled: true,
  }).available;
  const reviewAuthoritySummary = (
    authority: AgentSetupReviewDraft["authority"],
    requiresFundingPermission: boolean,
  ) => {
    if (authority === "prepare_for_approval") return t("authorityPrepare");
    if (authority === "ask_automatically") {
      return requiresFundingPermission ? t("authorityAutomaticFunded") : t("authorityAutomatic");
    }
    return t("authorityCheck");
  };
  const finalizationMessage = (postcondition: SetupFinalizationPostcondition | null) => {
    if (!postcondition) return null;
    if (postcondition.canSend) return t("finalReady");
    if (postcondition.deliveryAuthority !== "ask_automatically") return t("finalSelected");
    const routing = postcondition.privateRouting;
    if (routing?.reason === "reviewer_seats_insufficient") {
      const missing = Math.max(0, Number(routing.panelSize ?? 0) - Number(routing.syncedReviewerCount ?? 0));
      return t("finalReviewers", { count: missing });
    }
    if (routing?.reason === "expertise_coverage_insufficient") return t("finalExpertise");
    if (routing?.reason === "cohort_capacity_insufficient" || routing?.reason === "prior_managed_cohort_busy") {
      return t("finalCapacity");
    }
    return t("finalCheck");
  };
  const notifications = useRateLoopNotifications();
  const [setup, setSetup] = useState(initialSetup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { capture: captureFormError, clear: clearFormErrors, fieldErrors, formError } = useFormErrors();
  const [announcement, setAnnouncement] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [issuedInvitationCapacity, setIssuedInvitationCapacity] = useState(1);
  const [finalizationPostcondition, setFinalizationPostcondition] = useState<SetupFinalizationPostcondition | null>(
    null,
  );
  const [workspaceName, setWorkspaceName] = useState(initialSetup.workspaceName);
  const [reviewFrequency, setReviewFrequency] = useState<ReviewFrequencyFormValues>(() =>
    reviewFrequencyFormValues(initialSetup.reviewDraft?.selection),
  );
  const [reviewAudience, setReviewAudience] = useState<ReviewAudienceFormValues>(() =>
    reviewAudienceFormValues(initialSetup.reviewDraft?.requestProfile),
  );
  const [reviewCriterion, setReviewCriterion] = useState<ReviewCriterionFormValues>(() => {
    const values = reviewCriterionFormValues(initialSetup.reviewDraft?.requestProfile);
    return initialSetup.reviewDraft
      ? values
      : {
          ...values,
          criterion: completion("defaultCriterion"),
          positiveLabel: completion("defaultApprove"),
          negativeLabel: completion("defaultReject"),
        };
  });
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
    reviewCompensationValues(
      initialSetup.reviewDraft,
      automaticGrantReady(initialSetup.capabilities.automaticGrantOffer),
      setupLocalization,
    ),
  );
  const [authorityAdjustmentNotice, setAuthorityAdjustmentNotice] = useState<string | null>(() =>
    savedAutomaticAuthorityNeedsFallback(
      initialSetup.reviewDraft,
      automaticGrantReady(initialSetup.capabilities.automaticGrantOffer),
      setupLocalization,
    )
      ? t("automaticFallback")
      : null,
  );
  const [peopleDecision, setPeopleDecision] = useState<"invited" | "later">("invited");
  const [sharedInvitation, setSharedInvitation] = useState(false);
  const [sharedInvitationCapacity, setSharedInvitationCapacity] = useState(2);
  const [invitationExpertiseIds, setInvitationExpertiseIds] = useState<string[]>(() =>
    (initialSetup.reviewDraft?.requestProfile.expertiseRequirements ?? [])
      .filter(requirement => requirement.sourceScope === "customer_invited")
      .map(requirement => requirement.definitionId),
  );
  const [expertiseCoverage, setExpertiseCoverage] = useState<PrivateExpertiseCoverage | null>(null);
  const [expertiseCoverageLoading, setExpertiseCoverageLoading] = useState(false);
  const [expertiseCoverageError, setExpertiseCoverageError] = useState<string | null>(null);
  const [confirmedReviewerCount, setConfirmedReviewerCount] = useState<number | null>(null);
  const [confirmedReviewerCountError, setConfirmedReviewerCountError] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [confirmedReviewerCountRevision, retryConfirmedReviewerCount] = useReducer(value => value + 1, 0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const connectionMessageRef = useRef<HTMLTextAreaElement>(null);
  const invitationExpertiseInitialized = useRef(false);
  const focusOnNavigation = useRef(false);
  const setupLoadSequence = useRef(0);
  const finalizationKeyRef = useRef<string | null>(null);
  const peopleDecisionTouched = useRef(false);
  const sharedInvitationCapacityTouched = useRef(false);
  const currentStep = setup.currentStep === "complete" ? "people" : setup.currentStep;

  function openCompletedWorkspace() {
    const url = new URL(window.location.href);
    url.pathname = "/agents/connections";
    url.searchParams.delete("tab");
    url.searchParams.set("workspace", setup.workspaceId);
    url.searchParams.delete("step");
    router.replace(`${url.pathname}${url.search}`);
  }
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
  const requiredReviewerCount = Number(setup.reviewDraft?.requestProfile.panelSize ?? 0);
  // A failed check is not "zero confirmed reviewers". Sizing invitations off an unknown group would
  // offer seats for a group that may already be full.
  const missingReviewerSeats =
    confirmedReviewerCountError !== null ? 0 : Math.max(0, requiredReviewerCount - Number(confirmedReviewerCount ?? 0));
  const canCreateSharedInvitation = missingReviewerSeats >= 2;
  const confirmedReviewerSeatsReady =
    requiredReviewerCount > 0 && Number(confirmedReviewerCount ?? 0) >= requiredReviewerCount;
  const confirmedReviewerPoolReady =
    confirmedReviewerSeatsReady && (privateExpertiseRequirements.length === 0 || expertiseCoverage?.ready === true);
  const reviewerDetailsSummary = `${
    reviewAudience.audience === "private_invited"
      ? completion("reviewerSummaryInvited")
      : completion("reviewerSummaryPublic")
  } · ${completion("reviewerCount", { count: reviewerCount })} · ${
    reviewCompensation.compensationMode === "usdc"
      ? completion("paidEach", { amount: reviewCompensation.usdcPerReviewer || "—" })
      : completion("unpaid")
  }`;
  const automaticGrantOffer = setup.capabilities.automaticGrantOffer;
  const automaticEligibility = setupAutomaticSendingEligibility({
    audience: reviewAudience.audience,
    compensationMode: reviewCompensation.compensationMode,
    feedbackBonusEnabled: reviewCompensation.feedbackBonusEnabled === true,
    grantAvailable: automaticGrantReady(automaticGrantOffer),
  });
  const automaticAvailable = automaticEligibility.available;
  const automaticUnavailableReason = automaticEligibility.available
    ? ""
    : reviewAudience.audience !== "private_invited"
      ? completion("automaticInvitedOnly")
      : reviewCompensation.compensationMode !== "unpaid"
        ? completion("automaticNoBounty")
        : reviewCompensation.feedbackBonusEnabled
          ? completion("automaticNoBonus")
          : completion("automaticUnavailable");

  const localizedReviewSummary = (selection: AgentSetupReviewDraft["selection"] | null | undefined) => {
    if (!selection) return completion("summaryAdaptive");
    if (selection.mode === "always") return completion("summaryEvery");
    if (selection.mode === "manual") return completion("summaryManual");
    if (selection.mode === "fixed") {
      return completion("summaryFixed", { percent: String((selection.fixedRateBps ?? 0) / 100) });
    }
    if (selection.mode === "rules") return completion("summaryRules");
    return completion("summaryAdaptiveMinimum", {
      percent: String((selection.productionFloorBps || ADAPTIVE_MONITORING_FLOOR_BPS) / 100),
    });
  };
  const displayedReviewAuthority = reconcileSetupAutomaticAuthority(
    reviewCompensation.authority,
    automaticEligibility,
  ).authority;
  const selectedExpertiseIds = new Set(reviewExpertise.requirements.map(requirement => requirement.definitionId));
  // A hybrid panel cannot express a specialist requirement yet (requirementForDefinition has no
  // hybrid case), so it must not offer a single control that would add one.
  const canAddExpertiseDefinitions = reviewAudience.audience !== "hybrid";
  const selectableExpertiseDefinitions = expertiseDefinitions.filter(
    definition =>
      canAddExpertiseDefinitions &&
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
    async (step: AgentSetupScreenStep, options?: { replace?: boolean; focus?: boolean; navigate?: boolean }) => {
      const url = agentSetupUrl(setup.workspaceId, step);
      // Claim a sequence number before the request so a slower load can never overwrite a newer
      // one. Without this, two overlapping loads (or a load overlapping the save in
      // configureReviews) both call setSetup and router navigation and the last response wins.
      const sequence = (setupLoadSequence.current += 1);
      const response = await fetch(
        `/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup?step=${encodeURIComponent(step)}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const next = (await readJson(response)) as unknown as SetupResponse;
      if (sequence !== setupLoadSequence.current) return;
      focusOnNavigation.current = options?.focus ?? true;
      setSetup(next);
      if (options?.navigate === false) return;
      if (options?.replace) router.replace(url);
      else router.push(url);
    },
    [router, setup.workspaceId],
  );

  // readJson throws on any non-2xx, so a bare `void loadStep(...)` from Back, the progress chips or
  // "Check agent" turned an expired session into a button that did nothing at all. Await inside a
  // try and surface the failure exactly like createConnectionMessage and confirmAgent do, and hold
  // `busy` for the whole request so navigation cannot race an in-flight save.
  const navigateToStep = useCallback(
    async (step: AgentSetupScreenStep) => {
      setBusy(true);
      setError(null);
      try {
        await loadStep(step);
      } catch {
        setError(errors("openSetupStep"));
      } finally {
        setBusy(false);
      }
    },
    [errors, loadStep],
  );

  useEffect(() => {
    if (!focusOnNavigation.current) return;
    focusOnNavigation.current = false;
    headingRef.current?.focus();
  }, [currentStep]);

  useEffect(() => clearFormErrors(), [clearFormErrors, currentStep]);

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
        .catch(() => {
          if (!controller.signal.aborted) {
            setExpertiseDefinitionsError(errors("loadExpertise"));
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
  }, [
    currentStep,
    errors,
    expertiseSuggestionContext,
    reviewAudience.audience,
    reviewTiming.panelSize,
    setup.workspaceId,
  ]);

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
    if (!groupId) {
      setConfirmedReviewerCount(null);
      setConfirmedReviewerCountError(null);
      return;
    }
    const controller = new AbortController();
    setConfirmedReviewerCountError(null);
    void fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/private-groups`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(readJson)
      .then(body => {
        if (controller.signal.aborted) return;
        const groups = Array.isArray(body.groups) ? (body.groups as Array<Record<string, unknown>>) : [];
        const group = groups.find(candidate => candidate.groupId === groupId);
        setConfirmedReviewerCount(typeof group?.memberCount === "number" ? group.memberCount : 0);
      })
      .catch(() => {
        // A failure must not look like "still loading": null is the loading value, so record the
        // failure separately and stop treating an unknown group size as zero confirmed reviewers.
        if (!controller.signal.aborted) {
          setConfirmedReviewerCount(null);
          setConfirmedReviewerCountError(errors("checkGroup"));
        }
      });
    return () => controller.abort();
  }, [
    confirmedReviewerCountRevision,
    currentStep,
    errors,
    setup.privateGroupId,
    setup.reviewDraft?.requestProfile.privateGroupId,
    setup.workspaceId,
  ]);

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
      .catch(() => {
        if (!controller.signal.aborted) {
          setExpertiseCoverage(null);
          setExpertiseCoverageError(errors("checkCoverage"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setExpertiseCoverageLoading(false);
      });
    return () => controller.abort();
  }, [
    currentStep,
    errors,
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

  useEffect(() => {
    if (currentStep === "people" && confirmedReviewerPoolReady && !peopleDecisionTouched.current) {
      setPeopleDecision("later");
      setSharedInvitation(false);
    }
  }, [confirmedReviewerPoolReady, currentStep]);

  useEffect(() => {
    const availableCapacity = Math.max(2, missingReviewerSeats);
    setSharedInvitationCapacity(current =>
      sharedInvitationCapacityTouched.current ? Math.min(current, availableCapacity) : availableCapacity,
    );
    if (!canCreateSharedInvitation && sharedInvitation) setSharedInvitation(false);
  }, [canCreateSharedInvitation, missingReviewerSeats, sharedInvitation]);

  useEffect(() => {
    const grantAvailable = automaticGrantReady(setup.capabilities.automaticGrantOffer);
    setReviewCompensation(reviewCompensationValues(setup.reviewDraft, grantAvailable, setupLocalization));
    setAuthorityAdjustmentNotice(
      savedAutomaticAuthorityNeedsFallback(setup.reviewDraft, grantAvailable, setupLocalization)
        ? t("automaticFallback")
        : null,
    );
  }, [setup.capabilities.automaticGrantOffer, setup.reviewDraft, setupLocalization, t]);

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
        setError(null);
        setSetup(next);
        if (next.resumeStep === "agent") {
          setAnnouncement(statusCopy("agentConnected"));
          await loadStep("agent", { replace: true, focus: false });
          return;
        }
      } catch {
        if (!stopped) setError(errors("refreshConnection"));
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
  }, [currentStep, errors, loadStep, setup.connection.status, setup.workspaceId, statusCopy]);

  if (!setup.canManage) {
    return (
      <Card as="section" className="rounded-2xl p-6">
        <AgentSetupProgress
          currentStep={currentStep}
          stages={setup.stages}
          onNavigate={() => undefined}
          allowNavigation={false}
        />
        <div className="mt-8 w-full">
          <SetupStageHeader
            headingRef={headingRef}
            title={t("workspaceSetupIncomplete")}
            description={t("workspaceSetupOwner")}
          />
        </div>
      </Card>
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
        setAnnouncement(statusCopy("setupConnectionCopied"));
        notifications.success(t("connectionMessageCopied"));
      } catch {
        setError(errors("clipboardMessage"));
        notifications.error(t("connectionMessageCopyBlocked"));
      }
      // Refresh the setup revision and connection state without replacing the current route.
      // Replacing the same RSC route remounts this client component and discards the private,
      // one-time connection message before the manual-copy fallback can render it.
      await loadStep("connect", { focus: false, navigate: false });
    } catch {
      setError(errors("createConnection"));
    } finally {
      setBusy(false);
    }
  }

  async function copyVisibleConnectionMessage() {
    if (!connectionMessage) return;
    try {
      await navigator.clipboard.writeText(connectionMessage);
      setAnnouncement(statusCopy("setupConnectionCopied"));
      notifications.success(t("connectionMessageCopied"));
    } catch {
      connectionMessageRef.current?.focus();
      connectionMessageRef.current?.select();
      setError(errors("clipboardMessage"));
      notifications.error(t("connectionMessageSelected"));
    }
  }

  async function copyInvitationLink() {
    if (!inviteToken) return;
    try {
      await navigator.clipboard.writeText(inviteToken);
      setAnnouncement(statusCopy("invitationCopied"));
      notifications.success(t("invitationCopied"));
    } catch {
      setError(errors("clipboardInvitation"));
      notifications.error(t("invitationCopyBlocked"));
    }
  }

  function addExpertiseDefinition(definition: ReviewerExpertiseDefinition) {
    // Build the requirement before touching state. requirementForDefinition throws for combinations
    // it cannot express (hybrid), and a throw inside a setState updater escapes to the root error
    // boundary and takes every unsaved answer on this long form with it.
    let requirement: ReviewerExpertiseRequirement;
    try {
      requirement = requirementForDefinition({
        localization: setupLocalization,
        audience: reviewAudience.audience,
        definition,
        panelSize: reviewTiming.panelSize,
      });
    } catch (cause) {
      const message =
        reviewAudience.audience === "hybrid"
          ? t("hybridSpecialistUnavailable")
          : cause instanceof Error
            ? cause.message
            : completion("specialistAddFailed");
      setError(message);
      setAnnouncement(message);
      return;
    }
    setReviewExpertise(current => {
      if (
        current.requirements.some(candidate => candidate.definitionId === definition.definitionId) ||
        current.requirements.length >= 8
      ) {
        return current;
      }
      return {
        ...current,
        needsSpecialists: true,
        requirements: [...current.requirements, requirement],
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

  function reconcileAutomaticAuthorityForChoice(eligibility: ReturnType<typeof setupAutomaticSendingEligibility>) {
    const reconciliation = reconcileSetupAutomaticAuthority(reviewCompensation.authority, eligibility);
    if (reconciliation.changed) {
      const notice = completion("automaticChanged", {
        reason: automaticUnavailableReason || completion("automaticRequirements"),
      });
      setAuthorityAdjustmentNotice(notice);
      setAnnouncement(notice);
    }
    return reconciliation;
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
          ? completion("hybridLegacyActive")
          : completion("hybridUnavailable"),
      );
    } else if (requirements.length < reviewExpertise.requirements.length) {
      setAnnouncement(completion("workspaceAreasRemoved"));
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
    const compensationMode = audience === "private_invited" ? reviewCompensation.compensationMode : "usdc";
    const eligibility = setupAutomaticSendingEligibility({
      audience,
      compensationMode,
      feedbackBonusEnabled: reviewCompensation.feedbackBonusEnabled === true,
      grantAvailable: automaticGrantReady(setup.capabilities.automaticGrantOffer),
    });
    reconcileAutomaticAuthorityForChoice(eligibility);
    setReviewCompensation(current => ({
      ...current,
      compensationMode,
      authority: reconcileSetupAutomaticAuthority(current.authority, eligibility).authority,
    }));
    if (audience !== "private_invited") setShowCustomExpertise(false);
  }

  function changeReviewCompensationMode(compensationMode: ReviewCompensationFormValues["compensationMode"]) {
    const eligibility = setupAutomaticSendingEligibility({
      audience: reviewAudience.audience,
      compensationMode,
      feedbackBonusEnabled: reviewCompensation.feedbackBonusEnabled === true,
      grantAvailable: automaticGrantReady(setup.capabilities.automaticGrantOffer),
    });
    reconcileAutomaticAuthorityForChoice(eligibility);
    setReviewCompensation(current => ({
      ...current,
      compensationMode,
      authority: reconcileSetupAutomaticAuthority(current.authority, eligibility).authority,
    }));
  }

  function changeFeedbackBonus(feedbackBonusEnabled: boolean) {
    const eligibility = setupAutomaticSendingEligibility({
      audience: reviewAudience.audience,
      compensationMode: reviewCompensation.compensationMode,
      feedbackBonusEnabled,
      grantAvailable: automaticGrantReady(setup.capabilities.automaticGrantOffer),
    });
    reconcileAutomaticAuthorityForChoice(eligibility);
    setReviewCompensation(current => ({
      ...current,
      feedbackBonusEnabled,
      authority: reconcileSetupAutomaticAuthority(current.authority, eligibility).authority,
    }));
  }

  function changeReviewAuthority(authority: ReviewCompensationFormValues["authority"]) {
    setReviewCompensation(current => ({ ...current, authority }));
    setAuthorityAdjustmentNotice(null);
  }

  function changeQuestionAuthority(questionAuthority: ReviewCriterionFormValues["questionAuthority"]) {
    setReviewCriterion(current => ({ ...current, questionAuthority }));
    if (questionAuthority === "agent_per_request") {
      setReviewFrequency(current => (current.mode === "adaptive" ? { ...current, mode: "always" } : current));
      changeReviewAudience("public_network");
      setAnnouncement(statusCopy("agentQuestion"));
    }
  }

  async function createCustomExpertiseDefinition() {
    const label = customExpertiseLabel.trim();
    const description = customExpertiseDescription.trim();
    if (!label || !description) {
      setError(errors("specialistRequired"));
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
      if (!definition?.definitionId) throw new Error(completion("specialistAddFailed"));
      setExpertiseDefinitions(current => [...current, definition]);
      addExpertiseDefinition(definition);
      setCustomExpertiseLabel("");
      setCustomExpertiseDescription("");
      setShowCustomExpertise(false);
      setAnnouncement(completion("specialistAdded", { label: definition.label }));
    } catch {
      setError(errors("createSpecialist"));
    } finally {
      setCreatingCustomExpertise(false);
    }
  }

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workspaceName.trim();
    setBusy(true);
    setError(null);
    clearFormErrors();
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
      captureFormError(
        cause instanceof SetupRequestError && cause.field
          ? new SetupRequestError(completion("saveWorkspace"), cause.field)
          : completion("saveWorkspace"),
        completion("saveWorkspace"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const connectedAgent = setup.agent;
    if (!connectedAgent) {
      setError(errors("agentDetails"));
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    clearFormErrors();
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
      captureFormError(
        cause instanceof SetupRequestError && cause.field
          ? new SetupRequestError(completion("confirmAgent"), cause.field)
          : completion("confirmAgent"),
        completion("confirmAgent"),
      );
    } finally {
      setBusy(false);
    }
  }

  function changeReviewMode(mode: ReviewRoutingMode) {
    setReviewFrequency(current => ({ ...current, mode }));
    setReviewCompensation(current => ({
      ...current,
      authority: reviewRoutingStateForMode(mode, current.authority).authority,
    }));
    if (mode === "manual") setAuthorityAdjustmentNotice(null);
  }

  async function configureReviews(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const connectedAgent = setup.agent;
    if (!connectedAgent) {
      setError(errors("agentDetails"));
      return;
    }
    setError(null);
    clearFormErrors();
    try {
      const draft = setup.reviewDraft;
      if (!draft) throw new Error(completion("setupUnavailable"));
      const selection = buildReviewFrequencySelection(draft.selection, reviewFrequency, setupLocalization);
      const audienceProfile = buildReviewAudienceRequestProfile(draft.requestProfile, reviewAudience);
      const criterionProfile = buildReviewCriterionRequestProfile(audienceProfile, reviewCriterion, setupLocalization);
      const expertiseProfile = buildReviewExpertiseRequestProfile(
        criterionProfile,
        reviewExpertise,
        reviewTiming.panelSize,
        setupLocalization,
      );
      const timingProfile = buildReviewTimingRequestProfile(expertiseProfile, reviewTiming, {
        labels: policyCopy.timing,
        t: fieldValidationCopy,
      });
      const compensationConfiguration = buildReviewCompensationConfiguration(
        timingProfile,
        reviewCompensation,
        setupLocalization,
      );
      const requestProfile = compensationConfiguration.requestProfile;
      const authority = selection.mode === "manual" ? "check_only" : compensationConfiguration.authority;
      const finalAutomaticEligibility = setupAutomaticSendingEligibility({
        audience: requestProfile.audience,
        compensationMode: requestProfile.compensationMode,
        feedbackBonusEnabled: requestProfile.feedbackBonusEnabled === true,
        grantAvailable: automaticGrantReady(automaticGrantOffer),
      });
      let publishingGrant: {
        integrationId: string;
        provision: "private_invited_unpaid";
        allowedWorkflowKeys: string[];
      } | null = null;
      if (authority === "ask_automatically") {
        if (
          !finalAutomaticEligibility.available ||
          requestProfile.contentBoundary !== "private_workspace" ||
          !automaticGrantOffer?.available ||
          !automaticGrantOffer.integrationId ||
          automaticGrantOffer.allowedWorkflowKeys.length === 0
        ) {
          throw new Error(
            requestProfile.contentBoundary !== "private_workspace"
              ? completion("automaticInvitedOnly")
              : automaticUnavailableReason || completion("automaticUnavailable"),
          );
        }
        publishingGrant = {
          integrationId: automaticGrantOffer.integrationId,
          provision: "private_invited_unpaid",
          allowedWorkflowKeys: automaticGrantOffer.allowedWorkflowKeys,
        };
      }
      const confirmation = humanReviewConfirmationMessage(
        {
          authority,
          bountyPerSeatAtomic: requestProfile.compensationMode === "usdc" ? requestProfile.bountyPerSeatAtomic : null,
          feedbackBonusPoolAtomic: requestProfile.feedbackBonusEnabled
            ? (requestProfile.feedbackBonusPoolAtomic ?? null)
            : null,
          panelSize: requestProfile.panelSize,
        },
        {
          automatic: confirmationCopy("automatic"),
          payment: amount => confirmationCopy("payment", { amount }),
          save: confirmationCopy("save"),
        },
      );
      if (
        confirmation &&
        !(await confirm({
          title: policyCopy.confirmation.title,
          description: confirmation,
          confirmLabel: policyCopy.confirmation.action,
          destructive: false,
        }))
      )
        return;
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
                  dataClassifications: privateClassificationsThrough(
                    reviewAudience.privateSensitivity,
                    setupLocalization,
                  ),
                },
              }),
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
            }),
          );
          const group = created.group as Record<string, unknown> | undefined;
          if (typeof group?.groupId !== "string") throw new Error(completion("reviewerGroupUnavailable"));
          privateGroupId = group.groupId;
        }
      }
      // Save the human-review configuration and advance the wizard as one retry-safe operation. If
      // the advance fails or the save response is lost after the server committed, the helper adopts
      // the authoritative binding version so Retry does not resend a stale expectedBindingVersion
      // that the server would permanently reject (AUD-14).
      await saveReviewConfigurationAndAdvance({
        localization: setupLocalization,
        putHumanReviewConfiguration: async () => {
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
                  publishingGrant,
                }),
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
          return { bindingRevision: Number(ownerView.bindingRevision) };
        },
        advanceSetup: async bindingRevision => {
          await readJson(
            await fetch(
              `/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup/configure-reviews`,
              {
                method: "POST",
                body: JSON.stringify({ revision: setup.revision, bindingRevision }),
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        },
        reloadAuthoritativeSetup: async () => {
          const response = await fetch(
            `/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup?step=reviews`,
            { cache: "no-store", credentials: "same-origin" },
          );
          return (await readJson(response)) as unknown as SetupResponse;
        },
        adoptAuthoritativeSetup: authoritative => {
          setSetup(authoritative);
        },
        adoptBindingRevision: bindingRevision => {
          // Update only the binding version so in-progress form edits are preserved (the shared
          // requestProfile/selection references stay identical, so the sync effects do not re-run).
          setSetup(current =>
            current.reviewDraft ? { ...current, reviewDraft: { ...current.reviewDraft, bindingRevision } } : current,
          );
        },
      });
      await loadStep("people");
    } catch {
      captureFormError(completion("saveReviews"), completion("saveReviews"));
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
    clearFormErrors();
    setInviteToken(null);
    setIssuedInvitationCapacity(1);
    try {
      const idempotencyKey = finalizationKeyRef.current ?? crypto.randomUUID();
      finalizationKeyRef.current = idempotencyKey;
      const creatingSharedInvitation = decision === "invited" && sharedInvitation;
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup/finalize`, {
          method: "POST",
          body: JSON.stringify({
            revision: setup.revision,
            idempotencyKey,
            decision,
            createInvitation: decision === "invited",
            intendedEmail: creatingSharedInvitation ? null : form.get("intendedEmail") || null,
            intendedEmailDomain: creatingSharedInvitation ? form.get("intendedEmailDomain") || null : null,
            maximumRedemptions: creatingSharedInvitation ? Number(form.get("maximumRedemptions")) : 1,
            expertiseDefinitionIds: decision === "invited" && !creatingSharedInvitation ? invitationExpertiseIds : [],
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      const invitation = body.invitation as Record<string, unknown> | null;
      if (invitation && typeof invitation.destinationUrl === "string") {
        setInviteToken(invitation.destinationUrl);
        setIssuedInvitationCapacity(
          typeof invitation.maximumRedemptions === "number" ? invitation.maximumRedemptions : 1,
        );
      }
      const postcondition = (body.postcondition ?? null) as SetupFinalizationPostcondition | null;
      setFinalizationPostcondition(postcondition);
      setSetup(current => ({
        ...current,
        status: "completed",
        complete: true,
        currentStep: "complete",
        peopleDecision: decision as "invited" | "later" | "not_required",
        revision: typeof body.revision === "number" ? body.revision : current.revision,
      }));
      if (!invitation?.destinationUrl) {
        openCompletedWorkspace();
      }
    } catch (cause) {
      captureFormError(
        cause instanceof SetupRequestError && cause.field
          ? new SetupRequestError(completion("savePeople"), cause.field)
          : completion("savePeople"),
        completion("savePeople"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function finishSetup() {
    if (setup.complete) {
      openCompletedWorkspace();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(setup.workspaceId)}/agent-setup/complete`, {
          method: "POST",
          body: JSON.stringify({ revision: setup.revision }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      openCompletedWorkspace();
    } catch {
      setError(errors("finishSetup"));
      setBusy(false);
    }
  }

  const back = stepBefore(currentStep);
  const finalizedStatusMessage = finalizationMessage(finalizationPostcondition);
  const backButton = back ? (
    <Button
      variant="secondary"
      className="rateloop-back-action min-h-11 w-full gap-2 sm:w-auto"
      type="button"
      disabled={busy}
      onClick={() => void navigateToStep(back)}
    >
      {t("back")}
    </Button>
  ) : null;
  return (
    <Card as="section" className="rounded-2xl p-5 sm:p-7">
      {confirmationDialog}
      <AgentSetupProgress
        currentStep={currentStep}
        stages={setup.stages}
        onNavigate={step => void navigateToStep(step)}
        busy={busy}
      />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="mt-8 w-full">
        {currentStep === "workspace" ? (
          <form onSubmit={saveWorkspace} aria-busy={busy}>
            <SetupStageHeader headingRef={headingRef} title={t("nameWorkspace")} />
            <div className="mt-8">
              <Field
                id="agent-setup-workspace-name"
                label={t("workspaceName")}
                className="border-base-content/10 bg-[var(--rateloop-field)]"
                value={workspaceName}
                onChange={event => {
                  setWorkspaceName(event.target.value);
                  clearFormErrors("name");
                }}
                autoComplete="organization"
                maxLength={120}
                required
                error={fieldErrors.name}
              />
            </div>
            <SetupActionBar>
              {backButton}
              <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy || !workspaceName.trim()}>
                {busy ? t("saving") : workspaceName.trim() === setup.workspaceName ? t("continue") : t("saveContinue")}
              </Button>
            </SetupActionBar>
          </form>
        ) : null}

        {currentStep === "connect" ? (
          <>
            <SetupStageHeader headingRef={headingRef} title={t("connectAgent")} />
            <WorkspacePublicContentLink
              className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--rateloop-blue)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rateloop-blue)]"
              href="/docs/connect"
            >
              {t("docs")}
            </WorkspacePublicContentLink>
            <SetupActionBar>
              {backButton}
              {setup.connection.status === "connected" ? (
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  type="button"
                  disabled={busy}
                  onClick={() => void navigateToStep("agent")}
                >
                  {t("checkAgent")}
                </Button>
              ) : (
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  type="button"
                  disabled={busy}
                  onClick={() => void createConnectionMessage()}
                >
                  {busy ? t("creating") : setup.connection.intentId ? t("createNewConnection") : t("createConnection")}
                </Button>
              )}
            </SetupActionBar>
            {connectionMessage ? (
              <div className="mt-5">
                <TextareaField
                  ref={connectionMessageRef}
                  id="agent-setup-connection-message"
                  className="min-h-40 border-base-content/10 bg-[var(--rateloop-field)] font-mono text-xs leading-5"
                  label={t("connectionMessage")}
                  labelClassName="text-sm font-medium"
                  value={connectionMessage}
                  readOnly
                  onFocus={event => event.currentTarget.select()}
                />
                <button
                  className="btn rateloop-secondary-action mt-3 px-5"
                  type="button"
                  onClick={() => void copyVisibleConnectionMessage()}
                >
                  {t("copyMessage")}
                </button>
                <AgentConnectionTroubleshooting />
              </div>
            ) : null}
          </>
        ) : null}

        {currentStep === "agent" && setup.agent ? (
          <form onSubmit={confirmAgent} aria-busy={busy}>
            <SetupStageHeader headingRef={headingRef} title={t("nameWorkflow")} />
            <div className="mt-8 grid gap-4">
              <Field
                label={t("workflowName")}
                className="border-base-content/10 bg-[var(--rateloop-field)]"
                name="displayName"
                defaultValue={setup.agent.displayName}
                onChange={() => clearFormErrors("displayName")}
                maxLength={120}
                required
                error={fieldErrors.displayName}
              />
              <TextareaField
                className="border-base-content/10 bg-[var(--rateloop-field)]"
                label={
                  <>
                    {t("description")} <span className="text-base-content/55">{t("optional")}</span>
                  </>
                }
                labelClassName="text-sm"
                name="description"
                defaultValue={setup.agent.description ?? ""}
                onChange={() => clearFormErrors("description")}
                maxLength={1000}
                error={fieldErrors.description}
              />
            </div>
            <div className="mt-4 rounded-xl border border-base-content/10 bg-base-content/[0.02] p-4 text-sm">
              <p className="font-medium">{t("observedConnection")}</p>
              <p className="mt-1 text-base-content/60">
                {setup.agent.observedClientName ?? t("unknownClient")}
                {setup.agent.observedClientVersion ? ` · ${setup.agent.observedClientVersion}` : ""}
              </p>
              <p className="mt-2 text-base-content/60">{t("safeAccess")}</p>
            </div>
            <SetupActionBar>
              {backButton}
              <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy}>
                {busy ? t("confirming") : t("confirmWorkflow")}
              </Button>
            </SetupActionBar>
          </form>
        ) : null}

        {currentStep === "reviews" ? (
          <form onSubmit={configureReviews} aria-busy={busy}>
            <SetupStageHeader headingRef={headingRef} title={t("setReview")} />
            <fieldset className="mt-8">
              <legend className="text-xl font-semibold">{policyCopy.question.authority}</legend>
              <SetupChoiceGroup>
                <SetupRadioChoice
                  id="agent-setup-question-owner-fixed"
                  name="questionAuthority"
                  value="owner_fixed"
                  checked={reviewCriterion.questionAuthority === "owner_fixed"}
                  onChange={() => changeQuestionAuthority("owner_fixed")}
                  label={policyCopy.question.ownerFixed}
                  description={t("fixedQuestionDescription")}
                />
                {configuredHumanReviewMutationCapability({
                  audience: "public_network",
                  feedbackBonusEnabled: false,
                }).available ? (
                  <SetupRadioChoice
                    id="agent-setup-question-agent-per-request"
                    name="questionAuthority"
                    value="agent_per_request"
                    checked={reviewCriterion.questionAuthority === "agent_per_request"}
                    onChange={() => changeQuestionAuthority("agent_per_request")}
                    label={policyCopy.question.agentPerRequest}
                    description={completion("agentQuestionDescription")}
                  />
                ) : null}
              </SetupChoiceGroup>
            </fieldset>
            {reviewCriterion.questionAuthority === "owner_fixed" ? (
              <TextareaField
                containerClassName="mt-6"
                className="border-base-content/10 bg-[var(--rateloop-field)]"
                label={policyCopy.question.criterion}
                labelClassName="text-sm font-medium"
                rows={3}
                value={reviewCriterion.criterion}
                onChange={event => setReviewCriterion(current => ({ ...current, criterion: event.target.value }))}
                maxLength={REVIEW_CRITERION_MAX_LENGTH}
                required
              />
            ) : (
              <p className="mt-5 border-l-2 border-l-[var(--rateloop-yellow)] pl-4 text-sm leading-6 text-base-content/65">
                {policyCopy.question.agentWrittenNote}
              </p>
            )}
            <Card as="fieldset" variant="nested" className="mt-5 p-4">
              <legend className="px-1 text-sm font-medium">
                {reviewCriterion.questionAuthority === "owner_fixed" ? t("answerFormat") : t("writtenFeedback")}
              </legend>
              <div className="grid gap-4 sm:grid-cols-3">
                {reviewCriterion.questionAuthority === "owner_fixed" ? (
                  <>
                    <Field
                      label={policyCopy.question.positiveAnswer}
                      className="border-base-content/10 bg-[var(--rateloop-field)]"
                      value={reviewCriterion.positiveLabel}
                      onChange={event =>
                        setReviewCriterion(current => ({ ...current, positiveLabel: event.target.value }))
                      }
                      maxLength={REVIEW_ANSWER_LABEL_MAX_LENGTH}
                      required
                    />
                    <Field
                      label={policyCopy.question.negativeAnswer}
                      className="border-base-content/10 bg-[var(--rateloop-field)]"
                      value={reviewCriterion.negativeLabel}
                      onChange={event =>
                        setReviewCriterion(current => ({ ...current, negativeLabel: event.target.value }))
                      }
                      maxLength={REVIEW_ANSWER_LABEL_MAX_LENGTH}
                      required
                    />
                  </>
                ) : null}
                <SelectField
                  className="border-base-content/10 bg-[var(--rateloop-field)]"
                  label={policyCopy.question.rationale}
                  labelClassName="text-sm"
                  value={reviewCriterion.rationaleMode}
                  onChange={event =>
                    setReviewCriterion(current => ({
                      ...current,
                      rationaleMode: event.target.value as ReviewCriterionFormValues["rationaleMode"],
                    }))
                  }
                >
                  <option value="off">{policyCopy.question.rationaleOff}</option>
                  <option value="optional">{policyCopy.question.rationaleOptional}</option>
                  <option value="required">{policyCopy.question.rationaleRequired}</option>
                </SelectField>
              </div>
            </Card>
            <Card as="fieldset" variant="nested" className="mt-7 p-4 sm:p-5">
              <legend className="px-1 text-xl font-semibold">{t("reviewFrequency")}</legend>
              <ReviewFrequencyFields
                mode={reviewFrequency.mode}
                adaptiveAvailable={reviewCriterion.questionAuthority !== "agent_per_request"}
                onModeChange={changeReviewMode}
              />
            </Card>
            {reviewFrequency.mode === "adaptive" || reviewFrequency.mode === "fixed" ? (
              <div className="mt-4 border-l-2 border-l-[var(--rateloop-pink)] bg-base-content/[0.03] px-4 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={
                      reviewFrequency.mode === "adaptive" ? policyCopy.limits.adaptiveRate : policyCopy.limits.fixedRate
                    }
                    className="border-base-content/10 bg-[var(--rateloop-field)]"
                    type="number"
                    min={reviewFrequency.mode === "adaptive" ? ADAPTIVE_MONITORING_FLOOR_BPS / 100 : 0.01}
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
                    disabled={reviewFrequency.mode === "adaptive"}
                  />
                  <Field
                    label={policyCopy.limits.maximumGap}
                    className="border-base-content/10 bg-[var(--rateloop-field)]"
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
                </div>
                <p className="mt-3 text-xs leading-5 text-base-content/55">
                  {reviewFrequency.mode === "adaptive" ? t("adaptiveFrequencyNote") : t("fixedFrequencyNote")}
                </p>
              </div>
            ) : null}
            {reviewFrequency.mode === "rules" ? (
              <div className="mt-4 border-l-2 border-l-[var(--rateloop-pink)] bg-base-content/[0.03] px-4 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={policyCopy.limits.riskTiers}
                    className="border-base-content/10 bg-[var(--rateloop-field)]"
                    value={reviewFrequency.requiredRiskTiers}
                    onChange={event =>
                      setReviewFrequency(current => ({
                        ...current,
                        requiredRiskTiers: event.target.value,
                      }))
                    }
                    placeholder={t("riskTagsPlaceholder")}
                    maxLength={320}
                  />
                  <Field
                    label={
                      <>
                        {policyCopy.limits.confidence} <span className="text-base-content/55">{t("optional")}</span>
                      </>
                    }
                    className="border-base-content/10 bg-[var(--rateloop-field)]"
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
                </div>
                <p className="mt-3 text-xs leading-5 text-base-content/55">{t("rulesNote")}</p>
              </div>
            ) : null}
            <section
              className="mt-7 border-y border-base-content/10 py-5"
              aria-labelledby="agent-setup-reviewer-details-heading"
            >
              <h2 id="agent-setup-reviewer-details-heading" className="text-lg font-semibold">
                {t("reviewerDetails")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-base-content/55">{reviewerDetailsSummary}</p>
              <div className="pb-1 pt-6">
                <fieldset>
                  <legend className="text-lg font-semibold">{policyCopy.audience.label}</legend>
                  <SetupChoiceGroup>
                    {reviewAudienceOptions.map(([value, label, description]) => {
                      const configuredLane = configuredAudienceOption(value);
                      return (
                        <SetupRadioChoice
                          key={value}
                          id={`agent-setup-review-audience-${value}`}
                          name="audience"
                          value={value}
                          checked={reviewAudience.audience === value}
                          onChange={() => changeReviewAudience(value)}
                          label={label}
                          description={`${description} ${configuredLane.available ? "" : completion("reviewPathUnavailable")}`}
                          disabled={
                            !configuredLane.available ||
                            (reviewCriterion.questionAuthority === "agent_per_request" && value !== "public_network")
                          }
                        />
                      );
                    })}
                  </SetupChoiceGroup>
                </fieldset>
                {reviewAudience.audience !== "private_invited" ? (
                  <p className="mt-4 border-l-2 border-l-[var(--rateloop-yellow)] pl-4 text-sm leading-6 text-base-content/65">
                    {t("publicMaterialOnly")}
                  </p>
                ) : null}
                <fieldset className="mt-6 border-t border-base-content/10 pt-5">
                  <legend className="text-lg font-semibold">{t("specialistQuestion")}</legend>
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
                      label={t("noSpecialist")}
                      description={t("noSpecialistDescription")}
                    />
                    <SetupRadioChoice
                      id="agent-setup-specialists-yes"
                      name="specialistKnowledge"
                      value="yes"
                      checked={reviewExpertise.needsSpecialists}
                      onChange={() => setReviewExpertise(current => ({ ...current, needsSpecialists: true }))}
                      label={t("requireSpecialist")}
                      description={t("requireSpecialistDescription")}
                      disabled={reviewAudience.audience === "hybrid"}
                    />
                  </SetupChoiceGroup>
                  {reviewAudience.audience === "hybrid" ? (
                    <p className="mt-3 text-sm leading-6 text-base-content/60">
                      {reviewExpertise.legacyRequiredExpertiseKeys.length
                        ? t("legacyAllSeat")
                        : completion("hybridUnavailable")}
                    </p>
                  ) : null}
                </fieldset>
                {reviewExpertise.needsSpecialists ? (
                  <section
                    className="mt-5 border-l-2 border-l-[var(--rateloop-pink)] pl-4"
                    aria-labelledby="agent-setup-specialist-areas-heading"
                  >
                    <h3 id="agent-setup-specialist-areas-heading" className="font-semibold">
                      <AgentText id="translated240" />
                    </h3>
                    {!canAddExpertiseDefinitions ? (
                      <p className="mt-2 text-sm leading-6 text-base-content/60">{t("hybridSpecialistUnavailable")}</p>
                    ) : null}
                    {reviewExpertise.requirements.length ? (
                      <ul className="mt-3 space-y-3">
                        {reviewExpertise.requirements.map(requirement => {
                          const definition = expertiseDefinitions.find(
                            candidate => candidate.definitionId === requirement.definitionId,
                          );
                          return (
                            <Card as="li" variant="nested" key={requirement.definitionId} className="rounded-xl p-4">
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
                                  <AgentText id="translated232" />
                                </button>
                              </div>
                              {reviewAudience.audience === "private_invited" ? (
                                <Field
                                  containerClassName="mt-3 max-w-48"
                                  className="border-base-content/10 bg-[var(--rateloop-field)]"
                                  label={t("reviewersNeeded")}
                                  labelClassName="text-sm"
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
                              ) : (
                                <p className="mt-3 text-sm text-base-content/60">
                                  <AgentText id="translated241" /> {reviewTiming.panelSize || "—"}{" "}
                                  <AgentText id="translated242" />
                                </p>
                              )}
                            </Card>
                          );
                        })}
                      </ul>
                    ) : canAddExpertiseDefinitions ? (
                      <p className="mt-2 text-sm text-base-content/60">{t("chooseSpecialist")}</p>
                    ) : null}

                    {exampleExpertiseDefinitions.length ? (
                      <div className="mt-5">
                        <p className="text-sm font-medium">
                          {suggestedExpertiseDefinitions.length ? t("suggested") : t("examples")}
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
                        <AgentText id="translated243" />
                      </p>
                    ) : null}
                    {expertiseDefinitionsError ? (
                      <p className="mt-4 text-sm text-error" role="alert">
                        {expertiseDefinitionsError}
                      </p>
                    ) : null}

                    {selectableExpertiseDefinitions.length ? (
                      <details className="mt-4 rounded-xl border border-base-content/10 p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-base-content/75">
                          <AgentText id="translated244" />
                        </summary>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {selectableExpertiseDefinitions.map(definition => (
                            <button
                              key={definition.definitionId}
                              className="min-h-11 rounded-lg border border-base-content/10 px-3 py-2 text-left text-sm hover:border-base-content/20"
                              type="button"
                              onClick={() => addExpertiseDefinition(definition)}
                            >
                              <span className="font-medium">{definition.label}</span>
                              <span className="mt-1 block text-xs leading-5 text-base-content/55">
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
                            <AgentText id="translated245" />
                          </button>
                        ) : (
                          <Card as="div" variant="nested" className="rounded-xl p-4">
                            <p className="font-medium">{t("newSpecialist")}</p>
                            <div className="mt-3 grid gap-3">
                              <Field
                                className="border-base-content/10 bg-[var(--rateloop-field)]"
                                label={t("name")}
                                labelClassName="text-sm"
                                value={customExpertiseLabel}
                                onChange={event => setCustomExpertiseLabel(event.target.value)}
                                maxLength={80}
                                placeholder={t("specialistPlaceholder")}
                              />
                              <TextareaField
                                className="border-base-content/10 bg-[var(--rateloop-field)]"
                                label={t("qualification")}
                                labelClassName="text-sm"
                                rows={2}
                                value={customExpertiseDescription}
                                onChange={event => setCustomExpertiseDescription(event.target.value)}
                                maxLength={320}
                                placeholder={t("qualificationPlaceholder")}
                              />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                className="btn btn-sm rateloop-secondary-action"
                                type="button"
                                disabled={creatingCustomExpertise}
                                onClick={() => void createCustomExpertiseDefinition()}
                              >
                                {creatingCustomExpertise ? t("adding") : t("addArea")}
                              </button>
                              <button
                                className="btn btn-sm border-transparent bg-transparent"
                                type="button"
                                disabled={creatingCustomExpertise}
                                onClick={() => setShowCustomExpertise(false)}
                              >
                                <AgentText id="translated183" />
                              </button>
                            </div>
                          </Card>
                        )}
                      </div>
                    ) : (
                      <p className="mt-4 text-xs leading-5 text-base-content/55">
                        <AgentText id="translated246" />
                      </p>
                    )}
                  </section>
                ) : null}
                <fieldset className="mt-6 border-t border-base-content/10 pt-5">
                  <legend className="text-lg font-semibold">{t("reviewRound")}</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="text-sm">
                      <p>{policyCopy.timing.responseWindow}</p>
                      <DurationInput
                        id="agent-setup-review-response-window"
                        className="mt-2"
                        ariaLabel={policyCopy.timing.responseWindow}
                        valueSeconds={reviewTiming.responseWindowSeconds}
                        minSeconds={MIN_REVIEW_RESPONSE_WINDOW_SECONDS}
                        maxSeconds={MAX_REVIEW_RESPONSE_WINDOW_SECONDS}
                        summarySuffix={t("frozenWhenOpen")}
                        onChangeSeconds={responseWindowSeconds =>
                          setReviewTiming(current => ({ ...current, responseWindowSeconds }))
                        }
                      />
                    </div>
                    <Field
                      label={policyCopy.timing.panelSize}
                      className="border-base-content/10 bg-[var(--rateloop-field)]"
                      type="number"
                      inputMode="numeric"
                      min={reviewAudience.audience === "private_invited" ? MIN_REVIEW_PANEL_SIZE : 3}
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
                  </div>
                </fieldset>
                <fieldset className="mt-6 border-t border-base-content/10 pt-5">
                  <legend className="text-lg font-semibold">{policyCopy.payment.bounty}</legend>
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
                      onChange={() => changeReviewCompensationMode("unpaid")}
                      label={policyCopy.payment.noBounty}
                      description={t("noGuaranteedPayment")}
                    />
                    <SetupRadioChoice
                      id="agent-setup-compensation-usdc"
                      name="compensationMode"
                      value="usdc"
                      checked={
                        reviewAudience.audience !== "private_invited" || reviewCompensation.compensationMode === "usdc"
                      }
                      disabled={!configuredHumanReviewLaneForSelection(reviewAudience.audience, "usdc").available}
                      onChange={() => changeReviewCompensationMode("usdc")}
                      label={policyCopy.payment.addBounty}
                      description={`${completion("payDescription")} ${
                        configuredHumanReviewLaneForSelection(reviewAudience.audience, "usdc").available
                          ? ""
                          : completion("reviewPathUnavailable")
                      }`}
                    />
                  </SetupChoiceGroup>
                  {reviewAudience.audience !== "private_invited" ? (
                    <p className="mt-3 text-xs text-base-content/55">
                      <AgentText id="translated247" />
                    </p>
                  ) : null}
                  {reviewCompensation.compensationMode === "usdc" ? (
                    <div className="mt-4">
                      <Field
                        label={policyCopy.payment.bountyPerReviewer}
                        className="border-base-content/10 bg-[var(--rateloop-field)]"
                        type="text"
                        inputMode="decimal"
                        format="usdcAmount"
                        maxLength={REVIEW_USDC_DECIMAL_MAX_LENGTH}
                        value={reviewCompensation.usdcPerReviewer}
                        onChange={event =>
                          setReviewCompensation(current => ({ ...current, usdcPerReviewer: event.target.value }))
                        }
                        required
                      />
                    </div>
                  ) : null}
                </fieldset>
                {feedbackBonusAvailable ? (
                  <fieldset className="mt-6 border-t border-base-content/10 pt-5">
                    <legend className="text-lg font-semibold">
                      <span className="inline-flex items-center gap-2">
                        {policyCopy.payment.feedbackBonus}
                        <InfoPopover label={t("aboutBonus")}>
                          {reviewCompensation.compensationMode === "usdc" ? t("bonusOptional") : t("bonusHumanChoice")}
                        </InfoPopover>
                      </span>
                    </legend>
                    <SegmentedChoice
                      className="mt-3 sm:max-w-md"
                      value={reviewCompensation.feedbackBonusEnabled ? "enabled" : "disabled"}
                      options={[
                        { value: "disabled", label: policyCopy.payment.noBonus },
                        { value: "enabled", label: policyCopy.payment.addBonus },
                      ]}
                      onChange={value => changeFeedbackBonus(value === "enabled")}
                    />
                    {reviewCompensation.feedbackBonusEnabled ? (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <Field
                          label={policyCopy.payment.bonusPool}
                          className="border-base-content/10 bg-[var(--rateloop-field)]"
                          type="text"
                          inputMode="decimal"
                          format="usdcAmount"
                          maxLength={REVIEW_USDC_DECIMAL_MAX_LENGTH}
                          value={reviewCompensation.feedbackBonusUsdc}
                          onChange={event =>
                            setReviewCompensation(current => ({ ...current, feedbackBonusUsdc: event.target.value }))
                          }
                          required
                        />
                        <SelectField
                          className="border-base-content/10 bg-[var(--rateloop-field)]"
                          label={policyCopy.payment.awarder}
                          labelClassName="text-sm"
                          value={reviewCompensation.feedbackBonusAwarderKind}
                          onChange={event =>
                            setReviewCompensation(current => ({
                              ...current,
                              feedbackBonusAwarderKind: event.target.value as "requester" | "designated",
                            }))
                          }
                        >
                          <option value="requester">{policyCopy.payment.requester}</option>
                          <option value="designated">{policyCopy.payment.designated}</option>
                        </SelectField>
                        {reviewCompensation.feedbackBonusAwarderKind === "designated" ? (
                          <div className="sm:col-span-2">
                            <Field
                              label={policyCopy.payment.awarderAccount}
                              className="border-base-content/10 bg-[var(--rateloop-field)]"
                              value={reviewCompensation.feedbackBonusAwarderAccount}
                              onChange={event =>
                                setReviewCompensation(current => ({
                                  ...current,
                                  feedbackBonusAwarderAccount: event.target.value,
                                }))
                              }
                              placeholder={t("authenticatedAccount")}
                              maxLength={320}
                              required
                            />
                          </div>
                        ) : null}
                        <p className="text-xs text-base-content/55 sm:col-span-2">{t("bonusAgentBoundary")}</p>
                      </div>
                    ) : null}
                  </fieldset>
                ) : null}
              </div>
            </section>
            {authorityAdjustmentNotice ? (
              <p className="mt-7 border-l-2 border-l-[var(--rateloop-yellow)] pl-4 text-sm leading-6 text-base-content/70">
                {authorityAdjustmentNotice}
              </p>
            ) : null}
            {reviewFrequency.mode !== "manual" ? (
              <Card variant="nested" className="mt-7 p-4 sm:p-5">
                <ReviewAuthorityFields
                  prominent
                  authority={displayedReviewAuthority}
                  automaticAvailable={automaticAvailable}
                  automaticUnavailableReason={automaticUnavailableReason}
                  requiresFundingPermission={
                    reviewCompensation.compensationMode === "usdc" || reviewCompensation.feedbackBonusEnabled === true
                  }
                  onAuthorityChange={changeReviewAuthority}
                />
              </Card>
            ) : null}
            <SetupActionBar>
              {backButton}
              <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy}>
                {busy ? t("saving") : t("saveContinue")}
              </Button>
            </SetupActionBar>
          </form>
        ) : null}

        {currentStep === "people" ? (
          <>
            <SetupStageHeader headingRef={headingRef} title={t("people")} />
            {setup.reviewDraft?.requestProfile.audience !== "public_network" ? (
              <Card
                as="section"
                variant="nested"
                className="mt-5 flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <h3 className="font-semibold">{t("confirmedReviewers")}</h3>
                  {confirmedReviewerCountError ? (
                    <>
                      <p className="mt-1 text-sm text-error" role="alert">
                        {confirmedReviewerCountError}
                      </p>
                      <button
                        className="btn btn-sm rateloop-secondary-action mt-3"
                        type="button"
                        onClick={() => retryConfirmedReviewerCount()}
                      >
                        <AgentText id="translated248" />
                      </button>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-base-content/60">
                      {confirmedReviewerCount === null
                        ? t("checkingGroup")
                        : completion("seatsReady", {
                            confirmed: confirmedReviewerCount,
                            required: requiredReviewerCount,
                          })}
                    </p>
                  )}
                </div>
                {confirmedReviewerCount !== null ? (
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-medium ${
                      confirmedReviewerSeatsReady ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                    }`}
                  >
                    {confirmedReviewerSeatsReady ? t("ready") : t("actionRequired")}
                  </span>
                ) : null}
              </Card>
            ) : null}
            {privateExpertiseRequirements.length > 0 ? (
              <Card
                as="section"
                variant="nested"
                className="mt-5 p-4"
                aria-labelledby="setup-specialist-coverage-heading"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 id="setup-specialist-coverage-heading" className="font-semibold">
                      {t("specialistCoverage")}
                    </h3>
                    <p className="mt-1 text-sm text-base-content/60">{t("specialistCoverageDescription")}</p>
                  </div>
                  {expertiseCoverage ? (
                    <span
                      className={`rounded-md px-2 py-1 text-xs font-medium ${
                        expertiseCoverage.ready ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                      }`}
                    >
                      {expertiseCoverage.ready ? t("ready") : t("actionRequired")}
                    </span>
                  ) : null}
                </div>
                {expertiseCoverageLoading ? (
                  <p className="mt-4 text-sm text-base-content/55" aria-live="polite">
                    {t("checkingCoverage")}
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
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-base-content/10 px-3 py-2 text-sm"
                        >
                          <span>{coverage?.label ?? expertiseRequirementLabel(requirement, expertiseDefinitions)}</span>
                          <span className="text-base-content/55">
                            {coverage
                              ? `${completion("coverageConfirmed", {
                                  confirmed: coverage.confirmedSeats,
                                  required: requirement.minimumSeats,
                                })}${
                                  coverage.pendingInvitationSeats
                                    ? completion("coveragePending", { count: coverage.pendingInvitationSeats })
                                    : ""
                                }`
                              : completion("coverageNeeded", { count: requirement.minimumSeats })}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            ) : null}
            {!setup.peopleDecision ? (
              <form className="mt-5" onSubmit={configurePeople} aria-busy={busy}>
                {setup.reviewDraft?.requestProfile.audience === "public_network" ? (
                  <>
                    <input type="hidden" name="decision" value="not_required" />
                    <Card as="div" variant="nested" className="p-4 text-sm">
                      <p className="font-medium">{t("network")}</p>
                      <p className="mt-1 text-base-content/60">{t("networkDescription")}</p>
                    </Card>
                  </>
                ) : (
                  <>
                    <input type="hidden" name="decision" value={peopleDecision} />
                    <fieldset>
                      <legend className="font-medium">{t("inviteNow")}</legend>
                      <SetupChoiceGroup>
                        <SetupRadioChoice
                          id="agent-setup-people-invited"
                          name="peopleInvitationKind"
                          value="single"
                          checked={peopleDecision === "invited" && !sharedInvitation}
                          onChange={() => {
                            peopleDecisionTouched.current = true;
                            setPeopleDecision("invited");
                            setSharedInvitation(false);
                          }}
                          label={t("inviteOne")}
                          description={t("inviteOneDescription")}
                        />
                        {canCreateSharedInvitation ? (
                          <SetupRadioChoice
                            id="agent-setup-people-shared"
                            name="peopleInvitationKind"
                            value="shared"
                            checked={peopleDecision === "invited" && sharedInvitation}
                            onChange={() => {
                              peopleDecisionTouched.current = true;
                              setPeopleDecision("invited");
                              setSharedInvitation(true);
                            }}
                            label={t("inviteSeveral")}
                            description={t("inviteSeveralDescription")}
                          />
                        ) : null}
                        <SetupRadioChoice
                          id="agent-setup-people-later"
                          name="peopleInvitationKind"
                          value="later"
                          checked={peopleDecision === "later"}
                          onChange={() => {
                            peopleDecisionTouched.current = true;
                            setPeopleDecision("later");
                          }}
                          // expertiseCoverage is hard-set to null when no specialist requirement
                          // exists — the same value as "loading" — so keying off it alone told a
                          // full reviewer group that automatic requests were still unavailable.
                          label={confirmedReviewerPoolReady ? t("useConfirmed") : t("inviteLater")}
                          description={confirmedReviewerPoolReady ? t("noNewCode") : t("automaticWait")}
                        />
                      </SetupChoiceGroup>
                    </fieldset>
                    {peopleDecision === "invited" ? (
                      <div className="mt-4 space-y-4">
                        {sharedInvitation ? (
                          <>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Field
                                label={t("numberPeople")}
                                className="border-base-content/10 bg-[var(--rateloop-field)]"
                                type="number"
                                name="maximumRedemptions"
                                min={2}
                                max={missingReviewerSeats}
                                value={sharedInvitationCapacity}
                                onChange={event => {
                                  sharedInvitationCapacityTouched.current = true;
                                  setSharedInvitationCapacity(Number(event.target.value));
                                }}
                                required
                              />
                              <Field
                                label={
                                  <>
                                    {t("verifiedDomain")} <span className="text-base-content/55">{t("optional")}</span>
                                  </>
                                }
                                className="border-base-content/10 bg-[var(--rateloop-field)]"
                                type="text"
                                name="intendedEmailDomain"
                                maxLength={253}
                                placeholder="company.com"
                                onChange={() => clearFormErrors("intendedEmailDomain")}
                                error={fieldErrors.intendedEmailDomain}
                              />
                            </div>
                            <Card as="div" variant="nested" className="p-4 text-sm">
                              <p>
                                <AgentText id="translated249" /> {sharedInvitationCapacity}{" "}
                                <AgentText id="translated250" />
                              </p>
                              <p className="mt-2 text-base-content/60">
                                <AgentText id="translated251" />
                              </p>
                              {privateExpertiseRequirements.length > 0 ? (
                                <p className="mt-2 text-base-content/60">
                                  <AgentText id="translated252" />
                                </p>
                              ) : null}
                            </Card>
                          </>
                        ) : (
                          <>
                            <Field
                              label={
                                <>
                                  {t("recipientEmail")}{" "}
                                  {invitationExpertiseIds.length === 0 ? (
                                    <span className="text-base-content/55">{t("optional")}</span>
                                  ) : null}
                                </>
                              }
                              className="border-base-content/10 bg-[var(--rateloop-field)]"
                              type="email"
                              name="intendedEmail"
                              maxLength={320}
                              required={invitationExpertiseIds.length > 0}
                              onChange={() => clearFormErrors("intendedEmail")}
                              error={fieldErrors.intendedEmail}
                              hint={t("recipientEmailHint")}
                            />
                            {privateExpertiseRequirements.length > 0 ? (
                              <fieldset className="rounded-lg border border-base-content/10 p-4">
                                <legend className="px-1 text-sm font-medium">{t("intendedAreas")}</legend>
                                <p className="mt-1 text-xs leading-5 text-base-content/55">
                                  {t("intendedAreasDescription")}
                                </p>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  {privateExpertiseRequirements.map(requirement => (
                                    <label
                                      key={`${requirement.definitionId}:${requirement.definitionVersion}:${requirement.definitionHash}`}
                                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-base-content/10 p-3 text-sm"
                                    >
                                      <ChoiceInput
                                        type="checkbox"
                                        className="checkbox checkbox-sm mt-0.5"
                                        checked={invitationExpertiseIds.includes(requirement.definitionId)}
                                        onChange={event =>
                                          setInvitationExpertiseIds(current =>
                                            event.target.checked
                                              ? [...current, requirement.definitionId]
                                              : current.filter(
                                                  definitionId => definitionId !== requirement.definitionId,
                                                ),
                                          )
                                        }
                                      />
                                      <span>{expertiseRequirementLabel(requirement, expertiseDefinitions)}</span>
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
                {setup.reviewDraft?.requestProfile.compensationMode === "usdc" ? (
                  <Card as="div" variant="nested" className="mt-4 p-4 text-sm">
                    <p className="font-medium">
                      {reviewCompensation.usdcPerReviewer} <AgentText id="translated253" />
                    </p>
                    <p className="mt-1 text-base-content/60">
                      <AgentText id="translated254" />
                    </p>
                  </Card>
                ) : null}
                {setup.reviewDraft?.requestProfile.feedbackBonusEnabled ? (
                  <Card as="div" variant="nested" className="mt-4 p-4 text-sm">
                    <p className="font-medium">
                      {reviewCompensation.feedbackBonusUsdc} <AgentText id="translated255" />
                    </p>
                    <p className="mt-1 text-base-content/60">
                      <AgentText id="translated256" />
                    </p>
                  </Card>
                ) : null}
                <SetupActionBar>
                  {backButton}
                  <Button className="min-h-11 w-full sm:w-auto" type="submit" disabled={busy}>
                    {busy ? t("finishing") : t("finish")}
                  </Button>
                </SetupActionBar>
              </form>
            ) : (
              <div className="mt-5 space-y-4">
                {inviteToken ? (
                  <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
                    <p className="font-medium">{t("copyInvitation")}</p>
                    <p className="mt-1 text-sm text-base-content/60">
                      {issuedInvitationCapacity > 1 ? t("multiUse", { count: issuedInvitationCapacity }) : t("oneUse")}
                    </p>
                    <code className="mt-2 block break-all text-sm">{inviteToken}</code>
                    <button
                      className="btn btn-sm rateloop-secondary-action mt-3"
                      type="button"
                      onClick={() => void copyInvitationLink()}
                    >
                      {t("copyLink")}
                    </button>
                  </div>
                ) : null}
                <Card as="div" variant="nested" className="p-4 text-sm">
                  <p>
                    <span className="text-base-content/55">{t("summaryAgent")}</span>{" "}
                    {setup.agent?.displayName ?? t("connectedAgent")}
                  </p>
                  <p className="mt-2">
                    <span className="text-base-content/55">{t("summaryReview")}</span>{" "}
                    {localizedReviewSummary(setup.reviewDraft?.selection)}
                  </p>
                  <p className="mt-2">
                    <span className="text-base-content/55">{t("summaryPeople")}</span>{" "}
                    {setup.peopleDecision === "invited"
                      ? t("invitationCreated")
                      : setup.peopleDecision === "not_required"
                        ? t("networkNoInvitation")
                        : t("inviteLater")}
                  </p>
                  {setup.reviewDraft?.requestProfile.compensationMode === "usdc" ? (
                    <p className="mt-2">
                      <span className="text-base-content/55">{t("baseBounty")}</span>{" "}
                      {reviewCompensation.usdcPerReviewer} <AgentText id="translated253" />
                    </p>
                  ) : null}
                  {setup.reviewDraft?.requestProfile.feedbackBonusEnabled ? (
                    <p className="mt-2">
                      <span className="text-base-content/55">{policyCopy.payment.feedbackBonus}:</span>{" "}
                      {reviewCompensation.feedbackBonusUsdc} <AgentText id="translated257" />
                    </p>
                  ) : null}
                  {setup.reviewDraft?.selection.mode !== "manual" ? (
                    <p className="mt-2">
                      <span className="text-base-content/55">{t("authority")}</span>{" "}
                      {reviewAuthoritySummary(
                        setup.reviewDraft?.authority ?? "check_only",
                        setup.reviewDraft?.requestProfile.compensationMode === "usdc" ||
                          setup.reviewDraft?.requestProfile.feedbackBonusEnabled === true,
                      )}
                    </p>
                  ) : null}
                </Card>
                {finalizedStatusMessage ? (
                  <p
                    className={`rounded-xl border px-4 py-3 text-sm ${
                      finalizationPostcondition?.canSend
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-warning/30 bg-warning/10 text-warning"
                    }`}
                    role="status"
                  >
                    {finalizedStatusMessage}
                  </p>
                ) : null}
                <SetupActionBar className="mt-0">
                  {backButton}
                  <Button
                    className="min-h-11 w-full sm:w-auto"
                    type="button"
                    disabled={busy}
                    onClick={() => void finishSetup()}
                  >
                    {busy ? t("finishing") : setup.complete ? t("goToAgents") : t("finish")}
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
        {formError ? (
          <p
            id="agent-setup-form-error"
            role="alert"
            className="mt-5 rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-sm text-error"
          >
            {formError}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
