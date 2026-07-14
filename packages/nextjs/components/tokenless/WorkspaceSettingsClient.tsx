"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

function usdc(value: string) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(BigInt(value)) / 1_000_000,
  );
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
                }}
              >
                {workspaces.map(workspace => (
                  <option key={workspace.workspaceId} value={workspace.workspaceId}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            {selected ? (
              <div className="mt-5 grid grid-cols-3 gap-2 border-y border-white/10 py-4 text-center">
                <div>
                  <span className="block text-lg font-semibold">${usdc(selected.prepaid.settledAtomic)}</span>
                  <span className="text-xs text-base-content/45">Settled</span>
                </div>
                <div>
                  <span className="block text-lg font-semibold">${usdc(selected.prepaid.reservedAtomic)}</span>
                  <span className="text-xs text-base-content/45">Reserved</span>
                </div>
                <div>
                  <span className="block text-lg font-semibold">${usdc(selected.prepaid.availableAtomic)}</span>
                  <span className="text-xs text-base-content/45">Available</span>
                </div>
              </div>
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
