/**
 * No tokenless deployment currently matches the fund core in this source tree.
 * A fresh, fully validated deployment artifact replaces this fail-closed
 * registry through generateTokenlessArtifacts.js.
 */
export const tokenlessDeploymentSchema = "rateloop-tokenless-deployment-v4" as const;

export const tokenlessDeploymentStatus = {
  schemaVersion: "rateloop-tokenless-deployment-v4",
  status: "unreleased",
  reason: "fresh_deployment_required",
} as const;

export const tokenlessDeployedContracts = {} as const;
