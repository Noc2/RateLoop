import type { Address } from "viem";

const DEVICE_PREFIX = "rateloop:rater-device-recovery:v1:";
export const LEGACY_RECOVERY_PREFIX = "rateloop:rater-recovery:";

export type DeviceRecoveryRecord = {
  schemaVersion: "rateloop.device-recovery.v1";
  roundId: string;
  voteKey: Address;
  recoverySecret: string;
  recoveryPackage: string;
  createdAt: string;
};

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function generateDeviceRecoverySecret(
  randomValues: Crypto["getRandomValues"] = crypto.getRandomValues.bind(crypto),
) {
  const bytes = randomValues(new Uint8Array(32));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

export function createDeviceRecoveryRecord(input: Omit<DeviceRecoveryRecord, "schemaVersion" | "createdAt">) {
  return {
    schemaVersion: "rateloop.device-recovery.v1",
    ...input,
    createdAt: new Date().toISOString(),
  } satisfies DeviceRecoveryRecord;
}

export function isDeviceRecoveryRecord(value: unknown): value is DeviceRecoveryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DeviceRecoveryRecord>;
  return (
    record.schemaVersion === "rateloop.device-recovery.v1" &&
    typeof record.roundId === "string" &&
    /^0x[0-9a-f]{40}$/u.test(record.voteKey ?? "") &&
    typeof record.recoverySecret === "string" &&
    record.recoverySecret.length >= 12 &&
    typeof record.recoveryPackage === "string" &&
    typeof record.createdAt === "string"
  );
}

export function serializeDeviceRecoveryBackup(record: DeviceRecoveryRecord) {
  return JSON.stringify(record, null, 2);
}

export function parseDeviceRecoveryBackup(serialized: string) {
  try {
    const value = JSON.parse(serialized) as unknown;
    return isDeviceRecoveryRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeDeviceRecovery(record: DeviceRecoveryRecord, storage: Storage | null = browserStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(`${DEVICE_PREFIX}${record.voteKey.toLowerCase()}`, serializeDeviceRecoveryBackup(record));
    return true;
  } catch {
    return false;
  }
}

export function listDeviceRecoveries(storage: Storage | null = browserStorage()) {
  if (!storage) return [];
  const records: DeviceRecoveryRecord[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const itemKey = storage.key(index);
      if (!itemKey?.startsWith(DEVICE_PREFIX)) continue;
      const serialized = storage.getItem(itemKey);
      const record = serialized ? parseDeviceRecoveryBackup(serialized) : null;
      if (record) records.push(record);
    }
  } catch {
    return [];
  }
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
