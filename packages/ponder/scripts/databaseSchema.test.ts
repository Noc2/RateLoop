import {
  DEFAULT_PONDER_DATABASE_SCHEMA,
  buildPonderStartArgs,
  hasSchemaFlag,
  resolvePonderDatabaseSchema,
} from "./databaseSchema.mjs";

describe("Ponder database schema launcher", () => {
  test("uses a RateLoop-specific fallback schema", () => {
    expect(resolvePonderDatabaseSchema({}).schema).toBe(DEFAULT_PONDER_DATABASE_SCHEMA);
  });

  test("uses a network-specific default schema when possible", () => {
    const result = resolvePonderDatabaseSchema({ PONDER_NETWORK: "worldchainSepolia" });

    expect(result.schema).toBe("rateloop_ponder_worldchain_sepolia");
    expect(result.source).toBe("default");
  });

  test("avoids the legacy generic ponder schema with a network-specific schema", () => {
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "ponder",
      PONDER_NETWORK: "worldchainSepolia",
    });

    expect(result.schema).toBe("rateloop_ponder_worldchain_sepolia");
    expect(result.ignoredLegacyDatabaseSchema).toBe(true);
  });

  test("honors a custom DATABASE_SCHEMA", () => {
    const result = resolvePonderDatabaseSchema({ DATABASE_SCHEMA: "rateloop_ponder_preview" });

    expect(result.schema).toBe("rateloop_ponder_preview");
    expect(result.source).toBe("DATABASE_SCHEMA");
  });

  test("prefers the RateLoop-specific schema env var", () => {
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "ponder",
      RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_worldchain",
    });

    expect(result.schema).toBe("rateloop_ponder_worldchain");
    expect(result.source).toBe("RATELOOP_PONDER_DATABASE_SCHEMA");
    expect(result.ignoredLegacyDatabaseSchema).toBe(false);
  });

  test("rejects schema names that are unsafe to pass to Ponder", () => {
    expect(() => resolvePonderDatabaseSchema({ DATABASE_SCHEMA: "rate-loop" })).toThrow(
      "Invalid Ponder database schema",
    );
  });

  test("detects explicit schema flags", () => {
    expect(hasSchemaFlag(["--schema", "custom"])).toBe(true);
    expect(hasSchemaFlag(["--schema=custom"])).toBe(true);
    expect(hasSchemaFlag(["--port", "42069"])).toBe(false);
  });

  test("injects the resolved schema into production start arguments", () => {
    const result = buildPonderStartArgs(["--port", "42069"], {
      DATABASE_SCHEMA: "ponder",
      PONDER_NETWORK: "worldchainSepolia",
    });

    expect(result.args).toEqual(["start", "--schema", "rateloop_ponder_worldchain_sepolia", "--port", "42069"]);
    expect(result.env.DATABASE_SCHEMA).toBe("rateloop_ponder_worldchain_sepolia");
  });

  test("leaves explicit CLI schema arguments alone", () => {
    const env = { DATABASE_SCHEMA: "ponder" };
    const result = buildPonderStartArgs(["--schema", "custom"], env);

    expect(result.args).toEqual(["start", "--schema", "custom"]);
    expect(result.env).toBe(env);
    expect(result.schemaInfo).toBeNull();
  });
});
