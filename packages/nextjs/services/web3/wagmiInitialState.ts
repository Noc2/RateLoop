import { deserialize } from "wagmi";
import type { State } from "wagmi";
import { WAGMI_STORAGE_KEY } from "~~/services/web3/wagmiStorageKey";

const WAGMI_STORE_COOKIE_KEY = `${WAGMI_STORAGE_KEY}.store`;

function parseCookieValue(cookie: string, key: string) {
  const keyValue = cookie.split("; ").find(value => value.startsWith(`${key}=`));
  return keyValue?.substring(key.length + 1);
}

export function getWagmiInitialStateFromCookie(cookie: string | null | undefined): State | undefined {
  if (!cookie) {
    return undefined;
  }

  const serializedStore = parseCookieValue(cookie, WAGMI_STORE_COOKIE_KEY);
  if (!serializedStore) {
    return undefined;
  }

  try {
    return deserialize<{ state: State }>(serializedStore).state;
  } catch {
    return undefined;
  }
}
