"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GrcEvidenceDelivery } from "./GrcEvidenceDelivery";
import { MetricsEvidenceAccess } from "./MetricsEvidenceAccess";
import { SiemEvidenceDelivery } from "./SiemEvidenceDelivery";
import { WormEvidenceDelivery } from "./WormEvidenceDelivery";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import type { EvaluationDashboard } from "~~/lib/tokenless/evaluationDashboard";

type EvidencePacket = {
  packetDigest: string;
  payload: {
    packetId: string;
    runId: string;
    generatedAt: string;
    aggregation: { suite: { outcome: "pass" | "fail" | "insufficient" } };
    reviewContext?: { selectionTrigger?: { kind?: string }; gate?: { type?: string } };
  };
  signing: { algorithm: "Ed25519"; keyId: string; publicKey: string };
};

type PacketRow = { packet: EvidencePacket; projectName: string; suiteName: string };
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

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body as T;
}

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
  packet: EvidencePacket | null;
  attestation: Attestation | null;
  trustedKey: TrustedKey | null;
  trustedKeyDownloadUrl: string | null;
}) {
  const packetCommand =
    packet && trustedKey
      ? `yarn workspace @rateloop/nextjs evidence:verify packet.json --public-key './${trustedKeyFilename(trustedKey.keyId)}' --key-id '${trustedKey.keyId}'`
      : packet
        ? "This packet's key is not in the workspace trust history. Do not verify it using its embedded key."
        : "Export a packet to show its pinned-key verification command.";
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
    <details className="surface-card rounded-2xl p-6">
      <summary className="cursor-pointer text-sm font-semibold">Verify an export</summary>
      <div className="mt-4 space-y-4">
        <p className="max-w-3xl text-sm leading-6 text-base-content/55">
          Download the matching Ed25519 SPKI pin from workspace key history, then recompute the packet signature, Merkle
          roots, aggregation, and digest. Never use the public key embedded in the packet as its own trust anchor. The
          audit command recomputes every chain link and the exported head.
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
          ) : packet ? (
            <p className="w-full text-sm text-red-100" role="alert">
              A trusted pin for {packet.signing.keyId} is unavailable to this account or is missing from workspace key
              history.
            </p>
          ) : null}
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
        <p className="text-xs leading-5 text-base-content/45">
          Select the attestation signer, Rekor log key, and TSA certificate chain through an independent trust process;
          none is trusted merely because it appears in a witness. A completed external-attestation job records a Rekor
          UUID. Export-boundary jobs additionally require an RFC 3161 token; absence is shown as a pending or failed
          anchor, never as verified evidence.
        </p>
      </div>
    </details>
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
          .catch(error => setMessage(error instanceof Error ? error.message : "Unable to save retention."))
          .finally(() => setBusy(false));
      }}
    >
      <label className="text-sm text-base-content/65">
        Evidence retention (months)
        <input
          className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
          type="number"
          min={policy.minimumRetentionMonths}
          max={120}
          value={evidenceMonths}
          onChange={event => setEvidenceMonths(event.target.value)}
          required
        />
      </label>
      <label className="text-sm text-base-content/65">
        Audit retention (months)
        <input
          className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
          type="number"
          min={policy.minimumRetentionMonths}
          max={120}
          value={auditMonths}
          onChange={event => setAuditMonths(event.target.value)}
          required
        />
      </label>
      <button type="submit" className="btn btn-sm rateloop-gradient-action" disabled={busy}>
        {busy ? "Saving…" : "Save retention"}
      </button>
      {message ? (
        <p className="text-xs text-base-content/60 sm:col-span-3" role="status">
          {message}
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
  const [selectedPacket, setSelectedPacket] = useState<EvidencePacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPacket, setBusyPacket] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}`;
      const dashboard = await readJson<EvaluationDashboard>(
        await fetch(`${base}/evaluations`, { cache: "no-store", credentials: "same-origin" }),
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
            projectName: run.projectName,
            suiteName: run.suiteName,
          })),
      );
      setPackets(packetRows);
      setSelectedPacket(current => current ?? packetRows[0]?.packet ?? null);
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
  }, [canManage, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const attestationByDigest = useMemo(
    () => new Map(attestations.map(attestation => [attestation.artifactDigest, attestation])),
    [attestations],
  );
  const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}`;
  const selectedTrustedKey = selectedPacket
    ? (keys.find(key => key.keyId === selectedPacket.signing.keyId) ?? null)
    : null;
  const selectedAttestation = selectedPacket ? (attestationByDigest.get(selectedPacket.packetDigest) ?? null) : null;
  const selectedTrustedKeyDownloadUrl = selectedTrustedKey
    ? `${base}/assurance/trusted-keys?format=spki&keyId=${encodeURIComponent(selectedTrustedKey.keyId)}`
    : null;

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Evidence</p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Decision records and exports</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
              Inspect the exact review policy, verdict, signature, coverage history, and external-anchor state.
            </p>
          </div>
          <button type="button" className="btn btn-sm border-white/10 bg-white/[0.06]" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-300/20 bg-red-300/[0.06] p-4 text-sm text-red-100" role="alert">
          {error}
        </div>
      ) : null}
      <AsyncSection loading={loading} loadingLabel="Loading evidence">
        {null}
      </AsyncSection>

      {!loading && packets.length === 0 ? (
        <section className="surface-card rounded-2xl p-6">
          <h3 className="font-semibold">No decision packet yet</h3>
          <p className="mt-2 text-sm text-base-content/55">
            A packet appears after a completed assurance run is frozen and exported.
          </p>
        </section>
      ) : null}

      {packets.length > 0 ? (
        <section className="space-y-3" aria-labelledby="evidence-packets-heading">
          <h2 id="evidence-packets-heading" className="text-xl font-semibold">
            Decision packets
          </h2>
          {packets.map(({ packet, projectName, suiteName }) => {
            const outcome = packet.payload.aggregation.suite.outcome;
            const attestation = attestationByDigest.get(packet.packetDigest);
            return (
              <article key={packet.payload.packetId} className="surface-card rounded-2xl p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-blue)]">
                      {projectName}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold">{suiteName}</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={`badge border-0 capitalize ${outcomeStyle(outcome)}`}>{outcome}</span>
                      <span className="badge border-white/10 bg-white/[0.04] text-base-content/65">
                        {anchorLabel(attestation, canManage)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm rateloop-gradient-action"
                    disabled={busyPacket === packet.payload.packetId}
                    onClick={() => {
                      setBusyPacket(packet.payload.packetId);
                      setSelectedPacket(packet);
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
                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs text-base-content/45">Generated</dt>
                    <dd className="mt-1">{new Date(packet.payload.generatedAt).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-base-content/45">Trigger</dt>
                    <dd className="mt-1 capitalize">
                      {packet.payload.reviewContext?.selectionTrigger?.kind?.replaceAll("_", " ") ?? "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-base-content/45">Gate</dt>
                    <dd className="mt-1 capitalize">{packet.payload.reviewContext?.gate?.type ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-base-content/45">Signing key</dt>
                    <dd className="mt-1 break-all font-mono text-xs">{packet.signing.keyId}</dd>
                  </div>
                </dl>
                <details className="mt-4 border-t border-white/10 pt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-base-content/65">
                    Anchor details
                  </summary>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-base-content/45">Packet digest</dt>
                      <dd className="mt-1 break-all font-mono text-xs">{packet.packetDigest}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/45">Rekor entry</dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {attestation?.rekor?.entryUuid ??
                          (canManage ? "No receipt recorded" : "Receipt details restricted")}
                      </dd>
                    </div>
                  </dl>
                  {attestation?.lastError ? (
                    <p className="mt-3 text-xs text-red-100" role="status">
                      {attestation.lastError}
                    </p>
                  ) : null}
                </details>
              </article>
            );
          })}
        </section>
      ) : null}

      <VerificationInstructions
        packet={selectedPacket}
        attestation={selectedAttestation}
        trustedKey={selectedTrustedKey}
        trustedKeyDownloadUrl={selectedTrustedKeyDownloadUrl}
      />

      {canManage ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="compliance-export-heading">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">Workspace controls</p>
          <h2 id="compliance-export-heading" className="mt-2 text-xl font-semibold">
            Compliance exports
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
            Export operating evidence for your own controls. These records support an audit; they do not assign or
            replace your accountable human oversight.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ExportLink href={`${base}/audit/export`}>Audit log</ExportLink>
            <ExportLink href={`${base}/assurance/coverage/export`}>Coverage history</ExportLink>
            <ExportLink href={`${base}/assurance/metrics/grafana`}>Grafana dashboard JSON</ExportLink>
          </div>
          {retention ? <RetentionEditor policy={retention} workspaceId={workspaceId} onSaved={setRetention} /> : null}
        </section>
      ) : null}

      {canManage ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="trusted-key-heading">
          <h2 id="trusted-key-heading" className="text-xl font-semibold">
            Trusted verification keys
          </h2>
          <p className="mt-2 text-sm text-base-content/55">Current and retired keys remain visible for old packets.</p>
          {untrustedPacketKeyCount > 0 ? (
            <p
              className="mt-4 rounded-xl border border-red-300/20 bg-red-300/[0.06] p-3 text-sm text-red-100"
              role="alert"
            >
              {untrustedPacketKeyCount} packet signing {untrustedPacketKeyCount === 1 ? "key is" : "keys are"} not in
              the configured trust anchor.
            </p>
          ) : null}
          {keys.length === 0 ? (
            <p className="mt-4 text-sm text-base-content/50">No key history is available.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {keys.map(key => (
                <article key={key.keyId} className="surface-card-nested rounded-xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all text-xs text-base-content/75">{key.keyId}</code>
                    <span className="badge border-white/10 bg-white/[0.04] text-xs capitalize">{key.status}</span>
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] text-base-content/45">
                    Ed25519 SPKI DER (base64url): {key.publicKeySpki}
                  </p>
                  <p className="mt-2 text-xs text-base-content/45">
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
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {canManage ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="enterprise-delivery-heading">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Delivery</p>
          <h2 id="enterprise-delivery-heading" className="mt-2 text-xl font-semibold">
            Enterprise evidence delivery
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
            Connect evidence to systems your security and compliance teams already operate.
          </p>
          <div className="mt-5 grid items-start gap-3 lg:grid-cols-2">
            <WormEvidenceDelivery workspaceId={workspaceId} />
            <SiemEvidenceDelivery workspaceId={workspaceId} />
            <GrcEvidenceDelivery workspaceId={workspaceId} />
            <MetricsEvidenceAccess workspaceId={workspaceId} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
