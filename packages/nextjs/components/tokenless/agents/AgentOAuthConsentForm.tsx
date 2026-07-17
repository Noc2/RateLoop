"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RateLoopLogo } from "~~/components/RateLoopLogo";

type Props = {
  autoAuthorize: boolean;
  values: Record<string, string>;
};

type RelayResponse = {
  delivery?: "callback" | "navigate";
  error_description?: string;
  outcome?: "approved" | "denied";
  redirectTo?: string;
};

function isLoopbackRedirect(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1")
    );
  } catch {
    return false;
  }
}

export function AgentOAuthConsentForm({ autoAuthorize, values }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const callbackDeliveredRef = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const [callbackDelivered, setCallbackDelivered] = useState(false);
  const [callbackOutcome, setCallbackOutcome] = useState<"approved" | "denied">("approved");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const relayLoopbackCallback = isLoopbackRedirect(values.redirect_uri);

  useEffect(() => {
    if (autoAuthorize) formRef.current?.requestSubmit();
  }, [autoAuthorize]);

  useEffect(
    () => () => {
      if (redirectTimerRef.current !== null) window.clearTimeout(redirectTimerRef.current);
    },
    [],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!relayLoopbackCallback) return;
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const form = event.currentTarget;
      const body = new FormData(form);
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      if (submitter?.name) body.set(submitter.name, submitter.value);
      const response = await fetch(form.action, {
        body,
        headers: { Accept: "application/json", "x-rateloop-oauth-callback-relay": "1" },
        method: "POST",
      });
      const result = (await response.json()) as RelayResponse;
      if (!response.ok || !result.redirectTo || !result.delivery) {
        throw new Error(result.error_description || "The connection could not be completed.");
      }
      if (result.delivery === "navigate") {
        window.location.assign(result.redirectTo);
        return;
      }
      const callback = new URL(result.redirectTo);
      const expected = new URL(values.redirect_uri);
      if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) {
        throw new Error("The connection callback did not match the approved destination.");
      }
      setCallbackOutcome(result.outcome === "denied" ? "denied" : "approved");
      setCallbackUrl(callback.href);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The connection could not be completed.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCallbackLoad() {
    if (callbackDeliveredRef.current) return;
    callbackDeliveredRef.current = true;
    setCallbackDelivered(true);
    if (window.opener && !window.opener.closed) window.close();
    redirectTimerRef.current = window.setTimeout(() => {
      window.location.replace("/agents?tab=overview");
    }, 1_600);
  }

  if (callbackUrl) {
    return (
      <div className="mt-8 border-t border-white/10 pt-8 text-center" role="status" aria-live="polite">
        <RateLoopLogo className="mx-auto h-16 w-16" idPrefix="agent-oauth-complete" />
        <p className="mt-5 font-mono text-xs uppercase tracking-[0.22em] text-[var(--rateloop-green)]">
          {callbackOutcome === "approved" ? "Agent connected" : "Connection canceled"}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          {callbackOutcome === "approved" ? "Authentication complete" : "Authorization canceled"}
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-base-content/65">
          {callbackDelivered ? "Returning to RateLoop…" : "Finishing the secure callback…"}
        </p>
        <Link href="/agents?tab=overview" className="rateloop-gradient-action mt-6 min-h-11 px-5">
          Back to Agents
        </Link>
        <iframe
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
          onLoad={handleCallbackLoad}
          referrerPolicy="no-referrer"
          sandbox=""
          src={callbackUrl}
          title="Complete agent authentication"
        />
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action="/api/agent/oauth/authorize"
      method="post"
      className="mt-8 space-y-3"
      aria-busy={submitting}
      onSubmit={handleSubmit}
    >
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {autoAuthorize ? (
        <>
          <input type="hidden" name="decision" value="approve" />
          <p className="text-sm text-base-content/65" role="status">
            Completing the secure connection…
          </p>
          <button className="rateloop-gradient-action min-h-11 w-full px-4" type="submit">
            {submitting ? "Connecting…" : "Continue"}
          </button>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            className="rateloop-gradient-action min-h-11 px-4"
            type="submit"
            name="decision"
            value="approve"
            disabled={submitting}
          >
            {submitting ? "Connecting…" : "Allow connection"}
          </button>
          <button className="btn btn-outline min-h-11" type="submit" name="decision" value="deny" disabled={submitting}>
            Cancel
          </button>
        </div>
      )}
      {error ? (
        <p className="text-sm leading-6 text-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
