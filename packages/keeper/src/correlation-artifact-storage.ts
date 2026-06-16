import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  canonicalJsonStringHash,
} from "@rateloop/node-utils/json";
import { config } from "./config.js";

export interface StoredCorrelationArtifact {
  artifactHash: `0x${string}`;
  artifactURI: string;
  canonicalJson: string;
}

export { canonicalJson };

export async function storeCorrelationArtifact(
  artifact: unknown,
): Promise<StoredCorrelationArtifact> {
  const canonical = canonicalJson(artifact);
  return materializeCorrelationArtifactCanonicalJson(canonical);
}

export async function materializeCorrelationArtifactCanonicalJson(
  canonical: string,
): Promise<StoredCorrelationArtifact> {
  const artifactHash = canonicalJsonStringHash(canonical);
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
  await writeFile(path.join(storage.outputDir, filename), canonical, "utf8");

  return {
    artifactHash,
    artifactURI: `${storage.publicBaseUrl.replace(/\/+$/, "")}/${filename}`,
    canonicalJson: canonical,
  };
}
