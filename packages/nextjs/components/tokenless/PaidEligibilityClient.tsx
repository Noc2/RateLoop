"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { readBrowserSession } from "~~/lib/auth/client";

type EligibilityState = {
  status: "not_started" | "eligible" | "review" | "blocked" | "expired";
  blockedReason?: string | null;
  capabilities?: string[];
  assuranceProviders?: string[];
  evidenceExpiresAt?: string;
  dac7Status?: string;
  screeningStatus?: string;
  payoutAccount?: string;
};

type UnlockForm = {
  declaredResidenceCountry: string;
  taxResidenceCountry: string;
  fullName: string;
  birthDate: string;
  streetAddress: string;
  city: string;
  postalCode: string;
  tin: string;
  noTinReason: string;
  sanctionsConsent: boolean;
};

const initialForm: UnlockForm = {
  declaredResidenceCountry: "DE",
  taxResidenceCountry: "DE",
  fullName: "",
  birthDate: "",
  streetAddress: "",
  city: "",
  postalCode: "",
  tin: "",
  noTinReason: "",
  sanctionsConsent: false,
};

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : "Eligibility request failed.",
    );
  }
  return body;
}

function statusLabel(state: EligibilityState | null) {
  if (!state) return "Checking…";
  if (state.status === "eligible") return "Paid tasks unlocked";
  if (state.status === "review") return "Eligibility review";
  if (state.status === "blocked") return "Paid tasks unavailable";
  if (state.status === "expired") return "Verification expired";
  return "Not started";
}

function formatCapability(value: string) {
  return value.replaceAll("_", " ");
}

export function PaidEligibilityClient() {
  const [state, setState] = useState<EligibilityState | null>(null);
  const [accountAddress, setAccountAddress] = useState<string | null>(null);
  const [providerState, setProviderState] = useState<string | null>(null);
  const [form, setForm] = useState<UnlockForm>(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const session = await readBrowserSession();
    const payoutAddress = session?.wallets.payout ?? null;
    setAccountAddress(payoutAddress);
    if (!payoutAddress) {
      setState({ status: "not_started" });
      return;
    }
    const eligibility = await readJson(
      await fetch("/api/rater/eligibility", { cache: "no-store", credentials: "same-origin" }),
    );
    setState(eligibility as EligibilityState);
  }

  useEffect(() => {
    const returned = new URL(window.location.href).searchParams.get("eligibility") === "provider-return";
    if (returned) setProviderState(sessionStorage.getItem("rateloop:eligibility-provider-state"));
    void refresh().catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load eligibility."));
  }, []);

  async function startProvider() {
    setBusy(true);
    setError(null);
    try {
      const body = await readJson(
        await fetch("/api/rater/eligibility/provider/start", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
      if (typeof body.state !== "string" || typeof body.startUrl !== "string") {
        throw new Error("Identity provider handoff was incomplete.");
      }
      sessionStorage.setItem("rateloop:eligibility-provider-state", body.state);
      window.location.assign(body.startUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open identity provider.");
      setBusy(false);
    }
  }

  function update<K extends keyof UnlockForm>(key: K, value: UnlockForm[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  async function submitUnlock(event: FormEvent) {
    event.preventDefault();
    if (!providerState || !accountAddress) return;
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch("/api/rater/eligibility", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerState,
            sanctionsConsent: form.sanctionsConsent,
            declaredResidenceCountry: form.declaredResidenceCountry.toUpperCase(),
            taxResidenceCountry: form.taxResidenceCountry.toUpperCase(),
            payoutAccount: accountAddress,
            dac7: {
              fullName: form.fullName,
              birthDate: form.birthDate,
              streetAddress: form.streetAddress,
              city: form.city,
              postalCode: form.postalCode,
              ...(form.tin ? { tin: form.tin } : { noTinReason: form.noTinReason }),
            },
          }),
        }),
      );
      sessionStorage.removeItem("rateloop:eligibility-provider-state");
      setProviderState(null);
      window.history.replaceState({}, "", "/human?tab=profile&section=paid-work");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete paid-task eligibility.");
    } finally {
      setBusy(false);
    }
  }

  const eligible = state?.status === "eligible";

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">Paid-task access</p>
            <h2 className="mt-2 text-xl font-semibold">{statusLabel(state)}</h2>
          </div>
          <span
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${eligible ? "bg-emerald-300/10 text-emerald-100" : "bg-white/[0.05] text-base-content/55"}`}
          >
            {eligible ? "Capability checked" : (state?.status ?? "checking")}
          </span>
        </div>

        {eligible ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="border-l-2 border-[var(--rateloop-blue)] pl-4">
              <span className="text-xs text-base-content/45">Identity & age</span>
              <strong className="mt-1 block">Verified</strong>
            </div>
            <div className="border-l-2 border-[var(--rateloop-green)] pl-4">
              <span className="text-xs text-base-content/45">Tax / DAC7</span>
              <strong className="mt-1 block">{state.dac7Status === "complete" ? "Complete" : "Not required"}</strong>
            </div>
            <div className="border-l-2 border-[var(--rateloop-yellow)] pl-4">
              <span className="text-xs text-base-content/45">Sanctions screening</span>
              <strong className="mt-1 block">Current</strong>
            </div>
            <div className="border-l-2 border-[var(--rateloop-pink)] pl-4">
              <span className="text-xs text-base-content/45">Payout wallet</span>
              <strong className="mt-1 block break-all text-sm">{state.payoutAccount}</strong>
            </div>
            <div className="border-l-2 border-white/20 pl-4 sm:col-span-2">
              <span className="text-xs text-base-content/45">Current assurance capabilities</span>
              <strong className="mt-1 block text-sm font-medium capitalize">
                {state.capabilities?.length
                  ? state.capabilities.map(formatCapability).join(" · ")
                  : "No provider claim exposed"}
              </strong>
            </div>
          </div>
        ) : providerState ? (
          <form className="mt-6 space-y-5" onSubmit={submitUnlock}>
            <p className="text-sm leading-6 text-base-content/60">
              Identity verification returned successfully. Complete the legal and payout fields before any paid voucher
              can be issued.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-base-content/60">
                Residence country
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] uppercase"
                  value={form.declaredResidenceCountry}
                  onChange={event => update("declaredResidenceCountry", event.target.value)}
                  minLength={2}
                  maxLength={2}
                  required
                />
              </label>
              <label className="text-sm text-base-content/60">
                Tax residence country
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] uppercase"
                  value={form.taxResidenceCountry}
                  onChange={event => update("taxResidenceCountry", event.target.value)}
                  minLength={2}
                  maxLength={2}
                  required
                />
              </label>
              <label className="text-sm text-base-content/60">
                Legal name
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={form.fullName}
                  onChange={event => update("fullName", event.target.value)}
                  maxLength={300}
                  required
                />
              </label>
              <label className="text-sm text-base-content/60">
                Birth date
                <input
                  type="date"
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={form.birthDate}
                  onChange={event => update("birthDate", event.target.value)}
                  required
                />
              </label>
              <label className="text-sm text-base-content/60">
                Street address
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={form.streetAddress}
                  onChange={event => update("streetAddress", event.target.value)}
                  maxLength={300}
                  required
                />
              </label>
              <label className="text-sm text-base-content/60">
                City
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={form.city}
                  onChange={event => update("city", event.target.value)}
                  maxLength={300}
                  required
                />
              </label>
              <label className="text-sm text-base-content/60">
                Postal code
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={form.postalCode}
                  onChange={event => update("postalCode", event.target.value)}
                  maxLength={40}
                  required
                />
              </label>
              <label className="text-sm text-base-content/60">
                Tax identification number
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={form.tin}
                  onChange={event => update("tin", event.target.value)}
                  maxLength={120}
                />
              </label>
              <label className="text-sm text-base-content/60">
                If no TIN, reason
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={form.noTinReason}
                  onChange={event => update("noTinReason", event.target.value)}
                  maxLength={300}
                />
              </label>
            </div>
            <label className="flex items-start gap-3 text-sm leading-6 text-base-content/65">
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-1"
                checked={form.sanctionsConsent}
                onChange={event => update("sanctionsConsent", event.target.checked)}
                required
              />
              <span>
                I consent to eligibility and sanctions screening for paid work. Screening affects future vouchers only
                and never an already accepted payment.
              </span>
            </label>
            <button className="rateloop-gradient-action w-full px-6" disabled={busy}>
              {busy ? "Completing…" : "Unlock paid tasks"}
            </button>
          </form>
        ) : (
          <div className="mt-6">
            <p className="text-sm leading-6 text-base-content/60">
              {state && !accountAddress
                ? "Add a payout wallet before starting paid-work verification. Private assignments remain available without one."
                : "Verify identity, age, and residence with the configured provider. Tax details and sanctions consent are collected only after that handoff succeeds."}
            </p>
            {state && !accountAddress ? (
              <Link href="/settings/wallets?use=payout" className="rateloop-gradient-action mt-5 inline-flex px-6">
                Add payout wallet
              </Link>
            ) : (
              <button
                type="button"
                className="rateloop-gradient-action mt-5 px-6"
                disabled={busy || !accountAddress}
                onClick={() => void startProvider()}
              >
                {busy ? "Opening provider…" : accountAddress ? "Verify identity" : "Checking account…"}
              </button>
            )}
          </div>
        )}
        {state?.blockedReason ? (
          <p className="mt-5 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">
            {state.blockedReason === "legal_eligibility_review"
              ? "Paid eligibility needs neutral legal review. You can continue advisory calibration while the review is open."
              : "Paid eligibility could not be completed with the current evidence."}
          </p>
        ) : null}
        {error ? <p className="mt-5 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
      </section>

      <aside className="surface-card rounded-2xl p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">Why this happens now</p>
        <h2 className="mt-2 text-xl font-semibold">No blocked earnings later</h2>
        <p className="mt-4 text-sm leading-6 text-base-content/60">
          Every paid-work gate is complete before the first voucher. Browsing and advisory calibration remain available
          without this step.
        </p>
        <p className="mt-4 border-l-2 border-[var(--rateloop-yellow)] bg-amber-300/[0.07] py-2 pl-3 text-xs leading-5 text-base-content/60">
          Normal claims publicly link a one-time vote key to its per-round payout destination. Recovery stays
          client-controlled.
        </p>
      </aside>
    </div>
  );
}
