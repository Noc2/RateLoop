#!/usr/bin/env node
import { RATELOOP_OSCAL_NAMESPACE, assuranceComplianceMap } from "../config/assuranceComplianceMap.mjs";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OSCAL_COMPONENT_DEFINITION_PATH = fileURLToPath(
  new URL("../public/docs/rateloop-human-assurance-component-definition.oscal.json", import.meta.url),
);

const UUID_NAMESPACE = "4e30513e-4719-5c90-aee7-48cb3b9ff2a2";
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("The compliance map must be JSON serializable.");
  return encoded;
}

function uuidBytes(value) {
  const compact = value.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/iu.test(compact)) throw new Error("The OSCAL UUID namespace is invalid.");
  return Buffer.from(compact, "hex");
}

function formatUuid(value) {
  const hex = value.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deterministicOscalUuid(name) {
  const digest = createHash("sha1")
    .update(Buffer.concat([uuidBytes(UUID_NAMESPACE), Buffer.from(name, "utf8")]))
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return formatUuid(digest);
}

export function assuranceComplianceMapHash(source = assuranceComplianceMap) {
  return `sha256:${createHash("sha256").update(canonicalJson(source)).digest("hex")}`;
}

function artifactResource(artifact) {
  return {
    uuid: deterministicOscalUuid(`artifact:${artifact.id}`),
    title: artifact.title,
    description: artifact.description,
    props: [
      { name: "artifact-id", ns: RATELOOP_OSCAL_NAMESPACE, value: artifact.id },
      { name: "schema-version", ns: RATELOOP_OSCAL_NAMESPACE, value: artifact.schemaVersion },
    ],
  };
}

function frameworkResource(framework) {
  return {
    uuid: deterministicOscalUuid(`framework:${framework.id}`),
    title: framework.title,
    description: "Authoritative framework or regulatory source used only as a cross-reference for this mapping.",
    props: [{ name: "framework-id", ns: framework.namespace, value: framework.id }],
    citation: { text: framework.citation },
    rlinks: framework.sources.map(source => ({ href: source.href, "media-type": source.mediaType })),
  };
}

function frameworkImplementation(framework, mappings, artifactsById) {
  const frameworkResourceUuid = deterministicOscalUuid(`framework:${framework.id}`);
  return {
    uuid: deterministicOscalUuid(`control-implementation:${framework.id}`),
    source: `#${frameworkResourceUuid}`,
    description: `The listed RateLoop artifacts support evidence for selected ${framework.title} expectations. This is a cross-reference, not an assertion that a control is implemented or effective.`,
    props: [
      { name: "framework-id", ns: framework.namespace, value: framework.id },
      { name: "claim", ns: RATELOOP_OSCAL_NAMESPACE, value: "supports-evidence-for" },
    ],
    "implemented-requirements": mappings.map(mapping => {
      const artifacts = mapping.evidenceArtifactIds.map(artifactId => {
        const artifact = artifactsById.get(artifactId);
        if (!artifact) throw new Error(`Mapping ${mapping.id} references unknown artifact ${artifactId}.`);
        return artifact;
      });
      return {
        uuid: deterministicOscalUuid(`mapping:${mapping.id}`),
        "control-id": mapping.id,
        description: `The listed RateLoop artifacts support evidence for ${mapping.evidencePurpose}. ${mapping.nonClaim}`,
        props: [
          { name: "reference", ns: framework.namespace, value: mapping.reference },
          { name: "claim", ns: RATELOOP_OSCAL_NAMESPACE, value: "supports-evidence-for" },
          ...artifacts.map(artifact => ({
            name: "evidence-artifact",
            ns: RATELOOP_OSCAL_NAMESPACE,
            value: artifact.id,
          })),
        ],
        links: artifacts.map(artifact => ({
          href: `#${deterministicOscalUuid(`artifact:${artifact.id}`)}`,
          rel: "evidence",
          text: artifact.title,
        })),
      };
    }),
  };
}

function validateSource(source) {
  if (source.oscalVersion !== "1.2.2") throw new Error("The component definition must remain pinned to OSCAL 1.2.2.");
  if (!source.mappingVersion || !source.published || !source.lastModified || !source.claimBoundary) {
    throw new Error("The compliance map metadata is incomplete.");
  }
  const artifacts = new Set();
  for (const artifact of source.evidenceArtifacts) {
    if (artifacts.has(artifact.id)) throw new Error(`Duplicate evidence artifact ${artifact.id}.`);
    artifacts.add(artifact.id);
  }
  const frameworks = new Set();
  for (const framework of source.frameworks) {
    if (frameworks.has(framework.id)) throw new Error(`Duplicate framework ${framework.id}.`);
    frameworks.add(framework.id);
    if (!URL.canParse(framework.namespace)) throw new Error(`Framework ${framework.id} has an invalid namespace.`);
    for (const sourceLink of framework.sources) {
      if (!URL.canParse(sourceLink.href) || new URL(sourceLink.href).protocol !== "https:") {
        throw new Error(`Framework ${framework.id} must use HTTPS source links.`);
      }
    }
  }
  const mappings = new Set();
  for (const mapping of source.mappings) {
    if (mappings.has(mapping.id)) throw new Error(`Duplicate compliance mapping ${mapping.id}.`);
    mappings.add(mapping.id);
    if (!frameworks.has(mapping.frameworkId)) throw new Error(`Mapping ${mapping.id} references an unknown framework.`);
    if (!mapping.evidenceArtifactIds.length) throw new Error(`Mapping ${mapping.id} has no evidence artifacts.`);
    for (const artifactId of mapping.evidenceArtifactIds) {
      if (!artifacts.has(artifactId))
        throw new Error(`Mapping ${mapping.id} references unknown artifact ${artifactId}.`);
    }
  }
}

export function buildOscalComponentDefinition(source = assuranceComplianceMap) {
  validateSource(source);
  const mappingHash = assuranceComplianceMapHash(source);
  if (!HASH_PATTERN.test(mappingHash)) throw new Error("The compliance map hash is invalid.");
  const artifactsById = new Map(source.evidenceArtifacts.map(artifact => [artifact.id, artifact]));
  const mappingsByFramework = new Map(
    source.frameworks.map(framework => [
      framework.id,
      source.mappings.filter(mapping => mapping.frameworkId === framework.id),
    ]),
  );
  return {
    "component-definition": {
      uuid: deterministicOscalUuid(`component-definition:${source.mappingVersion}`),
      metadata: {
        title: "RateLoop Human Assurance Evidence Compliance Map",
        published: source.published,
        "last-modified": source.lastModified,
        version: source.mappingVersion,
        "oscal-version": source.oscalVersion,
        "document-ids": [
          {
            scheme: "https://rateloop.ai/docs/compliance-map",
            identifier: source.mappingVersion,
          },
        ],
        props: [
          { name: "mapping-version", ns: RATELOOP_OSCAL_NAMESPACE, value: source.mappingVersion },
          { name: "mapping-hash", ns: RATELOOP_OSCAL_NAMESPACE, value: mappingHash },
          { name: "claim-boundary", ns: RATELOOP_OSCAL_NAMESPACE, value: source.claimBoundary },
        ],
        links: [
          {
            href: "https://pages.nist.gov/OSCAL-Reference/models/v1.2.2/component-definition/",
            rel: "described-by",
            "media-type": "text/html",
            text: "OSCAL 1.2.2 Component Definition Model",
          },
        ],
        remarks:
          "This component definition is a machine-readable evidence cross-reference. It does not represent an assessment result, certification, legal opinion, or assertion that a customer's controls are implemented or effective.",
      },
      components: [
        {
          uuid: deterministicOscalUuid("component:rateloop-human-assurance-evidence"),
          type: "service",
          title: "RateLoop Human Assurance Evidence",
          description:
            "A service component that produces integrity-bearing records of configured and sampled human review of AI-enabled workflows. Host-reported execution metadata remains explicitly unverified.",
          purpose:
            "Provide review-policy, human-judgment, coverage, escalation, gate, and audit evidence that customers can evaluate within their own governance systems.",
          props: [
            { name: "mapping-version", ns: RATELOOP_OSCAL_NAMESPACE, value: source.mappingVersion },
            { name: "mapping-hash", ns: RATELOOP_OSCAL_NAMESPACE, value: mappingHash },
            { name: "claim-boundary", ns: RATELOOP_OSCAL_NAMESPACE, value: "supports-evidence-for" },
            { name: "execution-provenance", ns: RATELOOP_OSCAL_NAMESPACE, value: "host-reported-unverified" },
          ],
          "control-implementations": source.frameworks.map(framework =>
            frameworkImplementation(framework, mappingsByFramework.get(framework.id) ?? [], artifactsById),
          ),
        },
      ],
      "back-matter": {
        resources: [...source.frameworks.map(frameworkResource), ...source.evidenceArtifacts.map(artifactResource)],
      },
    },
  };
}

export function serializeOscalComponentDefinition(source = assuranceComplianceMap) {
  return `${JSON.stringify(buildOscalComponentDefinition(source), null, 2)}\n`;
}

export async function checkOscalComponentDefinition(
  outputPath = OSCAL_COMPONENT_DEFINITION_PATH,
  source = assuranceComplianceMap,
) {
  const expected = serializeOscalComponentDefinition(source);
  let actual;
  try {
    actual = await readFile(outputPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  return actual === expected;
}

async function main() {
  const args = process.argv.slice(2);
  const supported = new Set(["--check"]);
  const unknown = args.filter(argument => !supported.has(argument));
  if (unknown.length) throw new Error(`Unsupported argument: ${unknown.join(", ")}`);
  if (args.includes("--check")) {
    if (!(await checkOscalComponentDefinition())) {
      throw new Error("The public OSCAL component definition is missing or out of date. Regenerate it first.");
    }
    process.stdout.write("OSCAL component definition is current.\n");
    return;
  }
  await writeFile(OSCAL_COMPONENT_DEFINITION_PATH, serializeOscalComponentDefinition(), "utf8");
  process.stdout.write(`${OSCAL_COMPONENT_DEFINITION_PATH}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "OSCAL generation failed."}\n`);
    process.exitCode = 1;
  });
}
