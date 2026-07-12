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
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <div className="max-w-3xl border-l-2 border-[var(--rateloop-blue)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Submit</p>
        <h1 className="display-section mt-3 text-4xl sm:text-5xl">Run a paid panel</h1>
        <p className="mt-4 text-lg leading-8 text-base-content/60">
          Make three clear decisions. Review every funded dollar before authorizing the panel.
        </p>
      </div>

      <div className="mt-10 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form className="rateloop-surface-card space-y-7 p-5 sm:p-7" onSubmit={event => event.preventDefault()}>
          <label className="block">
            <span className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">
              01 · Question
            </span>
            <textarea
              className="textarea mt-3 min-h-36 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] text-base leading-7 focus:border-white/25 focus:outline-none"
              value={prompt}
              maxLength={280}
              onChange={event => {
                setPrompt(event.target.value);
                setQuote(null);
              }}
            />
            <span className="mt-2 block text-xs text-base-content/45">
              Ask one focused binary decision. A/B panels use the same sealed workflow.
            </span>
          </label>

          <label className="block">
            <span className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
              02 · Audience assurance
            </span>
            <select
              className="select mt-3 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] focus:border-white/25 focus:outline-none"
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
            <legend className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
              03 · Budget
            </legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {Object.entries(presets).map(([id, option]) => (
                <button
                  key={id}
                  type="button"
                  className={`rounded-lg border p-4 text-left transition-colors ${presetId === id ? "border-base-content/55 bg-base-content/[0.1]" : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-white/[0.04]"}`}
                  onClick={() => {
                    setPresetId(id as keyof typeof presets);
                    setQuote(null);
                  }}
                >
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="mt-1.5 block text-xs leading-5 text-base-content/45">
                    {option.panelSize} raters · ${usdc(option.bountyAtomic)} bounty
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            className="rateloop-gradient-action w-full px-6"
            disabled={busy || !prompt.trim()}
            onClick={() => void getQuote()}
          >
            {busy ? "Working…" : "Get itemized quote"}
          </button>
        </form>

        <aside className="rateloop-surface-card sticky top-24 p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">Funding summary</p>
          <h2 className="mt-2 text-xl font-semibold">Itemized quote</h2>
          {quote ? (
            <div className="mt-5 space-y-4 text-sm">
              <div className="space-y-3 border-b border-white/10 pb-4">
                <div className="flex justify-between">
                  <span className="text-base-content/55">Rater bounty</span>
                  <span>${usdc(quote.economics.bounty.fundedAtomic)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/55">Platform fee ({quote.economics.fee.bps / 100}%)</span>
                  <span>${usdc(quote.economics.fee.fundedAtomic)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/55">Accepted-work reserve</span>
                  <span>${usdc(quote.economics.attemptReserve.fundedAtomic)}</span>
                </div>
                <div className="flex justify-between pt-2 font-semibold">
                  <span>Total authorized</span>
                  <span>${usdc(quote.economics.totalFundedAtomic)}</span>
                </div>
              </div>
              <p className="border-l-2 border-[var(--rateloop-yellow)] bg-white/[0.035] py-2 pl-4 leading-6 text-base-content/60">
                No responses: fully refunded. Partial panel: bounty and fee refunded; accepted work up to $
                {usdc(quote.economics.attemptReserve.fundedAtomic)} is paid from the reserve.
              </p>
              <p className="text-xs leading-5 text-base-content/45">
                Target: {quote.panel.requestedSize} raters · minimum {quote.panel.minimumReveals} reveals · estimated{" "}
                {Math.round(quote.slo.estimatedSeconds / 60)} min
              </p>
              <button
                type="button"
                className="rateloop-gradient-action w-full px-5"
                disabled={!sandboxMode || busy}
                onClick={() => void createAsk()}
              >
                {sandboxMode ? "Start preview panel" : "Fund and start panel"}
              </button>
            </div>
          ) : (
            <p className="mt-5 text-sm leading-6 text-base-content/45">
              Your itemized funding and refund exposure appear here before any payment action.
            </p>
          )}
          {ask ? (
            <p className="mt-4 break-all rounded-lg bg-white/5 p-3 text-xs text-base-content/55">
              Operation: {ask.operationKey}
            </p>
          ) : null}
          {result ? (
            <p className="mt-3 border-l-2 border-[var(--rateloop-green)] bg-emerald-400/10 py-2 pl-3 text-sm text-emerald-100">
              Result: {result.verdictStatus} · score{" "}
              {result.verdict?.scoreBps ? `${result.verdict.scoreBps / 100}%` : "n/a"}
            </p>
          ) : null}
          {error ? <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
        </aside>
      </div>
    </div>
  );
}
