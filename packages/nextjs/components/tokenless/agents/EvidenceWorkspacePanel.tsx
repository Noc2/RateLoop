"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentLocale, useAgentTranslations } from "./AgentsLocaleProvider";
import { GrcEvidenceDelivery } from "./GrcEvidenceDelivery";
import { MetricsEvidenceAccess } from "./MetricsEvidenceAccess";
import { SiemEvidenceDelivery } from "./SiemEvidenceDelivery";
import { WormEvidenceDelivery } from "./WormEvidenceDelivery";
import { agentTabHref } from "./agentWorkspaceState";
import { updateEvaluationUrlSearch } from "./evaluationUrlState";
import { evidenceGateLabel, evidenceReviewerSourceLabel, evidenceTriggerLabel } from "./evidencePacketPresentation";
import {
  DEFAULT_EVIDENCE_URL_STATE,
  type EvidenceDateFilter,
  type EvidenceOutcomeFilter,
  type EvidenceUrlState,
  evidenceUrlHref,
  parseEvidenceUrlState,
} from "./evidenceUrlState";
import { Field, SelectField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { WorkspacePublicContentLink } from "~~/components/tokenless/navigation/WorkspacePublicContentLink";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Card } from "~~/components/tokenless/ui/Card";
import { useConfirmDialog } from "~~/components/tokenless/ui/useConfirmDialog";
import { stripLocalePrefix } from "~~/i18n/config";
import { Link } from "~~/i18n/navigation";
import type { EvaluationDashboard } from "~~/lib/tokenless/evaluationDashboard";
import { readJson } from "~~/lib/tokenless/http";
import { WorkspaceRequestScope } from "~~/lib/tokenless/workspaceRequestScope";

type EvidencePacket = {
  packetDigest: string;
  payload: {
    packetId: string;
    runId: string;
    generatedAt: string;
    aggregation: {
      suite: { outcome: "pass" | "fail" | "insufficient" };
      judgmentCoverage?: {
        caseCount: number;
        targetExpectedJudgmentCount: number;
        assignedExpectedJudgmentCount: number;
        submittedJudgmentCount: number;
        validJudgmentCount: number;
        invalidJudgmentCount: number;
        pendingJudgmentCount: number;
        missingTargetJudgmentCount: number;
        missingAssignedJudgmentCount: number;
      };
      reviewerCoverage?: {
        sourceSubpanels?: Array<{
          source: string;
          targetReviewerCount: number;
          assignedReviewerCount: number;
          paidReviewerCount: number;
          respondingReviewerCount: number;
          completeJudgmentSetReviewerCount: number;
        }>;
      };
    };
    reviewContext?: {
      selectionTrigger?: { kind?: string };
      gate?: { type?: string };
      reviewerQualifications?: {
        minimumAggregationSize: number;
        categories: Array<{ key: string; reviewerCount?: number; suppressed: boolean }>;
        unqualified: { reviewerCount?: number; suppressed: boolean };
      };
      period?: {
        responseSubmissionLatencyFromPeriodStartMs?: {
          count: number;
          minimum: number | null;
          median: number | null;
          p95: number | null;
          maximum: number | null;
        };
      };
    };
    settlement?: { mode: string; statement: string; links: string[] };
  };
  signing: { algorithm: "Ed25519"; keyId: string; publicKey: string };
};

type PacketRow = {
  packet: EvidencePacket;
  projectId: string;
  projectName: string;
  suiteId: string;
  suiteName: string;
  suiteVersion: number;
  shares: EvidenceShareGrant[];
};
type EvidenceShareGrant = {
  grantId: string;
  packetId: string;
  runId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  status: "active" | "expired" | "revoked";
};
type Attestation = {
  jobId: string;
  artifactKind: string;
  artifactDigest: string;
  state: string;
  signerKeyId: string | null;
  rekor: { entryUuid: string; logIndex: string } | null;
  rfc3161TimestampPresent: boolean;
  boundaryAt: string;
  lastError: string | null;
};
type RetentionPolicy = {
  version: number;
  evidenceRetentionMonths: number;
  auditRetentionMonths: number;
  minimumRetentionMonths: number;
  effectiveAt: string;
  basis: { reasons: string[] };
};
type TrustedKey = {
  keyId: string;
  status: "current" | "retired";
  publicKeyJwk: { kty: "OKP"; crv: "Ed25519"; x: string };
  publicKeySpki: string;
  uses: string[];
  firstPacketAt: string | null;
  lastPacketAt: string | null;
  packetCount: number;
};
type TrustedKeyHistory = { keys: TrustedKey[]; untrustedPacketKeyCount: number };
type AssuranceProjectOption = { projectId: string; name: string };
type ProjectAuditor = {
  assignmentId: string;
  subjectReference: string;
  expiresAt: string | null;
  createdAt: string;
};
type EvidenceDeliveryKind = "worm" | "siem" | "grc" | "metrics";
type EvidenceUrlSnapshot = {
  pathname: string;
  search: string;
  hash: string;
  state: EvidenceUrlState;
};
type Translate = (key: string, values?: Record<string, number | string>) => string;

function outcomeStyle(outcome: string) {
  if (outcome === "pass") return "bg-success/10 text-success";
  if (outcome === "fail") return "bg-error/10 text-error";
  return "bg-warning/10 text-warning";
}

function anchorLabel(attestation: Attestation | undefined, canViewAttestations: boolean, copy: Translate) {
  if (!canViewAttestations) return copy("anchorRestricted");
  if (!attestation) return copy("anchorNotQueued");
  if (attestation.state === "completed") return copy("anchorRecorded");
  if (attestation.state === "dead") return copy("anchorFailed");
  return copy("anchorPending");
}

function downloadName(prefix: string, value: string) {
  return `${prefix}-${value.replace(/[^A-Za-z0-9._-]/gu, "-")}.json`;
}

function safeExternalEvidenceLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function responseLatency(milliseconds: number | null | undefined, copy: Translate, locale: string) {
  if (milliseconds === null || milliseconds === undefined) return copy("unavailable");
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) {
    return copy("seconds", {
      value: (milliseconds / 1_000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    });
  }
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return seconds ? copy("minutesSeconds", { minutes, seconds }) : copy("minutes", { count: minutes });
}

function packetIdentity({ packet }: PacketRow) {
  return `${packet.payload.runId}\u0000${packet.payload.packetId}`;
}

function packetLineage({ projectId, suiteId }: PacketRow) {
  return `${projectId}\u0000${suiteId}`;
}

function comparePacketRecency(left: PacketRow, right: PacketRow) {
  const generatedAt = Date.parse(left.packet.payload.generatedAt) - Date.parse(right.packet.payload.generatedAt);
  if (generatedAt !== 0) return generatedAt;
  if (left.suiteVersion !== right.suiteVersion) return left.suiteVersion - right.suiteVersion;
  return packetIdentity(left).localeCompare(packetIdentity(right));
}

function newerPacketsByIdentity(rows: PacketRow[]) {
  const latestByLineage = new Map<string, PacketRow>();
  for (const row of rows) {
    const lineage = packetLineage(row);
    const current = latestByLineage.get(lineage);
    if (!current || comparePacketRecency(row, current) > 0) latestByLineage.set(lineage, row);
  }
  return new Map(
    rows.flatMap(row => {
      const latest = latestByLineage.get(packetLineage(row));
      return latest && latest !== row ? [[packetIdentity(row), latest] as const] : [];
    }),
  );
}

function ProjectAuditorAccess({ workspaceId }: { workspaceId: string }) {
  const copy = useAgentTranslations("evidencePanels.workspace");
  const errors = useAgentTranslations("errors");
  const format = useAgentFormatter();
  const [projects, setProjects] = useState<AssuranceProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [auditors, setAuditors] = useState<ProjectAuditor[]>([]);
  const [subjectReference, setSubjectReference] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/projects`;

  const loadAuditors = useCallback(
    async (selectedProjectId: string) => {
      if (!selectedProjectId) {
        setAuditors([]);
        return;
      }
      const body = await readJson<{ auditors: ProjectAuditor[] }>(
        await fetch(`${base}/${encodeURIComponent(selectedProjectId)}/auditors`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
      );
      setAuditors(body.auditors);
    },
    [base],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const body = await readJson<{ projects: AssuranceProjectOption[] }>(
          await fetch(base, { cache: "no-store", credentials: "same-origin" }),
        );
        if (!active) return;
        setProjects(body.projects);
        const firstProjectId = body.projects[0]?.projectId ?? "";
        setProjectId(firstProjectId);
        await loadAuditors(firstProjectId);
      } catch {
        if (active) setError(errors("loadAuditors"));
      }
    })();
    return () => {
      active = false;
    };
  }, [base, errors, loadAuditors]);

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch(`${base}/${encodeURIComponent(projectId)}/auditors`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subjectReference,
            expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          }),
        }),
      );
      setSubjectReference("");
      setExpiresAt("");
      await loadAuditors(projectId);
    } catch {
      setError(errors("grantAuditor"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(assignmentId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${base}/${encodeURIComponent(projectId)}/auditors/${encodeURIComponent(assignmentId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!response.ok) await readJson(response);
      await loadAuditors(projectId);
    } catch {
      setError(errors("revokeAuditor"));
    } finally {
      setBusy(false);
    }
  }

  if (projects.length === 0 && !error) return null;
  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="project-auditors-heading">
      <h2 id="project-auditors-heading" className="text-xl font-semibold">
        <AgentText id="translated130" />
      </h2>
      <form className="mt-5 grid gap-4 md:grid-cols-3" onSubmit={grant}>
        <SelectField
          label={<AgentText id="attribute013" />}
          value={projectId}
          onChange={event => {
            const nextProjectId = event.target.value;
            setProjectId(nextProjectId);
            setError(null);
            void loadAuditors(nextProjectId).catch(() => setError(errors("loadAuditors")));
          }}
          required
        >
          {projects.map(project => (
            <option key={project.projectId} value={project.projectId}>
              {project.name}
            </option>
          ))}
        </SelectField>
        <Field
          label={<AgentText id="attribute014" />}
          value={subjectReference}
          onChange={event => setSubjectReference(event.target.value)}
          maxLength={255}
          required
        />
        <Field
          label={<AgentText id="attribute015" />}
          type="datetime-local"
          value={expiresAt}
          onChange={event => setExpiresAt(event.target.value)}
          min={new Date().toISOString().slice(0, 16)}
        />
        <button type="submit" className="btn btn-sm rateloop-gradient-action w-fit" disabled={busy || !projectId}>
          <AgentText id="translated131" />
        </button>
      </form>
      {error ? (
        <p className="mt-4 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {auditors.length > 0 ? (
        <ul className="mt-5 divide-y divide-base-content/10">
          {auditors.map(auditor => (
            <li key={auditor.assignmentId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="break-all font-mono text-sm">{auditor.subjectReference}</p>
                <p className="mt-1 text-xs text-base-content/55">
                  {auditor.expiresAt ? (
                    copy("expiresAt", {
                      date: format.dateTime(new Date(auditor.expiresAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    })
                  ) : (
                    <AgentText id="dynamic024" />
                  )}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm border-error/20 bg-error/[0.06] text-error"
                disabled={busy}
                onClick={() => void revoke(auditor.assignmentId)}
              >
                <AgentText id="translated132" />
              </button>
            </li>
          ))}
        </ul>
      ) : projectId ? (
        <p className="mt-5 text-sm text-base-content/55">
          <AgentText id="noAuditors" />
        </p>
      ) : null}
    </Card>
  );
}

function PacketCoverage({ packet }: { packet: EvidencePacket }) {
  const copy = useAgentTranslations("evidencePanels.workspace");
  const locale = useAgentLocale();
  const coverage = packet.payload.aggregation.judgmentCoverage;
  const latency = packet.payload.reviewContext?.period?.responseSubmissionLatencyFromPeriodStartMs;
  if (!coverage && !latency) return null;
  return (
    <details className="mt-4 rounded-xl border border-base-content/10 p-4">
      <summary className="cursor-pointer text-sm font-semibold">
        <AgentText id="coverageTiming" />
      </summary>
      {coverage ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          {[
            [copy("cases"), coverage.caseCount],
            [copy("targetExpected"), coverage.targetExpectedJudgmentCount],
            [copy("assignedExpected"), coverage.assignedExpectedJudgmentCount],
            [copy("submitted"), coverage.submittedJudgmentCount],
            [copy("valid"), coverage.validJudgmentCount],
            [copy("invalid"), coverage.invalidJudgmentCount],
            [copy("pending"), coverage.pendingJudgmentCount],
            [copy("missingTarget"), coverage.missingTargetJudgmentCount],
            [copy("missingAssignments"), coverage.missingAssignedJudgmentCount],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-base-content/55">{label}</dt>
              <dd className="mt-1 font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {latency ? (
        <dl className="mt-4 grid gap-3 border-t border-base-content/10 pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-base-content/55">
              <AgentText id="responseCount" />
            </dt>
            <dd className="mt-1 font-mono">{latency.count}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">
              <AgentText id="medianResponse" />
            </dt>
            <dd className="mt-1">{responseLatency(latency.median, copy, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">
              <AgentText id="percentile95" />
            </dt>
            <dd className="mt-1">{responseLatency(latency.p95, copy, locale)}</dd>
          </div>
        </dl>
      ) : null}
    </details>
  );
}

function resultHrefForRun(workspaceId: string, runId: string, currentSearch: string) {
  const preserved = new URLSearchParams(currentSearch);
  for (const key of ["q", "outcome", "date", "run", "packet"]) preserved.delete(key);
  const route = new URL(agentTabHref("evaluations", workspaceId, preserved), "https://rateloop.local");
  route.search = updateEvaluationUrlSearch(route.search, {
    query: "",
    agentId: "",
    workflowKey: "",
    status: "all",
    date: "all",
    runId,
  });
  return `${route.pathname}${route.search}`;
}

function evidenceLinkHref(snapshot: EvidenceUrlSnapshot, patch: Partial<EvidenceUrlState>) {
  return evidenceUrlHref({
    pathname: stripLocalePrefix(snapshot.pathname),
    search: snapshot.search,
    hash: snapshot.hash,
    patch,
  });
}

async function downloadJson(url: string, filename: string) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) await readJson(response);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

function ExportLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="btn btn-sm border-base-content/10 bg-base-content/[0.06] hover:bg-base-content/[0.1]"
      href={href}
      download
    >
      {children}
    </a>
  );
}

function trustedKeyFilename(keyId: string) {
  return `rateloop-evidence-${keyId.replace(/[^A-Za-z0-9._-]/gu, "-")}.spki.txt`;
}

function VerificationInstructions({
  packet,
  attestation,
  trustedKey,
  trustedKeyDownloadUrl,
}: {
  packet: EvidencePacket;
  attestation: Attestation | null;
  trustedKey: TrustedKey | null;
  trustedKeyDownloadUrl: string | null;
}) {
  const copy = useAgentTranslations("evidencePanels.workspace");
  const packetCommand = trustedKey
    ? `yarn workspace @rateloop/nextjs evidence:verify packet.json --public-key './${trustedKeyFilename(trustedKey.keyId)}' --key-id '${trustedKey.keyId}'`
    : copy("untrustedKeyCommand");
  const attestationCommand =
    attestation?.state === "completed" && attestation.signerKeyId
      ? `yarn workspace @rateloop/nextjs attestation:verify attestation-witness.json \\
  --signer-public-key ./trusted-attestation-signer.pem \\
  --signer-key-id '${attestation.signerKeyId}' \\
  --rekor-public-key ./trusted-rekor-public-key.pem \\
  --tsa-ca ./trusted-tsa-ca.pem \\
  --tsa-chain ./trusted-tsa-chain.pem`
      : copy("attestationRequiredCommand");
  const instructions = `${packetCommand}\nyarn workspace @rateloop/nextjs audit:verify audit-export.json\n${attestationCommand}`;
  const [copied, setCopied] = useState(false);
  return (
    <Card as="details" className="rounded-2xl p-6">
      <summary className="cursor-pointer text-sm font-semibold">
        <AgentText id="verifyExport" />
      </summary>
      <div className="mt-4 space-y-4">
        <p className="max-w-3xl text-sm leading-6 text-base-content/55">
          <AgentText id="translated133" />{" "}
          <WorkspacePublicContentLink className="link" href="/docs/evidence#verify">
            <AgentText id="translated134" />
          </WorkspacePublicContentLink>
          .
        </p>
        <div className="flex flex-wrap gap-2">
          {trustedKey && trustedKeyDownloadUrl ? (
            <a
              className="btn btn-sm border-base-content/10 bg-base-content/[0.06] hover:bg-base-content/[0.1]"
              href={trustedKeyDownloadUrl}
              download={trustedKeyFilename(trustedKey.keyId)}
            >
              <AgentText id="translated135" />
            </a>
          ) : (
            <p className="w-full text-sm text-error" role="alert">
              <AgentText id="translated136" /> {packet.signing.keyId} <AgentText id="translated137" />
            </p>
          )}
          {attestation?.state === "completed" ? (
            <a
              className="btn btn-sm border-base-content/10 bg-base-content/[0.06] hover:bg-base-content/[0.1]"
              href={`/api/public/assurance/attestations/${encodeURIComponent(attestation.jobId)}`}
              download={`rateloop-attestation-${attestation.jobId}.json`}
            >
              <AgentText id="translated138" />
            </a>
          ) : null}
        </div>
        <pre className="overflow-x-auto rounded-xl border border-base-content/10 bg-base-content/[0.045] p-4 text-xs leading-6 text-base-content/75">
          <code>{instructions}</code>
        </pre>
        <button
          type="button"
          className="btn btn-sm border-base-content/10 bg-base-content/[0.06]"
          onClick={() => {
            void navigator.clipboard.writeText(instructions).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2_000);
            });
          }}
        >
          {copied ? <AgentText id="dynamic018" /> : <AgentText id="dynamic019" />}
        </button>
      </div>
    </Card>
  );
}

function RetentionEditor({
  policy,
  workspaceId,
  onSaved,
}: {
  policy: RetentionPolicy;
  workspaceId: string;
  onSaved: (policy: RetentionPolicy) => void;
}) {
  const copy = useAgentTranslations("evidencePanels.workspace");
  const errors = useAgentTranslations("errors");
  const [evidenceMonths, setEvidenceMonths] = useState(String(policy.evidenceRetentionMonths));
  const [auditMonths, setAuditMonths] = useState(String(policy.auditRetentionMonths));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();
  useEffect(() => {
    setEvidenceMonths(String(policy.evidenceRetentionMonths));
    setAuditMonths(String(policy.auditRetentionMonths));
  }, [policy]);
  return (
    <form
      className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={event => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        clear();
        void fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/retention`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evidenceRetentionMonths: Number(evidenceMonths),
            auditRetentionMonths: Number(auditMonths),
          }),
        })
          .then(response => readJson<RetentionPolicy>(response))
          .then(next => {
            onSaved(next);
            setMessage(copy("policySaved", { version: next.version }));
          })
          .catch(() => capture(errors("saveRetention"), errors("saveRetention")))
          .finally(() => setBusy(false));
      }}
    >
      <Field
        label={<AgentText id="attribute016" />}
        className="border-base-content/10 bg-[var(--rateloop-field)]"
        type="number"
        min={policy.minimumRetentionMonths}
        max={120}
        value={evidenceMonths}
        error={fieldErrors.evidenceRetentionMonths}
        onChange={event => {
          clear("evidenceRetentionMonths");
          setEvidenceMonths(event.target.value);
        }}
        required
      />
      <Field
        label={<AgentText id="attribute017" />}
        className="border-base-content/10 bg-[var(--rateloop-field)]"
        type="number"
        min={policy.minimumRetentionMonths}
        max={120}
        value={auditMonths}
        error={fieldErrors.auditRetentionMonths}
        onChange={event => {
          clear("auditRetentionMonths");
          setAuditMonths(event.target.value);
        }}
        required
      />
      <button type="submit" className="btn btn-sm rateloop-gradient-action" disabled={busy}>
        {busy ? <AgentText id="dynamic033" /> : <AgentText id="dynamic032" />}
      </button>
      {message ? (
        <p className="text-xs text-base-content/60 sm:col-span-3" role="status">
          {message}
        </p>
      ) : null}
      {formError ? (
        <p className="text-xs text-error sm:col-span-3" role="alert">
          {formError}
        </p>
      ) : null}
    </form>
  );
}

export function EvidenceWorkspacePanel({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const copy = useAgentTranslations("evidencePanels.workspace");
  const evaluationCopy = useAgentTranslations("evidencePanels.evaluation");
  const format = useAgentFormatter();
  const locale = useAgentLocale();
  const ui = useAgentTranslations("ui");
  const errors = useAgentTranslations("errors");
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [packets, setPackets] = useState<PacketRow[]>([]);
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [retention, setRetention] = useState<RetentionPolicy | null>(null);
  const [keys, setKeys] = useState<TrustedKey[]>([]);
  const [untrustedPacketKeyCount, setUntrustedPacketKeyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPacket, setBusyPacket] = useState<string | null>(null);
  const [busyShare, setBusyShare] = useState<string | null>(null);
  const [shareUrls, setShareUrls] = useState<Record<string, string>>({});
  const [copiedShare, setCopiedShare] = useState<string | null>(null);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [workspaceRequests] = useState(() => new WorkspaceRequestScope());
  const [urlReady, setUrlReady] = useState(false);
  const [urlSnapshot, setUrlSnapshot] = useState<EvidenceUrlSnapshot>(() => {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspace", workspaceId);
    return {
      pathname: "/agents/results",
      search: params.toString(),
      hash: "",
      state: DEFAULT_EVIDENCE_URL_STATE,
    };
  });
  const [deliveryKind, setDeliveryKind] = useState<EvidenceDeliveryKind | null>(null);
  const { date: dateFilter, outcome: outcomeFilter, query: packetQuery } = urlSnapshot.state;
  const requestedRunId = urlSnapshot.state.runId;

  const updateUrlState = useCallback((patch: Partial<EvidenceUrlState>, mode: "push" | "replace" = "replace") => {
    const href = evidenceUrlHref({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      patch,
    });
    if (mode === "push") window.history.pushState(window.history.state, "", href);
    else window.history.replaceState(window.history.state, "", href);
    setUrlSnapshot({
      pathname: window.location.pathname,
      search: window.location.search.slice(1),
      hash: window.location.hash,
      state: parseEvidenceUrlState(window.location.search),
    });
  }, []);

  useEffect(() => {
    const restoreUrlState = () => {
      setUrlSnapshot({
        pathname: window.location.pathname,
        search: window.location.search.slice(1),
        hash: window.location.hash,
        state: parseEvidenceUrlState(window.location.search),
      });
      setUrlReady(true);
    };
    restoreUrlState();
    window.addEventListener("popstate", restoreUrlState);
    return () => window.removeEventListener("popstate", restoreUrlState);
  }, []);

  useEffect(() => {
    workspaceRequests.selectWorkspace(workspaceId);
    return () => {
      if (workspaceRequests.isWorkspaceCurrent(workspaceId)) workspaceRequests.selectWorkspace("");
    };
  }, [workspaceId, workspaceRequests]);

  const load = useCallback(async () => {
    const request = workspaceRequests.begin(workspaceId, "evidence:load");
    setLoading(true);
    setError(null);
    try {
      const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}`;
      const requestedRun = requestedRunId ? `?run=${encodeURIComponent(requestedRunId)}` : "";
      const dashboard = await readJson<EvaluationDashboard>(
        await fetch(`${base}/evaluations${requestedRun}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: request.signal,
        }),
      );
      const packetRows = await Promise.all(
        dashboard.runs
          .filter(run => run.evidencePacketAvailable)
          .map(async run => {
            const runBase = `${base}/assurance/runs/${encodeURIComponent(run.runId)}/evidence`;
            const [packet, shares] = await Promise.all([
              readJson<EvidencePacket>(
                await fetch(runBase, {
                  cache: "no-store",
                  credentials: "same-origin",
                  signal: request.signal,
                }),
              ),
              readJson<{ shares: EvidenceShareGrant[] }>(
                await fetch(`${runBase}/shares`, {
                  cache: "no-store",
                  credentials: "same-origin",
                  signal: request.signal,
                }),
              ),
            ]);
            return {
              packet,
              shares: shares.shares,
              projectId: run.projectId,
              projectName: run.projectName,
              suiteId: run.suiteId,
              suiteName: run.suiteName,
              suiteVersion: run.suiteVersion,
            };
          }),
      );
      if (!request.isCurrent()) return;
      setPackets(packetRows);
      if (canManage) {
        const [attestationBody, retentionBody, keyBody] = await Promise.all([
          readJson<{ attestations: Attestation[] }>(
            await fetch(`${base}/assurance/attestations?limit=100`, {
              cache: "no-store",
              credentials: "same-origin",
              signal: request.signal,
            }),
          ),
          readJson<RetentionPolicy>(
            await fetch(`${base}/assurance/retention`, {
              cache: "no-store",
              credentials: "same-origin",
              signal: request.signal,
            }),
          ),
          readJson<TrustedKeyHistory>(
            await fetch(`${base}/assurance/trusted-keys`, {
              cache: "no-store",
              credentials: "same-origin",
              signal: request.signal,
            }),
          ),
        ]);
        if (!request.isCurrent()) return;
        setAttestations(attestationBody.attestations);
        setRetention(retentionBody);
        setKeys(keyBody.keys);
        setUntrustedPacketKeyCount(keyBody.untrustedPacketKeyCount);
      }
    } catch {
      if (request.isCurrent()) setError(errors("loadEvidence"));
    } finally {
      if (request.isCurrent()) setLoading(false);
      request.finish();
    }
  }, [canManage, errors, requestedRunId, workspaceId, workspaceRequests]);

  useEffect(() => {
    if (urlReady) void load();
  }, [load, urlReady]);

  const attestationByDigest = useMemo(
    () => new Map(attestations.map(attestation => [attestation.artifactDigest, attestation])),
    [attestations],
  );
  const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}`;
  const packetSelectionRequested = Boolean(urlSnapshot.state.packetId || urlSnapshot.state.runId);
  const selectedPacket = useMemo(() => {
    const { packetId, runId } = urlSnapshot.state;
    if (!packetId && !runId) return packets[0]?.packet ?? null;
    return (
      packets.find(
        row =>
          (!packetId || row.packet.payload.packetId === packetId) && (!runId || row.packet.payload.runId === runId),
      )?.packet ?? null
    );
  }, [packets, urlSnapshot.state]);
  const packetSelectionUnavailable = packetSelectionRequested && !selectedPacket;
  const selectedTrustedKey = selectedPacket
    ? (keys.find(key => key.keyId === selectedPacket.signing.keyId) ?? null)
    : null;
  const selectedAttestation = selectedPacket ? (attestationByDigest.get(selectedPacket.packetDigest) ?? null) : null;
  const selectedTrustedKeyDownloadUrl = selectedTrustedKey
    ? `${base}/assurance/trusted-keys?format=spki&keyId=${encodeURIComponent(selectedTrustedKey.keyId)}`
    : null;
  const visiblePackets = useMemo(() => {
    const query = packetQuery.trim().toLocaleLowerCase();
    const cutoff = dateFilter === "all" ? null : Date.now() - Number(dateFilter) * 86_400_000;
    return packets.filter(({ packet, projectName, suiteName }) => {
      const outcome = packet.payload.aggregation.suite.outcome;
      if (outcomeFilter !== "all" && outcome !== outcomeFilter) return false;
      if (cutoff !== null && Date.parse(packet.payload.generatedAt) < cutoff) return false;
      return (
        !query ||
        [projectName, suiteName, packet.payload.runId, packet.payload.packetId].some(value =>
          value.toLocaleLowerCase().includes(query),
        )
      );
    });
  }, [dateFilter, outcomeFilter, packetQuery, packets]);
  const newerPacketByIdentity = useMemo(() => newerPacketsByIdentity(packets), [packets]);

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">
          <AgentText id="decisionRecords" />
        </h2>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <button
              type="button"
              className="btn btn-sm border-base-content/10 bg-base-content/[0.06]"
              aria-controls="evidence-advanced-controls"
              aria-expanded={showAdvancedControls}
              onClick={() => setShowAdvancedControls(current => !current)}
            >
              <AgentText id="translated139" />
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm border-base-content/10 bg-base-content/[0.06]"
            onClick={() => void load()}
          >
            <AgentText id="translated140" />
          </button>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-error/20 bg-error/[0.06] p-4 text-sm text-error" role="alert">
          {error}
        </div>
      ) : null}
      <AsyncSection loading={loading} loadingLabel={copy("loadingEvidence")}>
        {null}
      </AsyncSection>

      {!loading && !error && packetSelectionUnavailable ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="evidence-unavailable-heading">
          <h2 id="evidence-unavailable-heading" className="font-semibold">
            <AgentText id="translated143" />
          </h2>
          <p className="mt-2 text-sm text-base-content/55">
            <AgentText id="translated144" />
          </p>
          <button
            type="button"
            className="btn btn-sm rateloop-secondary-action mt-4"
            onClick={() => updateUrlState({ runId: null, packetId: null })}
          >
            <AgentText id="translated145" />
          </button>
        </Card>
      ) : null}

      {!loading && !packetSelectionRequested && packets.length === 0 ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="evidence-empty-heading">
          <h2 id="evidence-empty-heading" className="font-semibold">
            <AgentText id="translated146" />
          </h2>
          <p className="mt-2 text-sm text-base-content/55">
            <AgentText id="reviewsAppear" />
          </p>
        </Card>
      ) : null}

      {!loading && packets.length > 0 ? (
        <section className="space-y-3" aria-labelledby="evidence-packets-heading">
          <h2 id="evidence-packets-heading" className="text-xl font-semibold">
            <AgentText id="translated147" />
          </h2>
          <Card as="div" className="grid gap-3 rounded-2xl p-4 sm:grid-cols-3">
            <Field
              label={<AgentText id="attribute018" />}
              type="search"
              value={packetQuery}
              onChange={event => updateUrlState({ query: event.target.value })}
            />
            <SelectField
              label={<AgentText id="attribute011" />}
              value={outcomeFilter}
              onChange={event => updateUrlState({ outcome: event.target.value as EvidenceOutcomeFilter })}
            >
              <option value="all">
                <AgentText id="allOutcomes" />
              </option>
              <option value="pass">
                <AgentText id="pass" />
              </option>
              <option value="fail">
                <AgentText id="fail" />
              </option>
              <option value="insufficient">
                <AgentText id="insufficient" />
              </option>
            </SelectField>
            <SelectField
              label={<AgentText id="attribute012" />}
              value={dateFilter}
              onChange={event => updateUrlState({ date: event.target.value as EvidenceDateFilter })}
            >
              <option value="all">
                <AgentText id="anyTime" />
              </option>
              <option value="7">
                <AgentText id="last7Days" />
              </option>
              <option value="30">
                <AgentText id="last30Days" />
              </option>
            </SelectField>
          </Card>
          {visiblePackets.length === 0 ? (
            <Card as="div" className="rounded-2xl p-6" role="status">
              <h3 className="font-semibold">
                <AgentText id="noMatchingEvidence" />
              </h3>
              <p className="mt-2 text-sm text-base-content/55">
                <AgentText id="clearChangeFilters" />
              </p>
            </Card>
          ) : null}
          {visiblePackets.map(({ packet, projectName, shares, suiteName }) => {
            const selected =
              selectedPacket?.payload.packetId === packet.payload.packetId &&
              selectedPacket.payload.runId === packet.payload.runId;
            const outcome = packet.payload.aggregation.suite.outcome;
            const attestation = attestationByDigest.get(packet.packetDigest);
            const sourceSubpanels = packet.payload.aggregation.reviewerCoverage?.sourceSubpanels ?? [];
            const targetReviewerCount = sourceSubpanels.reduce(
              (total, source) => total + source.targetReviewerCount,
              0,
            );
            const respondingReviewerCount = sourceSubpanels.reduce(
              (total, source) => total + source.respondingReviewerCount,
              0,
            );
            const settlementLinks = (packet.payload.settlement?.links ?? [])
              .map(safeExternalEvidenceLink)
              .filter((link): link is string => link !== null);
            const newerPacket = newerPacketByIdentity.get(`${packet.payload.runId}\u0000${packet.payload.packetId}`);
            return (
              <Card
                as="article"
                key={packet.payload.packetId}
                className={`rounded-2xl p-5 ${
                  selected ? "border-[var(--rateloop-blue)]/35 bg-[var(--rateloop-blue)]/[0.025]" : ""
                }`}
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-blue)]">
                      {projectName}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold">{suiteName}</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={`badge border-0 ${outcomeStyle(outcome)}`}>{copy(`outcome.${outcome}`)}</span>
                      <span className="badge border-base-content/10 bg-base-content/[0.04] text-base-content/65">
                        {anchorLabel(attestation, canManage, copy)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={resultHrefForRun(workspaceId, packet.payload.runId, urlSnapshot.search)}
                      className="btn btn-sm rateloop-secondary-action"
                    >
                      <AgentText id="translated149" />
                    </Link>
                    <Link
                      href={evidenceLinkHref(urlSnapshot, {
                        runId: packet.payload.runId,
                        packetId: packet.payload.packetId,
                      })}
                      scroll={false}
                      aria-current={selected ? "page" : undefined}
                      className="btn btn-sm rateloop-secondary-action"
                      onClick={event => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                          return;
                        event.preventDefault();
                        updateUrlState(
                          { runId: packet.payload.runId, packetId: packet.payload.packetId },
                          selected ? "replace" : "push",
                        );
                      }}
                    >
                      {selected ? copy("linkToPacket") : <AgentText id="dynamic027" />}
                    </Link>
                    <button
                      type="button"
                      className="btn btn-sm rateloop-gradient-action"
                      disabled={busyPacket === packet.payload.packetId}
                      onClick={() => {
                        setBusyPacket(packet.payload.packetId);
                        updateUrlState(
                          { runId: packet.payload.runId, packetId: packet.payload.packetId },
                          selected ? "replace" : "push",
                        );
                        void downloadJson(
                          `${base}/assurance/runs/${encodeURIComponent(packet.payload.runId)}/evidence`,
                          downloadName("rateloop-evidence", packet.payload.packetId),
                        )
                          .catch(() => setError(errors("exportPacket")))
                          .finally(() => setBusyPacket(null));
                      }}
                    >
                      {busyPacket === packet.payload.packetId ? (
                        <AgentText id="dynamic023" />
                      ) : (
                        <AgentText id="dynamic022" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm rateloop-secondary-action"
                      disabled={busyShare === packet.payload.packetId}
                      onClick={async () => {
                        if (
                          !(await confirm({
                            title: ui("shareConfirmationTitle"),
                            description: ui("translated150"),
                            confirmLabel: ui("shareConfirmationAction"),
                            cancelLabel: ui("translated183"),
                          }))
                        )
                          return;
                        setBusyShare(packet.payload.packetId);
                        setError(null);
                        void fetch(
                          `${base}/assurance/runs/${encodeURIComponent(packet.payload.runId)}/evidence/shares`,
                          {
                            method: "POST",
                            credentials: "same-origin",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }),
                          },
                        )
                          .then(response => readJson<{ share: EvidenceShareGrant; shareUrl: string }>(response))
                          .then(created => {
                            setPackets(current =>
                              current.map(row =>
                                packetIdentity(row) === `${packet.payload.runId}\u0000${packet.payload.packetId}`
                                  ? { ...row, shares: [created.share, ...row.shares] }
                                  : row,
                              ),
                            );
                            setShareUrls(current => ({ ...current, [created.share.grantId]: created.shareUrl }));
                          })
                          .catch(() => setError(errors("sharePacket")))
                          .finally(() => setBusyShare(null));
                      }}
                    >
                      {busyShare === packet.payload.packetId ? (
                        <AgentText id="dynamic021" />
                      ) : (
                        <AgentText id="dynamic034" />
                      )}
                    </button>
                  </div>
                </div>
                {shares.some(share => share.status === "active") ? (
                  <div className="mt-4 space-y-3 rounded-xl border border-base-content/10 bg-base-content/[0.025] p-4">
                    {shares
                      .filter(share => share.status === "active")
                      .map(share => (
                        <div className="flex flex-col gap-2" key={share.grantId}>
                          <p className="text-xs text-base-content/60">
                            <AgentText id="translated151" />{" "}
                            {format.dateTime(new Date(share.expiresAt), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                            {share.accessCount
                              ? ` · ${copy(share.accessCount === 1 ? "openedOnce" : "openedMany", {
                                  count: share.accessCount,
                                })}`
                              : ""}
                          </p>
                          {shareUrls[share.grantId] ? (
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <Field
                                label={<AgentText id="attribute019" />}
                                labelClassName="sr-only"
                                containerClassName="min-w-0 flex-1"
                                className="input input-sm border-base-content/10 bg-[var(--rateloop-field)] font-mono text-xs"
                                readOnly
                                value={shareUrls[share.grantId]}
                                onFocus={event => event.currentTarget.select()}
                              />
                              <button
                                className="btn btn-sm rateloop-secondary-action"
                                type="button"
                                onClick={() => {
                                  if (!navigator.clipboard) {
                                    setError(errors("copyShare"));
                                    return;
                                  }
                                  void navigator.clipboard
                                    .writeText(shareUrls[share.grantId])
                                    .then(() => setCopiedShare(share.grantId))
                                    .catch(() => setError(errors("copyShare")));
                                }}
                              >
                                {copiedShare === share.grantId ? (
                                  <AgentText id="dynamic018" />
                                ) : (
                                  <AgentText id="dynamic020" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <p className="text-xs text-base-content/60">
                              <AgentText id="translated152" />
                            </p>
                          )}
                          <button
                            className="btn btn-sm w-fit border-error/20 bg-error/[0.05] text-error"
                            type="button"
                            disabled={busyShare === share.grantId}
                            onClick={() => {
                              setBusyShare(share.grantId);
                              void fetch(
                                `${base}/assurance/runs/${encodeURIComponent(
                                  packet.payload.runId,
                                )}/evidence/shares/${encodeURIComponent(share.grantId)}`,
                                { method: "DELETE", credentials: "same-origin" },
                              )
                                .then(response => {
                                  if (!response.ok) return readJson(response);
                                  setPackets(current =>
                                    current.map(row =>
                                      packetIdentity(row) === `${packet.payload.runId}\u0000${packet.payload.packetId}`
                                        ? {
                                            ...row,
                                            shares: row.shares.map(item =>
                                              item.grantId === share.grantId
                                                ? { ...item, status: "revoked", revokedAt: new Date().toISOString() }
                                                : item,
                                            ),
                                          }
                                        : row,
                                    ),
                                  );
                                  setShareUrls(current => {
                                    const next = { ...current };
                                    delete next[share.grantId];
                                    return next;
                                  });
                                })
                                .catch(() => setError(errors("revokeShare")))
                                .finally(() => setBusyShare(null));
                            }}
                          >
                            {busyShare === share.grantId ? (
                              <AgentText id="dynamic031" />
                            ) : (
                              <AgentText id="dynamic030" />
                            )}
                          </button>
                        </div>
                      ))}
                  </div>
                ) : null}
                {newerPacket ? (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--rateloop-blue)]/25 bg-[var(--rateloop-blue)]/[0.05] px-4 py-3 text-xs leading-5">
                    <p className="text-base-content/70">
                      <AgentText id="translated153" />
                    </p>
                    <Link
                      href={evidenceLinkHref(urlSnapshot, {
                        runId: newerPacket.packet.payload.runId,
                        packetId: newerPacket.packet.payload.packetId,
                      })}
                      scroll={false}
                      className="font-semibold underline underline-offset-4"
                      onClick={event => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                          return;
                        event.preventDefault();
                        updateUrlState(
                          {
                            runId: newerPacket.packet.payload.runId,
                            packetId: newerPacket.packet.payload.packetId,
                          },
                          "push",
                        );
                      }}
                    >
                      <AgentText id="translated154" />
                    </Link>
                  </div>
                ) : null}
                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-base-content/55">
                      <AgentText id="generated" />
                    </dt>
                    <dd className="mt-1">
                      {format.dateTime(new Date(packet.payload.generatedAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </dd>
                  </div>
                  {targetReviewerCount > 0 ? (
                    <div>
                      <dt className="text-xs text-base-content/55">
                        <AgentText id="responses" />
                      </dt>
                      <dd className="mt-1">
                        {respondingReviewerCount} <AgentText id="translated063" /> {targetReviewerCount}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <PacketCoverage packet={packet} />
                <details className="mt-4 border-t border-base-content/10 pt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-base-content/65">
                    <AgentText id="translated155" />
                  </summary>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <dt className="text-xs text-base-content/55">
                        <AgentText id="trigger" />
                      </dt>
                      <dd className="mt-1">
                        {packet.payload.reviewContext?.selectionTrigger?.kind ? (
                          evidenceTriggerLabel(packet.payload.reviewContext.selectionTrigger.kind, copy)
                        ) : (
                          <AgentText id="dynamic026" />
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/55">
                        <AgentText id="gate" />
                      </dt>
                      <dd className="mt-1">
                        {packet.payload.reviewContext?.gate?.type ? (
                          evidenceGateLabel(packet.payload.reviewContext.gate.type, copy)
                        ) : (
                          <AgentText id="dynamic026" />
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/55">
                        <AgentText id="signingKey" />
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">{packet.signing.keyId}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/55">
                        <AgentText id="packetDigest" />
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">{packet.packetDigest}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/55">
                        <AgentText id="rekorEntry" />
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {attestation?.rekor?.entryUuid ??
                          (canManage ? <AgentText id="dynamic025" /> : <AgentText id="dynamic029" />)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 grid gap-4 border-t border-base-content/10 pt-4 lg:grid-cols-2">
                    <section aria-label={ui("settlementEvidenceLabel")}>
                      <h4 className="text-sm font-semibold">
                        <AgentText id="settlementEvidence" />
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-base-content/65">
                        {packet.payload.settlement?.statement
                          ? locale === "en"
                            ? packet.payload.settlement.statement
                            : copy("settlementRecorded")
                          : copy("settlementMissing")}
                      </p>
                      {settlementLinks.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-xs">
                          {settlementLinks.map(link => (
                            <li key={link}>
                              <a className="link break-all" href={link} rel="noreferrer">
                                {link}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                    <section aria-label={ui("reviewerProvenanceLabel")}>
                      <h4 className="text-sm font-semibold">
                        <AgentText id="reviewerProvenance" />
                      </h4>
                      <div className="mt-2 space-y-2 text-sm text-base-content/65">
                        {sourceSubpanels.map(source => (
                          <p key={source.source}>
                            <span>{evidenceReviewerSourceLabel(source.source, evaluationCopy)}</span>:{" "}
                            {source.assignedReviewerCount} <AgentText id="translated063" /> {source.targetReviewerCount}{" "}
                            <AgentText id="translated156" /> {source.respondingReviewerCount}{" "}
                            <AgentText id="translated157" /> {source.completeJudgmentSetReviewerCount}{" "}
                            <AgentText id="translated158" /> {source.paidReviewerCount} <AgentText id="translated159" />
                          </p>
                        ))}
                        {packet.payload.reviewContext?.reviewerQualifications ? (
                          <p>
                            {packet.payload.reviewContext.reviewerQualifications.categories.length > 0
                              ? copy(
                                  packet.payload.reviewContext.reviewerQualifications.categories.length === 1
                                    ? "qualificationCategoryOne"
                                    : "qualificationCategoryMany",
                                  {
                                    count: packet.payload.reviewContext.reviewerQualifications.categories.length,
                                  },
                                )
                              : copy("qualificationsSuppressed", {
                                  count: packet.payload.reviewContext.reviewerQualifications.minimumAggregationSize,
                                })}
                            .
                          </p>
                        ) : (
                          <p>
                            <AgentText id="noQualification" />
                          </p>
                        )}
                      </div>
                    </section>
                  </div>
                  {attestation?.lastError ? (
                    <p className="mt-3 text-xs text-error" role="status">
                      {copy("attestationError")}
                    </p>
                  ) : null}
                </details>
              </Card>
            );
          })}
        </section>
      ) : null}

      {!loading && selectedPacket ? (
        <VerificationInstructions
          packet={selectedPacket}
          attestation={selectedAttestation}
          trustedKey={selectedTrustedKey}
          trustedKeyDownloadUrl={selectedTrustedKeyDownloadUrl}
        />
      ) : null}

      {!loading && canManage && untrustedPacketKeyCount > 0 ? (
        <p className="rounded-xl border border-error/20 bg-error/[0.06] p-3 text-sm text-error" role="alert">
          {untrustedPacketKeyCount} <AgentText id="translated161" />{" "}
          {copy(untrustedPacketKeyCount === 1 ? "keyIs" : "keysAre")} <AgentText id="translated162" />
        </p>
      ) : null}

      {!loading && canManage && showAdvancedControls ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="compliance-export-heading">
          <h2 id="compliance-export-heading" className="text-xl font-semibold">
            <AgentText id="translated141" />
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
            <AgentText id="translated142" />
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ExportLink href={`${base}/audit/export`}>
              <AgentText id="auditLog" />
            </ExportLink>
            <ExportLink href={`${base}/assurance/coverage/export`}>
              <AgentText id="coverageHistory" />
            </ExportLink>
            <ExportLink href={`${base}/assurance/metrics/grafana`}>
              <AgentText id="grafanaJson" />
            </ExportLink>
          </div>
        </Card>
      ) : null}

      {!loading && canManage && showAdvancedControls ? <ProjectAuditorAccess workspaceId={workspaceId} /> : null}

      {!loading && canManage && showAdvancedControls ? (
        <Card
          as="section"
          id="evidence-advanced-controls"
          className="rounded-2xl p-6"
          aria-labelledby="evidence-retention-heading"
        >
          <h2 id="evidence-retention-heading" className="text-xl font-semibold">
            <AgentText id="translated163" />
          </h2>
          {retention ? <RetentionEditor policy={retention} workspaceId={workspaceId} onSaved={setRetention} /> : null}
        </Card>
      ) : null}

      {!loading && canManage && showAdvancedControls ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="trusted-key-heading">
          <h2 id="trusted-key-heading" className="text-xl font-semibold">
            <AgentText id="translated164" />
          </h2>
          <p className="mt-2 text-sm text-base-content/55">
            <AgentText id="keysVisible" />
          </p>
          {keys.length === 0 ? (
            <p className="mt-4 text-sm text-base-content/55">
              <AgentText id="noKeyHistory" />
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {keys.map(key => (
                <Card as="article" variant="nested" key={key.keyId} className="rounded-xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all text-xs text-base-content/75">{key.keyId}</code>
                    <span className="badge border-base-content/10 bg-base-content/[0.04] text-xs capitalize">
                      {copy(`keyStatus.${key.status}`)}
                    </span>
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] text-base-content/55">
                    Ed25519 SPKI DER (base64url): {key.publicKeySpki}
                  </p>
                  <p className="mt-2 text-xs text-base-content/55">
                    {copy(key.packetCount === 1 ? "packetCountOne" : "packetCountMany", { count: key.packetCount })}
                    {key.lastPacketAt
                      ? ` · ${copy("lastUsed", {
                          date: format.dateTime(new Date(key.lastPacketAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })}`
                      : ""}
                  </p>
                  <a
                    className="btn btn-xs mt-3 border-base-content/10 bg-base-content/[0.06] hover:bg-base-content/[0.1]"
                    href={`${base}/assurance/trusted-keys?format=spki&keyId=${encodeURIComponent(key.keyId)}`}
                    download={trustedKeyFilename(key.keyId)}
                  >
                    <AgentText id="translated165" />
                  </a>
                </Card>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {!loading && canManage && showAdvancedControls ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="enterprise-delivery-heading">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">
            <AgentText id="delivery" />
          </p>
          <h2 id="enterprise-delivery-heading" className="mt-2 text-xl font-semibold">
            <AgentText id="translated166" />
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
            <AgentText id="translated167" />
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(
              [
                ["worm", copy("delivery.wormLabel"), copy("delivery.wormDescription")],
                ["siem", copy("delivery.siemLabel"), copy("delivery.siemDescription")],
                ["grc", copy("delivery.grcLabel"), copy("delivery.grcDescription")],
                ["metrics", copy("delivery.metricsLabel"), copy("delivery.metricsDescription")],
              ] as const
            ).map(([kind, label, description]) => (
              <Card as="article" variant="nested" key={kind} className="rounded-xl p-4">
                <h3 className="font-semibold">{label}</h3>
                <p className="mt-1 text-sm text-base-content/55">{description}</p>
                <button
                  type="button"
                  className="btn btn-outline btn-sm mt-3"
                  aria-controls="evidence-delivery-editor"
                  aria-expanded={deliveryKind === kind}
                  onClick={() => setDeliveryKind(kind)}
                >
                  {copy("configureDelivery", { label })}
                </button>
              </Card>
            ))}
          </div>
          {deliveryKind ? (
            <div id="evidence-delivery-editor" className="mt-5 border-t border-base-content/10 pt-5">
              <div className="mb-4 flex justify-end">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeliveryKind(null)}>
                  <AgentText id="translated169" />
                </button>
              </div>
              {deliveryKind === "worm" ? <WormEvidenceDelivery workspaceId={workspaceId} /> : null}
              {deliveryKind === "siem" ? <SiemEvidenceDelivery workspaceId={workspaceId} /> : null}
              {deliveryKind === "grc" ? <GrcEvidenceDelivery workspaceId={workspaceId} /> : null}
              {deliveryKind === "metrics" ? <MetricsEvidenceAccess workspaceId={workspaceId} /> : null}
            </div>
          ) : null}
        </Card>
      ) : null}
      {confirmationDialog}
    </div>
  );
}
