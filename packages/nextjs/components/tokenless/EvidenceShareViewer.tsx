"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LocalizedSharedContent, UntranslatedContent } from "~~/components/tokenless/LocalizedSharedContent";
import { PublicEvidenceVerifier } from "~~/components/tokenless/PublicEvidenceVerifier";
import { Button } from "~~/components/tokenless/ui/Button";
import { readJson } from "~~/lib/tokenless/http";
import { type PublicEvidenceLimitation, publicEvidenceSummary } from "~~/lib/tokenless/publicEvidencePresentation";
import {
  type PublicEvidenceVerificationResult,
  verifyPublicEvidencePacket,
} from "~~/lib/tokenless/publicEvidenceVerification";

function verificationServiceUnavailable(error: unknown) {
  if (error instanceof TypeError) return true;
  return (
    error instanceof Error &&
    /public verification keys are unavailable|public verification-key response is invalid/iu.test(error.message)
  );
}

function outcomeLabel(outcome: "fail" | "insufficient" | "pass") {
  if (outcome === "pass") return "Pass";
  if (outcome === "fail") return "Fail";
  return "Insufficient";
}

function limitationLabel(limitation: PublicEvidenceLimitation) {
  if (limitation === "minimum_aggregation_not_met") {
    return "Results are hidden because the minimum group size was not met.";
  }
  if (limitation === "small_source_cells_suppressed") {
    return "One or more reviewer groups are too small to show separately.";
  }
  if (limitation === "incomplete_or_invalid_work") {
    return "Missing, invalid, or pending responses are excluded from the result.";
  }
  if (limitation === "chain_evidence_incomplete") return "Some settlement evidence is incomplete.";
  return "No onchain settlement was part of this review.";
}

export function EvidenceShareViewer({ grantId }: { grantId: string }) {
  const started = useRef(false);
  const [packet, setPacket] = useState<unknown>(null);
  const [packetJson, setPacketJson] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<PublicEvidenceVerificationResult | null>(null);
  const [verificationIssue, setVerificationIssue] = useState<"failed" | "temporary" | null>(null);

  const verifyPacket = useCallback(async (value: unknown) => {
    setVerifying(true);
    setVerification(null);
    setVerificationIssue(null);
    try {
      setVerification(await verifyPublicEvidencePacket(value));
    } catch (error) {
      setVerificationIssue(verificationServiceUnavailable(error) ? "temporary" : "failed");
    } finally {
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const secret = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    if (!secret) {
      setUnavailable(true);
      return;
    }
    void fetch(`/api/evidence/shares/${encodeURIComponent(grantId)}/redeem`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    })
      .then(response => readJson<unknown>(response))
      .then(value => {
        setPacket(value);
        setPacketJson(JSON.stringify(value, null, 2));
        return verifyPacket(value);
      })
      .catch(() => setUnavailable(true));
  }, [grantId, verifyPacket]);

  if (unavailable) {
    return (
      <LocalizedSharedContent>
        <p className="mt-6 rounded-2xl border border-error/20 bg-error/[0.06] p-4 text-sm text-error" role="alert">
          This evidence share is unavailable. Ask the sender for a new link.
        </p>
      </LocalizedSharedContent>
    );
  }
  if (!packetJson) {
    return (
      <LocalizedSharedContent>
        <p className="mt-6 text-sm text-base-content/60" role="status">
          Opening evidence packet…
        </p>
      </LocalizedSharedContent>
    );
  }

  const summary = verification?.valid ? publicEvidenceSummary(packet) : null;
  const technicalDetails = (
    <details className="mt-6 rounded-2xl border border-base-content/10 bg-base-content/[0.025] p-4 sm:p-5">
      <summary className="cursor-pointer font-semibold text-base-content">Technical verification details</summary>
      <PublicEvidenceVerifier initialPacketJson={packetJson} initialVerificationResult={verification} />
    </details>
  );

  if (verifying) {
    return (
      <LocalizedSharedContent>
        <p className="mt-6 text-sm text-base-content/60" role="status">
          Verifying evidence packet…
        </p>
      </LocalizedSharedContent>
    );
  }

  if (verificationIssue === "temporary") {
    return (
      <LocalizedSharedContent>
        <section className="mt-6 rounded-2xl border border-warning/25 bg-warning/[0.07] p-5" role="alert">
          <h2 className="font-semibold text-base-content">Verification is temporarily unavailable</h2>
          <p className="mt-2 text-sm leading-6 text-base-content/65">
            The packet opened, but its public signing key could not be checked.
          </p>
          <Button
            variant="secondary"
            size="none"
            className="mt-4"
            type="button"
            onClick={() => void verifyPacket(packet)}
          >
            Retry verification
          </Button>
        </section>
        {technicalDetails}
      </LocalizedSharedContent>
    );
  }

  if (verificationIssue === "failed" || (verification && !verification.valid)) {
    return (
      <LocalizedSharedContent>
        <section className="mt-6 rounded-2xl border border-error/20 bg-error/[0.06] p-5" role="alert">
          <h2 className="font-semibold text-error">Verification failed</h2>
          <p className="mt-2 text-sm leading-6 text-base-content/65">
            Do not rely on this packet. It did not verify against a published decision-packet key.
          </p>
        </section>
        {technicalDetails}
      </LocalizedSharedContent>
    );
  }

  return (
    <LocalizedSharedContent>
      <section
        className="mt-6 rounded-2xl border border-success/20 bg-success/[0.06] p-5 sm:p-6"
        aria-labelledby={summary?.question ? "shared-evidence-question" : "shared-evidence-verified"}
      >
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-success">Packet verified</p>
        {summary?.question ? (
          <h2 id="shared-evidence-question" className="mt-3 text-2xl font-semibold text-base-content">
            <UntranslatedContent>{summary.question}</UntranslatedContent>
          </h2>
        ) : (
          <h2 id="shared-evidence-verified" className="sr-only">
            Verified evidence packet
          </h2>
        )}
        {summary ? (
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-base-content/55">Evidence scope</dt>
              <dd className="mt-1 font-semibold text-base-content">Review result and coverage</dd>
            </div>
            {summary.outcome ? (
              <div>
                <dt className="text-base-content/55">Review outcome</dt>
                <dd className="mt-1 font-semibold text-base-content">{outcomeLabel(summary.outcome)}</dd>
              </div>
            ) : null}
            {summary.caseCount !== null ? (
              <div>
                <dt className="text-base-content/55">Cases</dt>
                <dd className="mt-1 font-mono text-base-content">{summary.caseCount}</dd>
              </div>
            ) : null}
            {summary.respondingReviewerCount !== null ? (
              <div>
                <dt className="text-base-content/55">Responding reviewers</dt>
                <dd className="mt-1 font-mono text-base-content">{summary.respondingReviewerCount}</dd>
              </div>
            ) : null}
            {summary.validJudgmentCount !== null ? (
              <div>
                <dt className="text-base-content/55">Valid judgments</dt>
                <dd className="mt-1 font-mono text-base-content">{summary.validJudgmentCount}</dd>
              </div>
            ) : null}
            {summary.generatedAt ? (
              <div>
                <dt className="text-base-content/55">Generated</dt>
                <dd className="mt-1 text-base-content">
                  <time dateTime={summary.generatedAt}>
                    {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
                      new Date(summary.generatedAt),
                    )}
                  </time>
                </dd>
              </div>
            ) : null}
            {summary.limitations.length > 0 ? (
              <div className="sm:col-span-2 lg:col-span-4">
                <dt className="text-base-content/55">Limitations</dt>
                <dd className="mt-1 text-base-content/75">
                  <ul className="list-disc space-y-1 pl-5">
                    {summary.limitations.map(limitation => (
                      <li key={limitation}>{limitationLabel(limitation)}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </section>
      {technicalDetails}
    </LocalizedSharedContent>
  );
}
