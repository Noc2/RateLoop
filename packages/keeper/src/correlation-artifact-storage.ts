import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { keccak256, toBytes } from "viem";
import { config } from "./config.js";

interface StoredCorrelationArtifact {
  artifactHash: `0x${string}`;
  artifactURI: string;
  canonicalJson: string;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value), (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

export async function storeCorrelationArtifact(
  artifact: unknown,
): Promise<StoredCorrelationArtifact> {
  const canonical = canonicalJson(artifact);
  const artifactHash = keccak256(toBytes(canonical));
  const storage = config.correlationSnapshots.artifactStorage;

  if (storage.mode === "data-uri") {
    return {
      artifactHash,
      artifactURI: `data:application/json;base64,${Buffer.from(canonical, "utf8").toString("base64")}`,
      canonicalJson: canonical,
    };
  }

  await mkdir(storage.outputDir, { recursive: true });
  const filename = `${artifactHash}.json`;
  await writeFile(path.join(storage.outputDir, filename), `${canonical}\n`, "utf8");

  return {
    artifactHash,
    artifactURI: `${storage.publicBaseUrl.replace(/\/+$/, "")}/${filename}`,
    canonicalJson: canonical,
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortJson(record[key])]),
  );
}
