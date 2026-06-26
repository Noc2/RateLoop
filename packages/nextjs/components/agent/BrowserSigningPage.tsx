"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useSignTypedData } from "wagmi";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  WalletIcon,
} from "@heroicons/react/24/outline";
import { RateLoopConnectButton } from "~~/components/scaffold-eth";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { surfaceSectionHeadingClassName } from "~~/components/shared/sectionHeading";
import { DOCS_AI_ROUTE } from "~~/constants/routes";
import { useRateLoopSwitchNetwork } from "~~/hooks/useRateLoopSwitchNetwork";
import { useWalletTransactionPlanExecutor } from "~~/hooks/useWalletTransactionPlanExecutor";
import {
  readBrowserSigningExpectedX402Amount,
  validateBrowserX402AuthorizationRequest,
} from "~~/lib/agent/browserSigningValidation";
import {
  type SubmissionRewardAsset,
  formatSubmissionRewardAmount,
  getConfiguredContentRegistryAddress,
  getConfiguredFeedbackBonusEscrowAddress,
  getConfiguredQuestionRewardPoolEscrowAddress,
  getConfiguredX402QuestionSubmitterAddress,
  getDefaultUsdcAddress,
} from "~~/lib/questionRewardPools";
import { notification } from "~~/utils/scaffold-eth";

type JsonRecord = Record<string, unknown>;

type SigningIntent = {
  chainId: number | null;
  clientRequestId: string | null;
  error: string | null;
  expiresAt: string;
  id: string;
  operationKey: string | null;
  paymentMode: "wallet_calls" | "x402_authorization";
  payloadHash: string | null;
  requestBody?: JsonRecord;
  status: string;
  transactionHashes?: string[];
  transactionPlan?: {
    calls?: Array<{
      data?: string;
      description?: string;
      functionName?: string;
      id?: string;
      phase?: string;
      to?: string;
      value?: string;
      waitAfterMs?: number;
    }>;
    requiresAtomicExecution?: boolean;
    requiresOrderedExecution?: boolean;
  } | null;
  wallet?: { address?: string; note?: string };
  walletAddress: string | null;
  x402AuthorizationRequest?: JsonRecord | null;
};

type ExecutionStep = {
  hash?: string;
  label: string;
  status: "pending" | "sent" | "confirmed";
};

function sameAddress(left: string | undefined | null, right: string | undefined | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function shortAddress(value: string | null | undefined) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Not set";
}

function getPostCallDelayMs(call: NonNullable<NonNullable<SigningIntent["transactionPlan"]>["calls"]>[number]) {
  return Number.isFinite(call.waitAfterMs) ? Math.max(0, call.waitAfterMs ?? 0) : 0;
}

function readToken() {
  // C-1 (2026-05-22 audit): signing links carry the token in the URL fragment
  // (#token=...) so it cannot leak via Referer or proxy logs.
  if (typeof window !== "undefined") {
    const hash = window.location.hash;
    if (hash) {
      const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const fromHash = hashParams.get("token");
      if (fromHash) return fromHash;
    }
  }
  return "";
}

function readQuestionTitle(intent: SigningIntent | null) {
  const question = intent?.requestBody?.question;
  if (question && typeof question === "object" && !Array.isArray(question)) {
    const title = (question as JsonRecord).title;
    return typeof title === "string" && title.trim() ? title.trim() : "RateLoop ask";
  }
  const questions = intent?.requestBody?.questions;
  if (Array.isArray(questions) && questions.length > 0) {
    return `${questions.length} question bundle`;
  }
  return "RateLoop ask";
}

function readBounty(intent: SigningIntent | null) {
  const bounty = intent?.requestBody?.bounty;
  if (!bounty || typeof bounty !== "object" || Array.isArray(bounty)) return "Unknown bounty";
  const amount = (bounty as JsonRecord).amount;
  if (typeof amount !== "string" && typeof amount !== "number") return "Unknown bounty";
  const assetRaw = (bounty as JsonRecord).asset;
  const asset: SubmissionRewardAsset =
    typeof assetRaw === "string" && assetRaw.trim().toLowerCase() === "lrep" ? "lrep" : "usdc";
  let atomic: bigint;
  try {
    atomic = BigInt(amount);
  } catch {
    return "Unknown bounty";
  }
  return formatSubmissionRewardAmount(atomic, asset);
}

function isFeedbackBonusSigningStep(intent: SigningIntent | null) {
  return intent?.status === "feedback_bonus_prepared";
}

// C-2 (2026-05-22 audit): decode the two ERC-20 selectors most commonly seen here
// (transfer, approve) so the user can see who/how-much before signing. The page
// also shows raw calldata, but humans skim — a decoded "approve(spender=0x.., amount=..)"
// line makes a phishing substitution (e.g. "Approve USDC" description hiding a
// transfer to attacker) far easier to spot. Extend the table when new selectors
// appear on the agent-call path; unknown selectors render the raw calldata as before.
const KNOWN_ERC20_SELECTORS = {
  "0xa9059cbb": { name: "transfer", argLabels: ["recipient", "amount"] },
  "0x095ea7b3": { name: "approve", argLabels: ["spender", "amount"] },
  "0x23b872dd": { name: "transferFrom", argLabels: ["from", "to", "amount"] },
} as const satisfies Record<string, { name: string; argLabels: readonly string[] }>;

type DecodedCall = { name: string; args: Array<{ label: string; value: string }> } | null;

function decodeKnownErc20Call(data: string): DecodedCall {
  if (typeof data !== "string" || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  const definition = (KNOWN_ERC20_SELECTORS as Record<string, { name: string; argLabels: readonly string[] }>)[
    selector
  ];
  if (!definition) return null;
  const body = data.slice(10);
  if (body.length < definition.argLabels.length * 64) return null;
  const args = definition.argLabels.map((label, index) => {
    const word = body.slice(index * 64, (index + 1) * 64);
    if (label === "amount") {
      try {
        return { label, value: BigInt(`0x${word}`).toString() };
      } catch {
        return { label, value: `0x${word}` };
      }
    }
    // address args occupy the low 20 bytes of a 32-byte word
    return { label, value: `0x${word.slice(-40)}` };
  });
  return { name: definition.name, args };
}

function readResponseError(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as { error?: unknown; message?: unknown };
  return typeof record.message === "string"
    ? record.message
    : typeof record.error === "string"
      ? record.error
      : fallback;
}

export function BrowserSigningPage({ intentId }: { intentId: string }) {
  const { address, chain } = useAccount();
  const { signTypedDataAsync, isPending: isSigningTypedData } = useSignTypedData();
  const { switchToChain, switchingChainId } = useRateLoopSwitchNetwork();
  const { executeWalletTransactionPlan } = useWalletTransactionPlanExecutor();
  // WS-1 (2026-05-21 repo audit): the `token` is the bearer credential for this signing intent.
  // Leaving it in the URL leaks it through browser history, the Referer header on any
  // cross-origin navigation, server access logs, and any analytics script allowed by CSP.
  //
  // Capture the token into stable component state on the first render *before* mutating the
  // URL, so subsequent re-renders don't reset the in-memory copy that the prepare/complete
  // API calls depend on. `useState(initialFn)` runs `initialFn` exactly once
  // on mount and ignores future URL changes.
  const [token] = useState(readToken);
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Strip the token fragment so a returning user sharing their screen doesn't expose it,
    // and so browser back/forward navigation lands on a clean URL.
    const hasTokenInHash = window.location.hash.includes("token=");
    if (!hasTokenInHash) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);
  const [intent, setIntent] = useState<SigningIntent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ExecutionStep[]>([]);

  const isFeedbackBonusStep = isFeedbackBonusSigningStep(intent);
  const isTerminalStatus = intent?.status === "expired" || intent?.status === "submitted";
  const connectedMismatch = Boolean(intent?.walletAddress && address && !sameAddress(intent.walletAddress, address));
  const hasTransactionPlan = Boolean(intent?.transactionPlan?.calls?.length);
  const needsChainSwitch = Boolean(intent?.chainId && chain?.id && chain.id !== intent.chainId);
  const canPrepare = Boolean(
    token &&
      address &&
      intent &&
      !connectedMismatch &&
      !isFeedbackBonusStep &&
      !isPreparing &&
      !isExecuting &&
      !isTerminalStatus,
  );
  const canExecute = Boolean(
    address && intent && hasTransactionPlan && !connectedMismatch && !isExecuting && !isTerminalStatus,
  );

  const loadIntent = useCallback(async () => {
    if (!token) {
      setError("This signing link is missing its private token.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/signing-intents/${intentId}`, {
        headers: {
          "x-rateloop-signing-intent-token": token,
        },
      });
      const body = (await response.json()) as SigningIntent | { message?: string; error?: string };
      if (!response.ok) throw new Error(readResponseError(body, "Failed to load signing intent."));
      setIntent(body as SigningIntent);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load signing intent.");
    } finally {
      setIsLoading(false);
    }
  }, [intentId, token]);

  useEffect(() => {
    void loadIntent();
  }, [loadIntent]);

  const postPrepare = useCallback(
    async (paymentAuthorization?: JsonRecord) => {
      if (!address) throw new Error("Connect a wallet before preparing this ask.");
      const response = await fetch(`/api/agent/signing-intents/${intentId}/prepare`, {
        body: JSON.stringify({
          paymentAuthorization,
          token,
          walletAddress: address,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as SigningIntent | { message?: string; error?: string };
      if (!response.ok) throw new Error(readResponseError(body, "Failed to prepare signing intent."));
      return body as SigningIntent;
    },
    [address, intentId, token],
  );

  const handlePrepare = useCallback(async () => {
    if (!address) {
      notification.error("Connect the wallet that will sign this ask.");
      return;
    }
    if (connectedMismatch) {
      notification.error("Connected wallet does not match this signing link.");
      return;
    }

    setIsPreparing(true);
    setError(null);
    try {
      if (intent?.chainId && chain?.id !== intent.chainId) {
        await switchToChain(intent.chainId);
      }

      let prepared = await postPrepare();
      const authorizationRequest = prepared.x402AuthorizationRequest;
      const calls = prepared.transactionPlan?.calls ?? [];
      if (authorizationRequest && calls.length === 0) {
        if (!intent?.chainId) {
          throw new Error("Signing intent is missing a chainId.");
        }
        const expectedUsdcAddress = getDefaultUsdcAddress(intent.chainId);
        if (!expectedUsdcAddress) {
          throw new Error("Cannot validate x402 authorization without a configured USDC token.");
        }
        const expectedSubmitterAddress = getConfiguredX402QuestionSubmitterAddress(intent.chainId);
        if (!expectedSubmitterAddress) {
          throw new Error("Cannot validate x402 authorization without a configured RateLoop x402 submitter.");
        }
        const expectedContentRegistryAddress = getConfiguredContentRegistryAddress(intent.chainId);
        if (!expectedContentRegistryAddress) {
          throw new Error("Cannot validate x402 authorization without a configured ContentRegistry.");
        }
        const expectedQuestionRewardPoolEscrowAddress = getConfiguredQuestionRewardPoolEscrowAddress(intent.chainId);
        if (!expectedQuestionRewardPoolEscrowAddress) {
          throw new Error("Cannot validate x402 authorization without a configured question reward escrow.");
        }
        const { authorization, typedData } = validateBrowserX402AuthorizationRequest({
          expectedAmount: readBrowserSigningExpectedX402Amount(intent.requestBody),
          expectedChainId: intent.chainId,
          expectedContentRegistryAddress,
          expectedFeedbackBonusEscrowAddress: getConfiguredFeedbackBonusEscrowAddress(intent.chainId),
          expectedQuestionRewardPoolEscrowAddress,
          expectedSubmitterAddress,
          expectedUsdcAddress,
          expectedWalletAddress: address,
          request: authorizationRequest,
          requestBody: intent.requestBody,
        });
        const signature = await signTypedDataAsync({
          domain: typedData.domain,
          message: typedData.message,
          primaryType: typedData.primaryType,
          types: typedData.types,
        });
        prepared = await postPrepare({
          ...authorization,
          signature,
        });
      }

      setIntent(prepared);
      notification.success("RateLoop ask is ready for wallet execution.");
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : "Failed to prepare signing intent.");
    } finally {
      setIsPreparing(false);
    }
  }, [
    address,
    chain?.id,
    connectedMismatch,
    intent?.chainId,
    intent?.requestBody,
    postPrepare,
    signTypedDataAsync,
    switchToChain,
  ]);

  const handleExecute = useCallback(async () => {
    const preparedIntent = intent;
    if (!preparedIntent?.transactionPlan?.calls?.length) {
      notification.error("Prepare this ask before executing wallet calls.");
      return;
    }
    if (!address) {
      notification.error("Connect the wallet that will sign this ask.");
      return;
    }
    if (connectedMismatch) {
      notification.error("Connected wallet does not match this signing link.");
      return;
    }

    setIsExecuting(true);
    setError(null);

    try {
      let currentIntent: SigningIntent = preparedIntent;
      let completedBonusStep = false;

      while (true) {
        const transactionPlan = currentIntent.transactionPlan;
        const calls = transactionPlan?.calls ?? [];
        if (calls.length === 0) {
          throw new Error("Prepared transaction plan is empty.");
        }

        setSteps(
          calls.map(call => ({
            label: call.description || call.phase || call.id || "Wallet call",
            status: "pending",
          })),
        );

        if (currentIntent.chainId && chain?.id !== currentIntent.chainId) {
          await switchToChain(currentIntent.chainId);
        }

        // Coerce null -> undefined for wagmi; binding chainId makes viem re-assert
        // the live wallet chain per call instead of trusting the pre-loop switch.
        const intentChainId = currentIntent.chainId ?? undefined;
        const hashes = await executeWalletTransactionPlan({
          action: isFeedbackBonusSigningStep(currentIntent)
            ? "browser signing feedback bonus funding"
            : "browser signing ask submission",
          calls,
          chainId: intentChainId,
          getPostCallDelayMs,
          onCallConfirmed: ({ hash, index }) => {
            setSteps(current =>
              current.map((step, stepIndex) => (stepIndex === index ? { ...step, hash, status: "confirmed" } : step)),
            );
          },
          onCallSent: ({ hash, index }) => {
            setSteps(current =>
              current.map((step, stepIndex) => (stepIndex === index ? { ...step, hash, status: "sent" } : step)),
            );
          },
          requiresAtomicExecution: transactionPlan?.requiresAtomicExecution,
          requiresOrderedExecution: transactionPlan?.requiresOrderedExecution,
        });

        const response = await fetch(`/api/agent/signing-intents/${intentId}/complete`, {
          body: JSON.stringify({ token, transactionHashes: hashes }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const body = (await response.json()) as SigningIntent | { message?: string; error?: string };
        if (!response.ok) throw new Error(readResponseError(body, "Failed to confirm RateLoop ask."));
        const nextIntent = body as SigningIntent;
        setIntent(nextIntent);

        if (isFeedbackBonusSigningStep(nextIntent)) {
          if (!nextIntent.transactionPlan?.calls?.length) {
            throw new Error("RateLoop returned a Feedback Bonus step without wallet calls.");
          }
          completedBonusStep = true;
          currentIntent = nextIntent;
          continue;
        }

        notification.success(
          completedBonusStep ? "Ask submitted and Feedback Bonus funded." : "Ask submitted to RateLoop.",
        );
        break;
      }
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : "Failed to execute wallet calls.");
    } finally {
      setIsExecuting(false);
    }
  }, [address, chain?.id, connectedMismatch, executeWalletTransactionPlan, intent, intentId, switchToChain, token]);

  return (
    <AppPageShell contentClassName="space-y-5" paddingTopClassName="pt-6">
      <section className="surface-card rounded-lg p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-base-content/50">Agent signing handoff</p>
            <h1 className={`${surfaceSectionHeadingClassName} mt-2`}>{readQuestionTitle(intent)}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-base-content/65">
              Review this RateLoop ask, connect the wallet that should pay the bounty, then sign and submit the prepared
              wallet calls.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RateLoopConnectButton />
            <Link href={DOCS_AI_ROUTE} className="btn btn-outline btn-sm">
              For Agents
            </Link>
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="surface-card rounded-lg p-6">
          <span className="loading loading-spinner loading-sm text-primary" /> Loading signing intent...
        </div>
      ) : null}

      {error ? (
        <div className="surface-card-nested rounded-lg p-4 text-sm text-error">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {intent ? (
        <>
          <section className="surface-card rounded-lg p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="surface-card-nested rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <WalletIcon className="h-4 w-4" />
                  <span>Signer wallet</span>
                </div>
                <p className="mt-2 font-mono text-sm">{shortAddress(intent.walletAddress ?? address)}</p>
              </div>
              <div className="surface-card-nested rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <ShieldCheckIcon className="h-4 w-4" />
                  <span>Bounty</span>
                </div>
                <p className="mt-2 text-lg font-semibold">{readBounty(intent)}</p>
              </div>
              <div className="surface-card-nested rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <CheckCircleIcon className="h-4 w-4" />
                  <span>Status</span>
                </div>
                <p className="mt-2 text-sm font-semibold">{intent.status}</p>
              </div>
            </div>

            {connectedMismatch ? (
              <p className="surface-card-nested mt-4 rounded-lg p-3 text-sm text-warning">
                This signing link expects {intent.walletAddress}. You are connected as {address}.
              </p>
            ) : null}
            {needsChainSwitch ? (
              <p className="surface-card-nested mt-4 rounded-lg p-3 text-sm text-warning">
                This ask is on chain {intent.chainId}. Your wallet is on chain {chain?.id}.
              </p>
            ) : null}
          </section>

          <section className="surface-card rounded-lg p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Sign And Submit</h2>
                <p className="mt-1 text-sm text-base-content/60">
                  Browser signing keeps the private key in the user wallet. RateLoop receives only the submitted
                  transaction hashes.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-outline btn-sm" type="button" onClick={() => void loadIntent()}>
                  <ArrowPathIcon className="h-4 w-4" />
                  Refresh
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!canPrepare || isSigningTypedData || switchingChainId !== null}
                  type="button"
                  onClick={() => void handlePrepare()}
                >
                  {isPreparing || isSigningTypedData ? "Preparing..." : "Prepare"}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!canExecute || switchingChainId !== null}
                  type="button"
                  onClick={() => void handleExecute()}
                >
                  {isExecuting ? "Submitting..." : isFeedbackBonusStep ? "Fund Bonus" : "Submit"}
                </button>
              </div>
            </div>

            {intent.transactionPlan?.calls?.length ? (
              <div className="mt-4 space-y-2">
                {intent.transactionPlan.calls.map((call, index) => (
                  <div
                    key={`${call.id ?? call.phase ?? "call"}-${index}`}
                    className="surface-card-nested rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{call.description ?? call.phase ?? "Wallet call"}</span>
                      <span className="reward-chip reward-chip-muted px-2 py-0.5 text-xs">
                        {steps[index]?.status ?? "ready"}
                      </span>
                    </div>
                    <p className="mt-1 break-all font-mono text-xs text-base-content/55">to: {call.to}</p>
                    {call.value && call.value !== "0" && call.value !== "0x0" ? (
                      <p className="mt-1 break-all font-mono text-xs text-base-content/55">value: {call.value}</p>
                    ) : null}
                    {/*
                     * WS-2 (2026-05-21 repo audit): show the function selector and full calldata
                     * so the user can verify what the wallet is about to be asked to sign. Without
                     * this, the user trusted only the server-supplied `description` — a poisoned
                     * MCP tool, a compromised server, or a stale plan could display "Approve USDC"
                     * while the calldata actually called `transfer(victim, max)`. The wallet
                     * software does show the raw calldata before broadcasting, but most users
                     * don't read it; surfacing it here gives a second chance before sign-off.
                     */}
                    {call.data ? (
                      <div className="mt-1 space-y-1">
                        <p className="font-mono text-xs text-base-content/55">
                          selector: <span className="text-base-content/75">{call.data.slice(0, 10)}</span>
                        </p>
                        {(() => {
                          const decoded = decodeKnownErc20Call(call.data);
                          if (!decoded) return null;
                          return (
                            <p className="font-mono text-xs text-warning">
                              decoded: {decoded.name}(
                              {decoded.args.map((arg, argIndex) => (
                                <span key={arg.label}>
                                  {argIndex > 0 ? ", " : ""}
                                  {arg.label}=<span className="text-base-content/85">{arg.value}</span>
                                </span>
                              ))}
                              )
                            </p>
                          );
                        })()}
                        <p className="break-all font-mono text-[10px] text-base-content/40">data: {call.data}</p>
                      </div>
                    ) : null}
                    {steps[index]?.hash ? (
                      <p className="mt-1 break-all font-mono text-xs text-base-content/55">tx: {steps[index].hash}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-base-content/60">
                Prepare this signing intent to fetch the wallet calls. x402 asks may first request a typed-data
                signature, then return the transaction plan.
              </p>
            )}
          </section>
        </>
      ) : null}
    </AppPageShell>
  );
}
