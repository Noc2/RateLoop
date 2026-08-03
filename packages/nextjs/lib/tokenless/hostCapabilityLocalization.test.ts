import { TOKENLESS_HOST_CAPABILITIES } from "./hostCapabilities";
import {
  hasTokenlessHostCapabilityTranslation,
  localizeTokenlessHostCapabilityCopy,
} from "./hostCapabilityLocalization";
import assert from "node:assert/strict";
import test from "node:test";

function visibleHostCapabilityCopy() {
  return [
    ...new Set(
      TOKENLESS_HOST_CAPABILITIES.flatMap(host => [
        ...host.humanActions,
        ...host.installAffordances.flatMap(affordance =>
          affordance.kind === "settings-instructions" ? [affordance.label, affordance.value] : [affordance.label],
        ),
      ]),
    ),
  ];
}

test("authenticated picker and public guides share complete German host-capability copy", () => {
  for (const source of visibleHostCapabilityCopy()) {
    assert.ok(hasTokenlessHostCapabilityTranslation(source, "de"), `missing German host copy: ${source}`);
    assert.notEqual(localizeTokenlessHostCapabilityCopy(source, "de"), source, source);
    assert.equal(localizeTokenlessHostCapabilityCopy(source, "en"), source, source);
  }
});
