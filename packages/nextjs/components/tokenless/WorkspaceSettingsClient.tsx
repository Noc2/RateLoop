"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { InfoPopover } from "~~/components/tokenless/InfoPopover";
import { WorkspaceRequestScope } from "~~/lib/tokenless/workspaceRequestScope";

type Workspace = {
  workspaceId: string;
  name: string;
  role: string;
  prepaid: { settledAtomic: string; reservedAtomic: string; availableAtomic: string };
};

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
  billingAddress: {
    country: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    postalCode: string | null;
    state: string | null;
  };
};

type PrepaidTopups = {
  enabled: boolean;
  topups: Array<{
    topupId: string;
    amountUsd: string;
    state: "draft" | "sent" | "paid" | "credited" | "failed";
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
    invoiceNumber: string | null;
    requestedAt: string | null;
  }>;
  ledger: Array<{
    entryId: string;
    amountAtomic: string;
    source: string;
    reference: string | null;
    settledAt: string | null;
  }>;
  reservations: Array<{ reservationId: string; amountAtomic: string; status: string; createdAt: string | null }>;
};

type WorkspaceIdentity = {
  enabled: boolean;
  providers: Array<{
    providerId: string;
    protocol: "oidc" | "saml";
    domain: string;
    domainVerified: boolean;
    enforceSso: boolean;
    lastSsoAt: string | null;
  }>;
  scim: Array<{
    providerId: string;
    lastSyncAt: string | null;
    lastSyncResult: string | null;
  }>;
  limitations: { scimGroups: false };
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

function signedUsdc(value: string) {
  const atomic = BigInt(value);
  return `${atomic >= 0n ? "+" : "-"}$${usdc((atomic >= 0n ? atomic : -atomic).toString())}`;
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

export function WorkspaceSettingsClient({ initialWorkspaceId = "" }: { initialWorkspaceId?: string }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
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
    billingCountryCode: "",
    billingAddressLine1: "",
    billingAddressLine2: "",
    billingCity: "",
    billingPostalCode: "",
    billingState: "",
  });
  const [topups, setTopups] = useState<PrepaidTopups | null>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupError, setTopupError] = useState<string | null>(null);
  const [showIdentity, setShowIdentity] = useState(false);
  const [identity, setIdentity] = useState<WorkspaceIdentity | null>(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityToken, setIdentityToken] = useState<string | null>(null);
  const [identityEndpoint, setIdentityEndpoint] = useState<string | null>(null);
  const [identityForm, setIdentityForm] = useState({
    providerId: "",
    protocol: "oidc" as "oidc" | "saml",
    domain: "",
    issuer: "",
    clientId: "",
    clientSecret: "",
    entryPoint: "",
    certificate: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceRequests] = useState(() => new WorkspaceRequestScope());
  const selected = workspaces.find(workspace => workspace.workspaceId === selectedId);
  const canManageTopups = selected?.role === "owner" || selected?.role === "billing";
  const canManageIdentity = selected?.role === "owner" || selected?.role === "admin";
  const hasInvoiceFundingAddress = Boolean(
    billingProfile.billingCountryCode ||
      billingProfile.billingAddressLine1 ||
      billingProfile.billingAddressLine2 ||
      billingProfile.billingCity ||
      billingProfile.billingPostalCode ||
      billingProfile.billingState,
  );

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      if (!workspaceRequests.selectWorkspace(workspaceId)) return;
      setSelectedId(workspaceId);
      setShowBillingProfile(false);
      setBillingProfileSaved(false);
      setTopups(null);
      setTopupAmount("");
      setTopupBusy(false);
      setTopupError(null);
      setShowIdentity(false);
      setIdentity(null);
      setIdentityBusy(false);
      setIdentityError(null);
      setIdentityToken(null);
      setIdentityEndpoint(null);
      setIdentityForm(current => ({
        ...current,
        providerId: "",
        domain: "",
        issuer: "",
        clientId: "",
        clientSecret: "",
        entryPoint: "",
        certificate: "",
      }));
    },
    [workspaceRequests],
  );

  const loadWorkspaces = useCallback(async () => {
    const body = await readJson(
      await fetch("/api/account/workspaces", { cache: "no-store", credentials: "same-origin" }),
    );
    const next = body.workspaces as Workspace[];
    setWorkspaces(next);
    const current = workspaceRequests.currentWorkspaceId;
    selectWorkspace(
      current && next.some(workspace => workspace.workspaceId === current)
        ? current
        : initialWorkspaceId && next.some(workspace => workspace.workspaceId === initialWorkspaceId)
          ? initialWorkspaceId
          : (next[0]?.workspaceId ?? ""),
    );
  }, [initialWorkspaceId, selectWorkspace, workspaceRequests]);

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
      billingCountryCode: body.billingAddress.country ?? "",
      billingAddressLine1: body.billingAddress.line1 ?? "",
      billingAddressLine2: body.billingAddress.line2 ?? "",
      billingCity: body.billingAddress.city ?? "",
      billingPostalCode: body.billingAddress.postalCode ?? "",
      billingState: body.billingAddress.state ?? "",
    });
    return body;
  }, []);

  const loadTopups = useCallback(
    async (workspaceId: string) => {
      if (!workspaceId) return null;
      const request = workspaceRequests.begin(workspaceId, "topups:load");
      try {
        const next = (await readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/billing/topups`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: request.signal,
          }),
        )) as PrepaidTopups;
        if (!request.isCurrent()) return null;
        setTopups(next);
        setTopupError(null);
        return next;
      } finally {
        request.finish();
      }
    },
    [workspaceRequests],
  );

  const loadIdentity = useCallback(
    async (workspaceId: string) => {
      const request = workspaceRequests.begin(workspaceId, "identity:load");
      try {
        const next = (await readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/identity`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: request.signal,
          }),
        )) as WorkspaceIdentity;
        if (!request.isCurrent()) return null;
        setIdentity(next);
        setIdentityError(null);
        return next;
      } finally {
        request.finish();
      }
    },
    [workspaceRequests],
  );

  useEffect(() => {
    void loadWorkspaces()
      .catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load workspaces."))
      .finally(() => setWorkspacesLoading(false));
  }, [loadWorkspaces]);

  useEffect(() => {
    void loadBilling(selectedId).catch(cause => {
      setBilling(null);
      setBillingError(cause instanceof Error ? cause.message : "Unable to load billing status.");
    });
  }, [loadBilling, selectedId]);

  useEffect(() => {
    setTopups(null);
    setTopupError(null);
    if (!selectedId || !canManageTopups) return;
    const workspaceId = selectedId;
    void loadTopups(workspaceId).catch(cause => {
      if (!workspaceRequests.isWorkspaceCurrent(workspaceId)) return;
      setTopupError(cause instanceof Error ? cause.message : "Unable to load prepaid funding.");
    });
  }, [canManageTopups, loadTopups, selectedId, workspaceRequests]);

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
            billingCountryCode: billingProfile.billingCountryCode || null,
            billingAddressLine1: billingProfile.billingAddressLine1 || null,
            billingAddressLine2: billingProfile.billingAddressLine2 || null,
            billingCity: billingProfile.billingCity || null,
            billingPostalCode: billingProfile.billingPostalCode || null,
            billingState: billingProfile.billingState || null,
          }),
        }),
      )) as BillingProfile;
      setBillingProfile({
        legalName: body.legalName ?? "",
        registrationNumber: body.registrationNumber ?? "",
        registeredAddress: body.registeredAddress ?? "",
        vatCountryCode: body.vatCountryCode ?? "",
        vatId: body.vatId ?? "",
        billingCountryCode: body.billingAddress.country ?? "",
        billingAddressLine1: body.billingAddress.line1 ?? "",
        billingAddressLine2: body.billingAddress.line2 ?? "",
        billingCity: body.billingAddress.city ?? "",
        billingPostalCode: body.billingAddress.postalCode ?? "",
        billingState: body.billingAddress.state ?? "",
      });
      setBillingProfileSaved(true);
    } catch (cause) {
      setBillingError(cause instanceof Error ? cause.message : "Unable to save billing details.");
    } finally {
      setBillingProfileBusy(false);
    }
  }

  async function createTopup(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !/^\d{1,6}(?:\.\d{1,2})?$/u.test(topupAmount)) return;
    const workspaceId = selectedId;
    const request = workspaceRequests.begin(workspaceId, "topups:action");
    const [whole, fraction = ""] = topupAmount.split(".");
    const amountAtomic = (BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(2, "0")) * 10_000n).toString();
    setTopupBusy(true);
    setTopupError(null);
    try {
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/billing/topups`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountAtomic, idempotencyKey: `browser:${crypto.randomUUID()}` }),
          signal: request.signal,
        }),
      );
      if (!request.isCurrent()) return;
      setTopupAmount("");
      await loadTopups(workspaceId);
      if (!request.isCurrent()) return;
      await loadWorkspaces();
    } catch (cause) {
      if (request.isCurrent()) {
        setTopupError(cause instanceof Error ? cause.message : "Unable to request a prepaid top-up.");
      }
    } finally {
      if (request.isCurrent()) setTopupBusy(false);
      request.finish();
    }
  }

  async function toggleIdentitySettings() {
    if (!selectedId) return;
    const workspaceId = selectedId;
    const next = !showIdentity;
    setShowIdentity(next);
    setIdentityToken(null);
    setIdentityEndpoint(null);
    if (!next) return;
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      await loadIdentity(workspaceId);
    } catch (cause) {
      if (workspaceRequests.isWorkspaceCurrent(workspaceId)) {
        setIdentityError(cause instanceof Error ? cause.message : "Unable to load enterprise identity.");
      }
    } finally {
      if (workspaceRequests.isWorkspaceCurrent(workspaceId)) setIdentityBusy(false);
    }
  }

  async function saveIdentityProvider(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      const editing = Boolean(identityForm.providerId);
      const payload = Object.fromEntries(
        Object.entries({
          protocol: identityForm.protocol,
          domain: identityForm.domain,
          issuer: identityForm.issuer,
          clientId: identityForm.clientId,
          clientSecret: identityForm.clientSecret,
          entryPoint: identityForm.entryPoint,
          certificate: identityForm.certificate,
        }).filter(([, value]) => value !== ""),
      );
      const body = await readJson(
        await fetch(
          editing
            ? `/api/account/workspaces/${encodeURIComponent(selectedId)}/identity/providers/${encodeURIComponent(identityForm.providerId)}`
            : `/api/account/workspaces/${encodeURIComponent(selectedId)}/identity`,
          {
            method: editing ? "PATCH" : "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        ),
      );
      setIdentityToken(typeof body.domainVerificationToken === "string" ? body.domainVerificationToken : null);
      setIdentityEndpoint(null);
      setIdentityForm(current => ({
        ...current,
        providerId: "",
        domain: "",
        issuer: "",
        clientId: "",
        clientSecret: "",
        entryPoint: "",
        certificate: "",
      }));
      await loadIdentity(selectedId);
    } catch (cause) {
      setIdentityError(cause instanceof Error ? cause.message : "Unable to save the identity provider.");
    } finally {
      setIdentityBusy(false);
    }
  }

  async function identityProviderAction(
    providerId: string,
    action: "request-verification" | "verify" | "enforce" | "delete",
    enabled?: boolean,
  ) {
    if (!selectedId) return;
    if (action === "delete" && !window.confirm("Delete this identity provider and its linked SSO accounts?")) return;
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      const providerPath = `/api/account/workspaces/${encodeURIComponent(selectedId)}/identity/providers/${encodeURIComponent(providerId)}`;
      const response = await readJson(
        await fetch(
          action === "request-verification" || action === "verify"
            ? `${providerPath}/domain-verification`
            : providerPath,
          {
            method: action === "delete" ? "DELETE" : action === "request-verification" ? "POST" : "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            ...(action === "enforce" ? { body: JSON.stringify({ enforceSso: enabled }) } : {}),
          },
        ),
      );
      if (typeof response.domainVerificationToken === "string") {
        setIdentityToken(response.domainVerificationToken);
        setIdentityEndpoint(null);
      }
      await loadIdentity(selectedId);
    } catch (cause) {
      setIdentityError(cause instanceof Error ? cause.message : "Unable to update the identity provider.");
    } finally {
      setIdentityBusy(false);
    }
  }

  async function scimAction(providerId?: string) {
    if (!selectedId) return;
    if (providerId && !window.confirm("Revoke this SCIM token? Provisioning will stop immediately.")) return;
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      const body = await readJson(
        await fetch(
          providerId
            ? `/api/account/workspaces/${encodeURIComponent(selectedId)}/identity/scim/${encodeURIComponent(providerId)}`
            : `/api/account/workspaces/${encodeURIComponent(selectedId)}/identity/scim`,
          { method: providerId ? "DELETE" : "POST", credentials: "same-origin" },
        ),
      );
      setIdentityToken(typeof body.scimToken === "string" ? body.scimToken : null);
      setIdentityEndpoint(typeof body.endpoint === "string" ? body.endpoint : null);
      await loadIdentity(selectedId);
    } catch (cause) {
      setIdentityError(cause instanceof Error ? cause.message : "Unable to update SCIM provisioning.");
    } finally {
      setIdentityBusy(false);
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
      window.location.assign(`/agents?workspace=${encodeURIComponent(String(body.workspaceId))}&step=connect`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create workspace.");
    } finally {
      setBusy(false);
    }
  }

  const usageTotal = billing ? billing.usage.completed + billing.usage.reserved : 0;
  const usagePercent = billing?.usage.limit ? Math.min(100, Math.round((usageTotal / billing.usage.limit) * 100)) : 0;
  const billingWarning = ["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(billing?.status ?? "");
  const editingIdentityProvider = identity?.providers.find(provider => provider.providerId === identityForm.providerId);
  const identityFormDirty =
    !identityForm.providerId ||
    identityForm.domain !== editingIdentityProvider?.domain ||
    Boolean(
      identityForm.issuer ||
        identityForm.clientId ||
        identityForm.clientSecret ||
        identityForm.entryPoint ||
        identityForm.certificate,
    );

  const workspaceForm = (
    <form className="mt-4" onSubmit={createWorkspace}>
      <label className="sr-only" htmlFor="workspace-name">
        Workspace name
      </label>
      <input
        id="workspace-name"
        className="input w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
        value={workspaceName}
        onChange={event => setWorkspaceName(event.target.value)}
        placeholder="Team or project name"
        maxLength={120}
        required
      />
      <button className="rateloop-gradient-action mt-3 w-full px-5" disabled={busy}>
        {busy ? "Creating…" : "Create workspace"}
      </button>
      {error ? <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
    </form>
  );

  if (workspacesLoading) {
    return (
      <div className="surface-card rounded-2xl p-6 text-sm text-base-content/55" role="status">
        <span className="loading loading-spinner loading-sm mr-2" /> Loading workspace…
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <section className="surface-card mx-auto max-w-xl rounded-2xl p-6" aria-labelledby="create-workspace-heading">
        <h1 id="create-workspace-heading" className="text-2xl font-semibold">
          Create your workspace
        </h1>
        <p className="mt-2 text-sm text-base-content/55">Name it, then connect your agent.</p>
        {workspaceForm}
      </section>
    );
  }

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
                        className="btn rateloop-secondary-action min-h-10 px-4"
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
                        <p className="text-xs font-semibold text-base-content/65 sm:col-span-2">
                          Invoice funding address <span className="font-normal text-base-content/35">(optional)</span>
                        </p>
                        <label className="text-xs text-base-content/55">
                          Country
                          <input
                            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] uppercase"
                            value={billingProfile.billingCountryCode}
                            onChange={event =>
                              setBillingProfile(current => ({
                                ...current,
                                billingCountryCode: event.target.value.toUpperCase(),
                              }))
                            }
                            placeholder="US"
                            pattern="[A-Za-z]{2}"
                            maxLength={2}
                            required={hasInvoiceFundingAddress}
                          />
                        </label>
                        <label className="text-xs text-base-content/55">
                          Postal code
                          <input
                            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                            value={billingProfile.billingPostalCode}
                            onChange={event =>
                              setBillingProfile(current => ({ ...current, billingPostalCode: event.target.value }))
                            }
                            maxLength={32}
                            autoComplete="postal-code"
                            required={hasInvoiceFundingAddress}
                          />
                        </label>
                        <label className="text-xs text-base-content/55 sm:col-span-2">
                          Address line 1
                          <input
                            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                            value={billingProfile.billingAddressLine1}
                            onChange={event =>
                              setBillingProfile(current => ({ ...current, billingAddressLine1: event.target.value }))
                            }
                            maxLength={200}
                            autoComplete="address-line1"
                            required={hasInvoiceFundingAddress}
                          />
                        </label>
                        <label className="text-xs text-base-content/55 sm:col-span-2">
                          Address line 2 <span className="text-base-content/35">(optional)</span>
                          <input
                            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                            value={billingProfile.billingAddressLine2}
                            onChange={event =>
                              setBillingProfile(current => ({ ...current, billingAddressLine2: event.target.value }))
                            }
                            maxLength={200}
                            autoComplete="address-line2"
                          />
                        </label>
                        <label className="text-xs text-base-content/55">
                          City
                          <input
                            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                            value={billingProfile.billingCity}
                            onChange={event =>
                              setBillingProfile(current => ({ ...current, billingCity: event.target.value }))
                            }
                            maxLength={120}
                            autoComplete="address-level2"
                            required={hasInvoiceFundingAddress}
                          />
                        </label>
                        <label className="text-xs text-base-content/55">
                          State or region <span className="text-base-content/35">(optional)</span>
                          <input
                            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                            value={billingProfile.billingState}
                            onChange={event =>
                              setBillingProfile(current => ({ ...current, billingState: event.target.value }))
                            }
                            maxLength={120}
                            autoComplete="address-level1"
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
              <section
                id="panel-funding"
                aria-labelledby="panel-funding-heading"
                className="mt-5 rounded-xl border border-white/10 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
                      Separate from subscription billing
                    </p>
                    <h2 id="panel-funding-heading" className="mt-2 text-xl font-semibold">
                      Panel funding
                    </h2>
                  </div>
                  <Link href="/pricing" className="text-xs text-base-content/45 underline underline-offset-4">
                    How panel costs work
                  </Link>
                </div>
                <div className="mt-5 grid gap-3 border-t border-white/10 pt-4 text-center sm:grid-cols-3">
                  <div>
                    <span className="block text-lg font-semibold">${usdc(selected.prepaid.settledAtomic)}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-base-content/45">
                      Settled USDC
                      <InfoPopover label="About settled USDC">
                        Funds credited to this workspace after payment settlement.
                      </InfoPopover>
                    </span>
                  </div>
                  <div>
                    <span className="block text-lg font-semibold">${usdc(selected.prepaid.reservedAtomic)}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-base-content/45">
                      Reserved USDC
                      <InfoPopover label="About reserved USDC">
                        Funds committed to review work that has not reached its paid terminal state.
                      </InfoPopover>
                    </span>
                  </div>
                  <div>
                    <span className="block text-lg font-semibold">${usdc(selected.prepaid.availableAtomic)}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-base-content/45">
                      Available USDC
                      <InfoPopover label="About available USDC">
                        Settled funds that are not reserved and can fund new review work.
                      </InfoPopover>
                    </span>
                  </div>
                </div>
                {canManageTopups && topups?.enabled ? (
                  <form
                    className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row"
                    onSubmit={createTopup}
                  >
                    <div className="grow text-xs text-base-content/55">
                      <label htmlFor="workspace-prepaid-topup-amount">Add prepaid balance by USD invoice</label>
                      <div className="mt-1.5 flex rounded-lg border border-white/10 bg-[var(--rateloop-field)]">
                        <span className="px-3 py-2.5 text-base-content/45">$</span>
                        <input
                          id="workspace-prepaid-topup-amount"
                          className="min-w-0 grow bg-transparent px-1 py-2.5 outline-none"
                          value={topupAmount}
                          onChange={event => setTopupAmount(event.target.value)}
                          inputMode="decimal"
                          pattern="\d{1,6}(\.\d{1,2})?"
                          placeholder="500.00"
                          required
                        />
                      </div>
                    </div>
                    <button className="rateloop-gradient-action min-h-10 self-end px-4" disabled={topupBusy}>
                      {topupBusy ? "Creating invoice…" : "Create invoice"}
                    </button>
                  </form>
                ) : canManageTopups && topups ? (
                  <p className="mt-4 text-xs leading-5 text-base-content/45">
                    USD invoice funding is not enabled for this deployment.
                  </p>
                ) : canManageTopups && !topupError ? (
                  <p className="mt-4 text-xs leading-5 text-base-content/45" role="status">
                    Loading prepaid funding…
                  </p>
                ) : !canManageTopups ? (
                  <p className="mt-4 text-xs leading-5 text-base-content/45">
                    Workspace owners and billing members can add prepaid balance.
                  </p>
                ) : null}
                {topupError ? (
                  <p className="mt-3 text-sm text-red-100" role="alert">
                    {topupError}
                  </p>
                ) : null}
                {topups?.topups.length ? (
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <h3 className="text-sm font-semibold">Top-up invoices</h3>
                    <ul className="mt-3 space-y-2">
                      {topups.topups.map(topup => (
                        <li
                          key={topup.topupId}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-base-content/[0.035] px-3 py-2 text-xs"
                        >
                          <span>
                            ${topup.amountUsd} · <span className="capitalize">{topup.state}</span>
                            {topup.invoiceNumber ? ` · ${topup.invoiceNumber}` : ""}
                          </span>
                          {topup.hostedInvoiceUrl || topup.invoicePdfUrl ? (
                            <a
                              className="font-semibold underline underline-offset-4"
                              href={topup.hostedInvoiceUrl ?? topup.invoicePdfUrl ?? undefined}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {topup.state === "credited" ? "View invoice" : "Open invoice"}
                            </a>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {topups?.ledger.length || topups?.reservations.length ? (
                  <details className="mt-4 rounded-lg border border-white/10 p-3">
                    <summary className="cursor-pointer text-sm font-semibold">Balance ledger</summary>
                    <ul className="mt-3 space-y-2 text-xs text-base-content/60">
                      {topups.ledger.map(entry => (
                        <li className="flex justify-between gap-3" key={entry.entryId}>
                          <span>{entry.source.replaceAll("_", " ")}</span>
                          <span className="font-mono">{signedUsdc(entry.amountAtomic)}</span>
                        </li>
                      ))}
                      {topups.reservations.map(reservation => (
                        <li className="flex justify-between gap-3" key={reservation.reservationId}>
                          <span className="capitalize">{reservation.status} reservation</span>
                          <span className="font-mono">-${usdc(reservation.amountAtomic)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            ) : null}

            {selected && canManageIdentity ? (
              <section aria-labelledby="enterprise-identity" className="mt-5 rounded-xl border border-white/10 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">
                      Access control
                    </p>
                    <h2 id="enterprise-identity" className="mt-2 text-xl font-semibold">
                      Enterprise identity
                    </h2>
                  </div>
                  <button
                    className="btn rateloop-secondary-action min-h-10 px-4"
                    type="button"
                    aria-expanded={showIdentity}
                    onClick={() => void toggleIdentitySettings()}
                  >
                    {showIdentity ? "Close" : "Configure SSO and SCIM"}
                  </button>
                </div>
                {showIdentity ? (
                  <div className="mt-5 space-y-5 border-t border-white/10 pt-5">
                    {identity && !identity.enabled ? (
                      <p className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-base-content/60">
                        Enterprise identity is not enabled for this deployment.
                      </p>
                    ) : null}
                    {identity?.enabled ? (
                      <>
                        {identityToken ? (
                          <div className="rounded-lg border border-amber-300/25 bg-amber-300/[0.06] p-3">
                            <p className="text-xs font-semibold text-amber-50">
                              {identityEndpoint
                                ? "Copy this SCIM bearer token now"
                                : "Publish this domain verification token"}
                            </p>
                            <code className="mt-2 block break-all rounded bg-black/25 p-2 text-xs">
                              {identityToken}
                            </code>
                            {identityEndpoint ? (
                              <>
                                <p className="mt-2 break-all text-xs text-base-content/60">
                                  SCIM Users endpoint: <code>{identityEndpoint}</code>
                                </p>
                                <p className="mt-2 text-xs text-base-content/50">
                                  This bearer token is shown only once.
                                </p>
                              </>
                            ) : (
                              <p className="mt-2 text-xs text-base-content/50">
                                Add this value to the DNS TXT record requested by your identity provider.
                              </p>
                            )}
                          </div>
                        ) : null}
                        {identity.providers.map(provider => (
                          <article className="rounded-lg border border-white/10 p-4" key={provider.providerId}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h3 className="font-semibold">{provider.domain}</h3>
                                <p className="mt-1 text-xs uppercase tracking-wide text-base-content/45">
                                  {provider.protocol} ·{" "}
                                  {provider.domainVerified ? "domain verified" : "verification required"}
                                </p>
                              </div>
                              <label className="flex items-center gap-2 text-xs text-base-content/65">
                                <input
                                  type="checkbox"
                                  className="toggle toggle-sm"
                                  checked={provider.enforceSso}
                                  disabled={identityBusy || !provider.domainVerified}
                                  onChange={event =>
                                    void identityProviderAction(provider.providerId, "enforce", event.target.checked)
                                  }
                                />
                                SSO-only
                              </label>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-3 text-xs">
                              {!provider.domainVerified ? (
                                <>
                                  <button
                                    className="font-semibold underline underline-offset-4"
                                    disabled={identityBusy}
                                    onClick={() =>
                                      void identityProviderAction(provider.providerId, "request-verification")
                                    }
                                    type="button"
                                  >
                                    Get TXT token
                                  </button>
                                  <button
                                    className="font-semibold underline underline-offset-4"
                                    disabled={identityBusy}
                                    onClick={() => void identityProviderAction(provider.providerId, "verify")}
                                    type="button"
                                  >
                                    Check DNS
                                  </button>
                                </>
                              ) : null}
                              <button
                                className="underline underline-offset-4"
                                disabled={identityBusy}
                                onClick={() =>
                                  setIdentityForm({
                                    providerId: provider.providerId,
                                    protocol: provider.protocol,
                                    domain: provider.domain,
                                    issuer: "",
                                    clientId: "",
                                    clientSecret: "",
                                    entryPoint: "",
                                    certificate: "",
                                  })
                                }
                                type="button"
                              >
                                Update
                              </button>
                              <button
                                className="text-red-200 underline underline-offset-4"
                                disabled={identityBusy}
                                onClick={() => void identityProviderAction(provider.providerId, "delete")}
                                type="button"
                              >
                                Delete
                              </button>
                            </div>
                          </article>
                        ))}
                        <form className="rounded-lg border border-white/10 p-4" onSubmit={saveIdentityProvider}>
                          <h3 className="font-semibold">
                            {identityForm.providerId ? "Update identity provider" : "Add identity provider"}
                          </h3>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <label className="text-xs text-base-content/55">
                              Protocol
                              <select
                                className="select mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                                value={identityForm.protocol}
                                disabled={Boolean(identityForm.providerId)}
                                onChange={event =>
                                  setIdentityForm(current => ({
                                    ...current,
                                    protocol: event.target.value as "oidc" | "saml",
                                  }))
                                }
                              >
                                <option value="oidc">OpenID Connect</option>
                                <option value="saml">SAML 2.0</option>
                              </select>
                            </label>
                            <label className="text-xs text-base-content/55">
                              Email domain
                              <input
                                className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                                value={identityForm.domain}
                                onChange={event =>
                                  setIdentityForm(current => ({ ...current, domain: event.target.value }))
                                }
                                placeholder="company.example"
                                required
                              />
                            </label>
                            <label className="text-xs text-base-content/55 sm:col-span-2">
                              Issuer URL
                              <input
                                className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                                type="url"
                                value={identityForm.issuer}
                                onChange={event =>
                                  setIdentityForm(current => ({ ...current, issuer: event.target.value }))
                                }
                                placeholder="https://id.company.example"
                                required={!identityForm.providerId}
                              />
                            </label>
                            {identityForm.protocol === "oidc" ? (
                              <>
                                <label className="text-xs text-base-content/55">
                                  Client ID
                                  <input
                                    className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                                    value={identityForm.clientId}
                                    onChange={event =>
                                      setIdentityForm(current => ({ ...current, clientId: event.target.value }))
                                    }
                                    required={!identityForm.providerId}
                                  />
                                </label>
                                <label className="text-xs text-base-content/55">
                                  Client secret
                                  <input
                                    className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                                    type="password"
                                    autoComplete="new-password"
                                    value={identityForm.clientSecret}
                                    onChange={event =>
                                      setIdentityForm(current => ({ ...current, clientSecret: event.target.value }))
                                    }
                                    required={!identityForm.providerId}
                                  />
                                </label>
                              </>
                            ) : (
                              <>
                                <label className="text-xs text-base-content/55 sm:col-span-2">
                                  SSO entry point
                                  <input
                                    className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                                    type="url"
                                    value={identityForm.entryPoint}
                                    onChange={event =>
                                      setIdentityForm(current => ({ ...current, entryPoint: event.target.value }))
                                    }
                                    required={!identityForm.providerId}
                                  />
                                </label>
                                <label className="text-xs text-base-content/55 sm:col-span-2">
                                  Signing certificate
                                  <textarea
                                    className="textarea mt-1.5 min-h-24 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] font-mono text-xs"
                                    value={identityForm.certificate}
                                    onChange={event =>
                                      setIdentityForm(current => ({ ...current, certificate: event.target.value }))
                                    }
                                    required={!identityForm.providerId}
                                  />
                                </label>
                              </>
                            )}
                          </div>
                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              className="rateloop-gradient-action min-h-10 px-4"
                              disabled={identityBusy || !identityFormDirty}
                            >
                              {identityForm.providerId ? "Save provider" : "Add provider"}
                            </button>
                            {identityForm.providerId ? (
                              <button
                                className="btn rateloop-secondary-action min-h-10 px-4"
                                type="button"
                                onClick={() =>
                                  setIdentityForm(current => ({
                                    ...current,
                                    providerId: "",
                                    domain: "",
                                    issuer: "",
                                    clientId: "",
                                    clientSecret: "",
                                    entryPoint: "",
                                    certificate: "",
                                  }))
                                }
                              >
                                Cancel
                              </button>
                            ) : null}
                          </div>
                        </form>
                        <div className="rounded-lg border border-white/10 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="font-semibold">SCIM user provisioning</h3>
                              <p className="mt-1 text-xs leading-5 text-base-content/45">
                                Users are provisioned into this workspace only. SCIM Groups are not supported.
                              </p>
                            </div>
                            {identity?.scim.length ? null : (
                              <button
                                className="btn rateloop-secondary-action min-h-9 px-3"
                                disabled={identityBusy}
                                onClick={() => void scimAction()}
                                type="button"
                              >
                                Create SCIM token
                              </button>
                            )}
                          </div>
                          {identity?.scim.map(connection => (
                            <div
                              className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                              key={connection.providerId}
                            >
                              <span>
                                Last sync: {dateLabel(connection.lastSyncAt)} ·{" "}
                                {connection.lastSyncResult ?? "not used"}
                              </span>
                              <button
                                className="text-red-200 underline underline-offset-4"
                                disabled={identityBusy}
                                onClick={() => void scimAction(connection.providerId)}
                                type="button"
                              >
                                Revoke token
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {identityBusy ? (
                      <p className="text-sm text-base-content/50" role="status">
                        Updating enterprise identity…
                      </p>
                    ) : null}
                    {identityError ? (
                      <p className="text-sm text-red-100" role="alert">
                        {identityError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </section>

      <details className="surface-card rounded-2xl p-6">
        <summary className="cursor-pointer text-sm font-semibold">Create another workspace</summary>
        {workspaceForm}
      </details>
    </div>
  );
}
