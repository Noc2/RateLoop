import { ponder } from "ponder:registry";
import {
  content,
  confidentialityBond,
  confidentialityConfig,
} from "ponder:schema";

const CONFIDENTIALITY_FLAG_PRIVATE_FOREVER = 1;

function bondId(contentId: bigint, identityKey: `0x${string}`) {
  return `${contentId.toString()}-${identityKey}`;
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBigInt(value: unknown) {
  return typeof value === "bigint" ? value : BigInt(String(value ?? 0));
}

function confidentialityBondAssetName(asset: number) {
  return asset === 1 ? "USDC" : "LREP";
}

function confidentialityDisclosurePolicyFromFlags(flags: number) {
  return (flags & CONFIDENTIALITY_FLAG_PRIVATE_FOREVER) !== 0
    ? "private_forever"
    : "after_settlement";
}

ponder.on(
  "ConfidentialityEscrow:ConfidentialityConfigured" as never,
  async ({ event, context }: any) => {
    const { contentId, gated, bondAsset, bondAmount, flags } = event.args;
    const asset = toNumber(bondAsset);
    const amount = toBigInt(bondAmount);
    const flagValue = toNumber(flags);

    await context.db
      .insert(confidentialityConfig)
      .values({
        contentId,
        gated,
        bondAsset: asset,
        bondAmount: amount,
        flags: flagValue,
        configuredAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        gated,
        bondAsset: asset,
        bondAmount: amount,
        flags: flagValue,
        updatedAt: event.block.timestamp,
      });

    await context.db.update(content, { id: contentId }).set({
      gated,
      confidentialityBondAsset: confidentialityBondAssetName(asset),
      confidentialityBondAmount: amount,
      confidentialityDisclosurePolicy: confidentialityDisclosurePolicyFromFlags(flagValue),
    });
  },
);

ponder.on(
  "ConfidentialityEscrow:BondPosted" as never,
  async ({ event, context }: any) => {
    const { contentId, identityKey, poster, asset, amount } = event.args;
    const normalizedAsset = toNumber(asset);
    const normalizedAmount = toBigInt(amount);

    await context.db
      .insert(confidentialityBond)
      .values({
        id: bondId(contentId, identityKey),
        contentId,
        identityKey,
        poster,
        asset: normalizedAsset,
        amount: normalizedAmount,
        status: "active",
        postedAt: event.block.timestamp,
        releasedAt: null,
        slashedAt: null,
        reporterRecipient: null,
        reporterAmount: null,
        confiscatedAmount: null,
        evidenceHash: null,
        reason: null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        poster,
        asset: normalizedAsset,
        amount: normalizedAmount,
        status: "active",
        postedAt: event.block.timestamp,
        releasedAt: null,
        slashedAt: null,
        reporterRecipient: null,
        reporterAmount: null,
        confiscatedAmount: null,
        evidenceHash: null,
        reason: null,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "ConfidentialityEscrow:BondReleased" as never,
  async ({ event, context }: any) => {
    const { contentId, identityKey, poster, amount } = event.args;
    const normalizedAmount = toBigInt(amount);

    await context.db
      .insert(confidentialityBond)
      .values({
        id: bondId(contentId, identityKey),
        contentId,
        identityKey,
        poster,
        asset: 0,
        amount: normalizedAmount,
        status: "released",
        postedAt: 0n,
        releasedAt: event.block.timestamp,
        slashedAt: null,
        reporterRecipient: null,
        reporterAmount: null,
        confiscatedAmount: null,
        evidenceHash: null,
        reason: null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        poster,
        amount: normalizedAmount,
        status: "released",
        releasedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "ConfidentialityEscrow:BondSlashed" as never,
  async ({ event, context }: any) => {
    const {
      contentId,
      identityKey,
      poster,
      reporterRecipient,
      reporterAmount,
      confiscatedAmount,
      evidenceHash,
      reason,
    } = event.args;
    const reporterShare = toBigInt(reporterAmount);
    const confiscatedShare = toBigInt(confiscatedAmount);

    await context.db
      .insert(confidentialityBond)
      .values({
        id: bondId(contentId, identityKey),
        contentId,
        identityKey,
        poster,
        asset: 0,
        amount: reporterShare + confiscatedShare,
        status: "slashed",
        postedAt: 0n,
        releasedAt: null,
        slashedAt: event.block.timestamp,
        reporterRecipient,
        reporterAmount: reporterShare,
        confiscatedAmount: confiscatedShare,
        evidenceHash,
        reason,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        poster,
        amount: reporterShare + confiscatedShare,
        status: "slashed",
        slashedAt: event.block.timestamp,
        reporterRecipient,
        reporterAmount: reporterShare,
        confiscatedAmount: confiscatedShare,
        evidenceHash,
        reason,
        updatedAt: event.block.timestamp,
      });
  },
);
