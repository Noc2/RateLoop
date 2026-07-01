import { listClaimableFrontendFeeRounds } from "~~/lib/frontendFees/server";

type ListClaimableFrontendFeeRounds = typeof listClaimableFrontendFeeRounds;

let listClaimableFrontendFeeRoundsForRoute: ListClaimableFrontendFeeRounds = listClaimableFrontendFeeRounds;

export function __setListClaimableFrontendFeeRoundsForTests(override: ListClaimableFrontendFeeRounds | null) {
  listClaimableFrontendFeeRoundsForRoute = override ?? listClaimableFrontendFeeRounds;
}

export function listClaimableFrontendFeeRoundsForRequest(
  ...args: Parameters<ListClaimableFrontendFeeRounds>
): ReturnType<ListClaimableFrontendFeeRounds> {
  return listClaimableFrontendFeeRoundsForRoute(...args);
}
