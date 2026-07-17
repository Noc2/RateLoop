"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { humanReviewConfirmationMessage } from "./humanReviewConfirmation";
import {
  type ReviewRoutingAuthority as Authority,
  type ReviewRoutingMode as Mode,
  ReviewRoutingFields,
  reviewRoutingStateForMode,
} from "~~/components/tokenless/agents/ReviewRoutingFields";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { readJson } from "~~/lib/tokenless/http";
import { formatUsdcAtomic, parseUsdcDecimal } from "~~/lib/tokenless/usdc";

type Audience = "private_invited" | "public_network" | "hybrid";
type QuestionAuthority = "owner_fixed" | "agent_per_request";

type OwnerView = {
  bindingRevision: number;
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
  connection: { allowedWorkflowKeys: string[]; integrationId: string } | null;
};

type PrivateGroup = { groupId: string; name: string; status: string };

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
  privateGroupId: string;
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

function usdcToAtomic(value: string) {
  let atomic: string;
  try {
    atomic = parseUsdcDecimal(value);
  } catch {
    throw new Error("USDC per reviewer must have at most six decimal places.");
  }
  if (BigInt(atomic) <= 0n) throw new Error("USDC per reviewer must be greater than zero.");
  return atomic;
}

function draftFromView(view: OwnerView): Draft {
  if (!view.configuration) throw new Error("Finish human-review setup before editing it.");
  const selection = view.configuration.selection.value;
  const request = view.configuration.requestProfile.value;
  const mode = String(selection.mode) as Mode;
  const rateBps =
    mode === "fixed" ? number(selection.fixedRateBps, 1_000) : number(selection.productionFloorBps, 1_000);
  return {
    questionAuthority: request.questionAuthority === "agent_per_request" ? "agent_per_request" : "owner_fixed",
    mode,
    ratePercent: String(rateBps / 100),
    maximumUnreviewedGap: String(number(selection.maximumUnreviewedGap, 20)),
    requiredRiskTiers: strings(selection.requiredRiskTiers, ["high"]).join(", "),
    minimumConfidencePercent:
      selection.minimumConfidenceBps === null ? "" : String(number(selection.minimumConfidenceBps, 7_000) / 100),
    criterion: String(request.criterion ?? ""),
    positiveLabel: String(request.positiveLabel ?? "Approve"),
    negativeLabel: String(request.negativeLabel ?? "Reject"),
    rationaleMode: String(request.rationaleMode ?? "required") as Draft["rationaleMode"],
    audience: String(request.audience ?? "private_invited") as Audience,
    privateGroupId: String(request.privateGroupId ?? ""),
    responseWindowSeconds: String(number(request.responseWindowSeconds, 3_600)),
    panelSize: String(number(request.panelSize, 1)),
    compensationMode: String(request.compensationMode ?? "unpaid") as Draft["compensationMode"],
    bountyUsdc: atomicToUsdc(request.bountyPerSeatAtomic),
    feedbackBonusEnabled: request.feedbackBonusEnabled === true,
    feedbackBonusUsdc: request.feedbackBonusPoolAtomic ? atomicToUsdc(request.feedbackBonusPoolAtomic) : "2",
    feedbackBonusAwarderKind: request.feedbackBonusAwarderKind === "designated" ? "designated" : "requester",
    feedbackBonusAwarderAccount: String(request.feedbackBonusAwarderAccount ?? ""),
    authority: mode === "manual" ? "check_only" : view.configuration.authority,
  };
}

function positiveInteger(value: string, field: string, minimum: number, maximum: number) {
  if (!/^\d+$/u.test(value.trim())) throw new Error(`${field} must be a whole number.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function bps(value: string, field: string, minimum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed * 100 < minimum || parsed > 100) {
    throw new Error(`${field} must be between ${minimum / 100}% and 100%.`);
  }
  return Math.round(parsed * 100);
}

function buildMutation(view: OwnerView, draft: Draft) {
  const configuration = view.configuration;
  if (!configuration) throw new Error("Human-review configuration is unavailable.");
  const currentSelection = configuration.selection.value;
  const currentRequestProfile = configuration.requestProfile.value;
  const authority: Authority = draft.mode === "manual" ? "check_only" : draft.authority;
  if (draft.questionAuthority === "agent_per_request" && draft.mode === "adaptive") {
    throw new Error("Agent-written questions cannot use adaptive review.");
  }
  if (draft.questionAuthority === "agent_per_request" && draft.audience !== "public_network") {
    throw new Error("Agent-written questions require RateLoop network reviewers.");
  }
  const requiredRiskTiers = [
    ...new Set(
      draft.requiredRiskTiers
        .split(",")
        .map(value => value.trim())
        .filter(Boolean),
    ),
  ];
  const minimumPanelSize = draft.audience === "private_invited" ? 1 : 3;
  const panelSize = positiveInteger(draft.panelSize, "Reviewer count", minimumPanelSize, 100);
  const responseWindowSeconds = positiveInteger(draft.responseWindowSeconds, "Response window", 1_200, 86_400);
  const compensationMode = draft.audience === "private_invited" ? draft.compensationMode : "usdc";
  const privateGroupId = draft.audience === "public_network" ? null : draft.privateGroupId.trim();
  if (draft.audience !== "public_network" && !privateGroupId) throw new Error("Choose an invited reviewer group.");
  const selection = {
    mode: draft.mode,
    enforcementMode: draft.mode === "manual" ? "advisory" : currentSelection.enforcementMode,
    agreementThresholdBps: currentSelection.agreementThresholdBps,
    productionFloorBps: draft.mode === "adaptive" ? bps(draft.ratePercent, "Minimum review rate", 1_000) : 0,
    fixedRateBps: draft.mode === "fixed" ? bps(draft.ratePercent, "Fixed review rate", 1) : null,
    maximumUnreviewedGap: positiveInteger(draft.maximumUnreviewedGap, "Maximum unreviewed gap", 1, 10_000),
    requiredRiskTiers,
    criticalRiskTiers: currentSelection.criticalRiskTiers,
    minimumConfidenceBps: draft.minimumConfidencePercent.trim()
      ? bps(draft.minimumConfidencePercent, "Confidence threshold", 0)
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
    bountyPerSeatAtomic: compensationMode === "usdc" ? usdcToAtomic(draft.bountyUsdc) : null,
    feedbackBonusEnabled: draft.feedbackBonusEnabled,
    feedbackBonusPoolAtomic: draft.feedbackBonusEnabled ? usdcToAtomic(draft.feedbackBonusUsdc) : null,
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
    throw new Error("Question and answer labels are required.");
  }
  if (
    draft.feedbackBonusEnabled &&
    draft.feedbackBonusAwarderKind === "designated" &&
    !draft.feedbackBonusAwarderAccount.trim()
  ) {
    throw new Error("Enter the authenticated account for the designated Feedback Bonus awarder.");
  }
  let publishingGrant: Record<string, unknown> | null = null;
  if (authority === "ask_automatically") {
    const delegation = configuration.delegation;
    const workflowKeys = delegation?.allowedWorkflowKeys ?? [];
    if (!delegation?.integrationId || workflowKeys.length === 0) {
      throw new Error("Automatic requests need an existing exact publishing grant.");
    }
    publishingGrant = {
      integrationId: delegation.integrationId,
      publishingPolicyId: delegation.publishingPolicy.id,
      publishingPolicyVersion: delegation.publishingPolicy.version,
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
    confirmation: humanReviewConfirmationMessage({
      authority,
      bountyPerSeatAtomic: compensationMode === "usdc" ? requestProfile.bountyPerSeatAtomic : null,
      feedbackBonusPoolAtomic: draft.feedbackBonusEnabled ? requestProfile.feedbackBonusPoolAtomic : null,
      panelSize,
    }),
  };
}

export function AgentHumanReviewEditor({
  workspaceId,
  agentId,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  agentId: string;
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const [view, setView] = useState<OwnerView | null>(null);
  const [groups, setGroups] = useState<PrivateGroup[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const [reviewBody, groupsBody] = await Promise.all([
        readJson(
          await fetch(
            `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/human-review`,
            { cache: "no-store", credentials: "same-origin", signal },
          ),
        ),
        readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/private-groups`, {
            cache: "no-store",
            credentials: "same-origin",
            signal,
          }),
        ),
      ]);
      const nextView = reviewBody as unknown as OwnerView;
      setView(nextView);
      setGroups(((groupsBody.groups ?? []) as PrivateGroup[]).filter(group => group.status === "active"));
      setDraft(draftFromView(nextView));
    },
    [agentId, workspaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(cause => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Unable to load human review.");
    });
    return () => controller.abort();
  }, [load]);

  function update<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft(current => (current ? { ...current, [key]: value } : current));
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
    setError(null);
    try {
      const next = buildMutation(view, draft);
      if (next.confirmation && !window.confirm(next.confirmation)) return;
      setBusy(true);
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/human-review`,
          {
            method: "PUT",
            body: JSON.stringify(next.body),
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      await load();
      setStatus("Human-review configuration saved.");
      onSaved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save human review.");
    } finally {
      setBusy(false);
    }
  }

  if (!draft || !view) {
    return (
      <Card as="section" id="agent-human-review-editor" className="rounded-2xl p-6">
        {onClose ? (
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            ← Back to registry
          </Button>
        ) : null}
        <p className="text-sm text-base-content/60">{error ?? "Loading human-review configuration…"}</p>
      </Card>
    );
  }
  const automaticAvailable = Boolean(
    view.configuration?.delegation?.integrationId && view.configuration.delegation.allowedWorkflowKeys.length > 0,
  );

  return (
    <Card as="section" id="agent-human-review-editor" className="rounded-2xl p-6">
      {onClose ? (
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={busy}>
          ← Back to registry
        </Button>
      ) : null}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Human review</h2>
          <p className="mt-1 text-sm text-base-content/60">Edit the complete configuration for this agent.</p>
        </div>
      </div>
      <form className="mt-6 space-y-5" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            Who writes the question?
            <select
              className="select mt-2 w-full"
              value={draft.questionAuthority}
              onChange={event => changeQuestionAuthority(event.target.value as QuestionAuthority)}
            >
              <option value="owner_fixed">Use one question</option>
              <option value="agent_per_request">Let the agent ask each time</option>
            </select>
          </label>
          {draft.questionAuthority === "owner_fixed" ? (
            <>
              <label className="text-sm sm:col-span-2">
                Review question
                <textarea
                  className="textarea mt-2 w-full"
                  rows={3}
                  value={draft.criterion}
                  onChange={event => update("criterion", event.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Positive label
                <input
                  className="input mt-2 w-full"
                  value={draft.positiveLabel}
                  onChange={event => update("positiveLabel", event.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Negative label
                <input
                  className="input mt-2 w-full"
                  value={draft.negativeLabel}
                  onChange={event => update("negativeLabel", event.target.value)}
                  required
                />
              </label>
            </>
          ) : (
            <p className="text-sm leading-6 text-base-content/60 sm:col-span-2">
              Agent-written questions collect feedback only. They use RateLoop network reviewers and never change
              adaptive review coverage.
            </p>
          )}
          <label className="text-sm">
            Rationale
            <select
              className="select mt-2 w-full"
              value={draft.rationaleMode}
              onChange={event => update("rationaleMode", event.target.value as Draft["rationaleMode"])}
            >
              <option value="off">Off</option>
              <option value="optional">Optional</option>
              <option value="required">Required</option>
            </select>
          </label>
          <ReviewRoutingFields
            className="sm:col-span-2"
            mode={draft.mode}
            authority={draft.authority}
            automaticAvailable={automaticAvailable}
            automaticUnavailableReason={
              draft.compensationMode === "usdc" || draft.feedbackBonusEnabled
                ? "Create an exact owner-approved publishing and funding grant for this workflow first."
                : "Create an exact owner-approved publishing grant for this workflow first."
            }
            requiresFundingPermission={draft.compensationMode === "usdc" || draft.feedbackBonusEnabled}
            adaptiveAvailable={draft.questionAuthority !== "agent_per_request"}
            onModeChange={changeReviewMode}
            onAuthorityChange={authority => update("authority", authority)}
          />
          {draft.mode === "adaptive" || draft.mode === "fixed" ? (
            <label className="text-sm">
              {draft.mode === "adaptive" ? "Minimum review rate (%)" : "Outputs reviewed (%)"}
              <input
                className="input mt-2 w-full"
                type="number"
                min={draft.mode === "adaptive" ? 10 : 0.01}
                max={100}
                step="0.01"
                value={draft.ratePercent}
                onChange={event => update("ratePercent", event.target.value)}
                required
              />
            </label>
          ) : null}
          {draft.mode !== "manual" ? (
            <label className="text-sm">
              Maximum outputs between reviews
              <input
                className="input mt-2 w-full"
                type="number"
                min={1}
                max={10000}
                value={draft.maximumUnreviewedGap}
                onChange={event => update("maximumUnreviewedGap", event.target.value)}
                required
              />
            </label>
          ) : null}
          {draft.mode === "rules" ? (
            <>
              <label className="text-sm">
                Risk levels
                <input
                  className="input mt-2 w-full"
                  value={draft.requiredRiskTiers}
                  onChange={event => update("requiredRiskTiers", event.target.value)}
                />
              </label>
              <label className="text-sm">
                Review below confidence (%)
                <input
                  className="input mt-2 w-full"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.minimumConfidencePercent}
                  onChange={event => update("minimumConfidencePercent", event.target.value)}
                />
              </label>
            </>
          ) : null}
          <label className="text-sm">
            Reviewers
            <select
              className="select mt-2 w-full"
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
              <option value="private_invited" disabled={draft.questionAuthority === "agent_per_request"}>
                Invited reviewers
              </option>
              <option value="public_network">RateLoop network</option>
              <option value="hybrid" disabled={draft.questionAuthority === "agent_per_request"}>
                Invited and RateLoop network
              </option>
            </select>
          </label>
          {draft.audience !== "public_network" ? (
            <label className="text-sm">
              Invited reviewer group
              <select
                className="select mt-2 w-full"
                value={draft.privateGroupId}
                onChange={event => update("privateGroupId", event.target.value)}
                required
              >
                <option value="">Choose a group</option>
                {groups.map(group => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-sm">
            Response window (seconds)
            <input
              className="input mt-2 w-full"
              type="number"
              min={1200}
              max={86400}
              value={draft.responseWindowSeconds}
              onChange={event => update("responseWindowSeconds", event.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            Reviewers per request
            <input
              className="input mt-2 w-full"
              type="number"
              min={draft.audience === "private_invited" ? 1 : 3}
              max={100}
              value={draft.panelSize}
              onChange={event => update("panelSize", event.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            Guaranteed bounty
            <select
              className="select mt-2 w-full"
              value={draft.compensationMode}
              onChange={event => update("compensationMode", event.target.value as Draft["compensationMode"])}
            >
              <option value="unpaid" disabled={draft.audience !== "private_invited"}>
                No bounty
              </option>
              <option value="usdc">Add USDC bounty</option>
            </select>
            {draft.audience !== "private_invited" ? (
              <span className="mt-1 block text-xs text-base-content/50">
                Network assignments currently require a guaranteed bounty.
              </span>
            ) : null}
          </label>
          {draft.compensationMode === "usdc" ? (
            <label className="text-sm">
              USDC per accepted reviewer
              <input
                className="input mt-2 w-full"
                inputMode="decimal"
                value={draft.bountyUsdc}
                onChange={event => update("bountyUsdc", event.target.value)}
                required
              />
            </label>
          ) : null}
          <fieldset className="rounded-xl border border-white/10 p-4 sm:col-span-2">
            <legend className="px-1 text-sm font-medium">Feedback Bonus</legend>
            <p className="text-sm text-base-content/60">
              Optional, separately funded, and awarded only by the saved human.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
              <Button
                type="button"
                size="sm"
                variant={!draft.feedbackBonusEnabled ? "primary" : "secondary"}
                aria-pressed={!draft.feedbackBonusEnabled}
                onClick={() => update("feedbackBonusEnabled", false)}
              >
                No bonus
              </Button>
              <Button
                type="button"
                size="sm"
                variant={draft.feedbackBonusEnabled ? "primary" : "secondary"}
                aria-pressed={draft.feedbackBonusEnabled}
                onClick={() => update("feedbackBonusEnabled", true)}
              >
                Add bonus
              </Button>
            </div>
            {draft.feedbackBonusEnabled ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  Bonus pool (USDC)
                  <input
                    className="input mt-2 w-full"
                    inputMode="decimal"
                    value={draft.feedbackBonusUsdc}
                    onChange={event => update("feedbackBonusUsdc", event.target.value)}
                    required
                  />
                </label>
                <label className="text-sm">
                  Human awarder
                  <select
                    className="select mt-2 w-full"
                    value={draft.feedbackBonusAwarderKind}
                    onChange={event =>
                      update("feedbackBonusAwarderKind", event.target.value as Draft["feedbackBonusAwarderKind"])
                    }
                  >
                    <option value="requester">Requester</option>
                    <option value="designated">Designated authenticated human</option>
                  </select>
                </label>
                {draft.feedbackBonusAwarderKind === "designated" ? (
                  <label className="text-sm sm:col-span-2">
                    Awarder account
                    <input
                      className="input mt-2 w-full"
                      value={draft.feedbackBonusAwarderAccount}
                      onChange={event => update("feedbackBonusAwarderAccount", event.target.value)}
                      maxLength={320}
                      required
                    />
                  </label>
                ) : null}
                <p className="text-xs text-base-content/55 sm:col-span-2">
                  The agent can never select or execute a Feedback Bonus award.
                </p>
              </div>
            ) : null}
          </fieldset>
        </div>
        {error ? (
          <p className="alert alert-error text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <p className="alert alert-success text-sm" role="status">
            {status}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Card>
  );
}
