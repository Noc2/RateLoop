import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const FOUNDRY_ACCOUNT_NAME = /^[A-Za-z0-9._-]{1,128}$/u;
const LOCAL_ANVIL_ACCOUNT = "scaffold-eth-default";

export function foundryKeystoreDirectory(homeDirectory = homedir()) {
  return join(homeDirectory, ".foundry", "keystores");
}

export function assertFoundryAccountName(accountName) {
  if (typeof accountName !== "string" || !FOUNDRY_ACCOUNT_NAME.test(accountName)) {
    throw new Error(
      "Foundry account name must use only letters, numbers, dots, underscores, or hyphens."
    );
  }
  if (accountName === LOCAL_ANVIL_ACCOUNT) {
    throw new Error(`${LOCAL_ANVIL_ACCOUNT} is reserved for local Anvil deployments.`);
  }
  return accountName;
}

export function listFoundryAccounts({
  keystoreDirectory = foundryKeystoreDirectory(),
} = {}) {
  if (!existsSync(keystoreDirectory)) return [];

  return readdirSync(keystoreDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => name !== LOCAL_ANVIL_ACCOUNT && FOUNDRY_ACCOUNT_NAME.test(name))
    .sort((left, right) => left.localeCompare(right));
}

export function requireFoundryAccount(
  accountName,
  { keystoreDirectory = foundryKeystoreDirectory() } = {}
) {
  const safeAccountName = assertFoundryAccountName(accountName);
  const keystorePath = join(keystoreDirectory, safeAccountName);
  if (!existsSync(keystorePath)) {
    throw new Error(`Foundry account ${safeAccountName} does not exist in ${keystoreDirectory}.`);
  }
  const entry = lstatSync(keystorePath);
  if (!entry.isFile() && !entry.isSymbolicLink()) {
    throw new Error(`Foundry account ${safeAccountName} is not a keystore file.`);
  }
  return safeAccountName;
}

export function readStoredFoundryAccountAddress(
  accountName,
  { keystoreDirectory = foundryKeystoreDirectory() } = {}
) {
  const safeAccountName = requireFoundryAccount(accountName, { keystoreDirectory });
  let keystore;
  try {
    keystore = JSON.parse(readFileSync(join(keystoreDirectory, safeAccountName), "utf8"));
  } catch (error) {
    throw new Error(
      `Foundry account ${safeAccountName} is not a readable JSON keystore: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const rawAddress = keystore?.address;
  if (rawAddress === undefined) return null;
  if (typeof rawAddress !== "string") {
    throw new Error(`Foundry account ${safeAccountName} has an invalid address field.`);
  }
  const address = rawAddress.startsWith("0x") ? rawAddress : `0x${rawAddress}`;
  if (!/^0x[0-9a-fA-F]{40}$/u.test(address)) {
    throw new Error(`Foundry account ${safeAccountName} contains an invalid public address.`);
  }
  return address;
}

export function resolveFoundryAccountSelection(selection, accounts) {
  if (!/^\d+$/u.test(selection.trim())) {
    throw new Error("Account selection must be a number from the displayed list.");
  }
  const index = Number.parseInt(selection, 10) - 1;
  if (index < 0 || index >= accounts.length) {
    throw new Error("Account selection is outside the displayed list.");
  }
  return accounts[index];
}

export async function selectFoundryAccount({
  keystoreDirectory = foundryKeystoreDirectory(),
  input = stdin,
  output = stdout,
} = {}) {
  const accounts = listFoundryAccounts({ keystoreDirectory });
  if (accounts.length === 0) {
    throw new Error(
      `No deployable Foundry accounts exist in ${keystoreDirectory}. ` +
        "Import one with: cast wallet import <account-name> --interactive"
    );
  }

  output.write("\nAvailable local Foundry accounts:\n");
  for (const [index, account] of accounts.entries()) {
    output.write(`${index + 1}. ${account}\n`);
  }

  const prompt = createInterface({ input, output });
  try {
    const selection = await prompt.question("\nSelect the deployment account: ");
    return resolveFoundryAccountSelection(selection, accounts);
  } finally {
    prompt.close();
  }
}
