import { FIELD_FORMATS, fieldFormat } from "./fieldFormats";
import assert from "node:assert/strict";
import test from "node:test";

test("shared field formats keep browser constraints and messages together", () => {
  for (const [name, format] of Object.entries(FIELD_FORMATS)) {
    assert.ok(format.pattern, `${name} has a pattern`);
    assert.ok(format.maxLength > 0, `${name} has a length`);
    assert.ok(format.title, `${name} has a title`);
    assert.ok(format.message, `${name} has a message`);
    assert.doesNotThrow(() => new RegExp(`^(?:${format.pattern})$`, "u"));
  }
  assert.equal(fieldFormat("vatIdentifier").maxLength, 64);
});

test("one-time codes share the exact six-digit browser constraint", () => {
  const format = fieldFormat("oneTimeCode");
  assert.equal(format.pattern, "[0-9]{6}");
  assert.equal(format.maxLength, 6);
  assert.match(format.message, /six-digit/u);
});
