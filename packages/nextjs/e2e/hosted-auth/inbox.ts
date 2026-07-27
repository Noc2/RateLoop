import { normalizeHostedAuthMailbox } from "./config";

const RESEND_RECEIVING_URL = "https://api.resend.com/emails/receiving";
const RATELOOP_OTP_SUBJECT = "Your RateLoop sign-in code";

type JsonObject = Record<string, unknown>;

export type OtpInboxWait = {
  recipient: string;
  requestedAt: Date;
  runStartedAt: Date;
  signal?: AbortSignal;
};

export interface OtpInbox {
  waitForOtp(input: OtpInboxWait): Promise<string>;
}

export type ResendReceivingInboxOptions = {
  apiKey: string;
  expectedFrom: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
};

type ResendReceivingInboxDependencies = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

type ReceivedEmailReference = {
  createdAt: Date;
  from: string;
  id: string;
  subject: string;
  to: string[];
};

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every(item => typeof item === "string") ? value : null;
}

function receivedAt(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function envelopeMailbox(value: string) {
  const bracketed = /^.*<([^<>]+)>$/u.exec(value.trim())?.[1];
  return normalizeHostedAuthMailbox(bracketed ?? value, "received email sender");
}

function exactRecipient(to: string[], recipient: string) {
  if (to.length !== 1) return false;
  try {
    return normalizeHostedAuthMailbox(to[0]!, "received email recipient") === recipient;
  } catch {
    return false;
  }
}

function parseReference(value: unknown): ReceivedEmailReference {
  const row = object(value);
  const to = stringArray(row?.to);
  const createdAt = receivedAt(row?.created_at);
  if (
    !row ||
    typeof row.id !== "string" ||
    !row.id ||
    typeof row.from !== "string" ||
    typeof row.subject !== "string" ||
    !to ||
    !createdAt
  ) {
    throw new Error("Resend Receiving returned malformed email metadata.");
  }
  return { createdAt, from: row.from, id: row.id, subject: row.subject, to };
}

function htmlToText(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&zwnj;|&#8204;/giu, "")
    .replace(/&amp;/giu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

function collectOtpCodes(value: string, output: Set<string>) {
  const pattern = /(?:Your one-time code:|One-time code)\s*([0-9]{6})(?![0-9])/giu;
  for (const match of value.matchAll(pattern)) output.add(match[1]!);
}

export function extractRateLoopOtp(input: { html?: string | null; text?: string | null }) {
  const codes = new Set<string>();
  if (input.text) collectOtpCodes(input.text, codes);
  if (input.html) collectOtpCodes(htmlToText(input.html), codes);
  if (codes.size !== 1) {
    throw new Error("The received RateLoop sign-in email did not contain exactly one labeled six-digit code.");
  }
  return [...codes][0]!;
}

export function redactHostedAuthSecrets(value: string, secrets: string[] = []) {
  let redacted = value;
  for (const secret of [...secrets].filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\bre_[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED_RESEND_KEY]")
    .replace(/\brlk_[a-f0-9]{16}_[A-Za-z0-9_-]{32,128}\b/gu, "[REDACTED_API_KEY]")
    .replace(/(\brateloop-session=)[^;\s]+/giu, "$1[REDACTED]")
    .replace(/\b[0-9]{6}\b/gu, "[REDACTED_OTP]");
}

async function abortableWait(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Hosted authentication inbox polling was aborted.");
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      action();
    };
    const timeout = setTimeout(() => finish(resolve), milliseconds);
    const abort = () => finish(() => reject(new Error("Hosted authentication inbox polling was aborted.")));
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class ResendReceivingInbox implements OtpInbox {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    private readonly options: ResendReceivingInboxOptions,
    dependencies: ResendReceivingInboxDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
    this.wait = dependencies.wait ?? abortableWait;
  }

  private async json(url: string, signal?: AbortSignal) {
    const response = await this.fetchImpl(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      throw new Error(`Resend Receiving request failed with status ${response.status}.`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error("Resend Receiving returned invalid JSON.");
    }
  }

  private async matchingReferences(input: OtpInboxWait) {
    const payload = object(await this.json(RESEND_RECEIVING_URL, input.signal));
    if (!payload || !Array.isArray(payload.data)) {
      throw new Error("Resend Receiving returned an invalid email list.");
    }
    const recipient = normalizeHostedAuthMailbox(input.recipient, "OTP recipient");
    const expectedFrom = normalizeHostedAuthMailbox(this.options.expectedFrom, "OTP sender");
    const notBefore = Math.max(input.runStartedAt.getTime(), input.requestedAt.getTime());
    return payload.data
      .map(parseReference)
      .filter(reference => {
        if (
          reference.createdAt.getTime() < notBefore ||
          reference.subject !== RATELOOP_OTP_SUBJECT ||
          !exactRecipient(reference.to, recipient)
        ) {
          return false;
        }
        try {
          return envelopeMailbox(reference.from) === expectedFrom;
        } catch {
          return false;
        }
      })
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  private async retrieveOtp(reference: ReceivedEmailReference, input: OtpInboxWait) {
    const payload = object(
      await this.json(`${RESEND_RECEIVING_URL}/${encodeURIComponent(reference.id)}`, input.signal),
    );
    const to = stringArray(payload?.to);
    const createdAt = receivedAt(payload?.created_at);
    if (
      !payload ||
      payload.id !== reference.id ||
      payload.subject !== RATELOOP_OTP_SUBJECT ||
      typeof payload.from !== "string" ||
      !to ||
      !createdAt ||
      !exactRecipient(to, normalizeHostedAuthMailbox(input.recipient, "OTP recipient")) ||
      envelopeMailbox(payload.from) !== normalizeHostedAuthMailbox(this.options.expectedFrom, "OTP sender") ||
      createdAt.getTime() < Math.max(input.runStartedAt.getTime(), input.requestedAt.getTime())
    ) {
      throw new Error("Resend Receiving returned mismatched sign-in email content.");
    }
    if (payload.text !== null && payload.text !== undefined && typeof payload.text !== "string") {
      throw new Error("Resend Receiving returned malformed sign-in email text.");
    }
    if (payload.html !== null && payload.html !== undefined && typeof payload.html !== "string") {
      throw new Error("Resend Receiving returned malformed sign-in email HTML.");
    }
    return extractRateLoopOtp({
      html: typeof payload.html === "string" ? payload.html : null,
      text: typeof payload.text === "string" ? payload.text : null,
    });
  }

  async waitForOtp(input: OtpInboxWait) {
    if (
      !Number.isFinite(input.runStartedAt.getTime()) ||
      !Number.isFinite(input.requestedAt.getTime()) ||
      input.requestedAt < input.runStartedAt
    ) {
      throw new Error("Hosted authentication inbox timestamps are invalid.");
    }
    const deadline = this.now().getTime() + this.options.pollTimeoutMs;
    while (this.now().getTime() <= deadline) {
      if (input.signal?.aborted) throw new Error("Hosted authentication inbox polling was aborted.");
      const references = await this.matchingReferences(input);
      if (references.length > 1) {
        throw new Error("More than one matching RateLoop sign-in email arrived during this authentication run.");
      }
      if (references[0]) return this.retrieveOtp(references[0], input);
      await this.wait(this.options.pollIntervalMs, input.signal);
    }
    throw new Error("Timed out waiting for the exact RateLoop sign-in email.");
  }
}
