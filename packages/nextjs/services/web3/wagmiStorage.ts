import { cookieStorage } from "wagmi";
import type { CreateStorageParameters } from "wagmi";
import { WAGMI_STORAGE_KEY } from "~~/services/web3/wagmiStorageKey";

function getLocalStorageItem(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setLocalStorageItem(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in private browsing / restricted environments.
  }
}

function removeLocalStorageItem(key: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures in private browsing / restricted environments.
  }
}

export const wagmiPersistentStorage = {
  getItem(key: string) {
    try {
      const cookieValue = cookieStorage.getItem(key);
      if (cookieValue) {
        return cookieValue;
      }
    } catch {
      // Fall back to legacy localStorage below.
    }

    return getLocalStorageItem(key);
  },
  removeItem(key: string) {
    try {
      cookieStorage.removeItem(key);
    } catch {
      // Keep removing legacy storage even if cookie access is unavailable.
    }

    removeLocalStorageItem(key);
  },
  setItem(key: string, value: string) {
    try {
      cookieStorage.setItem(key, value);
    } catch {
      // Keep legacy storage available when cookies are blocked.
    }

    setLocalStorageItem(key, value);
  },
} satisfies NonNullable<CreateStorageParameters["storage"]>;

export { WAGMI_STORAGE_KEY };
