"use client";

import { useMemo, useState } from "react";
import {
  type TokenlessAskResponse,
  type TokenlessQuoteResponse,
  type TokenlessResult,
  createTokenlessRateLoopClient,
} from "@rateloop/sdk";

const presets = {
  quick: { bountyAtomic: "25000000", attemptReserveAtomic: "5000000", panelSize: 15, label: "Quick pulse" },
  standard: { bountyAtomic: "50000000", attemptReserveAtomic: "10000000", panelSize: 25, label: "Standard panel" },
  deep: { bountyAtomic: "100000000", attemptReserveAtomic: "20000000", panelSize: 40, label: "Deeper read" },
} as const;

function usdc(value: string) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(
    Number(BigInt(value)) / 1_000_000,
  );
}

export function TokenlessAskClient({ sandboxMode }: { sandboxMode: boolean }) {
  const [prompt, setPrompt] = useState("Would this product message make you more likely to try the product?");
  const [tierId, setTierId] = useState("passport");
  const [presetId, setPresetId] = useState<keyof typeof presets>("quick");
  const [quote, setQuote] = useState<TokenlessQuoteResponse | null>(null);
  const [ask, setAsk] = useState<TokenlessAskResponse | null>(null);
  const [result, setResult] = useState<TokenlessResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preset = presets[presetId];
  const client = useMemo(
    () =>
      typeof window === "undefined" ? null : createTokenlessRateLoopClient({ apiBaseUrl: window.location.origin }),
    [],
  );

  async function getQuote() {
    if (!client) return;
    setBusy(true);
    setError(null);
    setAsk(null);
    setResult(null);
    try {
      setQuote(
        await client.quote({
          audience: { tierId },
          budget: { attemptReserveAtomic: preset.attemptReserveAtomic, bountyAtomic: preset.bountyAtomic, feeBps: 750 },
          question: { kind: "binary", prompt, rationale: { mode: "optional" } },
          requestedPanelSize: preset.panelSize,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create quote.");
    } finally {
      setBusy(false);
    }
  }

  async function createAsk() {
    if (!client || !quote || !sandboxMode) return;
    setBusy(true);
    setError(null);
    try {
      const created = await client.ask({
        idempotencyKey: `web:${crypto.randomUUID()}`,
        payment: { mode: "prepaid", workspaceId: "explicit-tokenless-sandbox" },
        quoteId: quote.quoteId,
      });
      setAsk(created);
      const wait = await client.wait({ operationKey: created.operationKey, timeoutMs: 5_000 });
      if (wait.status === "ready") setResult(await client.result({ operationKey: created.operationKey }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create ask.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
      <div className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-sky-300">Three decisions</p>
        <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">Run a paid panel</h1>
        <p className="mt-4 leading-7 text-white/55">Choose the question, audience assurance, and budget preset.</p>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form
          className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.035] p-6"
          onSubmit={event => event.preventDefault()}
        >
          <label className="block">
            <span className="text-sm font-semibold">1. Question</span>
            <textarea
              className="textarea textarea-bordered mt-2 min-h-32 w-full bg-black/30"
              value={prompt}
              maxLength={280}
              onChange={event => {
                setPrompt(event.target.value);
                setQuote(null);
              }}
            />
            <span className="mt-1 block text-xs text-white/40">
              v0 supports one binary decision. A/B uses the same panel mechanism.
            </span>
          </label>

          <label className="block">
            <span className="text-sm font-semibold">2. Audience assurance</span>
            <select
              className="select select-bordered mt-2 w-full bg-black/30"
              value={tierId}
              onChange={event => {
                setTierId(event.target.value);
                setQuote(null);
              }}
            >
              <option value="passport">Passport uniqueness</option>
              <option value="orb">Orb global uniqueness</option>
              <option value="presence">Identity + recent presence</option>
              <option value="selfie">Live human now (not unique)</option>
            </select>
          </label>

          <fieldset>
            <legend className="text-sm font-semibold">3. Budget</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {Object.entries(presets).map(([id, option]) => (
                <button
                  key={id}
                  type="button"
                  className={`rounded-xl border p-3 text-left ${presetId === id ? "border-sky-300 bg-sky-300/10" : "border-white/10 bg-black/20"}`}
                  onClick={() => {
                    setPresetId(id as keyof typeof presets);
                    setQuote(null);
                  }}
                >
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="mt-1 block text-xs text-white/45">
                    {option.panelSize} raters · ${usdc(option.bountyAtomic)} bounty
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            className="btn btn-primary w-full rounded-xl"
            disabled={busy || !prompt.trim()}
            onClick={() => void getQuote()}
          >
            {busy ? "Working…" : "Get itemized quote"}
          </button>
        </form>

        <aside className="rounded-2xl border border-white/10 bg-black/25 p-6">
          <h2 className="text-lg font-semibold">Quote</h2>
          {quote ? (
            <div className="mt-5 space-y-4 text-sm">
              <div className="space-y-2 border-b border-white/10 pb-4">
                <div className="flex justify-between">
                  <span className="text-white/55">Rater bounty</span>
                  <span>${usdc(quote.economics.bounty.fundedAtomic)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/55">Platform fee ({quote.economics.fee.bps / 100}%)</span>
                  <span>${usdc(quote.economics.fee.fundedAtomic)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/55">Max attempt reserve</span>
                  <span>${usdc(quote.economics.attemptReserve.fundedAtomic)}</span>
                </div>
                <div className="flex justify-between pt-2 font-semibold">
                  <span>Total authorized</span>
                  <span>${usdc(quote.economics.totalFundedAtomic)}</span>
                </div>
              </div>
              <p className="rounded-xl bg-white/5 p-3 leading-6 text-white/55">
                No responses: fully refunded. Partial panel: bounty and fee refunded; accepted work up to $
                {usdc(quote.economics.attemptReserve.fundedAtomic)} is paid from the reserve.
              </p>
              <p className="text-xs text-white/40">
                Target: {quote.panel.requestedSize} raters · minimum {quote.panel.minimumReveals} reveals · estimated{" "}
                {Math.round(quote.slo.estimatedSeconds / 60)} min
              </p>
              <button
                type="button"
                className="btn btn-primary w-full rounded-xl"
                disabled={!sandboxMode || busy}
                onClick={() => void createAsk()}
              >
                {sandboxMode ? "Run simulated sandbox panel" : "Payment integration not enabled"}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-white/45">
              Your itemized funding and refund exposure appear here before any payment action.
            </p>
          )}
          {ask ? (
            <p className="mt-4 break-all rounded-lg bg-white/5 p-3 text-xs text-white/55">
              Operation: {ask.operationKey}
            </p>
          ) : null}
          {result ? (
            <p className="mt-3 rounded-lg bg-emerald-400/10 p-3 text-sm text-emerald-100">
              Sandbox result: {result.verdictStatus} · score{" "}
              {result.verdict?.scoreBps ? `${result.verdict.scoreBps / 100}%` : "n/a"}
            </p>
          ) : null}
          {error ? <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
        </aside>
      </div>
    </div>
  );
}
