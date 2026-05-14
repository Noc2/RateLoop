export const DEPLOY_HELP_TEXT = `
Usage: yarn deploy [options]
Options:
  --network <network>   Specify the network (default: localhost)
  --keystore <name>     Specify the live-network keystore account to use (bypasses selection prompt)
  --resume              Resume a partial broadcast for the current network + account
  --help, -h           Show this help message
Examples:
  yarn deploy --network worldchainSepolia --keystore my-account --resume
  yarn deploy --network worldchain --keystore my-account
  yarn deploy
  `;

const SUPPORTED_DEPLOY_NETWORKS = new Set([
  "localhost",
  "worldchainSepolia",
  "worldchain",
]);

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(
      `Missing value for ${optionName}. Run \`yarn deploy --help\` for usage.`
    );
  }
  return value;
}

export function parseDeployArgs(args) {
  let network = "localhost";
  let keystoreArg = null;
  let resume = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      return { showHelp: true, network, keystoreArg, resume };
    }

    if (arg === "--network") {
      network = readOptionValue(args, i, "--network");
      i++;
      continue;
    }

    if (arg === "--keystore") {
      keystoreArg = readOptionValue(args, i, "--keystore");
      i++;
      continue;
    }

    if (arg === "--resume") {
      resume = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(
        `Unknown option: ${arg}. Run \`yarn deploy --help\` for usage.`
      );
    }

    throw new Error(
      `Unexpected argument: ${arg}. Run \`yarn deploy --help\` for usage.`
    );
  }

  if (!SUPPORTED_DEPLOY_NETWORKS.has(network)) {
    throw new Error(
      `Unsupported deploy network: ${network}. Supported networks: ${Array.from(
        SUPPORTED_DEPLOY_NETWORKS
      ).join(", ")}.`
    );
  }

  return { showHelp: false, network, keystoreArg, resume };
}
