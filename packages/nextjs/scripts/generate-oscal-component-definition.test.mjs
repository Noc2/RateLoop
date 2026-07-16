import { RATELOOP_OSCAL_NAMESPACE, assuranceComplianceMap } from "../config/assuranceComplianceMap.mjs";
import {
  OSCAL_COMPONENT_DEFINITION_PATH,
  assuranceComplianceMapHash,
  buildOscalComponentDefinition,
  checkOscalComponentDefinition,
  deterministicOscalUuid,
  serializeOscalComponentDefinition,
} from "./generate-oscal-component-definition.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function collectOwnedUuids(value, result = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectOwnedUuids(entry, result);
    return result;
  }
  if (!value || typeof value !== "object") return result;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "uuid") result.push(entry);
    collectOwnedUuids(entry, result);
  }
  return result;
}

function propValue(props, name, namespace = RATELOOP_OSCAL_NAMESPACE) {
  return props.find(prop => prop.name === name && prop.ns === namespace)?.value;
}

test("generates the OSCAL 1.2.2 component-definition shape with stable unique UUIDs", () => {
  const first = buildOscalComponentDefinition();
  const second = buildOscalComponentDefinition();
  assert.deepEqual(second, first);

  assert.deepEqual(Object.keys(first), ["component-definition"]);
  const definition = first["component-definition"];
  assert.deepEqual(Object.keys(definition), ["uuid", "metadata", "components", "back-matter"]);
  assert.equal(definition.metadata["oscal-version"], "1.2.2");
  assert.equal(definition.metadata.version, assuranceComplianceMap.mappingVersion);
  assert.equal(definition.metadata["last-modified"], assuranceComplianceMap.lastModified);
  assert.equal(definition.components.length, 1);
  assert.equal(definition.components[0].type, "service");
  assert.equal(definition.components[0]["control-implementations"].length, assuranceComplianceMap.frameworks.length);

  const ownedUuids = collectOwnedUuids(first);
  assert.ok(ownedUuids.length > assuranceComplianceMap.mappings.length);
  assert.equal(new Set(ownedUuids).size, ownedUuids.length);
  for (const uuid of ownedUuids) assert.match(uuid, UUID_V5_PATTERN);
  assert.equal(
    definition.uuid,
    deterministicOscalUuid(`component-definition:${assuranceComplianceMap.mappingVersion}`),
  );
});

test("encodes versioned hash-bound non-claim mappings and framework namespaces", () => {
  const definition = buildOscalComponentDefinition()["component-definition"];
  const mappingHash = assuranceComplianceMapHash();
  assert.match(mappingHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(propValue(definition.metadata.props, "mapping-version"), assuranceComplianceMap.mappingVersion);
  assert.equal(propValue(definition.metadata.props, "mapping-hash"), mappingHash);
  assert.equal(propValue(definition.components[0].props, "mapping-hash"), mappingHash);

  const frameworkById = new Map(assuranceComplianceMap.frameworks.map(framework => [framework.id, framework]));
  const mappingById = new Map(assuranceComplianceMap.mappings.map(mapping => [mapping.id, mapping]));
  const resourcesByUuid = new Map(definition["back-matter"].resources.map(resource => [resource.uuid, resource]));
  const implementations = definition.components[0]["control-implementations"];
  const generatedMappingIds = [];

  for (const implementation of implementations) {
    const frameworkId = implementation.props.find(prop => prop.name === "framework-id")?.value;
    const framework = frameworkById.get(frameworkId);
    assert.ok(framework, `unknown framework ${frameworkId}`);
    assert.equal(propValue(implementation.props, "framework-id", framework.namespace), framework.id);
    assert.equal(propValue(implementation.props, "claim"), "supports-evidence-for");
    assert.match(implementation.description, /support evidence for/u);
    assert.match(implementation.description, /not an assertion/u);
    assert.ok(resourcesByUuid.has(implementation.source.slice(1)));

    for (const requirement of implementation["implemented-requirements"]) {
      generatedMappingIds.push(requirement["control-id"]);
      const mapping = mappingById.get(requirement["control-id"]);
      assert.ok(mapping, `unknown mapping ${requirement["control-id"]}`);
      assert.equal(mapping.frameworkId, framework.id);
      assert.equal(propValue(requirement.props, "reference", framework.namespace), mapping.reference);
      assert.equal(propValue(requirement.props, "claim"), "supports-evidence-for");
      assert.match(requirement.description, /support evidence for/u);
      assert.match(requirement.description, /does not/u);
      assert.deepEqual(
        requirement.props
          .filter(prop => prop.name === "evidence-artifact" && prop.ns === RATELOOP_OSCAL_NAMESPACE)
          .map(prop => prop.value),
        mapping.evidenceArtifactIds,
      );
      assert.equal(requirement.links.length, mapping.evidenceArtifactIds.length);
      for (const link of requirement.links) {
        assert.equal(link.rel, "evidence");
        assert.ok(resourcesByUuid.has(link.href.slice(1)));
      }
    }
  }

  assert.deepEqual(
    generatedMappingIds,
    assuranceComplianceMap.mappings.map(mapping => mapping.id),
  );
  assert.doesNotMatch(
    JSON.stringify(definition),
    /(?:ensures compliance|is compliant|satisfies (?:a |the )?control|meets (?:a |the )?requirement|certifies a customer)/iu,
  );
});

test("keeps authoritative sources in back matter and exposes no unnamespaced mapping properties", () => {
  const definition = buildOscalComponentDefinition()["component-definition"];
  const resources = definition["back-matter"].resources;
  const frameworkResources = resources.slice(0, assuranceComplianceMap.frameworks.length);
  assert.equal(frameworkResources.length, assuranceComplianceMap.frameworks.length);
  for (const [index, resource] of frameworkResources.entries()) {
    const framework = assuranceComplianceMap.frameworks[index];
    assert.equal(propValue(resource.props, "framework-id", framework.namespace), framework.id);
    assert.ok(resource.citation.text.length > 20);
    assert.deepEqual(
      resource.rlinks.map(link => link.href),
      framework.sources.map(source => source.href),
    );
    for (const link of resource.rlinks) assert.match(link.href, /^https:\/\//u);
  }

  const mappingProps = definition.components[0]["control-implementations"].flatMap(implementation => [
    ...implementation.props,
    ...implementation["implemented-requirements"].flatMap(requirement => requirement.props),
  ]);
  assert.ok(mappingProps.length > 0);
  for (const prop of mappingProps) assert.ok(prop.ns, `property ${prop.name} has no namespace`);
});

test("keeps every mapped evidence artifact tied to a current repository schema", async () => {
  for (const artifact of assuranceComplianceMap.evidenceArtifacts) {
    const sources = await Promise.all(
      artifact.sourceLocations.map(sourceLocation =>
        readFile(new URL(`../../../${sourceLocation}`, import.meta.url), "utf8"),
      ),
    );
    assert.ok(
      sources.some(source => source.includes(artifact.schemaVersion)),
      `${artifact.id} is not backed by its declared schema version`,
    );
  }
});

test("keeps the public OSCAL download byte-for-byte in sync with the source map", async () => {
  assert.equal(await checkOscalComponentDefinition(), true);
  assert.equal(await readFile(OSCAL_COMPONENT_DEFINITION_PATH, "utf8"), serializeOscalComponentDefinition());
});
