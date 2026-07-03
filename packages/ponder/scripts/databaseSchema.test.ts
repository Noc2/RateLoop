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

describe("Ponder database schema launcher", () => {
  test("uses a RateLoop-specific fallback schema", () => {
    expect(resolvePonderDatabaseSchema({}).schema).toBe(DEFAULT_PONDER_DATABASE_SCHEMA);
  });

  test("uses a network-specific default schema when possible", () => {
    const result = resolvePonderDatabaseSchema({ PONDER_NETWORK: "worldchainSepolia" });

    expect(result.schema).toBe("rateloop_ponder_worldchain_sepolia");
    expect(result.source).toBe("default");
  });

  test("uses Base-specific default schemas", () => {
    expect(resolvePonderDatabaseSchema({ PONDER_NETWORK: "baseSepolia" }).schema).toBe(
      "rateloop_ponder_base_sepolia",
    );
    expect(resolvePonderDatabaseSchema({ PONDER_NETWORK: "base" }).schema).toBe("rateloop_ponder_base");
  });

  test("avoids the legacy generic ponder schema with a network-specific schema", () => {
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "ponder",
      PONDER_NETWORK: "worldchainSepolia",
    });

    expect(result.schema).toBe("rateloop_ponder_worldchain_sepolia");
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
      PONDER_NETWORK: "worldchainSepolia",
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.schema).toBe("railway_123e4567_e89b_12d3_a456_426614174000");
    expect(result.source).toBe("RAILWAY_DEPLOYMENT_ID");
    expect(result.ignoredLegacyDatabaseSchema).toBe(true);
  });

  test("uses protocol deployment keys before Railway deployment IDs", () => {
    const deploymentKey =
      "4801:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const result = resolvePonderDatabaseSchema({
      PONDER_NETWORK: "worldchainSepolia",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.schema).toBe(schemaFromProtocolDeploymentKey(deploymentKey));
    expect(result.source).toBe("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY");
  });

  test("prefers live protocol deployment schemas over stale RateLoop schema overrides", () => {
    const deploymentKey =
      "8453:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const result = resolvePonderDatabaseSchema({
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_worldchain",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    });

    expect(result.schema).toBe(schemaFromProtocolDeploymentKey(deploymentKey));
    expect(result.source).toBe("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY");
    expect(result.ignoredLiveSchemaOverride).toBe(true);
  });

  test("prefers live protocol deployment schemas over stale DATABASE_SCHEMA overrides", () => {
    const deploymentKey =
      "8453:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "rateloop_ponder_base_sepolia",
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    });

    expect(result.schema).toBe(schemaFromProtocolDeploymentKey(deploymentKey));
    expect(result.source).toBe("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY");
    expect(result.ignoredLiveSchemaOverride).toBe(true);
  });

  test("rejects foreign static RateLoop schema overrides on live networks", () => {
    expect(() =>
      resolvePonderDatabaseSchema({
        PONDER_NETWORK: "base",
        RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_worldchain",
      }),
    ).toThrow("RATELOOP_PONDER_DATABASE_SCHEMA=rateloop_ponder_worldchain is a static worldchain Ponder schema");
  });

  test("rejects foreign static DATABASE_SCHEMA overrides on live networks", () => {
    expect(() =>
      resolvePonderDatabaseSchema({
        DATABASE_SCHEMA: "rateloop_ponder_base_sepolia",
        PONDER_NETWORK: "base",
      }),
    ).toThrow("DATABASE_SCHEMA=rateloop_ponder_base_sepolia is a static baseSepolia Ponder schema");
  });

  test("allows deliberate live schema overrides with the break-glass flag", () => {
    const deploymentKey =
      "8453:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const result = resolvePonderDatabaseSchema({
      [LIVE_SCHEMA_OVERRIDE_FLAG]: "true",
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_worldchain",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    });

    expect(result.schema).toBe("rateloop_ponder_worldchain");
    expect(result.source).toBe("RATELOOP_PONDER_DATABASE_SCHEMA");
    expect(result.ignoredLiveSchemaOverride).toBe(false);
  });

  test("uses protocol deployment keys when Railway deployment IDs are unavailable", () => {
    const deploymentKey =
      "4801:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const result = resolvePonderDatabaseSchema({
      PONDER_NETWORK: "worldchainSepolia",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    });

    expect(result.schema).toBe(schemaFromProtocolDeploymentKey(deploymentKey));
    expect(result.schema).toMatch(/^rateloop_deployment_[a-f0-9]{16}$/);
    expect(result.source).toBe("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY");
  });

  test("does not derive live protocol deployment schemas from PONDER address overrides", () => {
    const env = {
      PONDER_NETWORK: "baseSepolia",
      PONDER_CONTENT_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000001",
      PONDER_FEEDBACK_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000002",
    };

    expect(protocolDeploymentKeyFromEnv(env)).toBeUndefined();
    const result = resolvePonderDatabaseSchema(env);
    expect(result.schema).toBe("rateloop_ponder_base_sepolia");
    expect(result.source).toBe("default");
  });

  test("derives local protocol deployment schemas from hardhat address overrides", () => {
    const env = {
      PONDER_CHAIN_ID: "31337",
      PONDER_CONTENT_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000001",
      PONDER_FEEDBACK_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000002",
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
        PONDER_NETWORK: "baseSepolia",
        PONDER_CHAIN_ID: "8453",
        PONDER_CONTENT_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000001",
        PONDER_FEEDBACK_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000002",
      }),
    ).toThrow("PONDER_CHAIN_ID 8453 does not match PONDER_NETWORK baseSepolia (84532).");
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
        PONDER_CONTENT_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000001",
        PONDER_FEEDBACK_REGISTRY_ADDRESS: "0x1000000000000000000000000000000000000002",
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
      RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_worldchain",
    });

    expect(result.schema).toBe("rateloop_ponder_worldchain");
    expect(result.source).toBe("RATELOOP_PONDER_DATABASE_SCHEMA");
    expect(result.ignoredLegacyDatabaseSchema).toBe(false);
  });

  test("ignores deprecated static canary schemas on Railway deployments", () => {
    const result = resolvePonderDatabaseSchema({
      RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_worldchain_canary",
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.schema).toBe("railway_123e4567_e89b_12d3_a456_426614174000");
    expect(result.source).toBe("RAILWAY_DEPLOYMENT_ID");
    expect(result.ignoredDeprecatedStaticSchema).toBe(true);
  });

  test("ignores deprecated Base Sepolia canary schemas on Railway deployments", () => {
    const result = resolvePonderDatabaseSchema({
      RATELOOP_PONDER_DATABASE_SCHEMA: "rateloop_ponder_base_sepolia_canary",
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.schema).toBe("railway_123e4567_e89b_12d3_a456_426614174000");
    expect(result.source).toBe("RAILWAY_DEPLOYMENT_ID");
    expect(result.ignoredDeprecatedStaticSchema).toBe(true);
  });

  test("ignores deprecated static canary DATABASE_SCHEMA on Railway deployments", () => {
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "rateloop_ponder_worldchain_canary",
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.schema).toBe("railway_123e4567_e89b_12d3_a456_426614174000");
    expect(result.source).toBe("RAILWAY_DEPLOYMENT_ID");
    expect(result.ignoredDeprecatedStaticSchema).toBe(true);
  });

  test("ignores deprecated Base Sepolia canary DATABASE_SCHEMA on Railway deployments", () => {
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "rateloop_ponder_base_sepolia_canary",
      RAILWAY_DEPLOYMENT_ID: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.schema).toBe("railway_123e4567_e89b_12d3_a456_426614174000");
    expect(result.source).toBe("RAILWAY_DEPLOYMENT_ID");
    expect(result.ignoredDeprecatedStaticSchema).toBe(true);
  });

  test("ignores deprecated static canary schemas when a protocol deployment schema is available", () => {
    const deploymentKey =
      "480:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const result = resolvePonderDatabaseSchema({
      DATABASE_SCHEMA: "rateloop_ponder_worldchain_canary",
      PONDER_NETWORK: "worldchain",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    });

    expect(result.schema).toBe(schemaFromProtocolDeploymentKey(deploymentKey));
    expect(result.source).toBe("RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY");
    expect(result.ignoredDeprecatedStaticSchema).toBe(true);
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
      PONDER_NETWORK: "worldchainSepolia",
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
    const deploymentKey =
      "8453:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const schema = schemaFromProtocolDeploymentKey(deploymentKey);
    const result = buildPonderStartArgs(["--schema", schema, "--port", "42069"], {
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
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
    const deploymentKey =
      "8453:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";

    expect(() =>
      buildPonderStartArgs(["--schema", "rateloop_ponder_worldchain"], {
        PONDER_NETWORK: "base",
        RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
      }),
    ).toThrow("does not match live protocol deployment schema");
  });

  test("allows deliberate explicit live CLI schema overrides with the break-glass flag", () => {
    const deploymentKey =
      "8453:0x1000000000000000000000000000000000000001:0x1000000000000000000000000000000000000002";
    const result = buildPonderStartArgs(["--schema=rateloop_ponder_worldchain"], {
      [LIVE_SCHEMA_OVERRIDE_FLAG]: "true",
      PONDER_NETWORK: "base",
      RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
    });

    expect(result.args).toEqual(["start", "--schema=rateloop_ponder_worldchain"]);
    expect(result.env.DATABASE_SCHEMA).toBe("rateloop_ponder_worldchain");
    expect(result.schemaInfo).toMatchObject({
      schema: "rateloop_ponder_worldchain",
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
