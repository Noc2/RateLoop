import "server-only";
import { prepareRunAudience, reserveDiversifiedNetworkSubpanel } from "~~/lib/tokenless/audienceAssignments";
import { requirePaidLaneComplianceApproval } from "~~/lib/tokenless/paidLaneCompliance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const HASH = /^sha256:[0-9a-f]{64}$/u;

type NetworkAudienceInput = {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  runId: string;
  confidentialityTermsHash: string;
  reservationTtlMs?: number;
  now?: Date;
};

type NetworkAudienceDependencies = {
  prepare: typeof prepareRunAudience;
  reserve: typeof reserveDiversifiedNetworkSubpanel;
};

export function createNetworkAudienceOrchestration(dependencies: NetworkAudienceDependencies) {
  return async function prepareAndReserveNetworkRunAudience(input: NetworkAudienceInput) {
    requirePaidLaneComplianceApproval("public_paid_network");
    if (!HASH.test(input.confidentialityTermsHash)) {
      throw new TokenlessServiceError("Confidentiality terms hash is invalid.", 400, "invalid_confidentiality_terms");
    }
    const subpanels = await dependencies.prepare({ ...input, requiredSource: "rateloop_network" });
    if (!subpanels.length || subpanels.some(subpanel => subpanel.source !== "rateloop_network")) {
      throw new TokenlessServiceError(
        "This endpoint only reserves frozen public-network audience policies.",
        409,
        "network_audience_policy_required",
      );
    }
    const reservations = [];
    for (const subpanel of subpanels) {
      if (!subpanel.subpanelId) throw new Error("Prepared network subpanel has no identity.");
      reservations.push(await dependencies.reserve({ ...input, subpanelId: subpanel.subpanelId }));
    }
    return { runId: input.runId, subpanels, reservations };
  };
}

export const prepareAndReserveNetworkRunAudience = createNetworkAudienceOrchestration({
  prepare: prepareRunAudience,
  reserve: reserveDiversifiedNetworkSubpanel,
});
