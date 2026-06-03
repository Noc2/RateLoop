import process from "node:process";

export const disableExperimentalWebStorageFlag = "--no-experimental-webstorage";

const defaultSupportedNodeMajor = 24;

function getCurrentNodeMajor() {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
}

export function buildNextDevEnv({
  currentNodeMajor = getCurrentNodeMajor(),
  env = process.env,
  supportedNodeMajor = defaultSupportedNodeMajor,
} = {}) {
  const shouldDisableExperimentalWebStorage = currentNodeMajor > supportedNodeMajor && currentNodeMajor >= 26;
  if (!shouldDisableExperimentalWebStorage) {
    return env;
  }

  const existingNodeOptions = env.NODE_OPTIONS ?? "";
  if (existingNodeOptions.split(/\s+/).includes(disableExperimentalWebStorageFlag)) {
    return env;
  }

  return {
    ...env,
    NODE_OPTIONS: [existingNodeOptions, disableExperimentalWebStorageFlag].filter(Boolean).join(" "),
  };
}
