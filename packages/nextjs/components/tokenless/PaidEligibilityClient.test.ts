import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PaidEligibilityClient.tsx", import.meta.url), "utf8");

test("paid eligibility asks residence first and conditionally renders the structured DAC7 form", () => {
  assert.ok((source.match(/<Field/g)?.length ?? 0) >= 10);
  assert.equal(source.match(/<ChoiceInput/g)?.length, 1);
  assert.equal(source.match(/<SelectField/g)?.length, 1);
  assert.doesNotMatch(source, /<input\b/);
  assert.match(source, /format="countryCode"/);
  assert.match(source, /type="date"/);
  assert.match(source, /autoComplete="street-address"/);
  assert.match(source, /autoComplete="postal-code"/);
  assert.match(source, /Tax identification number/);
  assert.match(source, /Place of birth city/);
  assert.match(source, /\{!residenceComplete \?/);
  assert.match(source, /\{collectDac7 \?/);
  assert.doesNotMatch(source, /If no TIN, reason|noTinReason/);
  assert.match(source, /Keep advisory-only/);
});

test("paid eligibility preserves server field errors and clears them as values change", () => {
  assert.match(source, /typeof body\.field === "string" \? body\.field : null/);
  assert.match(source, /const \{ capture, clear, fieldErrors, formError \} = useFormErrors\(\)/);
  assert.match(source, /capture\(cause, "Unable to complete paid-task eligibility\."\)/);
  assert.match(source, /clear\(key\)/);
  assert.match(source, /error=\{fieldErrors\.birthDate\}/);
  assert.match(source, /error=\{fieldErrors\.declaredResidenceCountry\}/);
  assert.match(source, /aria-invalid=\{fieldErrors\.sanctionsConsent/);
});

test("paid eligibility hides paid-work reassurance after advisory-only selection", () => {
  assert.match(source, /\{state\?\.status !== "declined" \? \([\s\S]*No blocked earnings later/u);
});
