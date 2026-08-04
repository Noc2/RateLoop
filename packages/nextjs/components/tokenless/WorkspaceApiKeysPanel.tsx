"use client";

import { FormEvent, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { LocalizedSharedContent, UntranslatedContent } from "~~/components/tokenless/LocalizedSharedContent";
import { OneTimeSecretNotice } from "~~/components/tokenless/agents/OneTimeSecretNotice";
import { ChoiceInput, Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { ConfirmDialog } from "~~/components/tokenless/ui/ConfirmDialog";
import {
  WORKSPACE_API_KEY_SCOPES,
  WORKSPACE_API_KEY_SCOPE_DETAILS,
  type WorkspaceApiKeyScope,
} from "~~/lib/tokenless/workspaceApiKeyScopes";

type ApiKeySummary = {
  apiKeyId: string;
  name: string;
  keyPrefix: string;
  scopes: WorkspaceApiKeyScope[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

class ApiKeyRequestError extends Error {
  field: string | null;

  constructor(message: string, field: string | null) {
    super(message);
    this.field = field;
  }
}

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiKeyRequestError(
      typeof body.message === "string" ? body.message : "API key request failed.",
      typeof body.field === "string" ? body.field : null,
    );
  }
  return body;
}

function dateLabel(value: string | null, locale: string) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function expiresInNinetyDays() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString();
}

export function WorkspaceApiKeysPanel({ workspaceId }: { workspaceId: string }) {
  const locale = useLocale();
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<WorkspaceApiKeyScope[]>(["result:read", "evaluation:read"]);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [revokeConfirmation, setRevokeConfirmation] = useState<ApiKeySummary | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    setRevealedToken(null);
    setRevokeConfirmation(null);
    void fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/api-keys`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(readJson)
      .then(body => setApiKeys(body.apiKeys as ApiKeySummary[]))
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadError("Unable to load API keys.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId]);

  async function createApiKey(event: FormEvent) {
    event.preventDefault();
    clear();
    setBusy(true);
    setRevealedToken(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/api-keys`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, scopes, expiresAt: expiresInNinetyDays() }),
        }),
      );
      setApiKeys(current => [body.apiKey as ApiKeySummary, ...current]);
      setName("");
      setRevealedToken(String(body.token));
    } catch (error) {
      capture(error, "Unable to create API key.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeApiKey(apiKey: ApiKeySummary) {
    clear();
    setBusy(true);
    try {
      const response = await fetch(
        `/api/account/workspaces/${encodeURIComponent(workspaceId)}/api-keys/${encodeURIComponent(apiKey.apiKeyId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!response.ok) await readJson(response);
      setApiKeys(current =>
        current.map(entry =>
          entry.apiKeyId === apiKey.apiKeyId ? { ...entry, revokedAt: new Date().toISOString() } : entry,
        ),
      );
    } catch (error) {
      capture(error, "Unable to revoke API key.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmApiKeyRevocation() {
    const apiKey = revokeConfirmation;
    if (!apiKey) return;
    await revokeApiKey(apiKey);
    setRevokeConfirmation(current => (current === apiKey ? null : current));
  }

  return (
    <LocalizedSharedContent>
      <section
        className="mt-5 rounded-xl border border-base-content/10 bg-base-content/[0.025] p-5"
        aria-labelledby="api-keys"
      >
        <div>
          <h2 id="api-keys" className="text-2xl font-semibold">
            API keys
          </h2>
          <p className="mt-2 text-sm leading-6 text-base-content/60">
            Create scoped credentials for an agent or server integration. New keys expire after 90 days and secrets are
            stored only as hashes.
          </p>
        </div>

        <form className="mt-5 space-y-4" onSubmit={createApiKey}>
          <Field
            id="workspace-api-key-name"
            label="Key name"
            value={name}
            maxLength={120}
            required
            autoComplete="off"
            placeholder="Production agent"
            error={fieldErrors.name}
            onChange={event => {
              setName(event.target.value);
              clear("name");
            }}
          />
          <fieldset>
            <legend className="text-sm font-medium text-base-content/80">Permissions</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {WORKSPACE_API_KEY_SCOPES.map(scope => {
                const details = WORKSPACE_API_KEY_SCOPE_DETAILS[scope];
                return (
                  <label
                    key={scope}
                    htmlFor={`workspace-api-key-scope-${scope}`}
                    className="flex min-h-11 items-start gap-3 rounded-lg border border-base-content/10 px-3 py-3"
                  >
                    <ChoiceInput
                      id={`workspace-api-key-scope-${scope}`}
                      className="checkbox-sm mt-0.5"
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={event => {
                        setScopes(current =>
                          event.target.checked ? [...current, scope] : current.filter(candidate => candidate !== scope),
                        );
                        clear("scopes");
                      }}
                    />
                    <span>
                      <span className="block text-sm font-medium">{details.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-base-content/55">{details.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {fieldErrors.scopes ? (
              <p className="mt-2 text-sm text-error" role="alert">
                {fieldErrors.scopes}
              </p>
            ) : null}
          </fieldset>
          <button className="btn rateloop-secondary-action" type="submit" disabled={busy || scopes.length === 0}>
            {busy ? "Creating…" : "Create API key"}
          </button>
          {formError ? (
            <p className="rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
              {formError}
            </p>
          ) : null}
        </form>

        {revealedToken ? (
          <OneTimeSecretNotice label="this API key" value={revealedToken} onDismiss={() => setRevealedToken(null)} />
        ) : null}

        <AsyncSection
          className="mt-6"
          loading={loading}
          loadingLabel="Loading API keys"
          error={loadError}
          empty={apiKeys.length === 0}
          emptyTitle="No API keys yet."
        >
          <div className="mt-6 space-y-3" aria-live="polite">
            {apiKeys.map(apiKey => (
              <article key={apiKey.apiKeyId} className="rounded-lg border border-base-content/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium">
                      <UntranslatedContent>{apiKey.name}</UntranslatedContent>
                    </h3>
                    <p className="mt-1 font-mono text-xs text-base-content/55">
                      <UntranslatedContent>{apiKey.keyPrefix}…</UntranslatedContent>
                    </p>
                    <p className="mt-2 text-xs text-base-content/55">
                      Expires <UntranslatedContent>{dateLabel(apiKey.expiresAt, locale)}</UntranslatedContent> · Last
                      used <UntranslatedContent>{dateLabel(apiKey.lastUsedAt, locale)}</UntranslatedContent>
                    </p>
                  </div>
                  {apiKey.revokedAt ? (
                    <span className="rounded-full bg-base-content/[0.08] px-3 py-1 text-xs">Revoked</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm border-error/20 bg-error/[0.06] text-error"
                      disabled={busy}
                      onClick={() => setRevokeConfirmation(apiKey)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Permissions">
                  {apiKey.scopes.map(scope => (
                    <li
                      key={scope}
                      className="inline-flex flex-wrap items-baseline gap-x-2 rounded-md bg-base-content/[0.05] px-2.5 py-1.5 text-xs"
                    >
                      <span>{WORKSPACE_API_KEY_SCOPE_DETAILS[scope].label}</span>
                      <code className="text-base-content/55">{scope}</code>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </AsyncSection>
        <ConfirmDialog
          open={revokeConfirmation !== null}
          title={
            revokeConfirmation ? (
              <>
                Revoke “<UntranslatedContent>{revokeConfirmation.name}</UntranslatedContent>”?
              </>
            ) : (
              "Revoke this API key?"
            )
          }
          description="Existing integrations using it will stop working."
          confirmLabel="Revoke API key"
          busy={busy}
          onCancel={() => setRevokeConfirmation(null)}
          onConfirm={() => void confirmApiKeyRevocation()}
        />
      </section>
    </LocalizedSharedContent>
  );
}
