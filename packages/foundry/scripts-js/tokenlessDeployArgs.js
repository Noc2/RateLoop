export const TOKENLESS_DEPLOY_USAGE =
  "yarn deploy --network baseSepolia [--keystore <foundry-account>] [--resume]";

function readFlagValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value. Usage: ${TOKENLESS_DEPLOY_USAGE}`);
  }
  return value;
}

export function parseTokenlessDeployArgs(args) {
  let network;
  let keystore;
  let resume = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--network") {
      network = readFlagValue(args, index, value);
      index += 1;
    } else if (value === "--keystore") {
      keystore = readFlagValue(args, index, value);
      index += 1;
    } else if (value === "--resume") {
      resume = true;
    } else if (value === "--help" || value === "-h") {
      return { showHelp: true };
    } else {
      throw new Error(`Unknown deployment argument ${value}. Usage: ${TOKENLESS_DEPLOY_USAGE}`);
    }
  }

  if (network !== "baseSepolia") {
    throw new Error(`Only --network baseSepolia is supported. Usage: ${TOKENLESS_DEPLOY_USAGE}`);
  }
  return { keystore, network, resume, showHelp: false };
}
