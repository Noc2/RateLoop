"use client";

import { type ChangeEvent, type FormEvent, useState } from "react";
import {
  MAX_PUBLIC_EVIDENCE_PACKET_BYTES,
  type PublicEvidenceVerificationResult,
  parsePublicEvidencePacketJson,
  verifyPublicEvidencePacket,
} from "~~/lib/tokenless/publicEvidenceVerification";

function CheckResult({ check }: { check: PublicEvidenceVerificationResult["checks"][number] }) {
  const passed = check.status === "pass";
  return (
    <li className="rounded-2xl border border-base-content/10 bg-base-content/[0.025] p-4">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-semibold text-base-content">{check.label}</h3>
        <span
          className={`rounded-full px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-wide ${
            passed ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"
          }`}
        >
          {passed ? "Pass" : "Fail"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-base-content/65">{check.detail}</p>
      {check.expected || check.actual ? (
        <dl className="mt-3 space-y-2 text-xs">
          {check.expected ? (
            <div>
              <dt className="text-base-content/50">Packet / trusted value</dt>
              <dd className="mt-1 break-all font-mono text-base-content/75">{check.expected}</dd>
            </div>
          ) : null}
          {check.actual && check.actual !== check.expected ? (
            <div>
              <dt className="text-base-content/50">Recomputed / packet value</dt>
              <dd className="mt-1 break-all font-mono text-base-content/75">{check.actual}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </li>
  );
}

export function PublicEvidenceVerifier({ initialPacketJson = "" }: { initialPacketJson?: string }) {
  const [packetJson, setPacketJson] = useState(initialPacketJson);
  const [sourceName, setSourceName] = useState<string | null>(initialPacketJson ? "Shared packet" : null);
  const [result, setResult] = useState<PublicEvidenceVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function changePacket(value: string, name: string | null = null) {
    setPacketJson(value);
    setSourceName(name);
    setResult(null);
    setError(null);
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PUBLIC_EVIDENCE_PACKET_BYTES) {
      changePacket("", null);
      setError("Evidence packets must be 2 MB or smaller.");
      event.target.value = "";
      return;
    }
    try {
      changePacket(await file.text(), file.name);
    } catch {
      setError("The selected file could not be read.");
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const packet = parsePublicEvidencePacketJson(packetJson);
      setResult(await verifyPublicEvidencePacket(packet));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The packet could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-8" onSubmit={verify}>
      <div className="rounded-3xl border border-base-content/10 bg-base-content/[0.025] p-5 sm:p-7">
        <label className="block font-semibold text-base-content" htmlFor="evidence-packet">
          Packet JSON
        </label>
        <textarea
          id="evidence-packet"
          className="textarea mt-3 min-h-64 w-full resize-y rounded-2xl border-base-content/15 bg-base-300/40 font-mono text-xs leading-6"
          value={packetJson}
          maxLength={MAX_PUBLIC_EVIDENCE_PACKET_BYTES}
          onChange={event => changePacket(event.target.value)}
          placeholder='{ "payload": { … }, "signing": { … }, "packetDigest": "sha256:…", "signature": "…" }'
          spellCheck={false}
        />
        <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <label
              className="btn rateloop-secondary-action min-h-11 cursor-pointer px-4"
              htmlFor="evidence-packet-file"
            >
              Choose JSON file
            </label>
            <input
              id="evidence-packet-file"
              className="sr-only"
              type="file"
              accept=".json,application/json"
              onChange={selectFile}
            />
            {sourceName ? <span className="ml-3 text-sm text-base-content/60">{sourceName}</span> : null}
          </div>
          <button
            className="rateloop-gradient-action min-h-11 px-5 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || !packetJson.trim()}
            type="submit"
          >
            {busy ? "Checking…" : "Verify packet"}
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-base-content/60">
          {initialPacketJson
            ? "Maximum 2 MB. Verification runs in this browser; the verifier does not upload the packet or send telemetry about its contents. This page only fetches the public verification keys."
            : "Maximum 2 MB. Your packet stays in this browser. RateLoop does not upload, store, or send telemetry about its contents; this page only fetches the public verification keys."}
        </p>
      </div>

      {error ? (
        <p
          className="mt-5 rounded-2xl border border-red-300/20 bg-red-300/[0.06] p-4 text-sm text-red-100"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <section className="mt-8" aria-live="polite" aria-labelledby="verification-result-title">
          <div
            className={`rounded-2xl border p-5 ${
              result.valid ? "border-emerald-300/20 bg-emerald-300/[0.06]" : "border-red-300/20 bg-red-300/[0.06]"
            }`}
          >
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-base-content/60">
              Verification result
            </p>
            <h2 id="verification-result-title" className="mt-2 text-2xl font-bold text-base-content">
              {result.valid ? "Packet verified" : "Verification failed"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-base-content/65">
              Public key {result.key.keyId} · {result.key.algorithm} · {result.key.status}
            </p>
          </div>

          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {result.checks.map(check => (
              <CheckResult check={check} key={check.id} />
            ))}
          </ul>

          {result.errors.length ? (
            <div className="mt-4 rounded-2xl border border-base-content/10 bg-base-content/[0.025] p-4">
              <h3 className="font-semibold text-base-content">Verifier errors</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs text-base-content/65">
                {result.errors.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </form>
  );
}
