import { listClaimableFrontendFeeRounds } from "~~/lib/frontendFees/server";

type ListClaimableFrontendFeeRounds = typeof listClaimableFrontendFeeRounds;

let listClaimableFrontendFeeRoundsForRoute: ListClaimableFrontendFeeRounds = listClaimableFrontendFeeRounds;

export function getListClaimableFrontendFeeRoundsForRoute() {
  return listClaimableFrontendFeeRoundsForRoute;
}

export function __setListClaimableFrontendFeeRoundsForTests(override: ListClaimableFrontendFeeRounds | null) {
  listClaimableFrontendFeeRoundsForRoute = override ?? listClaimableFrontendFeeRounds;
}
