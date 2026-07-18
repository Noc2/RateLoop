"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  type TokenlessAskResponse,
  type TokenlessQuestion,
  type TokenlessQuoteRequest,
  type TokenlessQuoteResponse,
  type TokenlessResult,
  normalizeTokenlessQuestion,
  parseTokenlessAskResponse,
  parseTokenlessQuoteResponse,
  parseTokenlessResult,
} from "@rateloop/sdk";
import { QuestionMedia, type QuestionMediaReviewState } from "~~/components/tokenless/answer/QuestionMedia";

const HANDOFF_VERSION = "rateloop.handoff.v1" as const;
const MAX_FRAGMENT_LENGTH = 16 * 1024;
const MAX_PROMPT_LENGTH = 4_000;
const HANDOFF_ID_PATTERN = /^rhl_[A-Za-z0-9_-]{32}$/;
const IDEMPOTENCY_PATTERN = /^mcp:[A-Za-z0-9_-]{43}$/;
const TOKEN_PATTERN = /^rht_[A-Za-z0-9_-]{43}_([0-9a-z]{6,12})$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ATOMIC_PATTERN = /^(0|[1-9]\d*)$/;
const REVIEWER_SOURCES = new Set(["customer_invited", "rateloop_network", "hybrid"]);
const CLASSIFICATIONS = new Set(["public", "synthetic", "redacted"]);
const VISIBILITIES = new Set(["public", "private"]);

export type TokenlessHandoffPayload = {
  version: typeof HANDOFF_VERSION;
  handoffId: string;
  handoffToken: string;
  idempotencyKey: string;
  expiresAt: string;
  dataClassification: "public" | "synthetic" | "redacted";
  redactionSummary: string;
  request: TokenlessQuoteRequest;
};

type Workspace = {
  workspaceId: string;
  name: string;
  role: string;
  prepaid: { settledAtomic: string; reservedAtomic: string; availableAtomic: string };
};

type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; principalId: string; expiresAt: string }
  | { status: "error"; message: string };

type HandoffState =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "expired"; payload: TokenlessHandoffPayload }
  | { status: "ready"; payload: TokenlessHandoffPayload };

type ApiFailure = Error & { code?: string; status?: number };

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, maximumLength: number, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maximumLength || (!allowEmpty && !value.trim())) {
    throw new Error(
      `${path} must be ${allowEmpty ? "a" : "a non-empty"} string of at most ${maximumLength} characters.`,
    );
  }
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${path} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function atomic(value: unknown, path: string) {
  if (typeof value !== "string" || !ATOMIC_PATTERN.test(value)) {
    throw new Error(`${path} must be an unsigned atomic amount string.`);
  }
  return value;
}

function validateQuestion(value: unknown): TokenlessQuestion {
  return normalizeTokenlessQuestion(value);
}

export function validateTokenlessQuoteRequest(value: unknown): TokenlessQuoteRequest {
  const request = record(value, "request");
  const audience = record(request.audience, "request.audience");
  const source = string(audience.source, "request.audience.source", 40);
  if (!REVIEWER_SOURCES.has(source)) throw new Error("request.audience.source is unsupported.");
  const admissionPolicyHash = string(audience.admissionPolicyHash, "request.audience.admissionPolicyHash", 66);
  if (!BYTES32_PATTERN.test(admissionPolicyHash)) {
    throw new Error("request.audience.admissionPolicyHash must be a bytes32 hex value.");
  }
  const requestedPanelSize = integer(request.requestedPanelSize, "request.requestedPanelSize", 3, 500);
  const responseWindowSeconds = integer(request.responseWindowSeconds, "request.responseWindowSeconds", 1_200, 86_400);
  const budget = record(request.budget, "request.budget");
  const bountyAtomic = atomic(budget.bountyAtomic, "request.budget.bountyAtomic");
  const attemptReserveAtomic = atomic(budget.attemptReserveAtomic, "request.budget.attemptReserveAtomic");
  if (BigInt(bountyAtomic) === 0n) throw new Error("request.budget.bountyAtomic must be greater than zero.");
  if (BigInt(attemptReserveAtomic) < BigInt(requestedPanelSize)) {
    throw new Error("request.budget.attemptReserveAtomic must cover every requested reviewer.");
  }
  // Preserve the owner-approved public-data contract. The MCP handoff creator sets these four fields
  // (lib/mcp/handoff.ts); dropping them here would let the server default the ask to private/internal,
  // so a public paid ask would never enter the public rater queue.
  const visibility = string(request.visibility, "request.visibility", 20);
  if (!VISIBILITIES.has(visibility)) throw new Error("request.visibility must be public or private.");
  const dataClassification = string(request.dataClassification, "request.dataClassification", 20);
  if (!CLASSIFICATIONS.has(dataClassification)) throw new Error("request.dataClassification is unsupported.");
  if (request.confirmedNoSensitiveData !== true) {
    throw new Error("request.confirmedNoSensitiveData must be true for a browser handoff.");
  }
  const redactionSummary = string(request.redactionSummary, "request.redactionSummary", 1_000, true).trim();
  if (dataClassification === "redacted" && redactionSummary.length < 10) {
    throw new Error("Redacted questions require a redaction summary of at least 10 characters.");
  }
  return {
    audience: {
      admissionPolicyHash: admissionPolicyHash as `0x${string}`,
      source: source as TokenlessQuoteRequest["audience"]["source"],
    },
    budget: {
      attemptReserveAtomic,
      bountyAtomic,
      feeBps: integer(budget.feeBps, "request.budget.feeBps", 0, 2_000),
    },
    confirmedNoSensitiveData: true,
    dataClassification: dataClassification as TokenlessQuoteRequest["dataClassification"],
    question: validateQuestion(request.question),
    redactionSummary,
    requestedPanelSize,
    responseWindowSeconds,
    visibility: visibility as TokenlessQuoteRequest["visibility"],
  };
}

export function decodeTokenlessHandoffFragment(fragment: string, now = new Date()): TokenlessHandoffPayload {
  if (!fragment || fragment.length > MAX_FRAGMENT_LENGTH) throw new Error("This handoff link is missing or too large.");
  const encoded = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment).get("payload");
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error("This handoff link has no valid payload fragment.");
  let parsed: unknown;
  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("This handoff payload cannot be decoded.");
  }
  const payload = record(parsed, "payload");
  if (payload.version !== HANDOFF_VERSION) throw new Error("This handoff version is not supported.");
  const handoffId = string(payload.handoffId, "handoffId", 160);
  if (!HANDOFF_ID_PATTERN.test(handoffId)) throw new Error("handoffId is invalid.");
  const handoffToken = string(payload.handoffToken, "handoffToken", 1_024);
  if (!TOKEN_PATTERN.test(handoffToken)) throw new Error("handoffToken is invalid.");
  const idempotencyKey = string(payload.idempotencyKey, "idempotencyKey", 160);
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) throw new Error("idempotencyKey is invalid.");
  const expiresAt = string(payload.expiresAt, "expiresAt", 64);
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) throw new Error("expiresAt must be an ISO-8601 timestamp.");
  const dataClassification = string(payload.dataClassification, "dataClassification", 20);
  if (!CLASSIFICATIONS.has(dataClassification)) throw new Error("dataClassification is unsupported.");
  const result = {
    version: HANDOFF_VERSION,
    handoffId,
    handoffToken,
    idempotencyKey,
    expiresAt,
    dataClassification: dataClassification as TokenlessHandoffPayload["dataClassification"],
    redactionSummary: string(payload.redactionSummary, "redactionSummary", 1_000, true),
    request: validateTokenlessQuoteRequest(payload.request),
  } satisfies TokenlessHandoffPayload;
  // The outer handoff privacy envelope and the embedded request must describe the same data boundary.
  // A mismatch means the fragment was tampered with or built inconsistently; reject rather than silently
  // trusting either half.
  if (result.dataClassification !== result.request.dataClassification) {
    throw new Error("The handoff data classification does not match the embedded request.");
  }
  if (result.redactionSummary.trim() !== (result.request.redactionSummary ?? "").trim()) {
    throw new Error("The handoff redaction summary does not match the embedded request.");
  }
  if (expiresAtMs <= now.getTime())
    throw Object.assign(new Error("This handoff link has expired."), { payload: result });
  return result;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function validateTokenlessHandoffBinding(payload: TokenlessHandoffPayload) {
  const tokenMatch = TOKEN_PATTERN.exec(payload.handoffToken);
  if (!tokenMatch) throw new Error("handoffToken is invalid.");
  const tokenExpiryMs = Number.parseInt(tokenMatch[1], 36) * 1_000;
  const payloadExpiryMs = Date.parse(payload.expiresAt);
  if (!Number.isSafeInteger(tokenExpiryMs) || Math.abs(tokenExpiryMs - payloadExpiryMs) >= 1_000) {
    throw new Error("The handoff token and expiry do not match.");
  }
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify the handoff capability.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${payload.handoffId}\0${payload.handoffToken}`),
  );
  const expectedIdempotencyKey = `mcp:${bytesToBase64Url(new Uint8Array(digest))}`;
  if (payload.idempotencyKey !== expectedIdempotencyKey) {
    throw new Error("The handoff capability and idempotency key do not match.");
  }
}

async function readApiJson(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) return body;
  const details = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const failure = new Error(
    typeof details.message === "string"
      ? details.message
      : typeof details.error === "string"
        ? details.error
        : `Request failed with status ${response.status}.`,
  ) as ApiFailure;
  failure.code = typeof details.code === "string" ? details.code : undefined;
  failure.status = response.status;
  throw failure;
}

export function formatUsdcAtomic(value: string) {
  const atomicValue = BigInt(value);
  const whole = atomicValue / 1_000_000n;
  const fraction = (atomicValue % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toLocaleString("en-US")}.${fraction} USDC`;
}

export function formatBpsPercent(value: number) {
  return `${(value / 100)
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1")}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "long" }).format(new Date(value));
}

function sourceLabel(source: TokenlessQuoteRequest["audience"]["source"]) {
  return {
    customer_invited: "Customer-invited reviewers",
    rateloop_network: "RateLoop reviewer network",
    hybrid: "Invited and network reviewers, reported separately",
  }[source];
}

function classificationLabel(classification: TokenlessHandoffPayload["dataClassification"]) {
  return { public: "Public", synthetic: "Synthetic", redacted: "Redacted" }[classification];
}

function displaySelected(result: TokenlessResult, question: TokenlessQuestion) {
  const selected = result.verdict?.selected;
  if (!selected) return "No selection";
  if (question.kind === "head_to_head") {
    if (selected === question.optionA.key) return question.optionA.label;
    if (selected === question.optionB.key) return question.optionB.label;
  }
  if (question.kind === "binary") {
    if (selected === "yes" || selected === "positive") return question.positiveLabel || "Yes";
    if (selected === "no" || selected === "negative") return question.negativeLabel || "No";
  }
  return selected;
}

function percentFromBps(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function SummaryItem({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="border-l border-white/15 pl-4">
      <dt className="text-xs uppercase tracking-wider text-base-content/45">{label}</dt>
      <dd className={`mt-1 break-words text-sm text-base-content/85 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

export function TokenlessHandoffClient() {
  const [handoff, setHandoff] = useState<HandoffState>({ status: "loading" });
  const [request, setRequest] = useState<TokenlessQuoteRequest | null>(null);
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [mediaReview, setMediaReview] = useState<QuestionMediaReviewState>({ status: "ready" });
  const [quote, setQuote] = useState<TokenlessQuoteResponse | null>(null);
  const [ask, setAsk] = useState<TokenlessAskResponse | null>(null);
  const [result, setResult] = useState<TokenlessResult | null>(null);
  const [resultPending, setResultPending] = useState(false);
  const [busy, setBusy] = useState<"quote" | "submit" | "result" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = decodeTokenlessHandoffFragment(window.location.hash);
        await validateTokenlessHandoffBinding(payload);
        if (cancelled) return;
        setHandoff({ status: "ready", payload });
        setRequest(payload.request);
        setMediaReview(payload.request.question.media ? { status: "pending" } : { status: "ready" });
      } catch (cause) {
        const failure = cause as Error & { payload?: TokenlessHandoffPayload };
        if (failure.payload) {
          try {
            await validateTokenlessHandoffBinding(failure.payload);
            if (cancelled) return;
            setHandoff({ status: "expired", payload: failure.payload });
            setRequest(failure.payload.request);
            setMediaReview(failure.payload.request.question.media ? { status: "pending" } : { status: "ready" });
            return;
          } catch (bindingCause) {
            cause = bindingCause;
          }
        }
        if (cancelled) return;
        setHandoff({
          status: "invalid",
          message: cause instanceof Error ? cause.message : "Invalid handoff link.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSession = useCallback(async (signal: AbortSignal) => {
    try {
      const sessionBody = record(
        await readApiJson(await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin", signal })),
        "session",
      );
      if (sessionBody.authenticated !== true || typeof sessionBody.principalId !== "string") {
        setSession({ status: "anonymous" });
        return;
      }
      if (typeof sessionBody.expiresAt !== "string") {
        throw new Error("RateLoop returned an invalid signed-in session.");
      }
      setSession({
        status: "authenticated",
        principalId: sessionBody.principalId,
        expiresAt: sessionBody.expiresAt,
      });
      setWorkspaceLoading(true);
      try {
        const workspaceBody = record(
          await readApiJson(
            await fetch("/api/account/workspaces", { cache: "no-store", credentials: "same-origin", signal }),
          ),
          "workspaces response",
        );
        const nextWorkspaces = Array.isArray(workspaceBody.workspaces)
          ? (workspaceBody.workspaces as Workspace[]).filter(
              workspace =>
                typeof workspace?.workspaceId === "string" &&
                typeof workspace?.name === "string" &&
                typeof workspace?.prepaid?.availableAtomic === "string" &&
                ATOMIC_PATTERN.test(workspace.prepaid.availableAtomic),
            )
          : [];
        setWorkspaces(nextWorkspaces);
        setSelectedWorkspaceId(current =>
          current && nextWorkspaces.some(workspace => workspace.workspaceId === current)
            ? current
            : (nextWorkspaces[0]?.workspaceId ?? ""),
        );
      } catch (cause) {
        if (!signal.aborted) {
          setWorkspaceError(cause instanceof Error ? cause.message : "Unable to load prepaid workspaces.");
        }
      }
    } catch (cause) {
      if (!signal.aborted) {
        setSession({ status: "error", message: cause instanceof Error ? cause.message : "Unable to load sign-in." });
      }
    } finally {
      if (!signal.aborted) setWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSession(controller.signal);
    return () => controller.abort();
  }, [loadSession]);

  // When the user signs in through the separate tab and returns here, refresh the session so this
  // tab picks it up. The private handoff fragment stays in this tab and is never navigated away, so
  // the bearer capability is never exposed to the server or placed in a query string.
  useEffect(() => {
    if (session.status === "authenticated" || session.status === "loading") return;
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState === "visible") void loadSession(controller.signal);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadSession, session.status]);

  const payload = handoff.status === "ready" || handoff.status === "expired" ? handoff.payload : null;
  const selectedWorkspace = workspaces.find(workspace => workspace.workspaceId === selectedWorkspaceId) ?? null;
  const insufficientPrepaid =
    quote !== null &&
    selectedWorkspace !== null &&
    BigInt(selectedWorkspace.prepaid.availableAtomic) < BigInt(quote.economics.totalFundedAtomic);
  const submitted = ask !== null;
  const formDisabled = busy !== null || submitted || handoff.status !== "ready";
  const mediaReady = !request?.question.media || mediaReview.status === "ready";

  const handleMediaReview = useCallback((state: QuestionMediaReviewState) => {
    setMediaReview(state);
    if (state.status !== "ready") setPrivacyConfirmed(false);
  }, []);

  function changeRequest(next: TokenlessQuoteRequest) {
    setRequest(next);
    setQuote(null);
    setPrivacyConfirmed(false);
    setError(null);
  }

  function changeBinaryLabel(label: "negativeLabel" | "positiveLabel", value: string) {
    if (!request || request.question.kind !== "binary") return;
    const question = request.question;
    if (label === "negativeLabel") {
      const withoutLabel = { ...question };
      delete withoutLabel.negativeLabel;
      changeRequest({
        ...request,
        question: value ? { ...withoutLabel, negativeLabel: value } : withoutLabel,
      });
      return;
    }
    const withoutLabel = { ...question };
    delete withoutLabel.positiveLabel;
    changeRequest({
      ...request,
      question: value ? { ...withoutLabel, positiveLabel: value } : withoutLabel,
    });
  }

  function changeComparisonLabel(option: "optionA" | "optionB", value: string) {
    if (!request || request.question.kind !== "head_to_head") return;
    const question = request.question;
    changeRequest({
      ...request,
      question: {
        ...question,
        [option]: { ...question[option], label: value },
      },
    });
  }

  function ensureActiveHandoff() {
    if (!payload || handoff.status !== "ready") throw new Error("This handoff is not active.");
    if (Date.parse(payload.expiresAt) <= Date.now()) {
      setHandoff({ status: "expired", payload });
      throw new Error("This handoff link has expired.");
    }
    return payload;
  }

  async function createQuote() {
    setError(null);
    try {
      const active = ensureActiveHandoff();
      if (!mediaReady) throw new Error("Review every attached image or video before requesting a quote.");
      if (!privacyConfirmed) throw new Error("Confirm the non-sensitive data statement before requesting a quote.");
      const validated = validateTokenlessQuoteRequest(request);
      setBusy("quote");
      const parsed = parseTokenlessQuoteResponse(
        await readApiJson(
          await fetch("/api/agent/v1/quote", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(validated),
          }),
        ),
      );
      if (Date.parse(active.expiresAt) <= Date.now()) throw new Error("This handoff link expired while quoting.");
      setQuote(parsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the quote.");
    } finally {
      setBusy(null);
    }
  }

  async function fetchResult(operationKey: string) {
    setBusy("result");
    setResultPending(false);
    try {
      const parsed = parseTokenlessResult(
        await readApiJson(
          await fetch(`/api/agent/v1/results/${encodeURIComponent(operationKey)}`, {
            cache: "no-store",
            credentials: "same-origin",
          }),
        ),
      );
      setResult(parsed);
    } catch (cause) {
      const failure = cause as ApiFailure;
      if (failure.code === "result_not_ready") {
        setResultPending(true);
      } else {
        setError(failure instanceof Error ? failure.message : "Unable to load the result.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitAsk() {
    setError(null);
    try {
      const active = ensureActiveHandoff();
      if (!request || !quote) throw new Error("Request a current quote before submitting.");
      if (!mediaReady) throw new Error("Review every attached image or video before submitting.");
      if (!privacyConfirmed) throw new Error("Confirm the non-sensitive data statement before submitting.");
      if (Date.parse(quote.expiresAt) <= Date.now()) {
        setQuote(null);
        throw new Error("The quote expired. Request a new quote before submitting.");
      }
      if (session.status !== "authenticated") throw new Error("Sign in to RateLoop before submitting.");
      if (!selectedWorkspace) throw new Error("Select a prepaid workspace before submitting.");
      if (insufficientPrepaid) throw new Error("The selected workspace does not have enough available prepaid USDC.");
      const body = {
        idempotencyKey: active.idempotencyKey,
        quoteId: quote.quoteId,
        payment: { mode: "prepaid" as const, workspaceId: selectedWorkspace.workspaceId },
      };
      setBusy("submit");
      const parsed = parseTokenlessAskResponse(
        await readApiJson(
          await fetch("/api/agent/v1/asks", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", "Idempotency-Key": active.idempotencyKey },
            body: JSON.stringify(body),
          }),
        ),
      );
      if (parsed.idempotencyKey !== active.idempotencyKey) {
        throw new Error("RateLoop returned a mismatched idempotency key.");
      }
      setAsk(parsed);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      await fetchResult(parsed.operationKey);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit the ask.");
      setBusy(null);
    }
  }

  if (handoff.status === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-5xl grow items-center justify-center px-4 py-20" aria-busy="true">
        <p className="text-base-content/65" role="status">
          Reading the private handoff fragment in this browser…
        </p>
      </main>
    );
  }

  if (handoff.status === "invalid") {
    return (
      <main className="mx-auto w-full max-w-3xl grow px-4 py-16 sm:py-24">
        <section className="rateloop-surface-card border-error/30 p-6 sm:p-9" role="alert">
          <p className="font-mono text-xs uppercase tracking-widest text-error">Cannot open review</p>
          <h1 className="mt-4 text-3xl font-semibold">Ask the agent for a new link.</h1>
          <p className="mt-4 leading-7 text-base-content/65">{handoff.message}</p>
        </section>
      </main>
    );
  }

  if (!payload || !request) return null;

  if (handoff.status === "expired") {
    return (
      <main className="mx-auto w-full max-w-3xl grow px-4 py-16 sm:py-24">
        <section className="rateloop-surface-card border-error/30 p-6 sm:p-9" role="alert">
          <p className="font-mono text-xs uppercase tracking-widest text-error">Review link expired</p>
          <h1 className="mt-4 text-3xl font-semibold">Ask the agent for a new link.</h1>
          <p className="mt-4 text-sm leading-6 text-base-content/65">
            This link expired <time dateTime={payload.expiresAt}>{formatDate(payload.expiresAt)}</time>.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl grow px-4 py-10 sm:py-14">
      <header className="max-w-4xl">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Browser handoff</p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-5xl">Review this ask.</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-base-content/65 sm:text-lg">
          Check the question, confirm it is safe to share, then get the exact price.
        </p>
        <p className="mt-3 text-sm text-base-content/50">
          Link expires <time dateTime={payload.expiresAt}>{formatDate(payload.expiresAt)}</time>
        </p>
      </header>

      {error ? (
        <div className="mt-7 rounded-xl border border-error/30 bg-error/10 px-5 py-4 text-sm leading-6" role="alert">
          {error}
        </div>
      ) : null}

      <div className="mt-8 max-w-4xl">
        <section className="rateloop-surface-card p-5 sm:p-7" aria-labelledby="review-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">Review</p>
              <h2 id="review-heading" className="mt-2 text-2xl font-semibold">
                Question
              </h2>
            </div>
            <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-base-content/65">
              {request.question.kind === "binary" ? "Binary" : "Head to head"}
            </span>
          </div>

          <label className="mt-6 block text-sm font-medium" htmlFor="handoff-prompt">
            Exact prompt
          </label>
          <textarea
            id="handoff-prompt"
            className="textarea mt-2 min-h-36 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] text-base leading-7"
            maxLength={MAX_PROMPT_LENGTH}
            disabled={formDisabled}
            value={request.question.prompt}
            onChange={event =>
              changeRequest({ ...request, question: { ...request.question, prompt: event.target.value } })
            }
          />
          <p className="mt-1 text-right font-mono text-xs text-base-content/35">
            {request.question.prompt.length}/{MAX_PROMPT_LENGTH}
          </p>

          {request.question.kind === "binary" ? (
            <fieldset className="mt-5 grid gap-4 sm:grid-cols-2" disabled={formDisabled}>
              <legend className="sr-only">Binary answer labels</legend>
              <label className="text-sm text-base-content/65">
                Negative label
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  maxLength={200}
                  placeholder="No"
                  value={request.question.negativeLabel ?? ""}
                  onChange={event => changeBinaryLabel("negativeLabel", event.target.value)}
                />
              </label>
              <label className="text-sm text-base-content/65">
                Positive label
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  maxLength={200}
                  placeholder="Yes"
                  value={request.question.positiveLabel ?? ""}
                  onChange={event => changeBinaryLabel("positiveLabel", event.target.value)}
                />
              </label>
            </fieldset>
          ) : (
            <fieldset className="mt-5 grid gap-4 sm:grid-cols-2" disabled={formDisabled}>
              <legend className="sr-only">Head-to-head options</legend>
              <label className="text-sm text-base-content/65">
                Option A
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  maxLength={200}
                  value={request.question.optionA.label}
                  onChange={event => changeComparisonLabel("optionA", event.target.value)}
                />
                <span className="mt-1 block font-mono text-xs text-base-content/35">
                  Key: {request.question.optionA.key}
                </span>
              </label>
              <label className="text-sm text-base-content/65">
                Option B
                <input
                  className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                  maxLength={200}
                  value={request.question.optionB.label}
                  onChange={event => changeComparisonLabel("optionB", event.target.value)}
                />
                <span className="mt-1 block font-mono text-xs text-base-content/35">
                  Key: {request.question.optionB.key}
                </span>
              </label>
            </fieldset>
          )}

          {request.question.media ? (
            <div className="mt-7 border-t border-white/10 pt-6" aria-labelledby="handoff-media-heading">
              <h3 id="handoff-media-heading" className="text-sm font-medium">
                Attached context
              </h3>
              <p className="mt-1 text-sm leading-6 text-base-content/55">
                Review all attached context before confirming it is safe to share.
              </p>
              <QuestionMedia media={request.question.media} onReviewStateChange={handleMediaReview} />
              {mediaReview.status === "pending" ? (
                <p className="mt-3 text-sm text-base-content/55" role="status">
                  {request.question.media.kind === "youtube"
                    ? "Load the video to continue."
                    : "Loading attached images…"}
                </p>
              ) : null}
              {mediaReview.status === "error" ? (
                <p className="mt-3 text-sm text-error" role="alert">
                  {mediaReview.message}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-7 border-t border-white/10 pt-6">
            <p className="mb-5 text-sm leading-6 text-base-content/65">
              {sourceLabel(request.audience.source)} · {request.requestedPanelSize} reviewers
            </p>
            <label className="flex items-start gap-3 text-sm leading-6 text-base-content/80">
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-1 border-white/30"
                checked={privacyConfirmed}
                disabled={formDisabled || !mediaReady}
                onChange={event => setPrivacyConfirmed(event.target.checked)}
              />
              <span>
                I confirm this ask contains only public, synthetic, or meaningfully redacted non-sensitive data. It
                contains no secrets, credentials, regulated personal data, or confidential customer material.
              </span>
            </label>
          </div>

          <details className="mt-6 rounded-xl border border-white/10 bg-black/15 p-4 text-sm">
            <summary className="cursor-pointer font-medium">Request details</summary>
            <dl className="mt-5 grid gap-5 sm:grid-cols-2">
              <SummaryItem label="Classification" value={classificationLabel(payload.dataClassification)} />
              <SummaryItem
                label="Redaction summary"
                value={payload.redactionSummary.trim() || "No redaction summary supplied"}
              />
              <SummaryItem label="Admission policy" value={request.audience.admissionPolicyHash} mono />
              <SummaryItem label="Handoff ID" value={payload.handoffId} mono />
            </dl>
          </details>
        </section>
      </div>

      <section className="rateloop-surface-card mt-6 max-w-4xl p-5 sm:p-7" aria-labelledby="quote-heading">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Price</p>
        <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 id="quote-heading" className="text-2xl font-semibold">
              Get the exact price
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
              No funds are reserved until you submit the ask.
            </p>
          </div>
          <button
            type="button"
            className="rateloop-gradient-action min-h-11 shrink-0 px-5 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy !== null || submitted || handoff.status !== "ready" || !mediaReady || !privacyConfirmed}
            onClick={() => void createQuote()}
          >
            {busy === "quote" ? "Getting price…" : quote ? "Refresh price" : "Get price"}
          </button>
        </div>

        {quote ? (
          <div
            className="mt-6 rounded-xl border border-[var(--rateloop-green)]/25 bg-[var(--rateloop-green)]/5 p-5"
            aria-live="polite"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-base-content/55">Total</p>
                <p className="mt-1 text-2xl font-semibold">{formatUsdcAtomic(quote.economics.totalFundedAtomic)}</p>
                <p className="mt-2 text-sm text-base-content/60">
                  Includes {formatUsdcAtomic(quote.economics.attemptReserve.fundedAtomic)} accepted-work reserve.
                </p>
              </div>
              <p className="text-sm text-base-content/55">
                {quote.panel.requestedSize} reviewers · expires {formatDate(quote.expiresAt)}
              </p>
            </div>
            <details className="mt-5 border-t border-white/10 pt-4 text-sm">
              <summary className="cursor-pointer font-medium">Price details</summary>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <SummaryItem label="Reviewer bounty" value={formatUsdcAtomic(quote.economics.bounty.fundedAtomic)} />
                <SummaryItem
                  label={`Platform fee · ${formatBpsPercent(quote.economics.fee.bps)}`}
                  value={formatUsdcAtomic(quote.economics.fee.fundedAtomic)}
                />
                <SummaryItem
                  label="Accepted-work reserve"
                  value={formatUsdcAtomic(quote.economics.attemptReserve.fundedAtomic)}
                />
                <SummaryItem
                  label="Minimum reveals"
                  value={`${quote.panel.minimumReveals} of ${quote.panel.requestedSize}`}
                />
                <SummaryItem label="Audience" value={quote.audience.label} />
                <SummaryItem label="Estimated time" value={`${quote.slo.estimatedSeconds} seconds`} />
                <SummaryItem label="Quote ID" value={quote.quoteId} mono />
              </dl>
            </details>
          </div>
        ) : null}
      </section>

      {quote ? (
        <section className="rateloop-surface-card mt-6 max-w-4xl p-5 sm:p-7" aria-labelledby="submit-heading">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">Submit</p>
          <h2 id="submit-heading" className="mt-2 text-2xl font-semibold">
            Send this ask
          </h2>
          <p className="mt-2 text-sm leading-6 text-base-content/60">
            Submitting reserves {formatUsdcAtomic(quote.economics.totalFundedAtomic)} from the selected workspace.
          </p>

          <div className="mt-5 rounded-xl border border-white/10 bg-black/15 p-4">
            {session.status === "loading" ? (
              <p className="text-sm text-base-content/60" role="status">
                Checking your RateLoop session…
              </p>
            ) : session.status === "anonymous" ? (
              <div className="text-sm leading-6 text-base-content/70">
                <p>
                  <strong className="text-base-content">Sign in required.</strong> Open sign-in in a new tab, then
                  return to this tab to continue. This review link stays in this browser tab and is never sent to
                  RateLoop during sign-in.
                </p>
                <a
                  href="/sign-in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block font-semibold underline underline-offset-4"
                >
                  Sign in in a new tab
                </a>
              </div>
            ) : session.status === "error" ? (
              <p className="text-sm leading-6 text-error" role="alert">
                {session.message}
              </p>
            ) : (
              <p className="text-sm text-base-content/70">Choose the workspace that will fund this ask.</p>
            )}
          </div>

          {session.status === "authenticated" ? (
            <div className="mt-5">
              <label className="block text-sm font-medium" htmlFor="handoff-workspace">
                Prepaid workspace
              </label>
              {workspaceLoading ? (
                <p className="mt-2 text-sm text-base-content/55" role="status">
                  Loading workspaces…
                </p>
              ) : workspaceError ? (
                <p className="mt-2 text-sm leading-6 text-error" role="alert">
                  {workspaceError}
                </p>
              ) : workspaces.length ? (
                <>
                  <select
                    id="handoff-workspace"
                    className="select mt-2 w-full max-w-xl rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                    disabled={busy !== null || submitted}
                    value={selectedWorkspaceId}
                    onChange={event => setSelectedWorkspaceId(event.target.value)}
                  >
                    {workspaces.map(workspace => (
                      <option key={workspace.workspaceId} value={workspace.workspaceId}>
                        {workspace.name} · {formatUsdcAtomic(workspace.prepaid.availableAtomic)} available
                      </option>
                    ))}
                  </select>
                  {insufficientPrepaid ? (
                    <div className="mt-2 text-sm text-error" role="alert">
                      <p>This workspace has less available prepaid USDC than the quoted total.</p>
                      <Link
                        className="mt-1 inline-block font-semibold underline underline-offset-4"
                        href={`/agents?workspace=${encodeURIComponent(selectedWorkspace.workspaceId)}&tab=overview#panel-funding`}
                      >
                        Top up balance
                      </Link>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-2 text-sm leading-6 text-base-content/60">
                  <p>No prepaid workspace is available. Create and fund one before submitting this handoff.</p>
                  <Link
                    className="font-semibold underline underline-offset-4"
                    href="/agents?tab=overview#panel-funding"
                  >
                    Top up balance
                  </Link>
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-6 flex justify-end border-t border-white/10 pt-6">
            <button
              type="button"
              className="rateloop-gradient-action min-h-11 shrink-0 px-5 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={
                busy !== null ||
                submitted ||
                handoff.status !== "ready" ||
                !quote ||
                !privacyConfirmed ||
                session.status !== "authenticated" ||
                !selectedWorkspace ||
                insufficientPrepaid
              }
              onClick={() => void submitAsk()}
            >
              {busy === "submit"
                ? "Submitting…"
                : `Submit and reserve ${formatUsdcAtomic(quote.economics.totalFundedAtomic)}`}
            </button>
          </div>
        </section>
      ) : null}

      {ask ? (
        <section
          className="rateloop-surface-card mt-6 max-w-4xl p-5 sm:p-7"
          aria-labelledby="result-heading"
          aria-live="polite"
        >
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Result</p>
          <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h2 id="result-heading" className="text-2xl font-semibold">
                {result ? "Authenticated outcome" : "Ask submitted"}
              </h2>
              <p className="mt-2 font-mono text-xs text-base-content/50">Operation {ask.operationKey}</p>
            </div>
            {!result ? (
              <button
                type="button"
                className="btn rateloop-secondary-action min-h-10 px-4"
                disabled={busy !== null}
                onClick={() => void fetchResult(ask.operationKey)}
              >
                {busy === "result" ? "Checking…" : "Check authenticated result"}
              </button>
            ) : null}
          </div>

          {busy === "result" ? (
            <p className="mt-5 text-sm text-base-content/60" role="status">
              Fetching the authenticated result…
            </p>
          ) : resultPending ? (
            <div className="mt-5 rounded-xl border border-white/10 bg-black/15 p-4 text-sm leading-6 text-base-content/65">
              The ask is authenticated, but its terminal result is not ready. This page will not invent an outcome;
              check again after the panel and settlement finish.
            </div>
          ) : null}

          {result ? (
            <>
              <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryItem label="Status" value={result.verdictStatus.replaceAll("_", " ")} />
                <SummaryItem label="Selected" value={displaySelected(result, request.question)} />
                <SummaryItem
                  label="Preference share"
                  value={
                    result.verdict?.preferenceShareBps === null || result.verdict?.preferenceShareBps === undefined
                      ? "Not available"
                      : percentFromBps(result.verdict.preferenceShareBps)
                  }
                />
                <SummaryItem
                  label="Participants"
                  value={`${result.audience.participantCount} · ${result.audience.label}`}
                />
                <SummaryItem
                  label="Interval"
                  value={
                    result.verdict?.intervalBps
                      ? `${percentFromBps(result.verdict.intervalBps.lower)}–${percentFromBps(result.verdict.intervalBps.upper)}`
                      : "Not available"
                  }
                />
                <SummaryItem
                  label="Paid bounty"
                  value={`${formatUsdcAtomic(result.economics.bounty.paidAtomic)} (${result.economics.bounty.paidAtomic} atomic)`}
                />
                <SummaryItem
                  label="Refunded"
                  value={`${formatUsdcAtomic(result.economics.refund.totalAtomic)} (${result.economics.refund.totalAtomic} atomic)`}
                />
                <SummaryItem label="Updated" value={formatDate(result.updatedAt)} />
              </dl>
              <div className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/5 p-5 text-sm leading-6 text-base-content/65">
                <p className="font-semibold text-base-content">Limitations</p>
                <p className="mt-2">
                  This panel is decision support, not an automatic release, safety, legal, or compliance approval. The
                  accountable person remains responsible for the final action.
                </p>
                <a
                  className="mt-3 inline-block text-[var(--rateloop-blue)] underline underline-offset-4"
                  href={result.methodologyUrl}
                >
                  Read the methodology and result limitations
                </a>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
