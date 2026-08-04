"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChoiceInput, Field, SelectField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { assuranceCapabilityLabel, eligibilityStatusLabel } from "~~/components/tokenless/human/humanStatePresentation";
import { Card } from "~~/components/tokenless/ui/Card";
import { Link } from "~~/i18n/navigation";
import { readBrowserSession } from "~~/lib/auth/client";
import {
  type Dac7FormPolicy,
  type PaidEligibilityFormValues,
  buildPaidEligibilityFormPayload,
  collectsDac7Details,
  normalizedResidenceCountry,
} from "~~/lib/tokenless/paidEligibilityForm";

type EligibilityState = {
  status: "not_started" | "declined" | "eligible" | "review" | "blocked" | "expired";
  blockedReason?: string | null;
  capabilities?: string[];
  assuranceProviders?: string[];
  evidenceExpiresAt?: string;
  dac7Status?: string;
  dac7Policy?: Dac7FormPolicy | null;
  screeningStatus?: string;
  payoutAccount?: string;
};

const initialForm: PaidEligibilityFormValues = {
  declaredResidenceCountry: "",
  taxResidenceCountry: "",
  fullName: "",
  birthDate: "",
  streetAddress: "",
  city: "",
  postalCode: "",
  taxIdentificationKind: "tin",
  tin: "",
  placeOfBirthCity: "",
  placeOfBirthCountry: "",
  sanctionsConsent: false,
};

class EligibilityRequestError extends Error {
  field: string | null;

  constructor(message: string, field: string | null) {
    super(message);
    this.field = field;
  }
}

async function readJson(response: Response, fallbackMessage: string) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new EligibilityRequestError(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : fallbackMessage,
      typeof body.field === "string" ? body.field : null,
    );
  }
  return body;
}

export function PaidEligibilityClient() {
  const t = useTranslations("human.eligibility");
  const [state, setState] = useState<EligibilityState | null>(null);
  const [accountAddress, setAccountAddress] = useState<string | null>(null);
  const [providerState, setProviderState] = useState<string | null>(null);
  const [form, setForm] = useState<PaidEligibilityFormValues>(initialForm);
  const [reviewerSource, setReviewerSource] = useState<"customer_invited" | "rateloop_network">("customer_invited");
  const [workspaceId, setWorkspaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const refresh = useCallback(async () => {
    const session = await readBrowserSession();
    const payoutAddress = session?.wallets.payout ?? null;
    setAccountAddress(payoutAddress);
    if (!payoutAddress) {
      setState({ status: "not_started" });
      return;
    }
    const eligibility = await readJson(
      await fetch("/api/rater/eligibility", { cache: "no-store", credentials: "same-origin" }),
      t("requestFailed"),
    );
    setState(eligibility as EligibilityState);
  }, [t]);

  useEffect(() => {
    const returned = new URL(window.location.href).searchParams.get("eligibility") === "provider-return";
    if (returned) setProviderState(sessionStorage.getItem("rateloop:eligibility-provider-state"));
    void refresh().catch(() => setError(t("loadFailed")));
  }, [refresh, t]);

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
        t("requestFailed"),
      );
      if (typeof body.state !== "string" || typeof body.startUrl !== "string") {
        throw new Error(t("handoffIncomplete"));
      }
      sessionStorage.setItem("rateloop:eligibility-provider-state", body.state);
      window.location.assign(body.startUrl);
    } catch {
      setError(t("providerFailed"));
      setBusy(false);
    }
  }

  function update<K extends keyof PaidEligibilityFormValues>(key: K, value: PaidEligibilityFormValues[K]) {
    setForm(current => ({ ...current, [key]: value }));
    clear(key);
  }

  async function submitUnlock(event: FormEvent) {
    event.preventDefault();
    if (!accountAddress || (reviewerSource === "rateloop_network" && !providerState)) return;
    setBusy(true);
    setError(null);
    clear();
    try {
      await readJson(
        await fetch("/api/rater/eligibility", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildPaidEligibilityFormPayload({
              dac7Policy: state?.dac7Policy ?? null,
              form,
              payoutAccount: accountAddress,
              providerState,
              reviewerSource,
              workspaceId,
            }),
          ),
        }),
        t("requestFailed"),
      );
      sessionStorage.removeItem("rateloop:eligibility-provider-state");
      setProviderState(null);
      window.history.replaceState({}, "", `${window.location.pathname}?section=paid-work`);
      await refresh();
    } catch (cause) {
      capture(cause, t("completeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function keepAdvisoryOnly() {
    if (reviewerSource === "customer_invited" && !workspaceId.trim()) {
      capture(new EligibilityRequestError(t("workspaceRequired"), "workspaceId"), t("advisoryFailed"));
      return;
    }
    setBusy(true);
    setError(null);
    clear();
    try {
      await readJson(
        await fetch("/api/rater/eligibility", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: "declined_paid_data_collection",
            reviewerSource,
            ...(reviewerSource === "customer_invited" ? { workspaceId: workspaceId.trim() } : {}),
          }),
        }),
        t("requestFailed"),
      );
      sessionStorage.removeItem("rateloop:eligibility-provider-state");
      setProviderState(null);
      await refresh();
    } catch (cause) {
      capture(cause, t("advisoryFailed"));
    } finally {
      setBusy(false);
    }
  }

  const eligible = state?.status === "eligible";
  const residenceComplete = normalizedResidenceCountry(form.declaredResidenceCountry) !== null;
  const collectDac7 = collectsDac7Details(form.declaredResidenceCountry, state?.dac7Policy ?? null);

  return (
    <div className="space-y-5">
      <Card as="section" className="rounded-2xl p-6">
        <div className="border-b border-base-content/10 pb-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">{t("eyebrow")}</p>
            <h2 className="mt-2 text-xl font-semibold">{eligibilityStatusLabel(state?.status, t)}</h2>
          </div>
        </div>

        {eligible ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="border-l-2 border-[var(--rateloop-blue)] pl-4">
              <span className="text-xs text-base-content/55">{t("identityAge")}</span>
              <strong className="mt-1 block">{t("verified")}</strong>
            </div>
            <div className="border-l-2 border-[var(--rateloop-green)] pl-4">
              <span className="text-xs text-base-content/55">{t("taxDac7")}</span>
              <strong className="mt-1 block">
                {state.dac7Status === "complete" ? t("complete") : t("notRequired")}
              </strong>
            </div>
            <div className="border-l-2 border-[var(--rateloop-yellow)] pl-4">
              <span className="text-xs text-base-content/55">{t("sanctions")}</span>
              <strong className="mt-1 block">{t("current")}</strong>
            </div>
            <div className="border-l-2 border-[var(--rateloop-pink)] pl-4">
              <span className="text-xs text-base-content/55">{t("payoutWallet")}</span>
              <strong className="mt-1 block break-all text-sm">{state.payoutAccount}</strong>
            </div>
            <div className="border-l-2 border-base-content/20 pl-4 sm:col-span-2">
              <span className="text-xs text-base-content/55">{t("capabilities")}</span>
              <strong className="mt-1 block text-sm font-medium">
                {state.capabilities?.length
                  ? state.capabilities.map(capability => assuranceCapabilityLabel(capability, t)).join(" · ")
                  : t("noCapability")}
              </strong>
            </div>
          </div>
        ) : state?.status === "declined" ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm leading-6 text-base-content/65">{t("declinedDescription")}</p>
            <button
              type="button"
              className="rounded-lg border border-base-content/15 px-4 py-2 text-sm"
              onClick={() => setState({ status: "not_started" })}
            >
              {t("reconsider")}
            </button>
          </div>
        ) : accountAddress && (providerState || reviewerSource === "customer_invited") ? (
          <form className="mt-6 space-y-5" onSubmit={submitUnlock}>
            <p className="text-sm leading-6 text-base-content/60">
              {reviewerSource === "customer_invited" ? t("invitedIntro") : t("networkIntro")}
            </p>
            {reviewerSource === "customer_invited" ? (
              <button
                type="button"
                className="text-sm text-[var(--rateloop-blue)] underline underline-offset-4"
                onClick={() => setReviewerSource("rateloop_network")}
              >
                {t("useNetwork")}
              </button>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {reviewerSource === "customer_invited" ? (
                <div className="sm:col-span-2">
                  <Field
                    label={t("workspaceId")}
                    value={workspaceId}
                    onChange={event => {
                      setWorkspaceId(event.target.value);
                      clear("workspaceId");
                    }}
                    required
                    maxLength={160}
                    error={fieldErrors.workspaceId}
                  />
                </div>
              ) : null}
              <Field
                label={t("residence")}
                className="uppercase"
                format="countryCode"
                value={form.declaredResidenceCountry}
                onChange={event => update("declaredResidenceCountry", event.target.value)}
                required
                error={fieldErrors.declaredResidenceCountry}
              />
              {!residenceComplete ? (
                <p className="self-end pb-3 text-xs leading-5 text-base-content/55">{t("residenceHelp")}</p>
              ) : (
                <>
                  <Field
                    label={t("legalName")}
                    value={form.fullName}
                    onChange={event => update("fullName", event.target.value)}
                    maxLength={300}
                    autoComplete="name"
                    required
                    error={fieldErrors.fullName}
                  />
                  <Field
                    label={t("birthDate")}
                    type="date"
                    value={form.birthDate}
                    onChange={event => update("birthDate", event.target.value)}
                    autoComplete="bday"
                    required
                    error={fieldErrors.birthDate}
                  />
                  {collectDac7 ? (
                    <>
                      <Field
                        label={t("taxResidence")}
                        className="uppercase"
                        format="countryCode"
                        value={form.taxResidenceCountry}
                        onChange={event => update("taxResidenceCountry", event.target.value)}
                        required
                        error={fieldErrors.taxResidenceCountry}
                      />
                      <Field
                        label={t("street")}
                        value={form.streetAddress}
                        onChange={event => update("streetAddress", event.target.value)}
                        maxLength={300}
                        autoComplete="street-address"
                        required
                        error={fieldErrors.streetAddress}
                      />
                      <Field
                        label={t("city")}
                        value={form.city}
                        onChange={event => update("city", event.target.value)}
                        maxLength={300}
                        autoComplete="address-level2"
                        required
                        error={fieldErrors.city}
                      />
                      <Field
                        label={t("postalCode")}
                        value={form.postalCode}
                        onChange={event => update("postalCode", event.target.value)}
                        maxLength={40}
                        autoComplete="postal-code"
                        required
                        error={fieldErrors.postalCode}
                      />
                      <SelectField
                        label={t("taxIdType")}
                        value={form.taxIdentificationKind}
                        onChange={event =>
                          update("taxIdentificationKind", event.target.value as "tin" | "place_of_birth")
                        }
                      >
                        <option value="tin">{t("tinOption")}</option>
                        <option value="place_of_birth">{t("birthOption")}</option>
                      </SelectField>
                      {form.taxIdentificationKind === "tin" ? (
                        <Field
                          label={t("tin")}
                          value={form.tin}
                          onChange={event => update("tin", event.target.value)}
                          maxLength={120}
                          autoComplete="off"
                          required
                          error={fieldErrors.tin}
                        />
                      ) : (
                        <>
                          <Field
                            label={t("birthCity")}
                            value={form.placeOfBirthCity}
                            onChange={event => update("placeOfBirthCity", event.target.value)}
                            maxLength={300}
                            required
                            error={fieldErrors.placeOfBirthCity}
                          />
                          <Field
                            label={t("birthCountry")}
                            className="uppercase"
                            format="countryCode"
                            value={form.placeOfBirthCountry}
                            onChange={event => update("placeOfBirthCountry", event.target.value)}
                            required
                            error={fieldErrors.placeOfBirthCountry}
                          />
                        </>
                      )}
                    </>
                  ) : null}
                </>
              )}
            </div>
            {residenceComplete ? (
              <label
                className="flex items-start gap-3 text-sm leading-6 text-base-content/65"
                htmlFor="paid-eligibility-sanctions-consent"
              >
                <ChoiceInput
                  id="paid-eligibility-sanctions-consent"
                  type="checkbox"
                  className="checkbox checkbox-sm mt-1"
                  checked={form.sanctionsConsent}
                  onChange={event => update("sanctionsConsent", event.target.checked)}
                  aria-invalid={fieldErrors.sanctionsConsent ? true : undefined}
                  required
                />
                <span>{t("consent")}</span>
              </label>
            ) : null}
            {fieldErrors.sanctionsConsent ? (
              <p className="text-sm text-error" role="alert">
                {fieldErrors.sanctionsConsent}
              </p>
            ) : null}
            <button className="rateloop-gradient-action w-full px-6" disabled={busy || !residenceComplete}>
              {busy ? t("completing") : t("unlock")}
            </button>
            <button
              type="button"
              className="w-full rounded-lg border border-base-content/15 px-6 py-3 text-sm"
              disabled={busy}
              onClick={() => void keepAdvisoryOnly()}
            >
              {t("keepAdvisory")}
            </button>
            {formError ? (
              <p className="rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
                {formError}
              </p>
            ) : null}
          </form>
        ) : (
          <div className="mt-6">
            <p className="text-sm leading-6 text-base-content/60">
              {state && !accountAddress ? t("walletRequired") : t("choosePath")}
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className={`rounded-lg border px-4 py-3 text-left text-sm ${reviewerSource === "customer_invited" ? "border-[var(--rateloop-green)] bg-success/10" : "border-base-content/10 bg-base-content/[0.03]"}`}
                onClick={() => setReviewerSource("customer_invited")}
              >
                <strong className="block">{t("workspaceInvited")}</strong>
                <span className="mt-1 block text-xs text-base-content/55">{t("workspacePath")}</span>
              </button>
              <button
                type="button"
                className={`rounded-lg border px-4 py-3 text-left text-sm ${reviewerSource === "rateloop_network" ? "border-[var(--rateloop-blue)] bg-sky-300/10" : "border-base-content/10 bg-base-content/[0.03]"}`}
                onClick={() => setReviewerSource("rateloop_network")}
              >
                <strong className="block">{t("network")}</strong>
                <span className="mt-1 block text-xs text-base-content/55">{t("networkPath")}</span>
              </button>
            </div>
            {state && !accountAddress ? (
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/settings/wallets?use=payout" className="rateloop-gradient-action inline-flex px-6">
                  {t("addWallet")}
                </Link>
                {reviewerSource === "rateloop_network" ? (
                  <button
                    type="button"
                    className="rounded-lg border border-base-content/15 px-6 py-3 text-sm"
                    disabled={busy}
                    onClick={() => void keepAdvisoryOnly()}
                  >
                    {t("keepAdvisory")}
                  </button>
                ) : null}
              </div>
            ) : reviewerSource === "rateloop_network" ? (
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rateloop-gradient-action px-6"
                  disabled={busy || !accountAddress}
                  onClick={() => void startProvider()}
                >
                  {busy ? t("opening") : accountAddress ? t("verifyIdentity") : t("checkingAccount")}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-base-content/15 px-6 py-3 text-sm"
                  disabled={busy || !accountAddress}
                  onClick={() => void keepAdvisoryOnly()}
                >
                  {t("keepAdvisory")}
                </button>
              </div>
            ) : null}
          </div>
        )}
        {state?.blockedReason ? (
          <p className="mt-5 rounded-lg bg-warning/10 p-3 text-sm text-warning">
            {state.blockedReason === "legal_eligibility_review" ? t("legalReview") : t("evidenceFailed")}
          </p>
        ) : null}
        {error ? <p className="mt-5 rounded-lg bg-error/10 p-3 text-sm text-error">{error}</p> : null}
      </Card>

      {state?.status !== "declined" ? (
        <Card as="aside" className="rounded-2xl p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-base-content/55">{t("whyNow")}</p>
          <h2 className="mt-2 text-xl font-semibold">{t("noBlockedEarnings")}</h2>
          <p className="mt-4 text-sm leading-6 text-base-content/60">{t("timing")}</p>
          <p className="mt-4 border-l-2 border-[var(--rateloop-yellow)] bg-warning/[0.07] py-2 pl-3 text-xs leading-5 text-base-content/60">
            {t("claimPrivacy")}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
