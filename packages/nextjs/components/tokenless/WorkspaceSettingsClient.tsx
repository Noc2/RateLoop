"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Workspace = {
  workspaceId: string;
  name: string;
  role: string;
  prepaid: { settledAtomic: string; reservedAtomic: string; availableAtomic: string };
};

type ApiKey = {
  apiKeyId: string;
  prefix: string;
  name: string;
  role: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type Webhook = { endpointId: string; url: string; eventTypes: string[]; active: boolean };

type BillingSummary = {
  plan: "free" | "early_access";
  priceVersion: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  usage: { completed: number; reserved: number; limit: number };
  limits: { activeAgents: number; activePrivateGroups: number; paidPanels: boolean };
  canManageBilling: boolean;
  checkoutAvailable: boolean;
  portalAvailable: boolean;
};

type BillingProfile = {
  complete: boolean;
  legalName: string | null;
  registrationNumber: string | null;
  registeredAddress: string | null;
  vatCountryCode: string | null;
  vatId: string | null;
};

class RequestFailure extends Error {
  code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = "RequestFailure";
    this.code = code;
  }
}

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new RequestFailure(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
      typeof body.code === "string" ? body.code : null,
    );
  }
  return body;
}

function usdc(value: string) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(BigInt(value)) / 1_000_000,
  );
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function billingStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export function WorkspaceSettingsClient() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [keyName, setKeyName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingReturn, setBillingReturn] = useState<"" | "success" | "cancelled" | "upgrade">("");
  const [showBillingProfile, setShowBillingProfile] = useState(false);
  const [billingProfileBusy, setBillingProfileBusy] = useState(false);
  const [billingProfileSaved, setBillingProfileSaved] = useState(false);
  const [billingProfile, setBillingProfile] = useState({
    legalName: "",
    registrationNumber: "",
    registeredAddress: "",
    vatCountryCode: "",
    vatId: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspaces = useCallback(async () => {
    const body = await readJson(
      await fetch("/api/account/workspaces", { cache: "no-store", credentials: "same-origin" }),
    );
    const next = body.workspaces as Workspace[];
    setWorkspaces(next);
    setSelectedId(current =>
      current && next.some(workspace => workspace.workspaceId === current) ? current : (next[0]?.workspaceId ?? ""),
    );
  }, []);

  const loadKeys = useCallback(async (workspaceId: string) => {
    if (!workspaceId) {
      setApiKeys([]);
      setWebhooks([]);
      return;
    }
    const [keysBody, webhooksBody] = await Promise.all([
      readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/api-keys`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
      ),
      readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/webhooks`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
      ),
    ]);
    setApiKeys(keysBody.apiKeys as ApiKey[]);
    setWebhooks(webhooksBody.webhooks as Webhook[]);
  }, []);

  const loadBilling = useCallback(async (workspaceId: string) => {
    if (!workspaceId) {
      setBilling(null);
      return null;
    }
    const body = await readJson(
      await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/billing`, {
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
    const next = ((body.billing as BillingSummary | undefined) ?? body) as BillingSummary;
    setBilling(next);
    setBillingError(null);
    return next;
  }, []);

  const loadBillingProfile = useCallback(async (workspaceId: string) => {
    if (!workspaceId) return null;
    const body = (await readJson(
      await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/billing/profile`, {
        cache: "no-store",
        credentials: "same-origin",
      }),
    )) as BillingProfile;
    setBillingProfile({
      legalName: body.legalName ?? "",
      registrationNumber: body.registrationNumber ?? "",
      registeredAddress: body.registeredAddress ?? "",
      vatCountryCode: body.vatCountryCode ?? "",
      vatId: body.vatId ?? "",
    });
    return body;
  }, []);

  useEffect(() => {
    void loadWorkspaces().catch(cause =>
      setError(cause instanceof Error ? cause.message : "Unable to load workspaces."),
    );
  }, [loadWorkspaces]);

  useEffect(() => {
    void loadKeys(selectedId).catch(cause =>
      setError(cause instanceof Error ? cause.message : "Unable to load API keys."),
    );
  }, [loadKeys, selectedId]);

  useEffect(() => {
    void loadBilling(selectedId).catch(cause => {
      setBilling(null);
      setBillingError(cause instanceof Error ? cause.message : "Unable to load billing status.");
    });
  }, [loadBilling, selectedId]);

  useEffect(() => {
    const state = new URLSearchParams(window.location.search).get("billing");
    if (state === "success" || state === "cancelled" || state === "upgrade") setBillingReturn(state);
  }, []);

  useEffect(() => {
    if (billingReturn !== "success" || !selectedId || billing?.plan === "early_access") return;
    let cancelled = false;
    let attempts = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      attempts += 1;
      try {
        const next = await loadBilling(selectedId);
        if (cancelled || next?.plan === "early_access" || attempts >= 6) return;
      } catch {
        if (cancelled || attempts >= 6) return;
      }
      timeout = setTimeout(() => void poll(), 2_000);
    };

    timeout = setTimeout(() => void poll(), 1_000);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [billing?.plan, billingReturn, loadBilling, selectedId]);

  async function openBillingDestination(kind: "checkout" | "portal") {
    if (!selectedId) return;
    setBillingBusy(true);
    setBillingError(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(selectedId)}/billing/${kind}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          ...(kind === "checkout" ? { body: JSON.stringify({ plan: "early_access" }) } : {}),
        }),
      );
      if (typeof body.url !== "string" || !body.url) throw new Error("The billing destination was unavailable.");
      window.location.assign(body.url);
    } catch (cause) {
      setBillingError(cause instanceof Error ? cause.message : "Unable to open billing.");
      if (cause instanceof RequestFailure && cause.code === "billing_profile_required") {
        setShowBillingProfile(true);
        setBillingProfileSaved(false);
        setBillingProfileBusy(true);
        void loadBillingProfile(selectedId)
          .catch(profileCause =>
            setBillingError(profileCause instanceof Error ? profileCause.message : "Unable to load billing details."),
          )
          .finally(() => setBillingProfileBusy(false));
      }
      setBillingBusy(false);
    }
  }

  async function toggleBillingProfile() {
    if (!selectedId) return;
    const next = !showBillingProfile;
    setShowBillingProfile(next);
    setBillingProfileSaved(false);
    if (!next) return;
    setBillingProfileBusy(true);
    setBillingError(null);
    try {
      await loadBillingProfile(selectedId);
    } catch (cause) {
      setBillingError(cause instanceof Error ? cause.message : "Unable to load billing details.");
    } finally {
      setBillingProfileBusy(false);
    }
  }

  async function saveBillingProfile(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setBillingProfileBusy(true);
    setBillingProfileSaved(false);
    setBillingError(null);
    try {
      const body = (await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(selectedId)}/billing/profile`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legalName: billingProfile.legalName,
            registrationNumber: billingProfile.registrationNumber || null,
            registeredAddress: billingProfile.registeredAddress,
            vatCountryCode: billingProfile.vatCountryCode || null,
            vatId: billingProfile.vatId || null,
          }),
        }),
      )) as BillingProfile;
      setBillingProfile({
        legalName: body.legalName ?? "",
        registrationNumber: body.registrationNumber ?? "",
        registeredAddress: body.registeredAddress ?? "",
        vatCountryCode: body.vatCountryCode ?? "",
        vatId: body.vatId ?? "",
      });
      setBillingProfileSaved(true);
    } catch (cause) {
      setBillingError(cause instanceof Error ? cause.message : "Unable to save billing details.");
    } finally {
      setBillingProfileBusy(false);
    }
  }

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await readJson(
        await fetch("/api/account/workspaces", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: workspaceName }),
        }),
      );
      setWorkspaceName("");
      await loadWorkspaces();
      setSelectedId(String(body.workspaceId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function createKey(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(selectedId)}/api-keys`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: keyName, role: "member" }),
        }),
      );
      setNewToken(String(body.token));
      setKeyName("");
      await loadKeys(selectedId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create API key.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(apiKeyId: string) {
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(selectedId)}/api-keys/${encodeURIComponent(apiKeyId)}`,
          { method: "DELETE", credentials: "same-origin" },
        ),
      );
      await loadKeys(selectedId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke API key.");
    } finally {
      setBusy(false);
    }
  }

  async function createWebhook(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(selectedId)}/webhooks`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: webhookUrl, eventTypes: ["result.ready"] }),
        }),
      );
      setNewWebhookSecret(String(body.signingSecret));
      setWebhookUrl("");
      await loadKeys(selectedId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create webhook.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivateWebhook(endpointId: string) {
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(selectedId)}/webhooks/${encodeURIComponent(endpointId)}`,
          {
            method: "DELETE",
            credentials: "same-origin",
          },
        ),
      );
      await loadKeys(selectedId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to deactivate webhook.");
    } finally {
      setBusy(false);
    }
  }

  const selected = workspaces.find(workspace => workspace.workspaceId === selectedId);
  const usageTotal = billing ? billing.usage.completed + billing.usage.reserved : 0;
  const usagePercent = billing?.usage.limit ? Math.min(100, Math.round((usageTotal / billing.usage.limit) * 100)) : 0;
  const billingWarning = ["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(billing?.status ?? "");

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Workspaces</p>
        {workspaces.length ? (
          <>
            <label className="mt-4 block text-sm text-base-content/60">
              Active workspace
              <select
                className="select mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                value={selectedId}
                onChange={event => {
                  setSelectedId(event.target.value);
                  setNewToken(null);
                  setShowBillingProfile(false);
                  setBillingProfileSaved(false);
                }}
              >
                {workspaces.map(workspace => (
                  <option key={workspace.workspaceId} value={workspace.workspaceId}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            <section
              aria-labelledby="workspace-plan"
              className="mt-6 rounded-xl border border-white/10 bg-base-content/[0.025] p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
                    Workspace subscription
                  </p>
                  <h2 id="workspace-plan" className="mt-2 text-2xl font-semibold">
                    {billing ? (billing.plan === "early_access" ? "Early Access" : "Free") : "Plan and usage"}
                  </h2>
                </div>
                {billing ? (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${billingWarning ? "bg-amber-300/10 text-amber-100" : "bg-base-content/[0.08] text-base-content/65"}`}
                  >
                    {billingStatusLabel(billing.status)}
                  </span>
                ) : null}
              </div>

              {billingReturn === "success" ? (
                <div className="mt-4 rounded-lg border border-[var(--rateloop-green)]/30 bg-[var(--rateloop-green)]/[0.07] p-3 text-sm leading-6 text-base-content/75">
                  Checkout received. Your plan activates after payment confirmation.
                </div>
              ) : null}
              {billingReturn === "cancelled" ? (
                <div className="mt-4 rounded-lg bg-base-content/[0.05] p-3 text-sm text-base-content/65">
                  Checkout was cancelled. Your current plan has not changed.
                </div>
              ) : null}
              {billingWarning ? (
                <div className="mt-4 rounded-lg border border-amber-300/25 bg-amber-300/[0.07] p-3 text-sm leading-6 text-amber-50">
                  Payment needs attention. Existing accepted work can finish; update the payment method to keep starting
                  Early Access work.
                </div>
              ) : null}
              {billing?.cancelAtPeriodEnd ? (
                <div className="mt-4 rounded-lg bg-base-content/[0.05] p-3 text-sm leading-6 text-base-content/65">
                  Cancellation is scheduled for {dateLabel(billing.periodEnd)}. Early Access remains active through that
                  date.
                </div>
              ) : null}

              {billing ? (
                <>
                  <div className="mt-5 flex items-end justify-between gap-4 text-sm">
                    <div>
                      <span className="text-2xl font-semibold">{billing.usage.completed}</span>
                      <span className="text-base-content/45"> completed</span>
                      {billing.usage.reserved ? (
                        <span className="text-base-content/45"> · {billing.usage.reserved} reserved</span>
                      ) : null}
                    </div>
                    <span className="text-base-content/50">{billing.usage.limit} limit</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Workspace review decision usage"
                    aria-valuemin={0}
                    aria-valuemax={billing.usage.limit}
                    aria-valuenow={usageTotal}
                    className="mt-3 h-2 overflow-hidden rounded-full bg-base-content/10"
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--rateloop-blue)] to-[var(--rateloop-green)]"
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                  <div className="mt-4 grid gap-2 text-xs text-base-content/50 sm:grid-cols-3">
                    <span>
                      {billing.limits.activeAgents} active {billing.limits.activeAgents === 1 ? "agent" : "agents"}
                    </span>
                    <span>
                      {billing.limits.activePrivateGroups} active private{" "}
                      {billing.limits.activePrivateGroups === 1 ? "group" : "groups"}
                    </span>
                    <span>{billing.limits.paidPanels ? "Paid panels available" : "Private unpaid reviews"}</span>
                  </div>
                  {billing.periodEnd ? (
                    <p className="mt-3 text-xs text-base-content/40">
                      Current usage period ends {dateLabel(billing.periodEnd)}.
                    </p>
                  ) : null}
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    {billing.canManageBilling && billing.plan === "free" ? (
                      <button
                        type="button"
                        className="rateloop-gradient-action min-h-10 px-4"
                        disabled={billingBusy || !billing.checkoutAvailable}
                        onClick={() => void openBillingDestination("checkout")}
                      >
                        {billing.checkoutAvailable ? "Upgrade to Early Access" : "Billing is not enabled yet"}
                      </button>
                    ) : null}
                    {billing.canManageBilling && billing.portalAvailable && !billing.checkoutAvailable ? (
                      <button
                        type="button"
                        className="btn min-h-10 rounded-lg border border-base-content/15 bg-base-content/[0.07] px-4 hover:bg-base-content/[0.12]"
                        disabled={billingBusy}
                        onClick={() => void openBillingDestination("portal")}
                      >
                        Manage billing
                      </button>
                    ) : null}
                    {billingReturn === "success" ? (
                      <button
                        type="button"
                        className="text-sm font-semibold underline decoration-base-content/35 underline-offset-4"
                        disabled={billingBusy}
                        onClick={() => void loadBilling(selectedId)}
                      >
                        Refresh status
                      </button>
                    ) : null}
                    {billing.canManageBilling ? (
                      <button
                        type="button"
                        className="text-sm text-base-content/60 underline decoration-base-content/30 underline-offset-4 hover:text-base-content"
                        disabled={billingProfileBusy}
                        aria-expanded={showBillingProfile}
                        onClick={() => void toggleBillingProfile()}
                      >
                        {showBillingProfile ? "Close billing details" : "Business billing details"}
                      </button>
                    ) : null}
                    <Link
                      href="/pricing"
                      className="text-sm text-base-content/60 underline decoration-base-content/30 underline-offset-4 hover:text-base-content"
                    >
                      Compare plans
                    </Link>
                  </div>
                  {billing.canManageBilling && showBillingProfile ? (
                    <form
                      className="mt-5 rounded-lg border border-white/10 bg-black/10 p-4"
                      onSubmit={saveBillingProfile}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">Business billing details</h3>
                          <p className="mt-1 text-xs leading-5 text-base-content/45">
                            Self-declared details used for Checkout, invoices, and tax handling. This is not an external
                            identity or company verification.
                          </p>
                        </div>
                        {billingProfileSaved ? (
                          <span className="rounded-full bg-[var(--rateloop-green)]/10 px-2.5 py-1 text-xs text-[var(--rateloop-green)]">
                            Saved
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label className="text-xs text-base-content/55 sm:col-span-2">
                          Legal business name
                          <input
                            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                            value={billingProfile.legalName}
                            onChange={event =>
                              setBillingProfile(current => ({ ...current, legalName: event.target.value }))
                            }
                            maxLength={200}
                            autoComplete="organization"
                            required
                          />
                        </label>
                        <label className="text-xs text-base-content/55 sm:col-span-2">
                          Registration number <span className="text-base-content/35">(optional)</span>
                          <input
                            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                            value={billingProfile.registrationNumber}
                            onChange={event =>
                              setBillingProfile(current => ({ ...current, registrationNumber: event.target.value }))
                            }
                            maxLength={120}
                          />
                        </label>
                        <label className="text-xs text-base-content/55 sm:col-span-2">
                          Registered address
                          <textarea
                            className="textarea mt-1.5 min-h-20 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                            value={billingProfile.registeredAddress}
                            onChange={event =>
                              setBillingProfile(current => ({ ...current, registeredAddress: event.target.value }))
                            }
                            maxLength={500}
                            autoComplete="street-address"
                            required
                          />
                        </label>
                        <label className="text-xs text-base-content/55">
                          VAT country <span className="text-base-content/35">(optional)</span>
                          <input
                            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] uppercase"
                            value={billingProfile.vatCountryCode}
                            onChange={event =>
                              setBillingProfile(current => ({
                                ...current,
                                vatCountryCode: event.target.value.toUpperCase(),
                              }))
                            }
                            placeholder="DE"
                            aria-describedby="vat-pair-hint"
                            pattern="[A-Za-z]{2}"
                            maxLength={2}
                          />
                        </label>
                        <label className="text-xs text-base-content/55">
                          VAT ID <span className="text-base-content/35">(optional)</span>
                          <input
                            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                            value={billingProfile.vatId}
                            onChange={event =>
                              setBillingProfile(current => ({ ...current, vatId: event.target.value }))
                            }
                            placeholder="DE123456789"
                            aria-describedby="vat-pair-hint"
                            maxLength={80}
                          />
                        </label>
                      </div>
                      <p id="vat-pair-hint" className="mt-2 text-xs text-base-content/40">
                        Provide both VAT country and VAT ID, or leave both empty.
                      </p>
                      <button
                        type="submit"
                        className="rateloop-gradient-action mt-4 min-h-10 px-4"
                        disabled={billingProfileBusy}
                      >
                        {billingProfileBusy ? "Saving…" : "Save billing details"}
                      </button>
                    </form>
                  ) : null}
                  {!billing.canManageBilling ? (
                    <p className="mt-4 text-xs leading-5 text-base-content/45">
                      Workspace owners and billing members can change the subscription.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-4 text-sm text-base-content/50">{billingError ?? "Loading subscription and usage…"}</p>
              )}
              {billingError && billing ? <p className="mt-4 text-sm text-red-100">{billingError}</p> : null}
            </section>

            {selected ? (
              <section aria-labelledby="panel-funding" className="mt-5 rounded-xl border border-white/10 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
                      Separate from subscription billing
                    </p>
                    <h2 id="panel-funding" className="mt-2 text-xl font-semibold">
                      Panel funding
                    </h2>
                  </div>
                  <Link href="/pricing" className="text-xs text-base-content/45 underline underline-offset-4">
                    How panel costs work
                  </Link>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-center">
                  <div>
                    <span className="block text-lg font-semibold">${usdc(selected.prepaid.settledAtomic)}</span>
                    <span className="text-xs text-base-content/45">Settled USDC</span>
                  </div>
                  <div>
                    <span className="block text-lg font-semibold">${usdc(selected.prepaid.reservedAtomic)}</span>
                    <span className="text-xs text-base-content/45">Reserved USDC</span>
                  </div>
                  <div>
                    <span className="block text-lg font-semibold">${usdc(selected.prepaid.availableAtomic)}</span>
                    <span className="text-xs text-base-content/45">Available USDC</span>
                  </div>
                </div>
              </section>
            ) : null}
            <h2 className="mt-7 text-xl font-semibold">Agent API keys</h2>
            <p className="mt-2 text-sm leading-6 text-base-content/50">
              Keys are shown once. RateLoop stores only a cryptographic hash.
            </p>
            <form className="mt-4 flex gap-2" onSubmit={createKey}>
              <input
                className="input min-w-0 flex-1 rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                value={keyName}
                onChange={event => setKeyName(event.target.value)}
                placeholder="Production agent"
                maxLength={120}
                required
              />
              <button className="rateloop-gradient-action px-4" disabled={busy}>
                Create
              </button>
            </form>
            {newToken ? (
              <div className="mt-4 border-l-2 border-[var(--rateloop-yellow)] bg-amber-300/[0.07] p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-100">Copy now — shown once</p>
                <code className="mt-2 block break-all text-xs text-base-content/75">{newToken}</code>
                <button
                  type="button"
                  className="mt-3 text-xs underline"
                  onClick={() => void navigator.clipboard.writeText(newToken)}
                >
                  Copy key
                </button>
              </div>
            ) : null}
            <div className="mt-5 space-y-2">
              {apiKeys.map(key => (
                <div
                  key={key.apiKeyId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 p-3 text-sm"
                >
                  <div className="min-w-0">
                    <span className="block truncate font-medium">{key.name}</span>
                    <code className="text-xs text-base-content/45">{key.prefix}…</code>
                  </div>
                  {key.revokedAt ? (
                    <span className="text-xs text-base-content/40">Revoked</span>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-red-200 underline"
                      disabled={busy}
                      onClick={() => void revokeKey(key.apiKeyId)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-8 border-t border-white/10 pt-7">
              <h2 className="text-xl font-semibold">Result webhooks</h2>
              <p className="mt-2 text-sm leading-6 text-base-content/50">
                Register HTTPS destinations before attaching them to an ask. Delivery secrets are shown once.
              </p>
              <form className="mt-4 flex gap-2" onSubmit={createWebhook}>
                <input
                  type="url"
                  className="input min-w-0 flex-1 rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  value={webhookUrl}
                  onChange={event => setWebhookUrl(event.target.value)}
                  placeholder="https://agent.example/webhooks/rateloop"
                  required
                />
                <button className="rateloop-gradient-action px-4" disabled={busy}>
                  Add
                </button>
              </form>
              {newWebhookSecret ? (
                <div className="mt-4 border-l-2 border-[var(--rateloop-yellow)] bg-amber-300/[0.07] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-100">
                    Signing secret · shown once
                  </p>
                  <code className="mt-2 block break-all text-xs text-base-content/75">{newWebhookSecret}</code>
                  <button
                    type="button"
                    className="mt-3 text-xs underline"
                    onClick={() => void navigator.clipboard.writeText(newWebhookSecret)}
                  >
                    Copy secret
                  </button>
                </div>
              ) : null}
              <div className="mt-4 space-y-2">
                {webhooks.map(webhook => (
                  <div
                    key={webhook.endpointId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="block truncate font-medium">{webhook.url}</span>
                      <span className="text-xs text-base-content/45">{webhook.eventTypes.join(" · ")}</span>
                    </div>
                    {webhook.active ? (
                      <button
                        type="button"
                        className="text-xs text-red-200 underline"
                        disabled={busy}
                        onClick={() => void deactivateWebhook(webhook.endpointId)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <span className="text-xs text-base-content/40">Inactive</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm leading-6 text-base-content/50">
            Create a workspace to fund panels and issue agent API keys.
          </p>
        )}
      </section>

      <aside className="surface-card rounded-2xl p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">New workspace</p>
        <form className="mt-4" onSubmit={createWorkspace}>
          <input
            className="input w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
            value={workspaceName}
            onChange={event => setWorkspaceName(event.target.value)}
            placeholder="Team or project name"
            maxLength={120}
            required
          />
          <button className="rateloop-gradient-action mt-3 w-full px-5" disabled={busy}>
            Create workspace
          </button>
        </form>
        <p className="mt-4 text-xs leading-5 text-base-content/45">
          Prepaid funds are usable only after settlement. Reserved amounts cannot be double-spent.
        </p>
        {error ? <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
      </aside>
    </div>
  );
}
