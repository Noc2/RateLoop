import type { createPublicClient } from "viem";

type DetailsAttachRouteTestOverrides = {
  createPublicClient?: typeof createPublicClient;
};

let detailsAttachRouteTestOverrides: DetailsAttachRouteTestOverrides | null = null;

export function setDetailsAttachRouteTestOverrides(overrides: DetailsAttachRouteTestOverrides | null) {
  detailsAttachRouteTestOverrides = overrides;
}

export function getDetailsAttachRouteTestOverrides(): DetailsAttachRouteTestOverrides | null {
  return detailsAttachRouteTestOverrides;
}
