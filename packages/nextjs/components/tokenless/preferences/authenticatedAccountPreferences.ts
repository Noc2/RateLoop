import { readBrowserSession } from "~~/lib/auth/client";

type AccountPreferences = {
  preferredLocale?: unknown;
  preferredTheme?: unknown;
};

type AccountPreferenceUpdate = {
  preferredLocale?: string;
  preferredTheme?: string;
};

type AccountPreferenceKey = keyof AccountPreferenceUpdate;

const localPreferenceRevisions: Record<AccountPreferenceKey, number> = {
  preferredLocale: 0,
  preferredTheme: 0,
};

export function readLocalAccountPreferenceRevision(preference: AccountPreferenceKey) {
  return localPreferenceRevisions[preference];
}

export function markLocalAccountPreferenceChange(preference: AccountPreferenceKey) {
  localPreferenceRevisions[preference] += 1;
}

function requestInit(signal?: AbortSignal): RequestInit {
  return {
    cache: "no-store",
    credentials: "same-origin",
    ...(signal ? { signal } : {}),
  };
}

async function hasAuthenticatedSession(fetcher: typeof fetch, signal?: AbortSignal) {
  try {
    return (await readBrowserSession(signal, fetcher)) !== null;
  } catch {
    return false;
  }
}

export async function loadAuthenticatedAccountPreferences({
  fetcher = fetch,
  signal,
}: {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
} = {}): Promise<AccountPreferences | null> {
  if (!(await hasAuthenticatedSession(fetcher, signal))) return null;
  const response = await fetcher("/api/account/profile", requestInit(signal));
  if (!response.ok) return null;
  return (await response.json()) as AccountPreferences;
}

export async function persistAuthenticatedAccountPreference(
  update: AccountPreferenceUpdate,
  { fetcher = fetch, signal }: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
) {
  if (!(await hasAuthenticatedSession(fetcher, signal))) return false;
  const response = await fetcher("/api/account/profile", {
    ...requestInit(signal),
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  return response.ok;
}

export function __resetLocalAccountPreferenceRevisionsForTests() {
  localPreferenceRevisions.preferredLocale = 0;
  localPreferenceRevisions.preferredTheme = 0;
}
