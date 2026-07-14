"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { parseTokenlessYouTubeUrl } from "@rateloop/sdk";

type Workspace = { workspaceId: string; name: string; role: string };
type Kind = "binary" | "head_to_head";
type Classification = "public" | "synthetic" | "redacted";
type MediaMode = "none" | "images" | "youtube";
type StagedImage = {
  alt: string;
  assetId: string;
  digest: `sha256:${string}`;
  height: number;
  previewUrl: string;
  sizeBytes: number;
  width: number;
};

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : "The public question request failed.",
    );
  }
  return body;
}

const SANDBOX_POLICY_HASH = `0x${"00".repeat(32)}`;

export function PublicQuestionClient({ sandboxMode }: { sandboxMode: boolean }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [kind, setKind] = useState<Kind>("binary");
  const [prompt, setPrompt] = useState("");
  const [mediaMode, setMediaMode] = useState<MediaMode>("none");
  const [images, setImages] = useState<StagedImage[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [positiveLabel, setPositiveLabel] = useState("Yes");
  const [negativeLabel, setNegativeLabel] = useState("No");
  const [optionA, setOptionA] = useState("Baseline");
  const [optionB, setOptionB] = useState("Candidate");
  const [classification, setClassification] = useState<Classification>("redacted");
  const [redactionSummary, setRedactionSummary] = useState("");
  const [panelSize, setPanelSize] = useState(15);
  const [bounty, setBounty] = useState("25000000");
  const [reserve, setReserve] = useState("5000000");
  const [feeBps, setFeeBps] = useState(750);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ operationKey: string; quoteId: string; status: string } | null>(null);

  const loadWorkspaces = useCallback(async () => {
    const body = await readJson(
      await fetch("/api/account/workspaces", { cache: "no-store", credentials: "same-origin" }),
    );
    const next = body.workspaces as Workspace[];
    setWorkspaces(next);
    setWorkspaceId(current =>
      current && next.some(item => item.workspaceId === current) ? current : (next[0]?.workspaceId ?? ""),
    );
  }, []);

  useEffect(() => {
    void loadWorkspaces().catch(cause =>
      setError(
        cause instanceof Error ? cause.message : "Sign in and create a workspace before asking a public question.",
      ),
    );
  }, [loadWorkspaces]);

  const youtubeMedia = useMemo(() => {
    if (!youtubeUrl.trim()) return null;
    try {
      return parseTokenlessYouTubeUrl(youtubeUrl).media;
    } catch {
      return null;
    }
  }, [youtubeUrl]);

  const mediaReady =
    mediaMode === "none" ||
    (mediaMode === "images" && images.length > 0 && images.every(image => image.alt.trim()) && !uploading) ||
    (mediaMode === "youtube" && youtubeMedia !== null);

  const ready = useMemo(
    () =>
      Boolean(
        sandboxMode &&
          workspaceId &&
          prompt.trim().length >= 10 &&
          mediaReady &&
          (kind === "binary"
            ? positiveLabel.trim() && negativeLabel.trim()
            : optionA.trim() && optionB.trim() && optionA.trim() !== optionB.trim()) &&
          (classification !== "redacted" || redactionSummary.trim().length >= 10) &&
          confirmed &&
          /^[0-9]+$/.test(bounty) &&
          /^[0-9]+$/.test(reserve) &&
          panelSize >= 3,
      ),
    [
      bounty,
      classification,
      confirmed,
      kind,
      mediaReady,
      negativeLabel,
      optionA,
      optionB,
      panelSize,
      positiveLabel,
      prompt,
      redactionSummary,
      reserve,
      sandboxMode,
      workspaceId,
    ],
  );

  async function uploadImages(files: FileList | File[]) {
    if (!workspaceId || uploading) return;
    const selected = Array.from(files).slice(0, Math.max(0, 4 - images.length));
    if (!selected.length) return;
    setUploading(true);
    setError(null);
    const staged: StagedImage[] = [];
    try {
      for (const file of selected) {
        const form = new FormData();
        form.set("file", file);
        form.set("clientRequestId", `upload:web:${Date.now()}:${crypto.randomUUID()}`);
        const body = await readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/public-media/images`, {
            body: form,
            credentials: "same-origin",
            method: "POST",
          }),
        );
        staged.push({
          alt:
            file.name
              .replace(/\.[^.]+$/, "")
              .replaceAll(/[-_]+/g, " ")
              .trim() || "Question image",
          assetId: String(body.assetId),
          digest: String(body.digest) as `sha256:${string}`,
          height: Number(body.height),
          previewUrl: String(body.previewUrl),
          sizeBytes: Number(body.sizeBytes),
          width: Number(body.width),
        });
      }
      setImages(current => [...current, ...staged].slice(0, 4));
    } catch (cause) {
      setImages(current => [...current, ...staged].slice(0, 4));
      setError(cause instanceof Error ? cause.message : "Unable to upload the selected image.");
    } finally {
      setUploading(false);
    }
  }

  async function removeImage(image: StagedImage) {
    setImages(current => current.filter(item => item.assetId !== image.assetId));
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/public-media/images/${encodeURIComponent(image.assetId)}`,
          { credentials: "same-origin", method: "DELETE" },
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove the staged image.");
    }
  }

  function changeMediaMode(next: MediaMode) {
    if (next !== "images" && images.length) {
      for (const image of images) void removeImage(image);
    }
    setYoutubeUrl("");
    setMediaMode(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const idempotencyKey = `ask:web:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
      const quoteBody = {
        visibility: "public" as const,
        dataClassification: classification,
        ...(classification === "redacted" ? { redactionSummary: redactionSummary.trim() } : {}),
        confirmedNoSensitiveData: true,
        audience: { admissionPolicyHash: SANDBOX_POLICY_HASH, source: "sandbox" as const },
        budget: { attemptReserveAtomic: reserve, bountyAtomic: bounty, feeBps },
        question:
          kind === "binary"
            ? {
                kind,
                prompt: prompt.trim(),
                positiveLabel: positiveLabel.trim(),
                negativeLabel: negativeLabel.trim(),
                rationale: { mode: "optional" as const },
                ...(mediaMode === "images"
                  ? {
                      media: {
                        kind: "images" as const,
                        items: images.map(({ alt, assetId, digest }) => ({ alt: alt.trim(), assetId, digest })),
                      },
                    }
                  : mediaMode === "youtube" && youtubeMedia
                    ? { media: youtubeMedia }
                    : {}),
              }
            : {
                kind,
                prompt: prompt.trim(),
                optionA: { key: "a", label: optionA.trim() },
                optionB: { key: "b", label: optionB.trim() },
                rationale: { mode: "optional" as const },
                ...(mediaMode === "images"
                  ? {
                      media: {
                        kind: "images" as const,
                        items: images.map(({ alt, assetId, digest }) => ({ alt: alt.trim(), assetId, digest })),
                      },
                    }
                  : mediaMode === "youtube" && youtubeMedia
                    ? { media: youtubeMedia }
                    : {}),
              },
        requestedPanelSize: panelSize,
      };
      const quote = await readJson(
        await fetch("/api/agent/v1/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(quoteBody),
        }),
      );
      const ask = await readJson(
        await fetch("/api/agent/v1/asks", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ idempotencyKey, quoteId: quote.quoteId, payment: { mode: "prepaid", workspaceId } }),
        }),
      );
      setReceipt({
        operationKey: String(ask.operationKey),
        quoteId: String(quote.quoteId),
        status: String(ask.status),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit the public question.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="surface-card rounded-2xl p-6">
        <h1 className="text-xl font-semibold">Ask a public question</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-base-content/55">
          <span className="pill-active px-3 py-1.5 font-medium">1. Question</span>
          <span className="pill-inactive px-3 py-1.5">2. Privacy &amp; quote</span>
          <span className="pill-inactive px-3 py-1.5">3. Submit</span>
        </div>
      </div>
      <form className="surface-card space-y-6 rounded-2xl p-6" onSubmit={submit}>
        <div className="border-b border-white/10 pb-5">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Public question</p>
          <h2 className="mt-2 text-2xl font-semibold">Ask for an outside judgment</h2>
          <p className="mt-2 text-sm leading-6 text-base-content/60">
            Public questions are discoverable by approved reviewers. Use only public, synthetic, or meaningfully
            redacted content.
          </p>
        </div>
        {!sandboxMode ? (
          <p className="rounded-lg bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
            Public browser publishing is currently enabled in deterministic sandbox mode only. Configure a
            server-provided public admission policy before funding a live panel.
          </p>
        ) : null}
        <label className="block text-sm text-base-content/60">
          Funding workspace
          <select
            className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
            value={workspaceId}
            onChange={event => {
              for (const image of images) void removeImage(image);
              setWorkspaceId(event.target.value);
            }}
          >
            {workspaces.map(workspace => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">Question</legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-base-content/60">
              Format
              <select
                className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={kind}
                onChange={event => setKind(event.target.value as Kind)}
              >
                <option value="binary">Binary</option>
                <option value="head_to_head">Head to head</option>
              </select>
            </label>
            <label className="text-sm text-base-content/60">
              Panel size
              <input
                type="number"
                min={3}
                max={500}
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={panelSize}
                onChange={event => setPanelSize(Number(event.target.value))}
              />
            </label>
          </div>
          <label className="mt-4 block text-sm text-base-content/60">
            Prompt
            <textarea
              className="textarea mt-2 min-h-28 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              maxLength={4000}
              placeholder="Which response should a support team ship?"
            />
          </label>
          <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-base-content">Visual context</p>
                <p className="mt-1 text-xs leading-5 text-base-content/50">
                  Add up to four images or one YouTube video. Media is reviewed with the question.
                </p>
              </div>
              <div className="flex gap-1.5" role="group" aria-label="Visual context type">
                {(["none", "images", "youtube"] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mediaMode === value}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      mediaMode === value ? "pill-active" : "pill-inactive"
                    }`}
                    onClick={() => changeMediaMode(value)}
                  >
                    {value === "none" ? "Text only" : value === "images" ? "Images" : "YouTube"}
                  </button>
                ))}
              </div>
            </div>
            {mediaMode === "images" ? (
              <div className="mt-4 space-y-3">
                {images.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {images.map((image, index) => (
                      <div key={image.assetId} className="surface-card-nested overflow-hidden rounded-xl">
                        {}
                        <img
                          src={image.previewUrl}
                          alt=""
                          className="aspect-video w-full bg-black/20 object-contain"
                          width={image.width}
                          height={image.height}
                        />
                        <div className="space-y-2 p-3">
                          <label className="block text-xs text-base-content/55">
                            Description for image {index + 1}
                            <input
                              className="input input-sm mt-1.5 w-full border-white/10 bg-[var(--rateloop-field)]"
                              value={image.alt}
                              maxLength={500}
                              onChange={event =>
                                setImages(current =>
                                  current.map(item =>
                                    item.assetId === image.assetId ? { ...item, alt: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="text-xs text-red-200 underline underline-offset-4"
                            onClick={() => void removeImage(image)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {images.length < 4 ? (
                  <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 text-center transition-colors hover:border-[var(--rateloop-blue)]/60">
                    <span className="text-sm font-medium">
                      {uploading ? "Processing image…" : "Choose JPG, PNG, or WEBP"}
                    </span>
                    <span className="mt-1 text-xs text-base-content/45">
                      Up to 10 MB each · {4 - images.length} remaining
                    </span>
                    <input
                      type="file"
                      className="sr-only"
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      multiple
                      disabled={!workspaceId || uploading}
                      onChange={event => {
                        if (event.target.files) void uploadImages(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {mediaMode === "youtube" ? (
              <label className="mt-4 block text-sm text-base-content/60">
                YouTube URL
                <input
                  type="url"
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={youtubeUrl}
                  onChange={event => setYoutubeUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                />
                {youtubeUrl && !youtubeMedia ? (
                  <span className="mt-2 block text-xs text-red-200">
                    Enter a supported YouTube watch, share, Shorts, or embed URL.
                  </span>
                ) : youtubeMedia ? (
                  <span className="mt-2 block text-xs text-emerald-200">Video recognized · {youtubeMedia.videoId}</span>
                ) : null}
              </label>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {kind === "binary" ? (
              <>
                <label className="text-sm text-base-content/60">
                  Positive label
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={positiveLabel}
                    onChange={event => setPositiveLabel(event.target.value)}
                  />
                </label>
                <label className="text-sm text-base-content/60">
                  Negative label
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={negativeLabel}
                    onChange={event => setNegativeLabel(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="text-sm text-base-content/60">
                  Option A
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={optionA}
                    onChange={event => setOptionA(event.target.value)}
                  />
                </label>
                <label className="text-sm text-base-content/60">
                  Option B
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={optionB}
                    onChange={event => setOptionB(event.target.value)}
                  />
                </label>
              </>
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
            Privacy and quote
          </legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-base-content/60">
              Data classification
              <select
                className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={classification}
                onChange={event => setClassification(event.target.value as Classification)}
              >
                <option value="public">Public</option>
                <option value="synthetic">Synthetic</option>
                <option value="redacted">Redacted</option>
              </select>
            </label>
            <label className="text-sm text-base-content/60">
              Bounty (USDC atomic units)
              <input
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={bounty}
                onChange={event => setBounty(event.target.value)}
                inputMode="numeric"
              />
            </label>
          </div>
          {classification === "redacted" ? (
            <label className="mt-4 block text-sm text-base-content/60">
              Redaction summary
              <textarea
                className="textarea mt-2 min-h-20 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={redactionSummary}
                onChange={event => setRedactionSummary(event.target.value)}
                maxLength={1000}
                placeholder="Explain which sensitive fields were removed."
              />
            </label>
          ) : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-base-content/60">
              Attempt reserve
              <input
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={reserve}
                onChange={event => setReserve(event.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="text-sm text-base-content/60">
              Fee (basis points)
              <input
                type="number"
                min={0}
                max={2000}
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={feeBps}
                onChange={event => setFeeBps(Number(event.target.value))}
              />
            </label>
          </div>
          <label className="mt-4 flex items-start gap-3 rounded-lg border border-white/10 p-4 text-sm leading-6 text-base-content/65">
            <input
              type="checkbox"
              className="checkbox mt-1"
              checked={confirmed}
              onChange={event => setConfirmed(event.target.checked)}
            />
            <span>
              I confirm this question contains no confidential or restricted material and may be shown to approved
              public reviewers.
            </span>
          </label>
        </fieldset>
        <button type="submit" className="rateloop-gradient-action w-full px-6" disabled={!ready || busy}>
          {busy ? "Quoting and submitting…" : "Create public question"}
        </button>
        {error ? (
          <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
            {error}
          </p>
        ) : null}
        {receipt ? (
          <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-50">
            <p className="font-semibold">Question submitted to the sandbox panel.</p>
            <p className="mt-2">Status: {receipt.status}</p>
            <p className="mt-1 break-all font-mono text-xs text-emerald-100/70">Operation {receipt.operationKey}</p>
            <a
              href={`/rate?q=${encodeURIComponent(prompt)}&scope=public`}
              className="mt-3 inline-block underline underline-offset-4"
            >
              Open Answer queue
            </a>
          </div>
        ) : null}
      </form>
    </div>
  );
}
