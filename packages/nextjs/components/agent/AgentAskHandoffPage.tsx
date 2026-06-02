"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type Address, type Hex, isAddress } from "viem";
import { useAccount, useConfig, useSignMessage } from "wagmi";
import { sendTransaction, waitForTransactionReceipt } from "wagmi/actions";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PhotoIcon,
  ShieldCheckIcon,
  WalletIcon,
} from "@heroicons/react/24/outline";
import { RateLoopConnectButton } from "~~/components/scaffold-eth";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { surfaceSectionHeadingClassName } from "~~/components/shared/sectionHeading";
import { DOCS_AI_ROUTE } from "~~/constants/routes";
import { useRateLoopSwitchNetwork } from "~~/hooks/useRateLoopSwitchNetwork";
import { notification } from "~~/utils/scaffold-eth";

type JsonRecord = Record<string, unknown>;

type HandoffAsset = {
  attachmentId?: string;
  dataUrl?: string;
  error?: string | null;
  filename?: string;
  id: string;
  imageUrl?: string | null;
  mimeType?: string;
  sha256?: string;
  sizeBytes?: number;
  status?: string;
};

type HandoffTransactionPlan = {
  calls?: Array<{
    data?: string;
    description?: string;
    id?: string;
    phase?: string;
    to?: string;
    value?: string;
    waitAfterMs?: number;
  }>;
  requiresOrderedExecution?: boolean;
};

type Handoff = {
  assets?: HandoffAsset[];
  chainId: number | null;
  clientRequestId: string | null;
  error: string | null;
  expiresAt: string;
  id: string;
  operationKey: string | null;
  payloadHash: string | null;
  paymentMode: "wallet_calls";
  publicUrl?: string | null;
  requestBody?: JsonRecord;
  status: string;
  transactionHashes?: string[];
  transactionPlan?: HandoffTransactionPlan | null;
  walletAddress: string | null;
};

type UploadChallenge = {
  assetId: string;
  attachmentId?: string;
  challengeId: string;
  expiresAt?: string;
  message: string;
};

type PrepareResponse = Handoff & {
  nextAction?: string;
  uploadChallenges?: UploadChallenge[];
};

type ExecutionStep = {
  hash?: string;
  label: string;
  status: "pending" | "sent" | "confirmed";
};

type ImageSignatureStep = {
  assetId: string;
  filename: string;
  status: "pending" | "signed";
};

function sameAddress(left: string | undefined | null, right: string | undefined | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function shortAddress(value: string | null | undefined) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Not set";
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readToken(searchParams: URLSearchParams) {
  if (typeof window !== "undefined") {
    const hash = window.location.hash;
    if (hash) {
      const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const fromHash = hashParams.get("token");
      if (fromHash) return fromHash;
    }
  }
  return searchParams.get("token") ?? "";
}

function readQuestionTitle(handoff: Handoff | null) {
  const question = handoff?.requestBody?.question;
  if (question && typeof question === "object" && !Array.isArray(question)) {
    const title = (question as JsonRecord).title;
    return typeof title === "string" && title.trim() ? title.trim() : "RateLoop ask";
  }
  const questions = handoff?.requestBody?.questions;
  if (Array.isArray(questions) && questions.length > 0) {
    return `${questions.length} question bundle`;
  }
  return "RateLoop ask";
}

function readBounty(handoff: Handoff | null) {
  const bounty = handoff?.requestBody?.bounty;
  if (!bounty || typeof bounty !== "object" || Array.isArray(bounty)) return "Unknown bounty";
  const amount = (bounty as JsonRecord).amount;
  if (typeof amount !== "string" && typeof amount !== "number") return "Unknown bounty";
  let atomic: bigint;
  try {
    atomic = BigInt(amount);
  } catch {
    return "Unknown bounty";
  }
  const whole = atomic / 1_000_000n;
  const fractional = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toString()}${fractional ? `.${fractional}` : ""} USDC`;
}

function normalizeHex(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x([a-fA-F0-9]{2})*$/.test(value)) {
    throw new Error(`${field} must be hex data.`);
  }
  return value as Hex;
}

function normalizeAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${field} must be an EVM address.`);
  }
  return value as Address;
}

function assertZeroValue(value: unknown, field: string) {
  if (value === undefined || value === null || value === "" || value === "0" || value === 0 || value === 0n) return 0n;
  if (typeof value === "string" && /^0x0+$/i.test(value)) return 0n;
  throw new Error(`${field} must be zero.`);
}

const KNOWN_ERC20_SELECTORS = {
  "0x095ea7b3": { argLabels: ["spender", "amount"], name: "approve" },
  "0x23b872dd": { argLabels: ["from", "to", "amount"], name: "transferFrom" },
  "0xa9059cbb": { argLabels: ["recipient", "amount"], name: "transfer" },
} as const satisfies Record<string, { argLabels: readonly string[]; name: string }>;

type DecodedCall = { args: Array<{ label: string; value: string }>; name: string } | null;

function decodeKnownErc20Call(data: string): DecodedCall {
  if (typeof data !== "string" || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  const definition = (KNOWN_ERC20_SELECTORS as Record<string, { argLabels: readonly string[]; name: string }>)[
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
    return { label, value: `0x${word.slice(-40)}` };
  });
  return { args, name: definition.name };
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

function imageSignatureLabel(challenge: UploadChallenge, handoff: Handoff | null) {
  const asset = handoff?.assets?.find(candidate => candidate.id === challenge.assetId);
  return asset?.filename || challenge.attachmentId || challenge.assetId;
}

export function AgentAskHandoffPage({ handoffId }: { handoffId: string }) {
  const searchParams = useSearchParams();
  const wagmiConfig = useConfig();
  const { address, chain } = useAccount();
  const { signMessageAsync, isPending: isSigningMessage } = useSignMessage();
  const { switchToChain, switchingChainId } = useRateLoopSwitchNetwork();
  const [token] = useState(() => readToken(searchParams));
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [imageSignatureSteps, setImageSignatureSteps] = useState<ImageSignatureStep[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasTokenInQuery = window.location.search.includes("token=");
    const hasTokenInHash = window.location.hash.includes("token=");
    if (!hasTokenInQuery && !hasTokenInHash) return;
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const isTerminalStatus = handoff?.status === "expired" || handoff?.status === "submitted";
  const connectedMismatch = Boolean(handoff?.walletAddress && address && !sameAddress(handoff.walletAddress, address));
  const hasTransactionPlan = Boolean(handoff?.transactionPlan?.calls?.length);
  const needsChainSwitch = Boolean(handoff?.chainId && chain?.id && chain.id !== handoff.chainId);
  const canPrepare = Boolean(
    token &&
      address &&
      handoff &&
      handoff.status !== "prepared" &&
      !connectedMismatch &&
      !isPreparing &&
      !isExecuting &&
      !isTerminalStatus,
  );
  const canExecute = Boolean(
    address && handoff && hasTransactionPlan && !connectedMismatch && !isExecuting && !isTerminalStatus,
  );

  const loadHandoff = useCallback(async () => {
    if (!token) {
      setError("This handoff link is missing its private token.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/handoffs/${handoffId}`, {
        headers: {
          "x-rateloop-handoff-token": token,
        },
      });
      const body = (await response.json()) as Handoff | { error?: string; message?: string };
      if (!response.ok) throw new Error(readResponseError(body, "Failed to load handoff."));
      setHandoff(body as Handoff);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load handoff.");
    } finally {
      setIsLoading(false);
    }
  }, [handoffId, token]);

  useEffect(() => {
    void loadHandoff();
  }, [loadHandoff]);

  const postPrepare = useCallback(
    async (imageSignatures?: Array<{ assetId: string; challengeId: string; signature: Hex }>) => {
      if (!address) throw new Error("Connect a wallet before preparing this ask.");
      const response = await fetch(`/api/agent/handoffs/${handoffId}/prepare`, {
        body: JSON.stringify({
          imageSignatures,
          token,
          walletAddress: address,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as PrepareResponse | { error?: string; message?: string };
      if (!response.ok) throw new Error(readResponseError(body, "Failed to prepare handoff."));
      return body as PrepareResponse;
    },
    [address, handoffId, token],
  );

  const handlePrepare = useCallback(async () => {
    if (!address) {
      notification.error("Connect the wallet that will fund this ask.");
      return;
    }
    if (connectedMismatch) {
      notification.error("Connected wallet does not match this handoff.");
      return;
    }

    setIsPreparing(true);
    setImageSignatureSteps([]);
    setError(null);
    try {
      if (handoff?.chainId && chain?.id !== handoff.chainId) {
        await switchToChain(handoff.chainId);
      }

      let prepared = await postPrepare();
      setHandoff(prepared);
      const uploadChallenges = prepared.uploadChallenges ?? [];
      if (uploadChallenges.length > 0) {
        setImageSignatureSteps(
          uploadChallenges.map(challenge => ({
            assetId: challenge.assetId,
            filename: imageSignatureLabel(challenge, prepared),
            status: "pending",
          })),
        );
        const imageSignatures = [];
        for (const challenge of uploadChallenges) {
          const signature = await signMessageAsync({ message: challenge.message });
          imageSignatures.push({
            assetId: challenge.assetId,
            challengeId: challenge.challengeId,
            signature,
          });
          setImageSignatureSteps(current =>
            current.map(step => (step.assetId === challenge.assetId ? { ...step, status: "signed" } : step)),
          );
        }
        prepared = await postPrepare(imageSignatures);
      }

      setHandoff(prepared);
      notification.success("RateLoop ask is ready for wallet execution.");
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : "Failed to prepare handoff.");
    } finally {
      setIsPreparing(false);
    }
  }, [address, chain?.id, connectedMismatch, handoff?.chainId, postPrepare, signMessageAsync, switchToChain]);

  const handleExecute = useCallback(async () => {
    if (!handoff?.transactionPlan?.calls?.length) {
      notification.error("Prepare this handoff before submitting wallet calls.");
      return;
    }
    if (!address) {
      notification.error("Connect the wallet that will fund this ask.");
      return;
    }
    if (connectedMismatch) {
      notification.error("Connected wallet does not match this handoff.");
      return;
    }

    setIsExecuting(true);
    setError(null);
    const hashes: Hex[] = [];
    const nextSteps: ExecutionStep[] = handoff.transactionPlan.calls.map(call => ({
      label: call.description || call.phase || call.id || "Wallet call",
      status: "pending",
    }));
    setSteps(nextSteps);

    try {
      if (handoff.chainId && chain?.id !== handoff.chainId) {
        await switchToChain(handoff.chainId);
      }

      const handoffChainId = handoff.chainId ?? undefined;
      for (const [index, call] of handoff.transactionPlan.calls.entries()) {
        const to = normalizeAddress(call.to, `transactionPlan.calls[${index}].to`);
        const data = normalizeHex(call.data ?? "0x", `transactionPlan.calls[${index}].data`);
        const value = assertZeroValue(call.value, `transactionPlan.calls[${index}].value`);
        const hash = await sendTransaction(wagmiConfig, { chainId: handoffChainId, data, to, value });
        hashes.push(hash);
        setSteps(current =>
          current.map((step, stepIndex) => (stepIndex === index ? { ...step, hash, status: "sent" } : step)),
        );
        await waitForTransactionReceipt(wagmiConfig, { chainId: handoffChainId, hash });
        setSteps(current =>
          current.map((step, stepIndex) => (stepIndex === index ? { ...step, hash, status: "confirmed" } : step)),
        );
        if (call.waitAfterMs && call.waitAfterMs > 0) {
          await delay(call.waitAfterMs);
        }
      }

      const response = await fetch(`/api/agent/handoffs/${handoffId}/complete`, {
        body: JSON.stringify({ token, transactionHashes: hashes }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as Handoff | { error?: string; message?: string };
      if (!response.ok) throw new Error(readResponseError(body, "Failed to confirm RateLoop ask."));
      setHandoff(body as Handoff);
      notification.success("Ask submitted to RateLoop.");
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : "Failed to execute wallet calls.");
    } finally {
      setIsExecuting(false);
    }
  }, [address, chain?.id, connectedMismatch, handoff, handoffId, switchToChain, token, wagmiConfig]);

  return (
    <AppPageShell contentClassName="space-y-5" paddingTopClassName="pt-6">
      <section className="surface-card rounded-lg p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-base-content/50">Agent ask handoff</p>
            <h1 className={`${surfaceSectionHeadingClassName} mt-2`}>{readQuestionTitle(handoff)}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-base-content/65">
              Review the RateLoop ask, connect the wallet that should pay the bounty, then approve the image signatures
              and wallet calls in the browser.
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
          <span className="loading loading-spinner loading-sm text-primary" /> Loading handoff...
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

      {handoff ? (
        <>
          <section className="surface-card rounded-lg p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="surface-card-nested rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <WalletIcon className="h-4 w-4" />
                  <span>Funding wallet</span>
                </div>
                <p className="mt-2 font-mono text-sm">{shortAddress(handoff.walletAddress ?? address)}</p>
              </div>
              <div className="surface-card-nested rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <ShieldCheckIcon className="h-4 w-4" />
                  <span>Bounty</span>
                </div>
                <p className="mt-2 text-lg font-semibold">{readBounty(handoff)}</p>
              </div>
              <div className="surface-card-nested rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <CheckCircleIcon className="h-4 w-4" />
                  <span>Status</span>
                </div>
                <p className="mt-2 text-sm font-semibold">{handoff.status}</p>
              </div>
            </div>

            {connectedMismatch ? (
              <p className="surface-card-nested mt-4 rounded-lg p-3 text-sm text-warning">
                This handoff expects {handoff.walletAddress}. You are connected as {address}.
              </p>
            ) : null}
            {needsChainSwitch ? (
              <p className="surface-card-nested mt-4 rounded-lg p-3 text-sm text-warning">
                This ask is on chain {handoff.chainId}. Your wallet is on chain {chain?.id}.
              </p>
            ) : null}
          </section>

          {handoff.assets?.length ? (
            <section className="surface-card rounded-lg p-5">
              <div className="flex items-center gap-2">
                <PhotoIcon className="h-5 w-5 text-base-content/60" />
                <h2 className="text-lg font-semibold">Images</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {handoff.assets.map(asset => (
                  <div key={asset.id} className="overflow-hidden rounded-lg border border-base-300/70 bg-base-100">
                    {asset.dataUrl || asset.imageUrl ? (
                      <img
                        alt={asset.filename ?? "RateLoop handoff image"}
                        className="aspect-video w-full object-cover"
                        src={asset.dataUrl ?? asset.imageUrl ?? ""}
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-base-200 text-sm text-base-content/50">
                        Image pending
                      </div>
                    )}
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{asset.filename ?? asset.attachmentId}</p>
                        <span className="reward-chip reward-chip-muted px-2 py-0.5 text-xs">{asset.status}</span>
                      </div>
                      {asset.error ? <p className="mt-2 text-xs text-error">{asset.error}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
              {imageSignatureSteps.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {imageSignatureSteps.map(step => (
                    <div key={step.assetId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate">{step.filename}</span>
                      <span className="reward-chip reward-chip-muted px-2 py-0.5 text-xs">{step.status}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="surface-card rounded-lg p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Submit Ask</h2>
                <p className="mt-1 text-sm text-base-content/60">
                  The connected wallet signs generated-image uploads first, then funds and submits the ask.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-outline btn-sm" type="button" onClick={() => void loadHandoff()}>
                  <ArrowPathIcon className="h-4 w-4" />
                  Refresh
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!canPrepare || isSigningMessage || switchingChainId !== null}
                  type="button"
                  onClick={() => void handlePrepare()}
                >
                  {isPreparing || isSigningMessage ? "Preparing..." : "Prepare"}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!canExecute || switchingChainId !== null}
                  type="button"
                  onClick={() => void handleExecute()}
                >
                  {isExecuting ? "Submitting..." : "Submit"}
                </button>
              </div>
            </div>

            {handoff.transactionPlan?.calls?.length ? (
              <div className="mt-4 space-y-2">
                {handoff.transactionPlan.calls.map((call, index) => (
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
                Prepare this handoff to sign staged images and fetch the wallet transaction calls.
              </p>
            )}

            {handoff.publicUrl ? (
              <Link className="btn btn-outline btn-sm mt-4" href={handoff.publicUrl}>
                View public result
              </Link>
            ) : null}
          </section>
        </>
      ) : null}
    </AppPageShell>
  );
}
