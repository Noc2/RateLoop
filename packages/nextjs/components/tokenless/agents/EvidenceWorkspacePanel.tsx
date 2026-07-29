"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GrcEvidenceDelivery } from "./GrcEvidenceDelivery";
import { MetricsEvidenceAccess } from "./MetricsEvidenceAccess";
import { SiemEvidenceDelivery } from "./SiemEvidenceDelivery";
import { WormEvidenceDelivery } from "./WormEvidenceDelivery";
import { agentTabHref } from "./agentWorkspaceState";
import { updateEvaluationUrlSearch } from "./evaluationUrlState";
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
import type { EvaluationDashboard } from "~~/lib/tokenless/evaluationDashboard";
import { readJson } from "~~/lib/tokenless/http";

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

function outcomeStyle(outcome: string) {
  if (outcome === "pass") return "bg-emerald-300/10 text-emerald-100";
  if (outcome === "fail") return "bg-red-300/10 text-red-100";
  return "bg-amber-300/10 text-amber-100";
}

function anchorLabel(attestation: Attestation | undefined, canViewAttestations: boolean) {
  if (!canViewAttestations) return "Anchor details restricted";
  if (!attestation) return "Anchor not queued";
  if (attestation.state === "completed") return "Transparency receipt recorded";
  if (attestation.state === "dead") return "Anchor failed";
  return "Anchor pending";
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

function responseLatency(milliseconds: number | null | undefined) {
  if (milliseconds === null || milliseconds === undefined) return "Unavailable";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} sec`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return `${minutes} min${seconds ? ` ${seconds} sec` : ""}`;
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
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load auditor access.");
      }
    })();
    return () => {
      active = false;
    };
  }, [base, loadAuditors]);

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to grant auditor access.");
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke auditor access.");
    } finally {
      setBusy(false);
    }
  }

  if (projects.length === 0 && !error) return null;
  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="project-auditors-heading">
      <h2 id="project-auditors-heading" className="text-xl font-semibold">
        Project auditors
      </h2>
      <form className="mt-5 grid gap-4 md:grid-cols-3" onSubmit={grant}>
        <SelectField
          label="Project"
          value={projectId}
          onChange={event => {
            const nextProjectId = event.target.value;
            setProjectId(nextProjectId);
            setError(null);
            void loadAuditors(nextProjectId).catch(cause =>
              setError(cause instanceof Error ? cause.message : "Unable to load auditor access."),
            );
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
          label="Auditor account or principal ID"
          value={subjectReference}
          onChange={event => setSubjectReference(event.target.value)}
          maxLength={255}
          required
        />
        <Field
          label="Expires"
          type="datetime-local"
          value={expiresAt}
          onChange={event => setExpiresAt(event.target.value)}
          min={new Date().toISOString().slice(0, 16)}
        />
        <button type="submit" className="btn btn-sm rateloop-gradient-action w-fit" disabled={busy || !projectId}>
          Grant read and export
        </button>
      </form>
      {error ? (
        <p className="mt-4 text-sm text-red-100" role="alert">
          {error}
        </p>
      ) : null}
      {auditors.length > 0 ? (
        <ul className="mt-5 divide-y divide-white/10">
          {auditors.map(auditor => (
            <li key={auditor.assignmentId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="break-all font-mono text-sm">{auditor.subjectReference}</p>
                <p className="mt-1 text-xs text-base-content/55">
                  {auditor.expiresAt ? `Expires ${new Date(auditor.expiresAt).toLocaleString()}` : "No expiry"}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm border-red-300/20 bg-red-300/[0.06] text-red-100"
                disabled={busy}
                onClick={() => void revoke(auditor.assignmentId)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : projectId ? (
        <p className="mt-5 text-sm text-base-content/55">No auditors have access to this project.</p>
      ) : null}
    </Card>
  );
}

function PacketCoverage({ packet }: { packet: EvidencePacket }) {
  const coverage = packet.payload.aggregation.judgmentCoverage;
  const latency = packet.payload.reviewContext?.period?.responseSubmissionLatencyFromPeriodStartMs;
  if (!coverage && !latency) return null;
  return (
    <details className="mt-4 rounded-xl border border-white/10 p-4">
      <summary className="cursor-pointer text-sm font-semibold">Review coverage and timing</summary>
      {coverage ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["Cases", coverage.caseCount],
            ["Target expected", coverage.targetExpectedJudgmentCount],
            ["Assigned expected", coverage.assignedExpectedJudgmentCount],
            ["Submitted", coverage.submittedJudgmentCount],
            ["Valid", coverage.validJudgmentCount],
            ["Invalid", coverage.invalidJudgmentCount],
            ["Pending", coverage.pendingJudgmentCount],
            ["Missing from target", coverage.missingTargetJudgmentCount],
            ["Missing from assignments", coverage.missingAssignedJudgmentCount],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-base-content/55">{label}</dt>
              <dd className="mt-1 font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {latency ? (
        <dl className="mt-4 grid gap-3 border-t border-white/10 pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-base-content/55">Response count</dt>
            <dd className="mt-1 font-mono">{latency.count}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">Median response time</dt>
            <dd className="mt-1">{responseLatency(latency.median)}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">95th percentile</dt>
            <dd className="mt-1">{responseLatency(latency.p95)}</dd>
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
    <a className="btn btn-sm border-white/10 bg-white/[0.06] hover:bg-white/[0.1]" href={href} download>
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
  const packetCommand = trustedKey
    ? `yarn workspace @rateloop/nextjs evidence:verify packet.json --public-key './${trustedKeyFilename(trustedKey.keyId)}' --key-id '${trustedKey.keyId}'`
    : "This packet's key is not in the workspace trust history. Do not verify it using its embedded key.";
  const attestationCommand =
    attestation?.state === "completed" && attestation.signerKeyId
      ? `yarn workspace @rateloop/nextjs attestation:verify attestation-witness.json \\
  --signer-public-key ./trusted-attestation-signer.pem \\
  --signer-key-id '${attestation.signerKeyId}' \\
  --rekor-public-key ./trusted-rekor-public-key.pem \\
  --tsa-ca ./trusted-tsa-ca.pem \\
  --tsa-chain ./trusted-tsa-chain.pem`
      : "A completed external attestation is required before attestation verification.";
  const instructions = `${packetCommand}\nyarn workspace @rateloop/nextjs audit:verify audit-export.json\n${attestationCommand}`;
  const [copied, setCopied] = useState(false);
  return (
    <Card as="details" className="rounded-2xl p-6">
      <summary className="cursor-pointer text-sm font-semibold">Verify an export</summary>
      <div className="mt-4 space-y-4">
        <p className="max-w-3xl text-sm leading-6 text-base-content/55">
          Never verify a packet with the key inside it. Download the pinned key from key history.{" "}
          <WorkspacePublicContentLink className="link" href="/docs/evidence#verify">
            Open the verification guide
          </WorkspacePublicContentLink>
          .
        </p>
        <div className="flex flex-wrap gap-2">
          {trustedKey && trustedKeyDownloadUrl ? (
            <a
              className="btn btn-sm border-white/10 bg-white/[0.06] hover:bg-white/[0.1]"
              href={trustedKeyDownloadUrl}
              download={trustedKeyFilename(trustedKey.keyId)}
            >
              Download trusted SPKI pin
            </a>
          ) : (
            <p className="w-full text-sm text-red-100" role="alert">
              A trusted pin for {packet.signing.keyId} is unavailable to this account or is missing from workspace key
              history.
            </p>
          )}
          {attestation?.state === "completed" ? (
            <a
              className="btn btn-sm border-white/10 bg-white/[0.06] hover:bg-white/[0.1]"
              href={`/api/public/assurance/attestations/${encodeURIComponent(attestation.jobId)}`}
              download={`rateloop-attestation-${attestation.jobId}.json`}
            >
              Download attestation witness
            </a>
          ) : null}
        </div>
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/35 p-4 text-xs leading-6 text-base-content/75">
          <code>{instructions}</code>
        </pre>
        <button
          type="button"
          className="btn btn-sm border-white/10 bg-white/[0.06]"
          onClick={() => {
            void navigator.clipboard.writeText(instructions).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2_000);
            });
          }}
        >
          {copied ? "Copied" : "Copy commands"}
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
            setMessage(`Saved as policy v${next.version}.`);
          })
          .catch(error => capture(error, "Unable to save retention."))
          .finally(() => setBusy(false));
      }}
    >
      <Field
        label="Evidence retention (months)"
        className="border-white/10 bg-[var(--rateloop-field)]"
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
        label="Audit retention (months)"
        className="border-white/10 bg-[var(--rateloop-field)]"
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
        {busy ? "Saving…" : "Save retention"}
      </button>
      {message ? (
        <p className="text-xs text-base-content/60 sm:col-span-3" role="status">
          {message}
        </p>
      ) : null}
      {formError ? (
        <p className="text-xs text-red-100 sm:col-span-3" role="alert">
          {formError}
        </p>
      ) : null}
    </form>
  );
}

export function EvidenceWorkspacePanel({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [packets, setPackets] = useState<PacketRow[]>([]);
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [retention, setRetention] = useState<RetentionPolicy | null>(null);
  const [keys, setKeys] = useState<TrustedKey[]>([]);
  const [untrustedPacketKeyCount, setUntrustedPacketKeyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPacket, setBusyPacket] = useState<string | null>(null);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}`;
      const requestedRun = requestedRunId ? `?run=${encodeURIComponent(requestedRunId)}` : "";
      const dashboard = await readJson<EvaluationDashboard>(
        await fetch(`${base}/evaluations${requestedRun}`, { cache: "no-store", credentials: "same-origin" }),
      );
      const packetRows = await Promise.all(
        dashboard.runs
          .filter(run => run.evidencePacketAvailable)
          .map(async run => ({
            packet: await readJson<EvidencePacket>(
              await fetch(`${base}/assurance/runs/${encodeURIComponent(run.runId)}/evidence`, {
                cache: "no-store",
                credentials: "same-origin",
              }),
            ),
            projectId: run.projectId,
            projectName: run.projectName,
            suiteId: run.suiteId,
            suiteName: run.suiteName,
            suiteVersion: run.suiteVersion,
          })),
      );
      setPackets(packetRows);
      if (canManage) {
        const [attestationBody, retentionBody, keyBody] = await Promise.all([
          readJson<{ attestations: Attestation[] }>(
            await fetch(`${base}/assurance/attestations?limit=100`, {
              cache: "no-store",
              credentials: "same-origin",
            }),
          ),
          readJson<RetentionPolicy>(
            await fetch(`${base}/assurance/retention`, { cache: "no-store", credentials: "same-origin" }),
          ),
          readJson<TrustedKeyHistory>(
            await fetch(`${base}/assurance/trusted-keys`, { cache: "no-store", credentials: "same-origin" }),
          ),
        ]);
        setAttestations(attestationBody.attestations);
        setRetention(retentionBody);
        setKeys(keyBody.keys);
        setUntrustedPacketKeyCount(keyBody.untrustedPacketKeyCount);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load evidence.");
    } finally {
      setLoading(false);
    }
  }, [canManage, requestedRunId, workspaceId]);

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
      <Card as="section" className="rounded-2xl p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Decision records and exports</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage ? (
              <button
                type="button"
                className="btn btn-sm border-white/10 bg-white/[0.06]"
                aria-controls="evidence-advanced-controls"
                aria-expanded={showAdvancedControls}
                onClick={() => setShowAdvancedControls(current => !current)}
              >
                Retention, keys, and delivery
              </button>
            ) : null}
            <button type="button" className="btn btn-sm border-white/10 bg-white/[0.06]" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
      </Card>

      {error ? (
        <div className="rounded-xl border border-red-300/20 bg-red-300/[0.06] p-4 text-sm text-red-100" role="alert">
          {error}
        </div>
      ) : null}
      <AsyncSection loading={loading} loadingLabel="Loading evidence">
        {null}
      </AsyncSection>

      {!loading && canManage ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="compliance-export-heading">
          <h2 id="compliance-export-heading" className="text-xl font-semibold">
            Compliance exports
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
            Export operating evidence for an audit. These records do not replace accountable human oversight.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ExportLink href={`${base}/audit/export`}>Audit log</ExportLink>
            <ExportLink href={`${base}/assurance/coverage/export`}>Coverage history</ExportLink>
            <ExportLink href={`${base}/assurance/metrics/grafana`}>Grafana dashboard JSON</ExportLink>
          </div>
        </Card>
      ) : null}

      {!loading && canManage ? <ProjectAuditorAccess workspaceId={workspaceId} /> : null}

      {!loading && !error && packetSelectionUnavailable ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="evidence-unavailable-heading">
          <h2 id="evidence-unavailable-heading" className="font-semibold">
            Evidence record unavailable
          </h2>
          <p className="mt-2 text-sm text-base-content/55">
            The linked run or packet is not available in this workspace.
          </p>
          <button
            type="button"
            className="btn btn-sm rateloop-secondary-action mt-4"
            onClick={() => updateUrlState({ runId: null, packetId: null })}
          >
            Show available records
          </button>
        </Card>
      ) : null}

      {!loading && !packetSelectionRequested && packets.length === 0 ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="evidence-empty-heading">
          <h2 id="evidence-empty-heading" className="font-semibold">
            No evidence records yet
          </h2>
          <p className="mt-2 text-sm text-base-content/55">Completed human reviews will appear here.</p>
        </Card>
      ) : null}

      {!loading && packets.length > 0 ? (
        <section className="space-y-3" aria-labelledby="evidence-packets-heading">
          <h2 id="evidence-packets-heading" className="text-xl font-semibold">
            Decision packets
          </h2>
          <Card as="div" className="grid gap-3 rounded-2xl p-4 sm:grid-cols-3">
            <Field
              label="Workflow or project"
              type="search"
              value={packetQuery}
              onChange={event => updateUrlState({ query: event.target.value })}
            />
            <SelectField
              label="Outcome"
              value={outcomeFilter}
              onChange={event => updateUrlState({ outcome: event.target.value as EvidenceOutcomeFilter })}
            >
              <option value="all">All outcomes</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
              <option value="insufficient">Insufficient</option>
            </SelectField>
            <SelectField
              label="Date"
              value={dateFilter}
              onChange={event => updateUrlState({ date: event.target.value as EvidenceDateFilter })}
            >
              <option value="all">Any time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </SelectField>
          </Card>
          {visiblePackets.length === 0 ? (
            <Card as="div" className="rounded-2xl p-6" role="status">
              <h3 className="font-semibold">No matching evidence</h3>
              <p className="mt-2 text-sm text-base-content/55">Clear or change the filters.</p>
            </Card>
          ) : null}
          {visiblePackets.map(({ packet, projectName, suiteName }) => {
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
                      <span className={`badge border-0 capitalize ${outcomeStyle(outcome)}`}>{outcome}</span>
                      <span className="badge border-white/10 bg-white/[0.04] text-base-content/65">
                        Point-in-time record
                      </span>
                      <span className="badge border-white/10 bg-white/[0.04] text-base-content/65">
                        {anchorLabel(attestation, canManage)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={resultHrefForRun(workspaceId, packet.payload.runId, urlSnapshot.search)}
                      className="btn btn-sm rateloop-secondary-action"
                    >
                      Open result
                    </Link>
                    <Link
                      href={evidenceUrlHref({
                        pathname: urlSnapshot.pathname,
                        search: urlSnapshot.search,
                        hash: urlSnapshot.hash,
                        patch: { runId: packet.payload.runId, packetId: packet.payload.packetId },
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
                      {selected ? "Link to packet" : "Open packet"}
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
                          .catch(cause => setError(cause instanceof Error ? cause.message : "Unable to export packet."))
                          .finally(() => setBusyPacket(null));
                      }}
                    >
                      {busyPacket === packet.payload.packetId ? "Exporting…" : "Export packet"}
                    </button>
                  </div>
                </div>
                {newerPacket ? (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--rateloop-blue)]/25 bg-[var(--rateloop-blue)]/[0.05] px-4 py-3 text-xs leading-5">
                    <p className="text-base-content/70">
                      A newer packet exists for this project and suite. This signed packet remains an immutable
                      point-in-time record.
                    </p>
                    <Link
                      href={evidenceUrlHref({
                        pathname: urlSnapshot.pathname,
                        search: urlSnapshot.search,
                        hash: urlSnapshot.hash,
                        patch: {
                          runId: newerPacket.packet.payload.runId,
                          packetId: newerPacket.packet.payload.packetId,
                        },
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
                      Open newer packet
                    </Link>
                  </div>
                ) : null}
                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-base-content/55">Generated</dt>
                    <dd className="mt-1">{new Date(packet.payload.generatedAt).toLocaleString()}</dd>
                  </div>
                  {targetReviewerCount > 0 ? (
                    <div>
                      <dt className="text-xs text-base-content/55">Responses</dt>
                      <dd className="mt-1">
                        {respondingReviewerCount} of {targetReviewerCount}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <PacketCoverage packet={packet} />
                <details className="mt-4 border-t border-white/10 pt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-base-content/65">
                    Verification details
                  </summary>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <dt className="text-xs text-base-content/55">Trigger</dt>
                      <dd className="mt-1 capitalize">
                        {packet.payload.reviewContext?.selectionTrigger?.kind?.replaceAll("_", " ") ?? "Not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/55">Gate</dt>
                      <dd className="mt-1 capitalize">{packet.payload.reviewContext?.gate?.type ?? "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/55">Signing key</dt>
                      <dd className="mt-1 break-all font-mono text-xs">{packet.signing.keyId}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/55">Packet digest</dt>
                      <dd className="mt-1 break-all font-mono text-xs">{packet.packetDigest}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/55">Rekor entry</dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {attestation?.rekor?.entryUuid ??
                          (canManage ? "No receipt recorded" : "Receipt details restricted")}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 grid gap-4 border-t border-white/10 pt-4 lg:grid-cols-2">
                    <section aria-label="Settlement evidence">
                      <h4 className="text-sm font-semibold">Settlement evidence</h4>
                      <p className="mt-2 text-sm leading-6 text-base-content/65">
                        {packet.payload.settlement?.statement ?? "Settlement evidence was not recorded in this packet."}
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
                    <section aria-label="Reviewer provenance">
                      <h4 className="text-sm font-semibold">Reviewer provenance</h4>
                      <div className="mt-2 space-y-2 text-sm text-base-content/65">
                        {sourceSubpanels.map(source => (
                          <p key={source.source}>
                            <span className="capitalize">{source.source.replaceAll("_", " ")}</span>:{" "}
                            {source.assignedReviewerCount} of {source.targetReviewerCount} assigned;{" "}
                            {source.respondingReviewerCount} responded; {source.completeJudgmentSetReviewerCount}{" "}
                            complete; {source.paidReviewerCount} paid.
                          </p>
                        ))}
                        {packet.payload.reviewContext?.reviewerQualifications ? (
                          <p>
                            Qualification categories:{" "}
                            {packet.payload.reviewContext.reviewerQualifications.categories.length > 0
                              ? packet.payload.reviewContext.reviewerQualifications.categories
                                  .map(category => `${category.key} (${category.reviewerCount ?? "suppressed"})`)
                                  .join(", ")
                              : `suppressed below the ${packet.payload.reviewContext.reviewerQualifications.minimumAggregationSize}-reviewer privacy threshold`}
                            .
                          </p>
                        ) : (
                          <p>Qualification provenance was not recorded.</p>
                        )}
                      </div>
                    </section>
                  </div>
                  {attestation?.lastError ? (
                    <p className="mt-3 text-xs text-red-100" role="status">
                      {attestation.lastError}
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
        <p className="rounded-xl border border-red-300/20 bg-red-300/[0.06] p-3 text-sm text-red-100" role="alert">
          {untrustedPacketKeyCount} packet signing {untrustedPacketKeyCount === 1 ? "key is" : "keys are"} not in the
          configured trust anchor.
        </p>
      ) : null}

      {!loading && canManage && showAdvancedControls ? (
        <Card
          as="section"
          id="evidence-advanced-controls"
          className="rounded-2xl p-6"
          aria-labelledby="evidence-retention-heading"
        >
          <h2 id="evidence-retention-heading" className="text-xl font-semibold">
            Retention policy
          </h2>
          {retention ? <RetentionEditor policy={retention} workspaceId={workspaceId} onSaved={setRetention} /> : null}
        </Card>
      ) : null}

      {!loading && canManage && showAdvancedControls ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="trusted-key-heading">
          <h2 id="trusted-key-heading" className="text-xl font-semibold">
            Trusted verification keys
          </h2>
          <p className="mt-2 text-sm text-base-content/55">Current and retired keys remain visible for old packets.</p>
          {keys.length === 0 ? (
            <p className="mt-4 text-sm text-base-content/55">No key history is available.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {keys.map(key => (
                <Card as="article" variant="nested" key={key.keyId} className="rounded-xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all text-xs text-base-content/75">{key.keyId}</code>
                    <span className="badge border-white/10 bg-white/[0.04] text-xs capitalize">{key.status}</span>
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] text-base-content/55">
                    Ed25519 SPKI DER (base64url): {key.publicKeySpki}
                  </p>
                  <p className="mt-2 text-xs text-base-content/55">
                    {key.packetCount} {key.packetCount === 1 ? "packet" : "packets"}
                    {key.lastPacketAt ? ` · last used ${new Date(key.lastPacketAt).toLocaleString()}` : ""}
                  </p>
                  <a
                    className="btn btn-xs mt-3 border-white/10 bg-white/[0.06] hover:bg-white/[0.1]"
                    href={`${base}/assurance/trusted-keys?format=spki&keyId=${encodeURIComponent(key.keyId)}`}
                    download={trustedKeyFilename(key.keyId)}
                  >
                    Download SPKI pin
                  </a>
                </Card>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {!loading && canManage && showAdvancedControls ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="enterprise-delivery-heading">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Delivery</p>
          <h2 id="enterprise-delivery-heading" className="mt-2 text-xl font-semibold">
            Evidence integrations
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
            Add or update one delivery destination at a time.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(
              [
                ["worm", "Immutable archive", "Send exports to an object-locked archive."],
                ["siem", "Event stream", "Send oversight events to a security event system."],
                ["grc", "Compliance connector", "Deliver evidence to a governance or compliance system."],
                ["metrics", "Metrics access", "Issue access for operational evidence metrics."],
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
                  Configure {label.toLocaleLowerCase()}
                </button>
              </Card>
            ))}
          </div>
          {deliveryKind ? (
            <div id="evidence-delivery-editor" className="mt-5 border-t border-white/10 pt-5">
              <div className="mb-4 flex justify-end">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeliveryKind(null)}>
                  Close integration setup
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
    </div>
  );
}
