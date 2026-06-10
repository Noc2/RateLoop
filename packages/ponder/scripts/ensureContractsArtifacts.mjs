import { pathToFileURL } from "node:url";
import { ensureContractsArtifacts } from "./start.mjs";

export function runEnsureContractsArtifacts() {
  try {
    ensureContractsArtifacts();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ponder] ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEnsureContractsArtifacts();
}
