"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useReadContract, useSignTypedData, useWriteContract } from "wagmi";
import { AiRaterTrustSection } from "~~/components/profile/AiRaterTrustSection";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useCuryoSwitchNetwork } from "~~/hooks/useCuryoSwitchNetwork";
import {
  AI_RATER_DECLARATION_DOMAIN,
  AI_RATER_DECLARATION_TYPES,
  AI_RATER_DISCLOSURE_DEFAULT,
  AI_RATER_MODEL_CLASS_OPTIONS,
  computeBondReleaseAt,
  formatAiRaterTierName,
  formatUnixTimestamp,
  hashAiRaterField,
  truncateHash,
} from "~~/lib/aiRater";
import {
  formatSubmissionRewardAmount,
  getDefaultUsdcAddress,
  parseSubmissionRewardAmount,
} from "~~/lib/questionRewardPools";
import { type PonderRaterParticipationStatusResponse, ponderApi } from "~~/services/ponder/client";
import { notification } from "~~/utils/scaffold-eth";

const SECONDS_PER_DAY = 86_400;

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-base-content/[0.05] px-4 py-3">
      <div className="text-sm text-base-content/55">{label}</div>
      <div className="mt-1 text-base font-medium text-base-content">{value}</div>
    </div>
  );
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function toBigIntValue(value: bigint | number | string | null | undefined) {
  return value === null || value === undefined ? 0n : BigInt(value);
}

function parseOptionalUsdcAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  const normalized = trimmed.includes(",") ? trimmed.replace(/,/g, "") : trimmed;
  if (/^0+(?:\.0{0,6})?$/.test(normalized)) return 0n;
  return parseSubmissionRewardAmount(value);
}

export function AiRaterSettingsPanel({ address }: { address?: string }) {
  const normalizedAddress = address as `0x${string}` | undefined;
  const { address: connectedAddress, chain } = useAccount();
  const { signTypedDataAsync, isPending: isSigning } = useSignTypedData();
  const { switchToChain, switchingChainId } = useCuryoSwitchNetwork();
  const { targetNetwork } = useTargetNetwork();
  const { data: registryInfo } = useDeployedContractInfo({ contractName: "RaterDeclarationRegistry" });
  const registryAddress = registryInfo?.address as `0x${string}` | undefined;
  const usdcAddress = getDefaultUsdcAddress(targetNetwork.id);

  const [modelClass, setModelClass] = useState("0");
  const [modelIdInput, setModelIdInput] = useState("openai/gpt-5.5");
  const [providerInput, setProviderInput] = useState("openai");
  const [endpointHintInput, setEndpointHintInput] = useState("");
  const [promptTemplateInput, setPromptTemplateInput] = useState("");
  const [retrievalConfigInput, setRetrievalConfigInput] = useState("");
  const [toolingInput, setToolingInput] = useState("");
  const [expiresInDaysInput, setExpiresInDaysInput] = useState("90");
  const [bondAmountInput, setBondAmountInput] = useState("");
  const [withdrawAmountInput, setWithdrawAmountInput] = useState("");
  const [requestProbe, setRequestProbe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRetiring, setIsRetiring] = useState(false);
  const [isReleasingBond, setIsReleasingBond] = useState(false);
  const [isWithdrawingBond, setIsWithdrawingBond] = useState(false);

  const rewardStatusQuery = useQuery({
    queryKey: ["ai-rater-settings", "participation-status", normalizedAddress],
    queryFn: () => ponderApi.getRaterParticipationStatus(normalizedAddress!),
    enabled: Boolean(normalizedAddress),
    staleTime: 15_000,
  });
  const rewardStatus = rewardStatusQuery.data as PonderRaterParticipationStatusResponse | undefined;
  const aiDeclaration = rewardStatus?.aiDeclaration;

  const { data: nonce, refetch: refetchNonce } = useScaffoldReadContract({
    contractName: "RaterDeclarationRegistry",
    functionName: "nonces",
    args: [normalizedAddress],
    query: { enabled: Boolean(normalizedAddress) },
  });
  const { data: minDeclarationBondUsdc, refetch: refetchMinDeclarationBondUsdc } = useScaffoldReadContract({
    contractName: "RaterDeclarationRegistry",
    functionName: "minDeclarationBondUsdc",
  });
  const { data: retiredBondLock, refetch: refetchRetiredBondLock } = useScaffoldReadContract({
    contractName: "RaterDeclarationRegistry",
    functionName: "RETIRED_DECLARATION_BOND_LOCK",
  });
  const { data: operatorBond, refetch: refetchOperatorBond } = useScaffoldReadContract({
    contractName: "RaterDeclarationRegistry",
    functionName: "operatorBond",
    args: [normalizedAddress],
    query: { enabled: Boolean(normalizedAddress) },
  });
  const { data: operatorBondReserved, refetch: refetchOperatorBondReserved } = useScaffoldReadContract({
    contractName: "RaterDeclarationRegistry",
    functionName: "operatorBondReserved",
    args: [normalizedAddress],
    query: { enabled: Boolean(normalizedAddress) },
  });
  const { data: activeOperatorDeclarations, refetch: refetchActiveOperatorDeclarations } = useScaffoldReadContract({
    contractName: "RaterDeclarationRegistry",
    functionName: "activeOperatorDeclarations",
    args: [normalizedAddress],
    query: { enabled: Boolean(normalizedAddress) },
  });
  const { data: openOperatorChallenges, refetch: refetchOpenOperatorChallenges } = useScaffoldReadContract({
    contractName: "RaterDeclarationRegistry",
    functionName: "openOperatorChallenges",
    args: [normalizedAddress],
    query: { enabled: Boolean(normalizedAddress) },
  });
  const { data: retiredDeclarationBondReleaseAt, refetch: refetchRetiredDeclarationBondReleaseAt } =
    useScaffoldReadContract({
      contractName: "RaterDeclarationRegistry",
      functionName: "retiredDeclarationBondReleaseAt",
      args: [normalizedAddress],
      query: { enabled: Boolean(normalizedAddress) },
    });
  const { data: usdcBalance, refetch: refetchUsdcBalance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: normalizedAddress ? [normalizedAddress] : undefined,
    query: { enabled: Boolean(normalizedAddress && usdcAddress) },
  });
  const { data: usdcAllowance, refetch: refetchUsdcAllowance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: normalizedAddress && registryAddress ? [normalizedAddress, registryAddress] : undefined,
    query: { enabled: Boolean(normalizedAddress && registryAddress && usdcAddress) },
  });

  const { writeContractAsync: writeUsdc } = useWriteContract();
  const { writeContractAsync: writeRegistry } = useScaffoldWriteContract({
    contractName: "RaterDeclarationRegistry",
  });
  const { writeContractAsync: writeRegistryNoSim } = useScaffoldWriteContract({
    contractName: "RaterDeclarationRegistry",
    disableSimulate: true,
  });

  const currentBond = toBigIntValue(operatorBond);
  const currentReservedBond = toBigIntValue(operatorBondReserved);
  const availableBond = currentBond > currentReservedBond ? currentBond - currentReservedBond : 0n;
  const minDeclarationBond = toBigIntValue(minDeclarationBondUsdc);
  const requiredTopUp = currentBond >= minDeclarationBond ? 0n : minDeclarationBond - currentBond;
  const nextVersion = (aiDeclaration?.version ?? 0) + 1;
  const releaseAt = computeBondReleaseAt({
    expiresAtEpoch: aiDeclaration?.expiresAtEpoch,
    inactiveReason: aiDeclaration?.inactiveReason,
    retiredAt:
      retiredDeclarationBondReleaseAt && retiredBondLock
        ? retiredDeclarationBondReleaseAt - retiredBondLock
        : aiDeclaration?.retiredAt,
    retiredBondLockSeconds: retiredBondLock,
  });
  const canReleaseBond =
    Boolean(normalizedAddress) &&
    (aiDeclaration?.inactiveReason === "retired" || aiDeclaration?.inactiveReason === "expired") &&
    releaseAt !== null &&
    releaseAt <= BigInt(Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!bondAmountInput && requiredTopUp > 0n) {
      setBondAmountInput(formatUnits(requiredTopUp, 6));
    }
  }, [bondAmountInput, requiredTopUp]);

  const declarationPreview = useMemo(
    () => ({
      endpointHint: hashAiRaterField(endpointHintInput),
      modelId: hashAiRaterField(modelIdInput),
      promptTemplateHash: hashAiRaterField(promptTemplateInput),
      provider: hashAiRaterField(providerInput),
      retrievalConfigHash: hashAiRaterField(retrievalConfigInput),
      toolingHash: hashAiRaterField(toolingInput),
    }),
    [endpointHintInput, modelIdInput, promptTemplateInput, providerInput, retrievalConfigInput, toolingInput],
  );

  const refreshAll = async () => {
    await Promise.all([
      rewardStatusQuery.refetch(),
      refetchNonce(),
      refetchMinDeclarationBondUsdc(),
      refetchRetiredBondLock(),
      refetchOperatorBond(),
      refetchOperatorBondReserved(),
      refetchActiveOperatorDeclarations(),
      refetchOpenOperatorChallenges(),
      refetchRetiredDeclarationBondReleaseAt(),
      refetchUsdcBalance(),
      refetchUsdcAllowance(),
    ]);
  };

  const ensureTargetChain = async () => {
    if (chain?.id === targetNetwork.id) return;
    await switchToChain(targetNetwork.id);
  };

  const handleSubmitDeclaration = async () => {
    if (!normalizedAddress || !connectedAddress || !registryAddress) {
      notification.error("Connect the declaration wallet before submitting.");
      return;
    }
    if (connectedAddress.toLowerCase() !== normalizedAddress.toLowerCase()) {
      notification.error("The connected wallet must match this settings wallet.");
      return;
    }
    if (!modelIdInput.trim() || !providerInput.trim()) {
      notification.error("Model identifier and provider are required.");
      return;
    }

    if (!usdcAddress) {
      notification.error("USDC is not configured for this network.");
      return;
    }

    const bondAmount = parseOptionalUsdcAmount(bondAmountInput);
    if (bondAmount === null) {
      notification.error("Enter a valid USDC bond amount with up to 6 decimals.");
      return;
    }
    if (bondAmount < requiredTopUp) {
      notification.error(`Bond top-up must be at least ${formatSubmissionRewardAmount(requiredTopUp, "usdc")}.`);
      return;
    }
    if ((usdcBalance ?? 0n) < bondAmount) {
      notification.error("Not enough USDC to post this bond.");
      return;
    }

    const expiresInDays = Number(expiresInDaysInput || "0");
    if (!Number.isFinite(expiresInDays) || expiresInDays < 0) {
      notification.error("Expiry must be zero or a positive day count.");
      return;
    }

    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const expiresAtEpoch =
      expiresInDays > 0 ? nowSeconds + BigInt(Math.floor(expiresInDays)) * BigInt(SECONDS_PER_DAY) : 0n;

    const declaration = {
      rater: normalizedAddress,
      operator: normalizedAddress,
      modelClass: Number(modelClass),
      modelId: declarationPreview.modelId,
      provider: declarationPreview.provider,
      endpointHint: declarationPreview.endpointHint,
      promptTemplateHash: declarationPreview.promptTemplateHash,
      retrievalConfigHash: declarationPreview.retrievalConfigHash,
      toolingHash: declarationPreview.toolingHash,
      version: nextVersion,
      effectiveEpoch: nowSeconds,
      expiresAtEpoch,
      disclosure: AI_RATER_DISCLOSURE_DEFAULT,
      nonce: nonce ?? 0n,
    } as const;

    setIsSubmitting(true);
    try {
      await ensureTargetChain();

      if (bondAmount > 0n && (usdcAllowance ?? 0n) < bondAmount) {
        await writeUsdc({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [registryAddress, bondAmount],
        });
      }

      const signature = await signTypedDataAsync({
        domain: {
          ...AI_RATER_DECLARATION_DOMAIN,
          chainId: targetNetwork.id,
          verifyingContract: registryAddress,
        },
        message: declaration,
        primaryType: "RaterDeclaration",
        types: AI_RATER_DECLARATION_TYPES,
      });

      await writeRegistryNoSim({
        functionName: "submitDeclaration",
        args: [declaration, signature, bondAmount, requestProbe],
      });

      notification.success("AI declaration submitted.");
      await refreshAll();
    } catch (error) {
      notification.error(readErrorMessage(error, "Failed to submit AI declaration."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetireDeclaration = async () => {
    setIsRetiring(true);
    try {
      await ensureTargetChain();
      await writeRegistry({ functionName: "retireDeclaration" });
      notification.success("Declaration retired.");
      await refreshAll();
    } catch (error) {
      notification.error(readErrorMessage(error, "Failed to retire declaration."));
    } finally {
      setIsRetiring(false);
    }
  };

  const handleReleaseBond = async () => {
    if (!normalizedAddress) return;
    setIsReleasingBond(true);
    try {
      await ensureTargetChain();
      if (aiDeclaration?.inactiveReason === "retired") {
        await writeRegistry({ functionName: "releaseRetiredDeclarationBond", args: [normalizedAddress] });
      } else if (aiDeclaration?.inactiveReason === "expired") {
        await writeRegistry({ functionName: "releaseExpiredDeclarationBond", args: [normalizedAddress] });
      } else {
        notification.error("This declaration is not eligible for bond release.");
        return;
      }
      notification.success("Declaration bond released.");
      await refreshAll();
    } catch (error) {
      notification.error(readErrorMessage(error, "Failed to release declaration bond."));
    } finally {
      setIsReleasingBond(false);
    }
  };

  const handleWithdrawBond = async () => {
    const amount = parseOptionalUsdcAmount(withdrawAmountInput);
    if (amount === null) {
      notification.error("Enter a valid USDC bond amount with up to 6 decimals.");
      return;
    }
    if (amount <= 0n) {
      notification.error("Enter a bond amount to withdraw.");
      return;
    }
    if (amount > availableBond) {
      notification.error("Withdrawal exceeds the unreserved operator bond.");
      return;
    }

    setIsWithdrawingBond(true);
    try {
      await ensureTargetChain();
      await writeRegistry({ functionName: "withdrawRetiredOperatorBond", args: [amount] });
      notification.success("Operator bond withdrawn.");
      setWithdrawAmountInput("");
      await refreshAll();
    } catch (error) {
      notification.error(readErrorMessage(error, "Failed to withdraw operator bond."));
    } finally {
      setIsWithdrawingBond(false);
    }
  };

  const isBusy = isSubmitting || isSigning || switchingChainId === targetNetwork.id;

  if (!normalizedAddress) {
    return (
      <div className="surface-card rounded-2xl p-6 text-base-content/60">
        Connect a wallet to manage AI rater declarations.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="surface-card rounded-2xl p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-base-content">AI rater controls</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/60">
              Publish a bonded declaration, request a probe when behavior changes, retire stale declarations, and manage
              the operator bond that backs this wallet.
            </p>
          </div>
          <div className="rounded-full bg-base-content/[0.05] px-4 py-2 text-sm font-medium text-base-content/70">
            {aiDeclaration?.declared
              ? `${aiDeclaration.active ? "Active" : `Inactive: ${aiDeclaration.inactiveReason}`}`
              : "No declaration"}
          </div>
        </div>

        {rewardStatusQuery.error ? (
          <div className="mt-4 rounded-2xl bg-error/10 px-4 py-3 text-sm text-error">
            {readErrorMessage(rewardStatusQuery.error, "Failed to load AI declaration status.")}
          </div>
        ) : null}

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DetailCard label="Current tier" value={formatAiRaterTierName(aiDeclaration?.tier)} />
          <DetailCard label="Next version" value={`#${nextVersion}`} />
          <DetailCard label="Operator bond" value={formatSubmissionRewardAmount(currentBond, "usdc")} />
          <DetailCard label="Unreserved bond" value={formatSubmissionRewardAmount(availableBond, "usdc")} />
        </div>
      </div>

      <div className="surface-card rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-base-content">Declare or re-declare</h3>
        <p className="mt-2 text-sm text-base-content/60">
          This settings flow uses the same connected wallet for both the rater and operator signatures.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <label className="form-control">
            <span className="label-text text-base-content/65">Model class</span>
            <select
              className="select select-bordered mt-2 w-full bg-base-100"
              value={modelClass}
              onChange={event => setModelClass(event.target.value)}
            >
              {AI_RATER_MODEL_CLASS_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="form-control">
            <span className="label-text text-base-content/65">Expires in days</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100"
              inputMode="numeric"
              min={0}
              type="number"
              value={expiresInDaysInput}
              onChange={event => setExpiresInDaysInput(event.target.value)}
            />
          </label>

          <label className="form-control">
            <span className="label-text text-base-content/65">Model identifier</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100"
              placeholder="openai/gpt-4o-2024-05-13"
              value={modelIdInput}
              onChange={event => setModelIdInput(event.target.value)}
            />
            <span className="mt-2 text-xs text-base-content/50">{truncateHash(declarationPreview.modelId)}</span>
          </label>

          <label className="form-control">
            <span className="label-text text-base-content/65">Provider</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100"
              placeholder="openai"
              value={providerInput}
              onChange={event => setProviderInput(event.target.value)}
            />
            <span className="mt-2 text-xs text-base-content/50">{truncateHash(declarationPreview.provider)}</span>
          </label>

          <label className="form-control">
            <span className="label-text text-base-content/65">Endpoint hint</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100"
              placeholder="api.openai.com/v1"
              value={endpointHintInput}
              onChange={event => setEndpointHintInput(event.target.value)}
            />
            <span className="mt-2 text-xs text-base-content/50">{truncateHash(declarationPreview.endpointHint)}</span>
          </label>

          <label className="form-control">
            <span className="label-text text-base-content/65">Prompt template fingerprint</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100"
              placeholder="prompt-v3"
              value={promptTemplateInput}
              onChange={event => setPromptTemplateInput(event.target.value)}
            />
            <span className="mt-2 text-xs text-base-content/50">
              {truncateHash(declarationPreview.promptTemplateHash)}
            </span>
          </label>

          <label className="form-control">
            <span className="label-text text-base-content/65">Retrieval config fingerprint</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100"
              placeholder="retrieval:pgvector:v2"
              value={retrievalConfigInput}
              onChange={event => setRetrievalConfigInput(event.target.value)}
            />
            <span className="mt-2 text-xs text-base-content/50">
              {truncateHash(declarationPreview.retrievalConfigHash)}
            </span>
          </label>

          <label className="form-control">
            <span className="label-text text-base-content/65">Tooling fingerprint</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100"
              placeholder="tooling:browser+routing"
              value={toolingInput}
              onChange={event => setToolingInput(event.target.value)}
            />
            <span className="mt-2 text-xs text-base-content/50">{truncateHash(declarationPreview.toolingHash)}</span>
          </label>

          <label className="form-control">
            <span className="label-text text-base-content/65">Bond top-up (USDC)</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100"
              inputMode="decimal"
              placeholder={requiredTopUp > 0n ? formatUnits(requiredTopUp, 6) : "0"}
              value={bondAmountInput}
              onChange={event => setBondAmountInput(event.target.value)}
            />
            <span className="mt-2 text-xs text-base-content/50">
              Required now: {formatSubmissionRewardAmount(requiredTopUp, "usdc")}. Balance:{" "}
              {formatSubmissionRewardAmount(usdcBalance, "usdc")}.
            </span>
          </label>
        </div>

        <label className="mt-5 flex items-center gap-3 rounded-2xl bg-base-content/[0.04] px-4 py-3 text-sm text-base-content/75">
          <input
            checked={requestProbe}
            className="checkbox checkbox-sm"
            type="checkbox"
            onChange={event => setRequestProbe(event.target.checked)}
          />
          <span>Request a probe when this declaration changes the behavior surface.</span>
        </label>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-submit"
            disabled={isBusy || !registryAddress}
            onClick={() => void handleSubmitDeclaration()}
          >
            {isBusy ? "Submitting..." : "Sign and submit declaration"}
          </button>
          <div className="text-sm text-base-content/55">
            Nonce {nonce?.toString() ?? "—"} • allowance {formatSubmissionRewardAmount(usdcAllowance, "usdc")}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="surface-card rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-base-content">Declaration lifecycle</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <DetailCard
              label="Declared at"
              value={aiDeclaration?.declaredAt ? formatUnixTimestamp(aiDeclaration.declaredAt) : "—"}
            />
            <DetailCard label="Release window" value={releaseAt ? formatUnixTimestamp(releaseAt) : "Not scheduled"} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-ghost border border-base-300"
              disabled={!aiDeclaration?.active || isRetiring}
              onClick={() => void handleRetireDeclaration()}
            >
              {isRetiring ? "Retiring..." : "Retire declaration"}
            </button>
            <button
              type="button"
              className="btn btn-ghost border border-base-300"
              disabled={!canReleaseBond || isReleasingBond}
              onClick={() => void handleReleaseBond()}
            >
              {isReleasingBond ? "Releasing..." : "Release declaration bond"}
            </button>
          </div>
        </div>

        <div className="surface-card rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-base-content">Operator bond</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <DetailCard label="Total bond" value={formatSubmissionRewardAmount(currentBond, "usdc")} />
            <DetailCard label="Reserved bond" value={formatSubmissionRewardAmount(currentReservedBond, "usdc")} />
            <DetailCard label="Active declarations" value={(activeOperatorDeclarations ?? 0n).toString()} />
            <DetailCard label="Open challenges" value={(openOperatorChallenges ?? 0n).toString()} />
          </div>

          <label className="form-control mt-5">
            <span className="label-text text-base-content/65">Withdraw unreserved bond (USDC)</span>
            <input
              className="input input-bordered mt-2 w-full bg-base-100"
              inputMode="decimal"
              placeholder={formatUnits(availableBond, 6)}
              value={withdrawAmountInput}
              onChange={event => setWithdrawAmountInput(event.target.value)}
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-ghost border border-base-300"
              disabled={
                isWithdrawingBond ||
                availableBond === 0n ||
                (activeOperatorDeclarations ?? 0n) > 0n ||
                (openOperatorChallenges ?? 0n) > 0n
              }
              onClick={() => void handleWithdrawBond()}
            >
              {isWithdrawingBond ? "Withdrawing..." : "Withdraw operator bond"}
            </button>
            <span className="text-sm text-base-content/55">
              Available now: {formatSubmissionRewardAmount(availableBond, "usdc")}
            </span>
          </div>
        </div>
      </div>

      <AiRaterTrustSection address={normalizedAddress} ownProfile />
    </div>
  );
}
