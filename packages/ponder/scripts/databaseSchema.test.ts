import {
  DEFAULT_PONDER_DATABASE_SCHEMA,
  LIVE_SCHEMA_OVERRIDE_FLAG,
  buildPonderStartArgs,
  buildProtocolDeploymentKey,
  hasSchemaFlag,
  protocolDeploymentKeyFromEnv,
  resolvePonderChainId,
  schemaFromProtocolDeploymentKey,
  resolvePonderDatabaseSchema,
  schemaFromRailwayDeploymentId,
} from "./databaseSchema.mjs";

const contentRegistryAddress = "0x1000000000000000000000000000000000000001";
const feedbackRegistryAddress = "0x1000000000000000000000000000000000000002";
const baseDeploymentKey = buildProtocolDeploymentKey({
  chainId: 8453,
  contentRegistryAddress,
  feedbackRegistryAddress,
});

describe("Ponder database schema launcher", () => {
  test("uses a RateLoop-specific fallback schema", () => {
    expect(resolvePonderDatabaseSchema({}).schema).toBe(DEFAULT_PONDER_DATABASE_SCHEMA);
  });

  test("uses supported network-specific default schemas", () => {
    expect(resolvePonderDatabaseSchema({ PONDER_NETWORK: "hardhat" }).schema).toBe(
      "rateloop_ponder_hardhat",
    );
    expect(resolvePonderDatabaseSchema({ PONDER_NETWORK: "base" }).schema).toBe("rateloop_ponder_base");
  });

  test("avoids the legacy generic ponder schema with a network-specific schema", () => {
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "ponder",
      PONDER_NETWORK: "base",
    });

    expect(result.schema).toBe("rateloop_ponder_base");
    expect(result.ignoredLegacyDatabaseSchema).toBe(true);
  });

  test("uses Railway deployment IDs for production deployment schemas", () => {
    const result = resolvePonderDatabaseSchema({
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.schema).toBe("railway_123e4567_e89b_12d3_a456_426614174000");
    expect(result.source).toBe("RAILWAY_DEPLOYMENT_ID");
  });

  test("uses Railway deployment IDs instead of the legacy generic ponder schema", () => {
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "ponder",
      PONDER_NETWORK: "base",
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.schema).toBe("railway_123e4567_e89b_12d3_a456_426614174000");
    expect(result.source).toBe("RAILWAY_DEPLOYMENT_ID");
    expect(result.ignoredLegacyDatabaseSchema).toBe(true);
  });

  test("uses protocol deployment keys before Railway deployment IDs", () => {
    const result = resolvePonderDatabaseSchema({
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: baseDeploymentKey,
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.schema).toBe(schemaFromProtocolDeploymentKey(baseDeploymentKey));
    expect(result.source).toBe("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY");
  });

  test("prefers live protocol deployment schemas over stale RateLoop schema overrides", () => {
    const result = resolvePonderDatabaseSchema({
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_preview",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: baseDeploymentKey,
    });

    expect(result.schema).toBe(schemaFromProtocolDeploymentKey(baseDeploymentKey));
    expect(result.source).toBe("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY");
    expect(result.ignoredLiveSchemaOverride).toBe(true);
  });

  test("prefers live protocol deployment schemas over stale DATABASE_SCHEMA overrides", () => {
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "rateloop_ponder_preview",
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: baseDeploymentKey,
    });

    expect(result.schema).toBe(schemaFromProtocolDeploymentKey(baseDeploymentKey));
    expect(result.source).toBe("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY");
    expect(result.ignoredLiveSchemaOverride).toBe(true);
  });

  test("rejects foreign static schema overrides on live networks", () => {
    expect(() =>
      resolvePonderDatabaseSchema({
        PONDER_NETWORK: "base",
        RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_hardhat",
      }),
    ).toThrow("RATELOOP_PONDER_DATABASE_SCHEMA=rateloop_ponder_hardhat is a static hardhat Ponder schema");

    expect(() =>
      resolvePonderDatabaseSchema({
        DATABASE_SCHEMA: "rateloop_ponder_hardhat",
        PONDER_NETWORK: "base",
      }),
    ).toThrow("DATABASE_SCHEMA=rateloop_ponder_hardhat is a static hardhat Ponder schema");
  });

  test("allows deliberate live schema overrides with the break-glass flag", () => {
    const result = resolvePonderDatabaseSchema({
      [LIVE_SCHEMA_OVERRIDE_FLAG]: "true",
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_preview",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: baseDeploymentKey,
    });

    expect(result.schema).toBe("rateloop_ponder_preview");
    expect(result.source).toBe("RATELOOP_PONDER_DATABASE_SCHEMA");
    expect(result.ignoredLiveSchemaOverride).toBe(false);
  });

  test("does not derive live protocol deployment schemas from PONDER address overrides", () => {
    const env = {
      PONDER_NETWORK: "base",
      PONDER_CONTENT_REGISTRY_ADDRESS: contentRegistryAddress,
      PONDER_FEEDBACK_REGISTRY_ADDRESS: feedbackRegistryAddress,
    };

    expect(protocolDeploymentKeyFromEnv(env)).toBeUndefined();
    const result = resolvePonderDatabaseSchema(env);
    expect(result.schema).toBe("rateloop_ponder_base");
    expect(result.source).toBe("default");
  });

  test("derives local protocol deployment schemas from hardhat address overrides", () => {
    const env = {
      PONDER_CHAIN_ID: "31337",
      PONDER_CONTENT_REGISTRY_ADDRESS: contentRegistryAddress,
      PONDER_FEEDBACK_REGISTRY_ADDRESS: feedbackRegistryAddress,
    };
    const deploymentKey = buildProtocolDeploymentKey({
      chainId: 31337,
      contentRegistryAddress: env.PONDER_CONTENT_REGISTRY_ADDRESS,
      feedbackRegistryAddress: env.PONDER_FEEDBACK_REGISTRY_ADDRESS,
    });

    expect(protocolDeploymentKeyFromEnv(env)).toBe(deploymentKey);
    const result = resolvePonderDatabaseSchema(env);
    expect(result.schema).toBe(schemaFromProtocolDeploymentKey(deploymentKey));
    expect(result.source).toBe("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY");
  });

  test("rejects explicit chain ids that conflict with the configured network", () => {
    expect(() =>
      protocolDeploymentKeyFromEnv({
        PONDER_NETWORK: "base",
        PONDER_CHAIN_ID: "31337",
        PONDER_CONTENT_REGISTRY_ADDRESS: contentRegistryAddress,
        PONDER_FEEDBACK_REGISTRY_ADDRESS: feedbackRegistryAddress,
      }),
    ).toThrow("PONDER_CHAIN_ID 31337 does not match PONDER_NETWORK base (8453).");
  });

  test("rejects malformed explicit chain ids before deriving schemas", () => {
    expect(() =>
      resolvePonderChainId({
        PONDER_NETWORK: "base",
        PONDER_CHAIN_ID: "8453junk",
      }),
    ).toThrow("PONDER_CHAIN_ID must be a positive integer.");

    expect(() =>
      protocolDeploymentKeyFromEnv({
        PONDER_NETWORK: "base",
        PONDER_CHAIN_ID: "8453junk",
        PONDER_CONTENT_REGISTRY_ADDRESS: contentRegistryAddress,
        PONDER_FEEDBACK_REGISTRY_ADDRESS: feedbackRegistryAddress,
      }),
    ).toThrow("PONDER_CHAIN_ID must be a positive integer.");
  });

  test("honors a custom DATABASE_SCHEMA", () => {
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "rateloop_ponder_preview",
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.schema).toBe("rateloop_ponder_preview");
    expect(result.source).toBe("DATABASE_SCHEMA");
  });

  test("prefers the RateLoop-specific schema env var", () => {
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "ponder",
      RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_custom",
    });

    expect(result.schema).toBe("rateloop_ponder_custom");
    expect(result.source).toBe("RATELOOP_PONDER_DATABASE_SCHEMA");
    expect(result.ignoredLegacyDatabaseSchema).toBe(false);
  });

  test("rejects schema names that are unsafe to pass to Ponder", () => {
    expect(() => resolvePonderDatabaseSchema({ DATABASE_SCHEMA: "rate-loop" })).toThrow(
      "Invalid Ponder database schema",
    );
  });

  test("sanitizes long Railway deployment IDs into Ponder-compatible schema names", () => {
    const schema = schemaFromRailwayDeploymentId("deploy/with a very very long id that needs shortening");

    expect(schema).toMatch(/^railway_deploy_with_a_very_very_long_[a-f0-9]{8}$/);
    expect(schema?.length).toBeLessThanOrEqual(45);
  });

  test("detects explicit schema flags", () => {
    expect(hasSchemaFlag(["--schema", "custom"])).toBe(true);
    expect(hasSchemaFlag(["--schema=custom"])).toBe(true);
    expect(hasSchemaFlag(["--port", "42069"])).toBe(false);
  });

  test("injects the resolved schema into production start arguments", () => {
    const result = buildPonderStartArgs(["--port", "42069"], {
      DATABASE_SCHEMA: "ponder",
      PONDER_NETWORK: "base",
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.args).toEqual([
      "start",
      "--schema",
      "railway_123e4567_e89b_12d3_a456_426614174000",
      "--port",
      "42069",
    ]);
    expect(result.env.DATABASE_SCHEMA).toBe("railway_123e4567_e89b_12d3_a456_426614174000");
  });

  test("leaves explicit CLI schema arguments alone", () => {
    const env = { DATABASE_SCHEMA: "ponder" };
    const result = buildPonderStartArgs(["--schema", "custom"], env);

    expect(result.args).toEqual(["start", "--schema", "custom"]);
    expect(result.env).toEqual({
      ...env,
      DATABASE_SCHEMA: "custom",
    });
    expect(result.schemaInfo).toMatchObject({
      expectedSchema: "rateloop_ponder",
      schema: "custom",
      source: "--schema",
    });
  });

  test("allows explicit live CLI schema arguments that match the protocol deployment schema", () => {
    const schema = schemaFromProtocolDeploymentKey(baseDeploymentKey);
    const result = buildPonderStartArgs(["--schema", schema, "--port", "42069"], {
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: baseDeploymentKey,
    });

    expect(result.args).toEqual(["start", "--schema", schema, "--port", "42069"]);
    expect(result.env.DATABASE_SCHEMA).toBe(schema);
    expect(result.schemaInfo).toMatchObject({
      expectedSchema: schema,
      schema,
      source: "--schema",
    });
  });

  test("rejects stale explicit live CLI schema arguments", () => {
    expect(() =>
      buildPonderStartArgs(["--schema", "rateloop_ponder_preview"], {
        PONDER_NETWORK: "base",
        RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: baseDeploymentKey,
      }),
    ).toThrow("does not match live protocol deployment schema");
  });

  test("allows deliberate explicit live CLI schema overrides with the break-glass flag", () => {
    const result = buildPonderStartArgs(["--schema=rateloop_ponder_preview"], {
      [LIVE_SCHEMA_OVERRIDE_FLAG]: "true",
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: baseDeploymentKey,
    });

    expect(result.args).toEqual(["start", "--schema=rateloop_ponder_preview"]);
    expect(result.env.DATABASE_SCHEMA).toBe("rateloop_ponder_preview");
    expect(result.schemaInfo).toMatchObject({
      schema: "rateloop_ponder_preview",
      source: "--schema",
    });
  });

  test("rejects invalid or ambiguous explicit CLI schema arguments", () => {
    expect(() => buildPonderStartArgs(["--schema"], {})).toThrow("--schema requires a non-empty schema name");
    expect(() => buildPonderStartArgs(["--schema="], {})).toThrow("--schema requires a non-empty schema name");
    expect(() => buildPonderStartArgs(["--schema", "valid", "--schema=other"], {})).toThrow(
      "Multiple --schema arguments are ambiguous",
    );
    expect(() => buildPonderStartArgs(["--schema", "rate-loop"], {})).toThrow("Invalid Ponder database schema");
  });
});
