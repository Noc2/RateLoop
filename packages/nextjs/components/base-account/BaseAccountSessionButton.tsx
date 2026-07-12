"use client";

import { useEffect, useState } from "react";
import { useConnect, useDisconnect } from "wagmi";
import {
  type BaseAccountProvider,
  readBaseAccountSession,
  signInWithBaseAccount,
  signOutBaseAccountSession,
} from "~~/lib/base-account/client";

type Session = Awaited<ReturnType<typeof readBaseAccountSession>>;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function BaseAccountSessionButton() {
  const { connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const [session, setSession] = useState<Session>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readBaseAccountSession()
      .then(value => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setSession(null);
      });
    return () => {
      active = false;
    };
  }, []);

  async function signIn() {
    setPending(true);
    setError(null);
    try {
      const connector = connectors.find(candidate => candidate.name.toLowerCase().includes("base account"));
      if (!connector) throw new Error("Base Account is unavailable in this browser.");
      const provider = await connector.getProvider();
      if (!provider) throw new Error("Base Account provider is unavailable.");
      await signInWithBaseAccount(provider as BaseAccountProvider);
      setSession(await readBaseAccountSession());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in.");
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      await signOutBaseAccountSession();
      await disconnectAsync();
      setSession(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign out.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="rateloop-gradient-action min-h-11 w-full px-3 text-sm disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        onClick={session ? signOut : signIn}
      >
        {pending ? "Opening Base Account…" : session ? shortAddress(session.address) : "Set up Base Account"}
      </button>
      {error ? <p className="mt-2 text-center text-[11px] leading-4 text-error">{error}</p> : null}
    </div>
  );
}
