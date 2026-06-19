type E2EProductionEnv = {
  RATELOOP_E2E_PRODUCTION_BUILD?: string;
  NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD?: string;
};

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function readStaticE2EProductionEnv(): E2EProductionEnv {
  // Next inlines browser env only for static process.env.NEXT_PUBLIC_* reads.
  return {
    RATELOOP_E2E_PRODUCTION_BUILD: process.env.RATELOOP_E2E_PRODUCTION_BUILD,
    NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD: process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD,
  };
}

export function isLocalE2EProductionBuildEnabled(env: E2EProductionEnv = readStaticE2EProductionEnv()): boolean {
  return env.RATELOOP_E2E_PRODUCTION_BUILD === "true" || env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD === "true";
}

export function isLocalE2EWalletBridgeEnabled(params: {
  hostname?: string;
  isProduction: boolean;
  localE2EProductionBuild?: boolean;
}): boolean {
  if (!params.hostname || !LOCALHOST_HOSTNAMES.has(params.hostname)) {
    return false;
  }

  return !params.isProduction || params.localE2EProductionBuild === true;
}
