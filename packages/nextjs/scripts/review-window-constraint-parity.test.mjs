import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_DIRECTORY = resolve(PACKAGE_ROOT, "drizzle");
const POLICY_FILE = resolve(PACKAGE_ROOT, "lib/tokenless/reviewPanelPolicy.ts");

/**
 * The application bound and the database CHECK constraints have to agree.
 *
 * They diverged once: the application ceiling was raised to 30 days while three
 * CHECK constraints still capped the stored value at 86400, so the new default
 * passed every validator and was then rejected on INSERT. That combination is
 * worse than either bound alone, because nothing fails until a customer tries to
 * configure a review.
 *
 * This reads the ceiling out of the policy module and asserts that the
 * highest-numbered migration mentioning each constraint uses the same number.
 */
async function latestConstraintCeilings() {
  const files = (await readdir(MIGRATION_DIRECTORY)).filter(name => name.endsWith(".sql")).sort();
  const ceilings = new Map();
  for (const file of files) {
    const sql = await readFile(resolve(MIGRATION_DIRECTORY, file), "utf8");
    for (const match of sql.matchAll(/"response_window_seconds"\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/gu)) {
      // Later migrations replace earlier constraints, so last writer wins.
      ceilings.set(`${file}:${match.index}`, { file, floor: Number(match[1]), ceiling: Number(match[2]) });
    }
  }
  const byFile = new Map();
  for (const entry of ceilings.values()) {
    const existing = byFile.get(entry.file) ?? [];
    existing.push(entry);
    byFile.set(entry.file, existing);
  }
  return { byFile, files };
}

test("the newest response-window CHECK matches the application ceiling", async () => {
  const policy = await readFile(POLICY_FILE, "utf8");
  const floorMatch = policy.match(/MINIMUM_REVIEW_RESPONSE_WINDOW_SECONDS\s*=\s*([\d_]+)/u);
  const ceilingMatch = policy.match(/MAXIMUM_REVIEW_RESPONSE_WINDOW_SECONDS\s*=\s*([\d_]+)/u);
  assert.ok(floorMatch && ceilingMatch, "reviewPanelPolicy must declare both response-window bounds");
  const expectedFloor = Number(floorMatch[1].replaceAll("_", ""));
  const expectedCeiling = Number(ceilingMatch[1].replaceAll("_", ""));

  const { byFile } = await latestConstraintCeilings();
  const migrations = [...byFile.keys()].sort();
  assert.ok(migrations.length > 0, "no migration constrains response_window_seconds");

  const newest = migrations.at(-1);
  for (const entry of byFile.get(newest) ?? []) {
    assert.equal(
      entry.ceiling,
      expectedCeiling,
      `${newest} caps response_window_seconds at ${entry.ceiling} while the application allows ${expectedCeiling}`,
    );
    assert.equal(entry.floor, expectedFloor, `${newest} floors response_window_seconds at ${entry.floor}`);
  }
});

test("every constraint the newest migration replaced is actually re-added", async () => {
  // A DROP CONSTRAINT without a matching ADD CONSTRAINT silently removes a
  // guard, which is the opposite failure and just as quiet.
  const { files } = await latestConstraintCeilings();
  const newest = files.filter(name => name.includes("review_response_window")).at(-1);
  assert.ok(newest, "expected a migration whose name records the response-window change");
  const sql = await readFile(resolve(MIGRATION_DIRECTORY, newest), "utf8");
  const dropped = [...sql.matchAll(/DROP CONSTRAINT "([^"]+)"/gu)].map(match => match[1]).sort();
  const added = [...sql.matchAll(/ADD CONSTRAINT "([^"]+)"/gu)].map(match => match[1]).sort();
  assert.deepEqual(added, dropped, `${newest} must re-add every constraint it drops`);
});
