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

const PRINCIPAL_A = `rlp_${"a".repeat(48)}`;
const PRINCIPAL_B = `rlp_${"b".repeat(48)}`;

test("device recovery keeps the unwrap secret out of principal-scoped browser storage", () => {
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
    principalId: PRINCIPAL_A,
    roundId: "42",
    voteKey: `0x${"a".repeat(40)}`,
    recoveryPackage: "encrypted-package",
  });
  assert.equal(storeDeviceRecovery(record, PRINCIPAL_A, storage), true);
  assert.deepEqual(listDeviceRecoveries(PRINCIPAL_A, storage), [record]);
  assert.doesNotMatch(storage.getItem(storage.key(0)!)!, new RegExp(secret, "u"));

  const backup = parseDeviceRecoveryBackup(serializeDeviceRecoveryBackup(record, secret));
  assert.deepEqual(backup, { schemaVersion: "rateloop.device-recovery-backup.v2", record, recoverySecret: secret });
});

test("an active principal cannot bind or list another principal's recovery key", () => {
  const storage = memoryStorage();
  const record = createDeviceRecoveryRecord({
    principalId: PRINCIPAL_B,
    roundId: "43",
    voteKey: `0x${"b".repeat(40)}`,
    recoveryPackage: "account-b-encrypted-package",
  });

  assert.equal(storeDeviceRecovery(record, PRINCIPAL_A, storage), false);
  assert.equal(storage.length, 0);
  assert.equal(storeDeviceRecovery(record, PRINCIPAL_B, storage), true);
  storage.setItem(`rateloop:rater-device-recovery:v2:${PRINCIPAL_B}:corrupt`, "{");
  assert.deepEqual(listDeviceRecoveries(PRINCIPAL_A, storage), []);
  assert.deepEqual(listDeviceRecoveries(PRINCIPAL_B, storage), [record]);
});

test("device recovery rejects malformed and origin-wide legacy backups", () => {
  const storage = memoryStorage();
  storage.setItem(
    `rateloop:rater-device-recovery:v1:0x${"c".repeat(40)}`,
    JSON.stringify({ recoverySecret: "origin-wide-secret", recoveryPackage: "legacy-package" }),
  );

  assert.deepEqual(listDeviceRecoveries(PRINCIPAL_A, storage), []);
  assert.equal(parseDeviceRecoveryBackup("{}"), null);
  assert.equal(parseDeviceRecoveryBackup("not-json"), null);
});
