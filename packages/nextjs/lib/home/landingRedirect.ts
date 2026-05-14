export function shouldAutoRedirectFromLanding(params: {
  address: string | undefined;
  connectorId: string | undefined;
  hasExplicitLandingOverride: boolean;
  isConnected: boolean;
  raterIdentityResolved: boolean;
}) {
  if (params.hasExplicitLandingOverride) {
    return false;
  }

  if (!params.isConnected || !params.address) {
    return false;
  }

  if (!params.raterIdentityResolved) {
    return false;
  }

  // Only authenticated in-app wallet sessions should bypass the public landing page.
  return params.connectorId === "in-app-wallet";
}
