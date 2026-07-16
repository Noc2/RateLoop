#!/usr/bin/env node
import { verifyAuditExport } from "./audit-export-core.mjs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function verifyAuditExportFile(path, options) {
  return verifyAuditExport(JSON.parse(await readFile(path, "utf8")), options);
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const expectedHead = argumentValue(args, "--expected-head");
  const path = args.find(value => !value.startsWith("--") && value !== expectedHead);
  if (!path) throw new Error("Usage: verify-audit-export.mjs <audit-export.json> [--expected-head sha256:<hex>]");
  const result = await verifyAuditExportFile(path, { expectedHead });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Audit verification failed."}\n`);
    process.exitCode = 1;
  });
}
