import type { Address } from "viem";

const DEVICE_PREFIX = "rateloop:rater-device-recovery:v2:";

export type DeviceRecoveryRecord = {
  schemaVersion: "rateloop.device-recovery.v2";
  principalId: string;
  roundId: string;
  voteKey: Address;
  recoveryPackage: string;
  createdAt: string;
};

export type DeviceRecoveryBackup = {
  schemaVersion: "rateloop.device-recovery-backup.v2";
  record: DeviceRecoveryRecord;
  recoverySecret: string;
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
  if (!isPrincipalId(input.principalId)) throw new Error("Device recovery requires an opaque browser principal.");
  return {
    schemaVersion: "rateloop.device-recovery.v2",
    ...input,
    createdAt: new Date().toISOString(),
  } satisfies DeviceRecoveryRecord;
}

function isPrincipalId(value: unknown): value is string {
  return typeof value === "string" && /^rlp_[a-z0-9_-]{16,128}$/iu.test(value);
}

export function isDeviceRecoveryRecord(value: unknown): value is DeviceRecoveryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DeviceRecoveryRecord>;
  return (
    record.schemaVersion === "rateloop.device-recovery.v2" &&
    isPrincipalId(record.principalId) &&
    typeof record.roundId === "string" &&
    /^0x[0-9a-f]{40}$/u.test(record.voteKey ?? "") &&
    typeof record.recoveryPackage === "string" &&
    typeof record.createdAt === "string"
  );
}

export function serializeDeviceRecoveryRecord(record: DeviceRecoveryRecord) {
  return JSON.stringify(record);
}

export function serializeDeviceRecoveryBackup(record: DeviceRecoveryRecord, recoverySecret: string) {
  if (!isDeviceRecoveryRecord(record) || recoverySecret.length < 12) {
    throw new Error("Device recovery backup material is invalid.");
  }
  return JSON.stringify(
    {
      schemaVersion: "rateloop.device-recovery-backup.v2",
      record,
      recoverySecret,
    } satisfies DeviceRecoveryBackup,
    null,
    2,
  );
}

export function parseDeviceRecoveryBackup(serialized: string) {
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!value || typeof value !== "object") return null;
    const backup = value as Partial<DeviceRecoveryBackup>;
    return backup.schemaVersion === "rateloop.device-recovery-backup.v2" &&
      isDeviceRecoveryRecord(backup.record) &&
      typeof backup.recoverySecret === "string" &&
      backup.recoverySecret.length >= 12
      ? (backup as DeviceRecoveryBackup)
      : null;
  } catch {
    return null;
  }
}

export function storeDeviceRecovery(
  record: DeviceRecoveryRecord,
  activePrincipalId: string,
  storage: Storage | null = browserStorage(),
) {
  if (!storage || !isDeviceRecoveryRecord(record) || record.principalId !== activePrincipalId) return false;
  try {
    storage.setItem(
      `${DEVICE_PREFIX}${activePrincipalId}:${record.voteKey.toLowerCase()}`,
      serializeDeviceRecoveryRecord(record),
    );
    return true;
  } catch {
    return false;
  }
}

export function listDeviceRecoveries(activePrincipalId: string, storage: Storage | null = browserStorage()) {
  if (!storage || !isPrincipalId(activePrincipalId)) return [];
  const records: DeviceRecoveryRecord[] = [];
  const principalPrefix = `${DEVICE_PREFIX}${activePrincipalId}:`;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const itemKey = storage.key(index);
      if (!itemKey?.startsWith(principalPrefix)) continue;
      const serialized = storage.getItem(itemKey);
      let value: unknown = null;
      try {
        value = serialized ? (JSON.parse(serialized) as unknown) : null;
      } catch {
        continue;
      }
      if (isDeviceRecoveryRecord(value) && value.principalId === activePrincipalId) records.push(value);
    }
  } catch {
    return [];
  }
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
