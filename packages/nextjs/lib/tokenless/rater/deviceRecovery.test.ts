import {
  createDeviceRecoveryRecord,
  generateDeviceRecoverySecret,
  listDeviceRecoveries,
  parseDeviceRecoveryBackup,
  serializeDeviceRecoveryBackup,
  storeDeviceRecovery,
} from "./deviceRecovery";
import assert from "node:assert/strict";
import test from "node:test";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

test("device recovery generates high-entropy secrets and stores records by vote key", () => {
  let next = 0;
  const randomValues = ((array: Uint8Array) => {
    for (let index = 0; index < array.length; index += 1) array[index] = next++;
    return array;
  }) as Crypto["getRandomValues"];
  const secret = generateDeviceRecoverySecret(randomValues);
  assert.equal(secret.length, 64);
  assert.equal(secret, "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");

  const storage = memoryStorage();
  const record = createDeviceRecoveryRecord({
    roundId: "42",
    voteKey: `0x${"a".repeat(40)}`,
    recoverySecret: secret,
    recoveryPackage: "encrypted-package",
  });
  assert.equal(storeDeviceRecovery(record, storage), true);
  assert.deepEqual(listDeviceRecoveries(storage), [record]);
  assert.deepEqual(parseDeviceRecoveryBackup(serializeDeviceRecoveryBackup(record)), record);
});

test("device recovery rejects malformed backups", () => {
  assert.equal(parseDeviceRecoveryBackup("{}"), null);
  assert.equal(parseDeviceRecoveryBackup("not-json"), null);
});
