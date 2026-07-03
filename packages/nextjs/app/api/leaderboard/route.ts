import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { parsePositiveIntegerChainId } from "~~/lib/chainId";
import { getPrimaryServerTargetNetwork, getServerTargetNetworkById } from "~~/lib/env/server";
import {
  getVoterLeaderboardSnapshot,
  resolveVoterLeaderboardSelection,
} from "~~/lib/governance/voterLeaderboardSnapshot";
import { isBlankQueryNumber, parseStrictUnsignedQueryNumber } from "~~/lib/http/queryNumbers";
import { readLrepBalances, readProfileRegistryProfiles } from "~~/lib/profileRegistry/server";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { ponderApi } from "~~/services/ponder/client";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const MAX_LIMIT = 100;

function parseLeaderboardLimit(value: string | null) {
  if (isBlankQueryNumber(value)) return 20;
  const parsed = parseStrictUnsignedQueryNumber(value);
  if (parsed === null) return null;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

async function buildIncludedAddressFallback(address: string, chainId: number) {
  const [balances, profiles] = await Promise.all([
    readLrepBalances([address], { chainId }),
    readProfileRegistryProfiles([address], { chainId }),
  ]);

  return NextResponse.json({
    entries: [
      {
        rank: 0,
        address,
        username: profiles[address]?.username ?? null,
        balance: (balances[address] ?? 0n).toString(),
      },
    ],
    totalCount: 1,
    source: "onchain_fallback",
    type: "voters",
  });
}

// GET: Fetch LREP leaderboard data.
// Uses Ponder when available for candidate discovery, then ranks by live on-chain LREP balances.
export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  try {
    const requestedType = request.nextUrl.searchParams.get("type");
    if (requestedType && requestedType !== "voters") {
      return NextResponse.json({ error: "Unsupported leaderboard type" }, { status: 400 });
    }
    const limit = parseLeaderboardLimit(request.nextUrl.searchParams.get("limit"));
    if (limit === null) {
      return NextResponse.json({ error: "Valid limit is required" }, { status: 400 });
    }
    const chainIdRaw = request.nextUrl.searchParams.get("chainId");
    const fallbackChainId = getPrimaryServerTargetNetwork()?.id;
    const parsedChainId = chainIdRaw === null ? fallbackChainId : parsePositiveIntegerChainId(chainIdRaw);
    if (parsedChainId === null || parsedChainId === undefined) {
      return NextResponse.json({ error: "Valid chainId is required" }, { status: 400 });
    }
    if (!getServerTargetNetworkById(parsedChainId)) {
      return NextResponse.json({ error: "Unsupported chainId" }, { status: 400 });
    }
    const includeAddressParam = request.nextUrl.searchParams.get("includeAddress");
    const includeAddress =
      includeAddressParam && isAddress(includeAddressParam) ? includeAddressParam.toLowerCase() : null;
    const canFallbackToIncludedAddress = includeAddress !== null && limit === 1;
    const deployment = resolveProtocolDeploymentScope(parsedChainId);
    if (!deployment) {
      if (canFallbackToIncludedAddress) {
        return buildIncludedAddressFallback(includeAddress, parsedChainId);
      }

      return NextResponse.json({ error: "Leaderboard deployment is not configured for this chain" }, { status: 503 });
    }

    // Try Ponder first for complete holder discovery.
    try {
      const snapshot = await getVoterLeaderboardSnapshot({
        chainId: parsedChainId,
        listTokenHolders: () => ponderApi.getAllTokenHolders({ deploymentKey: deployment.deploymentKey }),
      });
      const selection = await resolveVoterLeaderboardSelection(
        snapshot,
        {
          includeAddress,
          limit,
        },
        {
          readBalances: addresses => readLrepBalances(addresses, { chainId: parsedChainId }),
        },
      );
      const profiles = await readProfileRegistryProfiles(selection.selectedAddresses, { chainId: parsedChainId });
      const entries = selection.selectedAddresses.map(address => ({
        rank: selection.ranks[address] ?? 0,
        address,
        username: profiles[address]?.username ?? null,
        balance: (selection.balances[address] ?? 0n).toString(),
      }));

      return NextResponse.json({
        entries,
        totalCount: selection.totalCount,
        source: "ponder",
        type: "voters",
      });
    } catch (e) {
      if (canFallbackToIncludedAddress) {
        console.warn("Ponder token-holder discovery failed, using included-address fallback");
        return buildIncludedAddressFallback(includeAddress, parsedChainId);
      }

      console.warn("Ponder token-holder discovery failed:", e);
      return NextResponse.json(
        { error: "Leaderboard is temporarily unavailable while holder indexing catches up" },
        { status: 503 },
      );
    }
  } catch (error) {
    console.error("Error fetching leaderboard data:", error);
    return NextResponse.json({ error: "Failed to fetch leaderboard" }, { status: 500 });
  }
}
