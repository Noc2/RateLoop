import { describe, expect, it } from "vitest";
import { resolvePonderDatabaseSchema, schemaFromTokenlessDeploymentKey } from "../scripts/databaseSchema.mjs";

const key =
  "tokenless-v3:84532:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002:0x0000000000000000000000000000000000000000";

describe("tokenless database schema", () => {
  it("is stable per deployment identity", () => {
    expect(schemaFromTokenlessDeploymentKey(key)).toMatch(/^rateloop_tokenless_[0-9a-f]{16}$/u);
    expect(resolvePonderDatabaseSchema({ RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: key })).toBe(
      schemaFromTokenlessDeploymentKey(key),
    );
  });

  it("rejects legacy keys and accidental mixed-schema overrides", () => {
    expect(() => schemaFromTokenlessDeploymentKey("tokenless-v2:84532:legacy:legacy")).toThrow("tokenless-v3");
    expect(() =>
      resolvePonderDatabaseSchema({
        RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: key,
        DATABASE_SCHEMA: "legacy_schema",
      }),
    ).toThrow("must match tokenless deployment schema");
  });
});
