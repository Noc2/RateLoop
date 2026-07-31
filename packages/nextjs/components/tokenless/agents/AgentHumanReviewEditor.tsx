"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentLocale, useAgentTranslations } from "./AgentsLocaleProvider";
import { humanReviewConfirmationMessage } from "./humanReviewConfirmation";
import { InfoPopover } from "~~/components/tokenless/InfoPopover";
import {
  type ReviewRoutingAuthority as Authority,
  type ReviewRoutingMode as Mode,
  ReviewRoutingFields,
  reviewRoutingStateForMode,
} from "~~/components/tokenless/agents/ReviewRoutingFields";
import { useLocalizedReviewPolicyCopy } from "~~/components/tokenless/agents/reviewPolicyCopy";
import { Field, SelectField, TextareaField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { SegmentedChoice } from "~~/components/tokenless/ui/SegmentedChoice";
import { useConfirmDialog } from "~~/components/tokenless/ui/useConfirmDialog";
import { DurationInput } from "~~/components/ui/DurationInput";
import { ADAPTIVE_MONITORING_FLOOR_BPS } from "~~/lib/tokenless/adaptiveReviewPolicy";
import { readJson } from "~~/lib/tokenless/http";
import { configuredHumanReviewLaneForSelection, configuredHumanReviewLanes } from "~~/lib/tokenless/reviewCapabilities";
import { formatUsdcAtomic, parseUsdcDecimal } from "~~/lib/tokenless/usdc";

type Audience = "private_invited" | "public_network" | "hybrid";
type QuestionAuthority = "owner_fixed" | "agent_per_request";

type OwnerView = {
  bindingRevision: number;
  blockingReason?: { code: string; message: string } | null;
  capability?: { available: boolean; code: string; lane: string; message: string } | null;
  configuration: {
    authority: Authority;
    delegation: {
      integrationId: string | null;
      publishingPolicy: { id: string; version: number };
      allowedWorkflowKeys: string[];
    } | null;
    requestProfile: { value: Record<string, unknown> };
    selection: { value: Record<string, unknown> };
  } | null;
  connection: {
    allowedWorkflowKeys: string[];
    connectionStatus: string | null;
    enforcementMode: "advisory" | "host_enforced" | null;
    integrationId: string;
    reportedLane: string;
  } | null;
};

const CONFIGURED_HUMAN_REVIEW_LANES = configuredHumanReviewLanes();

type SaveResponse = {
  privateReviewRouting?: { ready?: boolean; reason?: string } | null;
  privateReviewRoutingReconciliationFailed?: boolean;
};

type Draft = {
  questionAuthority: QuestionAuthority;
  mode: Mode;
  ratePercent: string;
  maximumUnreviewedGap: string;
  requiredRiskTiers: string;
  minimumConfidencePercent: string;
  criterion: string;
  positiveLabel: string;
  negativeLabel: string;
  rationaleMode: "off" | "optional" | "required";
  audience: Audience;
  privateReviewerCompatibilityId: string;
  responseWindowSeconds: string;
  panelSize: string;
  compensationMode: "unpaid" | "usdc";
  bountyUsdc: string;
  feedbackBonusEnabled: boolean;
  feedbackBonusUsdc: string;
  feedbackBonusAwarderKind: "requester" | "designated";
  feedbackBonusAwarderAccount: string;
  authority: Authority;
};

type Translate = (key: string, values?: Record<string, number | string>) => string;

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function strings(value: unknown, fallback: string[]) {
  return Array.isArray(value) && value.every(entry => typeof entry === "string") ? value : fallback;
}

function atomicToUsdc(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) return "1";
  return formatUsdcAtomic(value, { includeUnit: false, useGrouping: false });
}

class LocalizedReviewError extends Error {}

class FormFieldError extends LocalizedReviewError {
  field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "FormFieldError";
    this.field = field;
  }
}

function usdcToAtomic(value: string, field: string, label: string, t: Translate) {
  let atomic: string;
  try {
    atomic = parseUsdcDecimal(value);
  } catch {
    throw new FormFieldError(field, t("decimalPlaces", { label }));
  }
  if (BigInt(atomic) <= 0n) throw new FormFieldError(field, t("greaterThanZero", { label }));
  return atomic;
}

function draftFromView(view: OwnerView, t: Translate): Draft {
  const selection = view.configuration?.selection.value ?? {
    mode: "always",
    productionFloorBps: 0,
    maximumUnreviewedGap: 20,
    requiredRiskTiers: ["high"],
    minimumConfidenceBps: 7_000,
  };
  const request = view.configuration?.requestProfile.value ?? {
    questionAuthority: "owner_fixed",
    criterion: t("defaultCriterion"),
    positiveLabel: t("defaultApprove"),
    negativeLabel: t("defaultReject"),
    rationaleMode: "required",
    audience: "private_invited",
    responseWindowSeconds: 3_600,
    panelSize: 2,
    compensationMode: "unpaid",
    feedbackBonusEnabled: false,
  };
  const mode = String(selection.mode) as Mode;
  const rateBps =
    mode === "fixed"
      ? number(selection.fixedRateBps, 1_000)
      : number(selection.productionFloorBps, ADAPTIVE_MONITORING_FLOOR_BPS);
  return {
    questionAuthority: request.questionAuthority === "agent_per_request" ? "agent_per_request" : "owner_fixed",
    mode,
    ratePercent: String(rateBps / 100),
    maximumUnreviewedGap: String(number(selection.maximumUnreviewedGap, 20)),
    requiredRiskTiers: strings(selection.requiredRiskTiers, ["high"]).join(", "),
    minimumConfidencePercent:
      selection.minimumConfidenceBps === null ? "" : String(number(selection.minimumConfidenceBps, 7_000) / 100),
    criterion: String(request.criterion ?? ""),
    positiveLabel: String(request.positiveLabel ?? t("defaultApprove")),
    negativeLabel: String(request.negativeLabel ?? t("defaultReject")),
    rationaleMode: String(request.rationaleMode ?? "required") as Draft["rationaleMode"],
    audience: String(request.audience ?? "private_invited") as Audience,
    privateReviewerCompatibilityId: String(request.privateGroupId ?? ""),
    responseWindowSeconds: String(number(request.responseWindowSeconds, 3_600)),
    panelSize: String(number(request.panelSize, 2)),
    compensationMode: String(request.compensationMode ?? "unpaid") as Draft["compensationMode"],
    bountyUsdc: atomicToUsdc(request.bountyPerSeatAtomic),
    feedbackBonusEnabled: request.feedbackBonusEnabled === true,
    feedbackBonusUsdc: request.feedbackBonusPoolAtomic ? atomicToUsdc(request.feedbackBonusPoolAtomic) : "2",
    feedbackBonusAwarderKind: request.feedbackBonusAwarderKind === "designated" ? "designated" : "requester",
    feedbackBonusAwarderAccount: String(request.feedbackBonusAwarderAccount ?? ""),
    authority: mode === "manual" ? "check_only" : (view.configuration?.authority ?? "check_only"),
  };
}

function positiveInteger(value: string, field: string, label: string, minimum: number, maximum: number, t: Translate) {
  if (!/^\d+$/u.test(value.trim())) throw new FormFieldError(field, t("wholeNumber", { label }));
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new FormFieldError(field, t("numberRange", { label, minimum, maximum }));
  }
  return parsed;
}

function bps(value: string, field: string, label: string, minimum: number, t: Translate) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed * 100 < minimum || parsed > 100) {
    throw new FormFieldError(field, t("percentRange", { label, minimum: minimum / 100 }));
  }
  return Math.round(parsed * 100);
}

function buildMutation(view: OwnerView, draft: Draft, t: Translate, confirmationCopy: Translate) {
  const configuration = view.configuration;
  const currentSelection = configuration?.selection.value ?? {
    enforcementMode: "advisory",
    agreementThresholdBps: 7_000,
    criticalRiskTiers: ["critical"],
    maximumLatencyMs: 120_000,
  };
  const currentRequestProfile = configuration?.requestProfile.value ?? {
    requiredExpertiseKeys: [],
    expertiseRequirements: [],
    privateSensitivity: "confidential",
  };
  const authority: Authority = draft.mode === "manual" ? "check_only" : draft.authority;
  if (draft.questionAuthority === "agent_per_request" && draft.mode === "adaptive") {
    throw new LocalizedReviewError(t("agentAdaptive"));
  }
  if (draft.questionAuthority === "agent_per_request" && draft.audience !== "public_network") {
    throw new LocalizedReviewError(t("agentNetwork"));
  }
  const requiredRiskTiers = [
    ...new Set(
      draft.requiredRiskTiers
        .split(",")
        .map(value => value.trim())
        .filter(Boolean),
    ),
  ];
  const minimumPanelSize = draft.audience === "private_invited" ? 2 : 3;
  const panelSize = positiveInteger(draft.panelSize, "panelSize", t("panelSize"), minimumPanelSize, 100, t);
  const responseWindowSeconds = positiveInteger(
    draft.responseWindowSeconds,
    "responseWindowSeconds",
    t("responseWindow"),
    1_200,
    86_400,
    t,
  );
  const compensationMode = draft.audience === "private_invited" ? draft.compensationMode : "usdc";
  const configuredLane = configuredHumanReviewLaneForSelection(draft.audience, compensationMode);
  if (!configuredLane.available) throw new LocalizedReviewError(t("reviewPathUnavailable"));
  const privateGroupId = draft.audience === "public_network" ? null : draft.privateReviewerCompatibilityId.trim();
  if (draft.audience !== "public_network" && !privateGroupId) {
    throw new LocalizedReviewError(t("reviewerRouting"));
  }
  const selection = {
    mode: draft.mode,
    enforcementMode: draft.mode === "manual" ? "advisory" : currentSelection.enforcementMode,
    agreementThresholdBps: currentSelection.agreementThresholdBps,
    productionFloorBps: draft.mode === "adaptive" ? ADAPTIVE_MONITORING_FLOOR_BPS : 0,
    fixedRateBps: draft.mode === "fixed" ? bps(draft.ratePercent, "ratePercent", t("fixedRate"), 1, t) : null,
    maximumUnreviewedGap: positiveInteger(
      draft.maximumUnreviewedGap,
      "maximumUnreviewedGap",
      t("maximumGap"),
      1,
      10_000,
      t,
    ),
    requiredRiskTiers,
    criticalRiskTiers: currentSelection.criticalRiskTiers,
    minimumConfidenceBps: draft.minimumConfidencePercent.trim()
      ? bps(draft.minimumConfidencePercent, "minimumConfidencePercent", t("confidence"), 0, t)
      : null,
    maximumLatencyMs: currentSelection.maximumLatencyMs,
  };
  const requestProfile = {
    requiredExpertiseKeys: strings(currentRequestProfile.requiredExpertiseKeys, []),
    expertiseRequirements: Array.isArray(currentRequestProfile.expertiseRequirements)
      ? currentRequestProfile.expertiseRequirements
      : [],
    questionAuthority: draft.questionAuthority,
    ...(draft.questionAuthority === "owner_fixed"
      ? {
          criterion: draft.criterion.trim(),
          positiveLabel: draft.positiveLabel.trim(),
          negativeLabel: draft.negativeLabel.trim(),
        }
      : {}),
    rationaleMode: draft.feedbackBonusEnabled && draft.rationaleMode === "off" ? "optional" : draft.rationaleMode,
    audience: draft.audience,
    contentBoundary: draft.audience === "private_invited" ? "private_workspace" : "public_or_test",
    privateSensitivity:
      draft.audience === "private_invited" ? (currentRequestProfile.privateSensitivity ?? "confidential") : null,
    privateGroupId,
    responseWindowSeconds,
    panelSize,
    compensationMode,
    bountyPerSeatAtomic:
      compensationMode === "usdc" ? usdcToAtomic(draft.bountyUsdc, "bountyUsdc", t("bountyPerReviewer"), t) : null,
    feedbackBonusEnabled: draft.feedbackBonusEnabled,
    feedbackBonusPoolAtomic: draft.feedbackBonusEnabled
      ? usdcToAtomic(draft.feedbackBonusUsdc, "feedbackBonusUsdc", t("bonusPool"), t)
      : null,
    feedbackBonusAwarderKind: draft.feedbackBonusEnabled ? draft.feedbackBonusAwarderKind : "requester",
    feedbackBonusAwarderAccount:
      draft.feedbackBonusEnabled && draft.feedbackBonusAwarderKind === "designated"
        ? draft.feedbackBonusAwarderAccount.trim()
        : null,
    feedbackBonusAwardWindowSeconds: draft.feedbackBonusEnabled ? 604_800 : null,
  };
  if (
    draft.questionAuthority === "owner_fixed" &&
    (!requestProfile.criterion || !requestProfile.positiveLabel || !requestProfile.negativeLabel)
  ) {
    const missingField = !requestProfile.criterion
      ? "criterion"
      : !requestProfile.positiveLabel
        ? "positiveLabel"
        : "negativeLabel";
    throw new FormFieldError(missingField, t("questionRequired"));
  }
  if (
    draft.feedbackBonusEnabled &&
    draft.feedbackBonusAwarderKind === "designated" &&
    !draft.feedbackBonusAwarderAccount.trim()
  ) {
    throw new FormFieldError("feedbackBonusAwarderAccount", t("awarderRequired"));
  }
  let publishingGrant: Record<string, unknown> | null = null;
  if (authority === "ask_automatically") {
    const delegation = configuration?.delegation ?? null;
    const connection = view.connection;
    const workflowKeys = delegation?.allowedWorkflowKeys.length
      ? delegation.allowedWorkflowKeys
      : (connection?.allowedWorkflowKeys ?? []);
    const integrationId = delegation?.integrationId ?? connection?.integrationId;
    if (
      !integrationId ||
      workflowKeys.length === 0 ||
      (!delegation?.integrationId && connection?.connectionStatus !== "connected")
    ) {
      throw new LocalizedReviewError(t("automaticConnection"));
    }
    publishingGrant = delegation?.integrationId
      ? {
          integrationId,
          publishingPolicyId: delegation.publishingPolicy.id,
          publishingPolicyVersion: delegation.publishingPolicy.version,
          allowedWorkflowKeys: workflowKeys,
        }
      : {
          integrationId,
          provision: "private_invited_unpaid",
          allowedWorkflowKeys: workflowKeys,
        };
  }
  const body =
    authority === "ask_automatically"
      ? {
          expectedBindingVersion: view.bindingRevision,
          selection,
          requestProfile,
          authority,
          publishingGrant,
        }
      : {
          expectedBindingVersion: view.bindingRevision,
          selection,
          requestProfile,
          authority,
          publishingGrant: null,
        };
  return {
    body,
    confirmation: humanReviewConfirmationMessage(
      {
        authority,
        bountyPerSeatAtomic: compensationMode === "usdc" ? requestProfile.bountyPerSeatAtomic : null,
        feedbackBonusPoolAtomic: draft.feedbackBonusEnabled ? requestProfile.feedbackBonusPoolAtomic : null,
        panelSize,
      },
      {
        automatic: confirmationCopy("automatic"),
        payment: amount => confirmationCopy("payment", { amount }),
        save: confirmationCopy("save"),
      },
    ),
  };
}

function savedStatus(response: SaveResponse, authority: Authority, t: Translate) {
  if (authority !== "ask_automatically") return t("saved");
  if (response.privateReviewRouting?.ready) {
    return t("savedAutomatic");
  }
  if (response.privateReviewRouting?.reason === "reviewer_seats_insufficient") {
    return t("savedReviewers");
  }
  if (response.privateReviewRouting?.reason === "expertise_coverage_insufficient") {
    return t("savedExpertise");
  }
  if (response.privateReviewRoutingReconciliationFailed) {
    return t("savedCheck");
  }
  return t("saved");
}

export function AgentHumanReviewEditor({
  workspaceId,
  agentId,
  onSaved,
}: {
  workspaceId: string;
  agentId: string;
  onSaved?: () => void;
}) {
  const ui = useAgentTranslations("ui");
  const locale = useAgentLocale();
  const errors = useAgentTranslations("errors");
  const editor = useAgentTranslations("reviewEditor");
  const confirmationCopy = useAgentTranslations("reviewConfirmation");
  const policyCopy = useLocalizedReviewPolicyCopy();
  const [view, setView] = useState<OwnerView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmDialog();
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const reviewBody = await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/human-review`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal,
          },
        ),
      );
      const nextView = reviewBody as unknown as OwnerView;
      setView(nextView);
      setDraft(draftFromView(nextView, editor));
    },
    [agentId, editor, workspaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(cause => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      capture(errors("loadHumanReview"), errors("loadHumanReview"));
    });
    return () => controller.abort();
  }, [capture, errors, load]);

  function update<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft(current => (current ? { ...current, [key]: value } : current));
    clear(key);
    setStatus(null);
  }

  function changeReviewMode(mode: Mode) {
    setDraft(current =>
      current
        ? {
            ...current,
            ...reviewRoutingStateForMode(mode, current.authority),
          }
        : current,
    );
    setStatus(null);
  }

  function changeQuestionAuthority(questionAuthority: QuestionAuthority) {
    setDraft(current =>
      current
        ? {
            ...current,
            questionAuthority,
            ...(questionAuthority === "agent_per_request"
              ? {
                  mode: current.mode === "adaptive" ? ("always" as const) : current.mode,
                  audience: "public_network" as const,
                  compensationMode: "usdc" as const,
                }
              : {}),
          }
        : current,
    );
    setStatus(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view || !draft) return;
    clear();
    try {
      const next = buildMutation(view, draft, editor, confirmationCopy);
      if (
        next.confirmation &&
        !(await confirm({
          title: policyCopy.confirmation.title,
          description: next.confirmation,
          confirmLabel: policyCopy.confirmation.action,
          destructive: false,
        }))
      )
        return;
      setBusy(true);
      const saved = (await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/human-review`,
          {
            method: "PUT",
            body: JSON.stringify(next.body),
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
          },
        ),
      )) as SaveResponse;
      await load();
      setStatus(savedStatus(saved, draft.authority, editor));
      onSaved?.();
    } catch (cause) {
      if (cause instanceof LocalizedReviewError || locale === "en") capture(cause, errors("saveHumanReview"));
      else {
        const field =
          cause && typeof cause === "object" && "field" in cause && typeof cause.field === "string"
            ? cause.field
            : null;
        capture(
          field ? new FormFieldError(field, errors("saveHumanReview")) : errors("saveHumanReview"),
          errors("saveHumanReview"),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (!draft || !view) {
    return (
      <Card as="section" id="agent-human-review-editor" className="rounded-2xl p-6">
        <p className="text-sm text-base-content/60">{formError ?? editor("loading")}</p>
      </Card>
    );
  }
  const exactDelegationAvailable = Boolean(
    view.configuration?.delegation?.integrationId && view.configuration.delegation.allowedWorkflowKeys.length > 0,
  );
  const privateUnpaidBootstrapAvailable = Boolean(
    draft.audience === "private_invited" &&
      draft.compensationMode === "unpaid" &&
      !draft.feedbackBonusEnabled &&
      view.connection?.connectionStatus === "connected" &&
      view.connection.allowedWorkflowKeys.length > 0,
  );
  const automaticAvailable = exactDelegationAvailable || privateUnpaidBootstrapAvailable;
  const creating = view.configuration === null;
  const advisoryConnectionLabel =
    view.connection?.reportedLane === "plugin-with-hooks" ? editor("pluginConnection") : editor("connection");
  const canChooseQuestionAuthority =
    CONFIGURED_HUMAN_REVIEW_LANES.publicPaidNetwork.available || draft.questionAuthority === "agent_per_request";
  const canChooseAudience =
    CONFIGURED_HUMAN_REVIEW_LANES.publicPaidNetwork.available ||
    CONFIGURED_HUMAN_REVIEW_LANES.hybridPublicSafe.available ||
    draft.audience !== "private_invited";
  const paidConfigurationRelevant =
    CONFIGURED_HUMAN_REVIEW_LANES.privateInvitedPaid.available ||
    draft.compensationMode === "usdc" ||
    draft.feedbackBonusEnabled;

  return (
    <Card as="section" id="agent-human-review-editor" className="rounded-2xl p-6">
      {confirmationDialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{creating ? ui("finishHumanReview") : ui("humanReviewTitle")}</h2>
          <p className="mt-1 text-sm text-base-content/60">
            {creating ? editor("createDescription") : editor("editDescription")}
          </p>
        </div>
      </div>
      {view.connection?.enforcementMode === "advisory" ? (
        <p className="mt-4 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3 text-sm leading-6 text-base-content/75">
          <strong>
            {advisoryConnectionLabel}
            <AgentText id="translated031" />
          </strong>{" "}
          <AgentText id="translated032" />
        </p>
      ) : null}
      {view.blockingReason ? (
        <p className="alert alert-warning mt-4 text-sm" role="alert">
          {locale === "en" ? view.blockingReason.message : editor("blocking")}
        </p>
      ) : null}
      <form className="mt-6 space-y-6" onSubmit={submit}>
        <section className="space-y-4" aria-labelledby={`review-question-${agentId}`}>
          <div>
            <p className="font-mono text-xs text-base-content/55">01</p>
            <h3 id={`review-question-${agentId}`} className="mt-1 font-semibold">
              <AgentText id="translated033" />
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {canChooseQuestionAuthority ? (
              <SelectField
                containerClassName="sm:col-span-2"
                label={policyCopy.question.authority}
                labelClassName="text-sm"
                value={draft.questionAuthority}
                onChange={event => changeQuestionAuthority(event.target.value as QuestionAuthority)}
              >
                <option value="owner_fixed">{policyCopy.question.ownerFixed}</option>
                {CONFIGURED_HUMAN_REVIEW_LANES.publicPaidNetwork.available ||
                draft.questionAuthority === "agent_per_request" ? (
                  <option value="agent_per_request">{policyCopy.question.agentPerRequest}</option>
                ) : null}
              </SelectField>
            ) : null}
            {draft.questionAuthority === "owner_fixed" ? (
              <>
                <div className="sm:col-span-2">
                  <TextareaField
                    label={policyCopy.question.criterion}
                    className="w-full"
                    rows={3}
                    value={draft.criterion}
                    error={fieldErrors.criterion}
                    onChange={event => update("criterion", event.target.value)}
                    required
                  />
                </div>
                <Field
                  label={policyCopy.question.positiveAnswer}
                  value={draft.positiveLabel}
                  error={fieldErrors.positiveLabel}
                  onChange={event => update("positiveLabel", event.target.value)}
                  required
                />
                <Field
                  label={policyCopy.question.negativeAnswer}
                  value={draft.negativeLabel}
                  error={fieldErrors.negativeLabel}
                  onChange={event => update("negativeLabel", event.target.value)}
                  required
                />
              </>
            ) : (
              <p className="text-sm leading-6 text-base-content/60 sm:col-span-2">
                {policyCopy.question.agentWrittenNote}
              </p>
            )}
            <SelectField
              label={policyCopy.question.rationale}
              labelClassName="text-sm"
              value={draft.rationaleMode}
              onChange={event => update("rationaleMode", event.target.value as Draft["rationaleMode"])}
            >
              <option value="off">{policyCopy.question.rationaleOff}</option>
              <option value="optional">{policyCopy.question.rationaleOptional}</option>
              <option value="required">{policyCopy.question.rationaleRequired}</option>
            </SelectField>
          </div>
        </section>

        <section
          className="space-y-4 border-t border-base-content/10 pt-6"
          aria-labelledby={`review-routing-${agentId}`}
        >
          <div>
            <p className="font-mono text-xs text-base-content/55">02</p>
            <h3 id={`review-routing-${agentId}`} className="mt-1 font-semibold">
              <AgentText id="translated034" />
            </h3>
          </div>
          <ReviewRoutingFields
            mode={draft.mode}
            authority={draft.authority}
            automaticAvailable={automaticAvailable}
            automaticUnavailableReason={
              draft.compensationMode === "usdc" || draft.feedbackBonusEnabled || draft.audience !== "private_invited"
                ? editor("automaticFirstGrant")
                : ui("reconnectWorkflow")
            }
            requiresFundingPermission={draft.compensationMode === "usdc" || draft.feedbackBonusEnabled}
            adaptiveAvailable={draft.questionAuthority !== "agent_per_request"}
            onModeChange={changeReviewMode}
            onAuthorityChange={authority => update("authority", authority)}
          />
          {draft.mode === "adaptive" ? (
            <div className="flex items-start gap-2 rounded-xl border border-base-content/10 p-4 text-sm text-base-content/70">
              <p>{policyCopy.limits.adaptiveDetail}</p>
              <InfoPopover label={ui("aboutAdaptiveCoverage")}>
                <AgentText id="translated035" />
              </InfoPopover>
            </div>
          ) : null}
          {draft.mode === "adaptive" || draft.mode === "fixed" ? (
            <div className="grid gap-4 rounded-xl border border-base-content/10 p-4 sm:grid-cols-2">
              <Field
                label={draft.mode === "adaptive" ? policyCopy.limits.adaptiveRate : policyCopy.limits.fixedRate}
                type="number"
                min={draft.mode === "fixed" ? 0.01 : undefined}
                max={100}
                step="0.01"
                value={draft.ratePercent}
                error={fieldErrors.ratePercent}
                onChange={event => update("ratePercent", event.target.value)}
                disabled={draft.mode === "adaptive"}
              />
              <Field
                label={policyCopy.limits.maximumGap}
                type="number"
                min={1}
                max={10000}
                value={draft.maximumUnreviewedGap}
                error={fieldErrors.maximumUnreviewedGap}
                onChange={event => update("maximumUnreviewedGap", event.target.value)}
              />
            </div>
          ) : null}
          {draft.mode === "rules" ? (
            <div className="grid gap-4 rounded-xl border border-base-content/10 p-4 sm:grid-cols-2">
              <Field
                label={policyCopy.limits.riskTiers}
                value={draft.requiredRiskTiers}
                error={fieldErrors.requiredRiskTiers}
                onChange={event => update("requiredRiskTiers", event.target.value)}
              />
              <Field
                label={policyCopy.limits.confidence}
                type="number"
                min={0}
                max={100}
                value={draft.minimumConfidencePercent}
                error={fieldErrors.minimumConfidencePercent}
                onChange={event => update("minimumConfidencePercent", event.target.value)}
              />
            </div>
          ) : null}
        </section>

        <section className="space-y-4 border-t border-base-content/10 pt-6" aria-labelledby={`review-panel-${agentId}`}>
          <div>
            <p className="font-mono text-xs text-base-content/55">03</p>
            <h3 id={`review-panel-${agentId}`} className="mt-1 font-semibold">
              <AgentText id="translated036" />
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {canChooseAudience ? (
              <SelectField
                label={policyCopy.audience.label}
                labelClassName="text-sm"
                value={draft.audience}
                onChange={event => {
                  const audience = event.target.value as Audience;
                  setDraft(current =>
                    current
                      ? {
                          ...current,
                          audience,
                          compensationMode: audience === "private_invited" ? current.compensationMode : "usdc",
                        }
                      : current,
                  );
                }}
              >
                {draft.questionAuthority !== "agent_per_request" ? (
                  <option value="private_invited">{policyCopy.audience.invited}</option>
                ) : null}
                {CONFIGURED_HUMAN_REVIEW_LANES.publicPaidNetwork.available || draft.audience === "public_network" ? (
                  <option value="public_network">{policyCopy.audience.rateLoopNetwork}</option>
                ) : null}
                {draft.questionAuthority !== "agent_per_request" &&
                (CONFIGURED_HUMAN_REVIEW_LANES.hybridPublicSafe.available || draft.audience === "hybrid") ? (
                  <option value="hybrid">
                    <AgentText id="hybridAudience" />
                  </option>
                ) : null}
              </SelectField>
            ) : (
              <div>
                <p className="text-sm font-medium">{policyCopy.audience.label}</p>
                <p className="mt-2 text-sm text-base-content/70">{policyCopy.audience.invited}</p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium" htmlFor={`response-window-${agentId}`}>
                {policyCopy.timing.responseWindow}
              </label>
              <DurationInput
                id={`response-window-${agentId}`}
                valueSeconds={draft.responseWindowSeconds}
                minSeconds={1_200}
                maxSeconds={86_400}
                invalid={Boolean(fieldErrors.responseWindowSeconds)}
                ariaDescribedBy={fieldErrors.responseWindowSeconds ? `response-window-${agentId}-error` : undefined}
                onChangeSeconds={value => update("responseWindowSeconds", value)}
              />
              {fieldErrors.responseWindowSeconds ? (
                <p id={`response-window-${agentId}-error`} className="mt-1 text-sm text-error" role="alert">
                  {fieldErrors.responseWindowSeconds}
                </p>
              ) : null}
            </div>
            <Field
              label={policyCopy.timing.panelSize}
              type="number"
              min={draft.audience === "private_invited" ? 2 : 3}
              max={100}
              value={draft.panelSize}
              error={fieldErrors.panelSize}
              onChange={event => update("panelSize", event.target.value)}
              required
            />
            {paidConfigurationRelevant ? (
              <SelectField
                label={policyCopy.payment.bounty}
                labelClassName="text-sm"
                value={draft.compensationMode}
                onChange={event => update("compensationMode", event.target.value as Draft["compensationMode"])}
              >
                {draft.audience === "private_invited" ? (
                  <option value="unpaid">{policyCopy.payment.noBounty}</option>
                ) : null}
                {CONFIGURED_HUMAN_REVIEW_LANES.privateInvitedPaid.available || draft.compensationMode === "usdc" ? (
                  <option value="usdc">{policyCopy.payment.addBounty}</option>
                ) : null}
              </SelectField>
            ) : null}
            {draft.compensationMode === "usdc" ? (
              <Field
                label={policyCopy.payment.bountyPerReviewer}
                inputMode="decimal"
                value={draft.bountyUsdc}
                error={fieldErrors.bountyUsdc}
                onChange={event => update("bountyUsdc", event.target.value)}
                required
              />
            ) : null}
            {paidConfigurationRelevant ? (
              <fieldset className="rounded-xl border border-base-content/10 p-4 sm:col-span-2">
                <legend className="px-1 text-sm font-medium">{policyCopy.payment.feedbackBonus}</legend>
                <SegmentedChoice
                  className="sm:max-w-md"
                  value={draft.feedbackBonusEnabled ? "enabled" : "disabled"}
                  options={[
                    { value: "disabled", label: policyCopy.payment.noBonus },
                    { value: "enabled", label: policyCopy.payment.addBonus },
                  ]}
                  onChange={value => update("feedbackBonusEnabled", value === "enabled")}
                />
                {draft.feedbackBonusEnabled ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field
                      label={policyCopy.payment.bonusPool}
                      inputMode="decimal"
                      value={draft.feedbackBonusUsdc}
                      error={fieldErrors.feedbackBonusUsdc}
                      onChange={event => update("feedbackBonusUsdc", event.target.value)}
                      required
                    />
                    <SelectField
                      label={policyCopy.payment.awarder}
                      labelClassName="text-sm"
                      value={draft.feedbackBonusAwarderKind}
                      onChange={event =>
                        update("feedbackBonusAwarderKind", event.target.value as Draft["feedbackBonusAwarderKind"])
                      }
                    >
                      <option value="requester">{policyCopy.payment.requester}</option>
                      <option value="designated">{policyCopy.payment.designated}</option>
                    </SelectField>
                    {draft.feedbackBonusAwarderKind === "designated" ? (
                      <div className="sm:col-span-2">
                        <Field
                          label={policyCopy.payment.awarderAccount}
                          value={draft.feedbackBonusAwarderAccount}
                          error={fieldErrors.feedbackBonusAwarderAccount}
                          onChange={event => update("feedbackBonusAwarderAccount", event.target.value)}
                          maxLength={320}
                          required
                        />
                      </div>
                    ) : null}
                    <p className="text-xs text-base-content/55 sm:col-span-2">
                      <AgentText id="translated037" />
                    </p>
                  </div>
                ) : null}
              </fieldset>
            ) : null}
          </div>
        </section>
        {formError ? (
          <p className="alert alert-error text-sm" role="alert">
            {formError}
          </p>
        ) : null}
        {status ? (
          <p className="alert alert-success text-sm" role="status">
            {status}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? ui("savingChanges") : creating ? ui("finishSetup") : ui("saveChanges")}
        </Button>
      </form>
    </Card>
  );
}
