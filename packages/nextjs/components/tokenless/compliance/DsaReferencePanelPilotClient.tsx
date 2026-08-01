"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { dsaReferencePanelCopy } from "./dsaReferencePanelCopy";
import { ChoiceInput, Field, SelectField, TextareaField } from "~~/components/tokenless/forms/Field";
import { PrivateArtifactPreview } from "~~/components/tokenless/review/PrivateArtifactPreview";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import type { Locale } from "~~/i18n/config";
import type {
  DsaReferencePanelAdjudicationTask,
  DsaReferencePanelAuditorUnit,
  DsaReferencePanelEpoch,
  DsaReferencePanelManagerUnit,
  DsaReferencePanelPilotResponse,
} from "~~/lib/tokenless/dsaReferencePanelPilotTypes";
import { readJson } from "~~/lib/tokenless/http";

const READ_ENDPOINT = "/api/account/compliance/dsa/reference-panel";

function windowLabel(locale: Locale, start: string, end: string) {
  const formatter = new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en", { dateStyle: "medium" });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

function dateLabel(locale: Locale, value: string) {
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en", { dateStyle: "medium" }).format(new Date(value));
}

function dateTimeLabel(locale: Locale, value: string) {
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function postAction<T = unknown>(
  scope: Pick<DsaReferencePanelEpoch, "workspaceId">,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `/api/account/workspaces/${encodeURIComponent(scope.workspaceId)}/compliance/dsa/reference-panel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return readJson<T>(response);
}

async function retryResponseProcessing() {
  const response = await fetch(READ_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reconcile_response_evidence" }),
  });
  return readJson(response);
}

function FixedRules({ locale }: { locale: Locale }) {
  const text = dsaReferencePanelCopy(locale);
  return (
    <Card as="section" className="rounded-2xl p-5 sm:p-6" aria-labelledby="reference-panel-rules">
      <h2 id="reference-panel-rules" className="text-lg font-semibold">
        {text.rulesTitle}
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <p className="rounded-xl border border-base-300/70 px-4 py-3 font-medium">{text.matches}</p>
        <p className="rounded-xl border border-base-300/70 px-4 py-3 font-medium">{text.doesNotMatch}</p>
      </div>
      <p className="mt-4 text-sm leading-6 text-base-content/70">{text.uncertainty}</p>
      <p className="mt-2 text-sm leading-6 text-base-content/70">{text.adjudication}</p>
    </Card>
  );
}

function DefinitionSummary({ epoch, locale }: { epoch: DsaReferencePanelEpoch; locale: Locale }) {
  const text = dsaReferencePanelCopy(locale);
  const definition = epoch.definition;
  if (!definition) return <p className="text-sm leading-6 text-base-content/70">{text.definitionMissing}</p>;
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-base-content/60">{text.version}</dt>
        <dd className="mt-1 font-medium">{definition.version}</dd>
      </div>
      <div>
        <dt className="text-base-content/60">{text.standardId}</dt>
        <dd className="mt-1 font-medium">{definition.standardId}</dd>
      </div>
      <div>
        <dt className="text-base-content/60">{text.standardVersion}</dt>
        <dd className="mt-1 font-medium">{definition.standardVersion}</dd>
      </div>
      <div>
        <dt className="text-base-content/60">{text.standardHash}</dt>
        <dd className="mt-1 break-all font-mono text-xs">{definition.standardHash}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-base-content/60">{text.question}</dt>
        <dd className="mt-1 font-medium">{definition.question}</dd>
      </div>
    </dl>
  );
}

function AuditorDefinitionForm({
  epoch,
  locale,
  onComplete,
}: {
  epoch: Extract<DsaReferencePanelEpoch, { role: "auditor" }>;
  locale: Locale;
  onComplete: () => Promise<void>;
}) {
  const text = dsaReferencePanelCopy(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (epoch.definition) return <DefinitionSummary epoch={epoch} locale={locale} />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    const form = event.currentTarget;
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value;
    try {
      await postAction(epoch, {
        action: "register_definition",
        projectId: epoch.projectId,
        epochId: epoch.epochId,
        version: Number(value("version")),
        question: value("question"),
        standardId: value("standardId"),
        standardVersion: value("standardVersion"),
        standardHash: value("standardHash"),
      });
      setStatus(text.frozen);
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.requestFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <p className="text-sm font-medium text-warning">{text.freezeConsequence}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={text.version} name="version" type="number" min={1} max={1_000_000} defaultValue={1} required />
        <Field label={text.standardId} name="standardId" maxLength={160} required />
        <Field label={text.standardVersion} name="standardVersion" maxLength={160} required />
        <Field
          containerClassName="sm:col-span-2"
          format="sha256Digest"
          label={text.standardHash}
          name="standardHash"
          required
        />
      </div>
      <TextareaField label={text.question} name="question" maxLength={2_000} rows={4} required />
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="text-sm text-success" role="status">
          {status}
        </p>
      ) : null}
      <Button className="w-full sm:w-fit" type="submit" disabled={busy}>
        {busy ? text.freezing : text.freeze}
      </Button>
    </form>
  );
}

function ManagerUnitForm({
  epoch,
  locale,
  onComplete,
}: {
  epoch: Extract<DsaReferencePanelEpoch, { role: "manager" }>;
  locale: Locale;
  onComplete: () => Promise<void>;
}) {
  const text = dsaReferencePanelCopy(locale);
  const candidates = epoch.managerReadiness.candidates.filter(
    candidate => candidate.sourceRecordsReady && !candidate.registered,
  );
  const runs = epoch.managerReadiness.preparedRuns;
  const [unitId, setUnitId] = useState("");
  const [runId, setRunId] = useState("");
  const [cefr, setCefr] = useState<"B2" | "C1" | "C2">("C1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const compatibleRuns = unitId ? runs.filter(candidate => candidate.compatibleUnitIds.includes(unitId)) : [];
  const run = compatibleRuns.find(candidate => candidate.runId === runId);

  if (!epoch.definition) return <p className="text-sm leading-6 text-base-content/70">{text.definitionMissing}</p>;
  if (candidates.length === 0) return <p className="text-sm text-base-content/70">{text.noReadyUnits}</p>;
  if (runs.length === 0) return <p className="text-sm text-base-content/70">{text.noPreparedRuns}</p>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unitId || !run) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await postAction(epoch, {
        action: "register_unit",
        projectId: epoch.projectId,
        epochId: epoch.epochId,
        unitId,
        runId: run.runId,
        caseId: run.caseId,
        requiredCefrLevel: cefr,
        requiredReviewerCount: run.reviewerCount,
      });
      setStatus(text.unitRegistered);
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.requestFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <SelectField
        label={text.selectedUnit}
        value={unitId}
        onChange={event => {
          setUnitId(event.target.value);
          setRunId("");
        }}
        required
      >
        <option value="">{text.chooseUnit}</option>
        {candidates.map(candidate => (
          <option key={candidate.unitId} value={candidate.unitId}>
            {candidate.publicDesignation} · {dateLabel(locale, candidate.decisionAt)}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={text.preparedRun}
        value={runId}
        onChange={event => setRunId(event.target.value)}
        disabled={!unitId || compatibleRuns.length === 0}
        hint={unitId && compatibleRuns.length === 0 ? text.noCompatibleRuns : undefined}
        required
      >
        <option value="">{unitId && compatibleRuns.length === 0 ? text.noCompatibleRuns : text.chooseRun}</option>
        {compatibleRuns.map(candidate => (
          <option key={candidate.runId} value={candidate.runId}>
            {candidate.suiteName} · {candidate.caseTitle} · {candidate.reviewerCount} {text.reviewers.toLowerCase()}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={text.qualification}
        value={cefr}
        onChange={event => setCefr(event.target.value as "B2" | "C1" | "C2")}
      >
        <option value="B2">B2</option>
        <option value="C1">C1</option>
        <option value="C2">C2</option>
      </SelectField>
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="text-sm text-success" role="status">
          {status}
        </p>
      ) : null}
      <Button className="w-full sm:w-fit" type="submit" disabled={busy || !unitId || !run}>
        {busy ? text.registering : text.register}
      </Button>
    </form>
  );
}

function UnitStatusList({
  epoch,
  locale,
  onComplete,
}: {
  epoch: DsaReferencePanelEpoch;
  locale: Locale;
  onComplete: () => Promise<void>;
}) {
  const text = dsaReferencePanelCopy(locale);
  const units = epoch.role === "manager" ? epoch.managerReadiness.registeredUnits : epoch.auditorReadiness.units;
  const [busyUnit, setBusyUnit] = useState<string | null>(null);
  const [adjudicatorByUnit, setAdjudicatorByUnit] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [retryClock, setRetryClock] = useState(() => Date.now());
  const nextCooldownAt = units.reduce<number | null>((earliest, unit) => {
    if (unit.responseMaterializationState !== "cooldown" || !unit.responseMaterializationNextRetryAt) {
      return earliest;
    }
    const dueAt = new Date(unit.responseMaterializationNextRetryAt).getTime();
    if (!Number.isFinite(dueAt) || dueAt <= retryClock) return earliest;
    return earliest === null ? dueAt : Math.min(earliest, dueAt);
  }, null);

  useEffect(() => {
    if (nextCooldownAt === null) return;
    const timeout = window.setTimeout(
      () => setRetryClock(Date.now()),
      Math.min(Math.max(nextCooldownAt - retryClock + 50, 50), 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [nextCooldownAt, retryClock]);

  async function act(
    unit: DsaReferencePanelAuditorUnit | DsaReferencePanelManagerUnit,
    action: "declare_gap" | "freeze_outcome",
    gapReason:
      | "reviewer_nonresponse"
      | "content_self_identification"
      | "adjudicator_nonresponse" = "reviewer_nonresponse",
  ) {
    setBusyUnit(unit.unitId);
    setError(null);
    setStatus(null);
    try {
      await postAction(epoch, {
        action,
        epochId: epoch.epochId,
        unitId: unit.unitId,
        ...(action === "declare_gap" ? { reason: gapReason } : {}),
      });
      setStatus(
        action === "declare_gap"
          ? gapReason === "content_self_identification"
            ? text.selfIdentificationGapDeclared
            : text.gapDeclared
          : text.outcomeFrozen,
      );
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.requestFailed);
    } finally {
      setBusyUnit(null);
    }
  }

  async function assignAdjudicator(unit: DsaReferencePanelAuditorUnit) {
    const adjudicatorPrincipalId = adjudicatorByUnit[unit.unitId]?.trim();
    if (!adjudicatorPrincipalId) return;
    setBusyUnit(unit.unitId);
    setError(null);
    setStatus(null);
    try {
      await postAction(epoch, {
        action: "assign_adjudicator",
        epochId: epoch.epochId,
        unitId: unit.unitId,
        adjudicatorPrincipalId,
      });
      setStatus(text.adjudicatorAssigned);
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.requestFailed);
    } finally {
      setBusyUnit(null);
    }
  }

  async function retryMaterialization(unit: DsaReferencePanelAuditorUnit | DsaReferencePanelManagerUnit) {
    setBusyUnit(unit.unitId);
    setError(null);
    setStatus(null);
    try {
      await retryResponseProcessing();
      setStatus(text.responseProcessingRetried);
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.requestFailed);
    } finally {
      setBusyUnit(null);
    }
  }

  if (units.length === 0) return <p className="text-sm text-base-content/70">{text.noReadyUnits}</p>;
  return (
    <div className="grid gap-3">
      {units.map(unit => (
        <div key={unit.unitId} className="rounded-xl border border-base-300/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">{unit.publicDesignation}</h3>
              <p className="mt-1 text-sm text-base-content/65">
                {text.assigned}: {unit.assignedReviewerCount}/{unit.requiredReviewerCount} · {text.responses}:{" "}
                {unit.responseCount}/{unit.requiredReviewerCount}
              </p>
            </div>
            {unit.terminal ? <span className="badge badge-success badge-outline">{text.terminal}</span> : null}
          </div>
          {!unit.terminal ? (
            <p className="mt-3 text-sm text-base-content/65">
              {epoch.role === "manager" && "needsAdjudication" in unit && unit.needsAdjudication
                ? text.disagreement
                : epoch.role === "auditor" && "needsAdjudicatorAssignment" in unit && unit.needsAdjudicatorAssignment
                  ? text.adjudicatorAssignmentPending
                  : epoch.role === "auditor"
                    ? text.gapPending
                    : text.waiting}
            </p>
          ) : null}
          {unit.responseMaterializationState === "retrying" || unit.responseMaterializationState === "cooldown" ? (
            <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4">
              <p className="text-sm leading-6">
                {unit.responseMaterializationState === "retrying" || unit.responseMaterializationNextRetryAt === null
                  ? text.materializationRetrying
                  : `${text.materializationCooldown} ${dateTimeLabel(
                      locale,
                      unit.responseMaterializationNextRetryAt,
                    )}.`}
              </p>
              <p className="mt-1 text-sm text-base-content/70">
                {text.materializationFailureCount}: {unit.responseMaterializationFailureCount}
              </p>
              {unit.responseMaterializationState === "retrying" ||
              (unit.responseMaterializationNextRetryAt !== null &&
                new Date(unit.responseMaterializationNextRetryAt).getTime() <= retryClock) ? (
                <Button
                  className="mt-3"
                  size="sm"
                  onClick={() => void retryMaterialization(unit)}
                  disabled={busyUnit !== null}
                >
                  {busyUnit === unit.unitId ? text.retryingResponseProcessing : text.retryResponseProcessing}
                </Button>
              ) : null}
            </div>
          ) : null}
          {epoch.role === "auditor" && "needsAdjudicatorAssignment" in unit && unit.needsAdjudicatorAssignment ? (
            <div className="mt-4 grid gap-3 sm:max-w-xl sm:grid-cols-[1fr_auto] sm:items-end">
              <Field
                label={text.adjudicatorPrincipal}
                value={adjudicatorByUnit[unit.unitId] ?? ""}
                onChange={event => setAdjudicatorByUnit(current => ({ ...current, [unit.unitId]: event.target.value }))}
                maxLength={200}
                required
              />
              <Button
                size="sm"
                onClick={() => void assignAdjudicator(unit as DsaReferencePanelAuditorUnit)}
                disabled={busyUnit !== null || !adjudicatorByUnit[unit.unitId]?.trim()}
              >
                {busyUnit === unit.unitId ? text.assigningAdjudicator : text.assignAdjudicator}
              </Button>
            </div>
          ) : null}
          {epoch.role === "manager" && "canFreezeOutcome" in unit && unit.canFreezeOutcome ? (
            <Button
              className="mt-4"
              size="sm"
              onClick={() => void act(unit, "freeze_outcome")}
              disabled={busyUnit !== null}
            >
              {busyUnit === unit.unitId ? text.freezingOutcome : text.freezeOutcome}
            </Button>
          ) : null}
          {epoch.role === "auditor" && "canDeclareGap" in unit && unit.canDeclareGap ? (
            <Button
              className="mt-4"
              size="sm"
              onClick={() => void act(unit, "declare_gap")}
              disabled={busyUnit !== null}
            >
              {busyUnit === unit.unitId ? text.declaringGap : text.declareGap}
            </Button>
          ) : null}
          {epoch.role === "auditor" && "canDeclareAdjudicatorGap" in unit && unit.canDeclareAdjudicatorGap ? (
            <Button
              className="mt-4"
              size="sm"
              onClick={() => void act(unit, "declare_gap", "adjudicator_nonresponse")}
              disabled={busyUnit !== null}
            >
              {busyUnit === unit.unitId ? text.declaringGap : text.declareAdjudicatorGap}
            </Button>
          ) : null}
          {epoch.role === "auditor" &&
          "canDeclareContentSelfIdentificationGap" in unit &&
          unit.canDeclareContentSelfIdentificationGap ? (
            <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4">
              <p className="text-sm leading-6">
                {text.selfIdentificationReported} {unit.contentSelfIdentificationReportCount}
              </p>
              <Button
                className="mt-3"
                size="sm"
                onClick={() => void act(unit, "declare_gap", "content_self_identification")}
                disabled={busyUnit !== null}
              >
                {busyUnit === unit.unitId ? text.declaringGap : text.confirmSelfIdentificationGap}
              </Button>
            </div>
          ) : null}
        </div>
      ))}
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="text-sm text-success" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

function ManagerLabelSetAction({
  epoch,
  locale,
  onComplete,
}: {
  epoch: Extract<DsaReferencePanelEpoch, { role: "manager" }>;
  locale: Locale;
  onComplete: () => Promise<void>;
}) {
  const text = dsaReferencePanelCopy(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function freeze() {
    setBusy(true);
    setError(null);
    try {
      await postAction(epoch, { action: "freeze_label_set", epochId: epoch.epochId });
      setStatus(text.labelSetFrozen);
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.requestFailed);
    } finally {
      setBusy(false);
    }
  }

  if (epoch.managerReadiness.labelSetFrozen) return <p className="text-sm text-success">{text.labelSetFrozen}</p>;
  return (
    <div>
      {!epoch.managerReadiness.canFreezeLabelSet ? (
        <p className="text-sm text-base-content/70">{text.labelSetPending}</p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="mt-3 text-sm text-success" role="status">
          {status}
        </p>
      ) : null}
      {epoch.managerReadiness.canFreezeLabelSet ? (
        <Button className="mt-4" onClick={() => void freeze()} disabled={busy}>
          {busy ? text.freezingLabelSet : text.freezeLabelSet}
        </Button>
      ) : null}
    </div>
  );
}

type AdjudicationLease = { artifactId: string; leaseId: string; expiresAt: string };

function AdjudicationTaskCard({
  task,
  locale,
  onComplete,
}: {
  task: DsaReferencePanelAdjudicationTask;
  locale: Locale;
  onComplete: () => Promise<void>;
}) {
  const text = dsaReferencePanelCopy(locale);
  const [lease, setLease] = useState<AdjudicationLease | null>(null);
  const [artifactReady, setArtifactReady] = useState(false);
  const [referenceLabel, setReferenceLabel] = useState<"pass" | "fail" | "uncertain">("uncertain");
  const [noConflict, setNoConflict] = useState(false);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState<"adjudicate" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openArtifact = useCallback(async () => {
    setBusy("open");
    setArtifactReady(false);
    setError(null);
    try {
      const nextLease = await postAction<AdjudicationLease>(task, {
        action: "open_adjudication_artifact",
        epochId: task.epochId,
        unitId: task.unitId,
      });
      setLease(nextLease);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.requestFailed);
    } finally {
      setBusy(null);
    }
  }, [task, text.requestFailed]);

  async function adjudicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!artifactReady || !noConflict || rationale.trim().length < 20) return;
    setBusy("adjudicate");
    setError(null);
    try {
      await postAction(task, {
        action: "adjudicate",
        epochId: task.epochId,
        unitId: task.unitId,
        referenceLabel,
        rationale,
        conflictDeclaration: { hasConflict: false, relationships: [] },
      });
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.requestFailed);
    } finally {
      setBusy(null);
    }
  }

  const artifactUrl = lease
    ? `/api/account/workspaces/${encodeURIComponent(
        task.workspaceId,
      )}/compliance/dsa/reference-panel/adjudications/${encodeURIComponent(task.unitId)}/artifact?epochId=${encodeURIComponent(
        task.epochId,
      )}&leaseId=${encodeURIComponent(lease.leaseId)}`
    : null;
  const canAdjudicate = artifactReady && noConflict && rationale.trim().length >= 20;

  return (
    <Card as="article" className="rounded-2xl p-5 sm:p-6">
      <h3 className="text-lg font-semibold">{text.adjudicationTask}</h3>
      <p className="mt-3 font-medium">{task.question}</p>
      {!artifactUrl ? (
        <div className="mt-5">
          <p className="text-sm text-base-content/70">{text.artifactRequired}</p>
          <Button className="mt-4" onClick={() => void openArtifact()} disabled={busy !== null}>
            {busy === "open" ? text.openingArtifact : text.openArtifact}
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <PrivateArtifactPreview
            artifactUrl={artifactUrl}
            label={text.artifact}
            onAvailabilityChange={availability => setArtifactReady(availability === "ready")}
            onRefreshAccess={openArtifact}
          />
          <form className="mt-5 grid gap-5" onSubmit={adjudicate}>
            <SelectField
              label={text.adjudicationOutcome}
              value={referenceLabel}
              onChange={event => setReferenceLabel(event.target.value as "pass" | "fail" | "uncertain")}
            >
              <option value="pass">{text.pass}</option>
              <option value="fail">{text.fail}</option>
              <option value="uncertain">{text.uncertain}</option>
            </SelectField>
            <TextareaField
              label={text.rationale}
              hint={text.rationaleHint}
              minLength={20}
              maxLength={4_000}
              rows={4}
              value={rationale}
              onChange={event => setRationale(event.target.value)}
              required
            />
            <label className="flex items-start gap-3 text-sm leading-6">
              <ChoiceInput
                type="checkbox"
                checked={noConflict}
                onChange={event => setNoConflict(event.target.checked)}
                required
              />
              <span>{text.noConflict}</span>
            </label>
            {!artifactReady ? <p className="text-sm text-base-content/70">{text.artifactRequired}</p> : null}
            {error ? (
              <p className="text-sm text-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full sm:w-fit" disabled={!canAdjudicate || busy !== null}>
              {busy === "adjudicate" ? text.adjudicating : text.adjudicate}
            </Button>
          </form>
        </div>
      )}
      {error && !artifactUrl ? (
        <p className="mt-4 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

export function DsaReferencePanelPilotClient({ locale }: { locale: Locale }) {
  const text = dsaReferencePanelCopy(locale);
  const [epochs, setEpochs] = useState<DsaReferencePanelEpoch[]>([]);
  const [adjudications, setAdjudications] = useState<DsaReferencePanelAdjudicationTask[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(READ_ENDPOINT, { cache: "no-store" });
      const body = await readJson<DsaReferencePanelPilotResponse>(response, { fallbackMessage: text.loadError });
      setEpochs(body.epochs);
      setAdjudications(body.adjudications);
      setSelectedKey(current => {
        if (body.epochs.some(epoch => `${epoch.workspaceId}:${epoch.epochId}` === current)) return current;
        const first = body.epochs[0];
        return first ? `${first.workspaceId}:${first.epochId}` : "";
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.loadError);
    } finally {
      setLoading(false);
    }
  }, [text.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const epoch = useMemo(
    () => epochs.find(candidate => `${candidate.workspaceId}:${candidate.epochId}` === selectedKey) ?? epochs[0],
    [epochs, selectedKey],
  );

  if (loading) return <p role="status">{text.loading}</p>;
  if (error) {
    return (
      <p className="text-error" role="alert">
        {error}
      </p>
    );
  }
  if (!epoch && adjudications.length === 0) return <p>{text.empty}</p>;

  return (
    <div className="grid gap-5">
      {epoch ? (
        <>
          {epochs.length > 1 ? (
            <SelectField
              label={text.project}
              value={selectedKey}
              onChange={event => setSelectedKey(event.target.value)}
            >
              {epochs.map(candidate => {
                const key = `${candidate.workspaceId}:${candidate.epochId}`;
                return (
                  <option key={key} value={key}>
                    {candidate.projectName} ·{" "}
                    {windowLabel(locale, candidate.reportingWindowStart, candidate.reportingWindowEnd)}
                  </option>
                );
              })}
            </SelectField>
          ) : null}
          <Card className="rounded-2xl p-5 sm:p-6">
            <p className="text-sm text-base-content/60">{epoch.workspaceName}</p>
            <h2 className="mt-1 text-xl font-semibold">{epoch.projectName}</h2>
            <p className="mt-2 text-sm text-base-content/70">
              {text.reportingWindow}: {windowLabel(locale, epoch.reportingWindowStart, epoch.reportingWindowEnd)}
            </p>
          </Card>
          <FixedRules locale={locale} />
          <Card as="section" className="rounded-2xl p-5 sm:p-6">
            <h2 className="text-lg font-semibold">{text.definitionTitle}</h2>
            <div className="mt-5">
              {epoch.role === "auditor" ? (
                <AuditorDefinitionForm key={selectedKey} epoch={epoch} locale={locale} onComplete={load} />
              ) : (
                <DefinitionSummary epoch={epoch} locale={locale} />
              )}
            </div>
          </Card>

          {epoch.role === "manager" ? (
            <>
              <Card as="section" className="rounded-2xl p-5 sm:p-6">
                <h2 className="text-lg font-semibold">{text.sourceReadiness}</h2>
                <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl border border-base-300/70 p-3">
                    <dt className="text-xs text-base-content/60">{text.selected}</dt>
                    <dd className="mt-1 text-xl font-semibold">{epoch.managerReadiness.selectedUnitCount}</dd>
                  </div>
                  <div className="rounded-xl border border-base-300/70 p-3">
                    <dt className="text-xs text-base-content/60">{text.ready}</dt>
                    <dd className="mt-1 text-xl font-semibold">{epoch.managerReadiness.sourceReadyUnitCount}</dd>
                  </div>
                  <div className="rounded-xl border border-base-300/70 p-3">
                    <dt className="text-xs text-base-content/60">{text.registered}</dt>
                    <dd className="mt-1 text-xl font-semibold">{epoch.managerReadiness.registeredUnitCount}</dd>
                  </div>
                </dl>
              </Card>
              <Card as="section" className="rounded-2xl p-5 sm:p-6">
                <h2 className="text-lg font-semibold">{text.registerTitle}</h2>
                <div className="mt-5">
                  <ManagerUnitForm key={selectedKey} epoch={epoch} locale={locale} onComplete={load} />
                </div>
              </Card>
            </>
          ) : null}

          <Card as="section" className="rounded-2xl p-5 sm:p-6">
            <h2 className="text-lg font-semibold">{text.registeredStatus}</h2>
            <div className="mt-5">
              <UnitStatusList key={`${selectedKey}:status`} epoch={epoch} locale={locale} onComplete={load} />
            </div>
          </Card>

          {epoch.role === "manager" ? (
            <Card as="section" className="rounded-2xl p-5 sm:p-6">
              <h2 className="text-lg font-semibold">{text.labelSet}</h2>
              <div className="mt-5">
                <ManagerLabelSetAction
                  key={`${selectedKey}:label-set`}
                  epoch={epoch}
                  locale={locale}
                  onComplete={load}
                />
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {adjudications.length > 0 ? (
        <section className="grid gap-4" aria-labelledby="reference-panel-adjudications">
          <h2 id="reference-panel-adjudications" className="text-xl font-semibold">
            {text.adjudicationTitle}
          </h2>
          {adjudications.map(task => (
            <AdjudicationTaskCard
              key={`${task.workspaceId}:${task.epochId}:${task.unitId}`}
              task={task}
              locale={locale}
              onComplete={load}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
