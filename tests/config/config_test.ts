// deno-lint-ignore-file no-explicit-any
/**
 * @module ConfigSchemaTest
 * @path tests/config/config_test.ts
 * @description Validates the system's global configuration schema, ensuring robust parsing of
 * JSON/YAML settings, default value application, and strict validation of sensitive provider keys.
 */

import { assertEquals, assertExists, assertStringIncludes, assertThrows } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { ProviderCostTier } from "@exaix/core";
import { ConfigService } from "@exaix/core/config";
import { ConfigSchema } from "@exaix/schemas/config.ts";

import { DEFAULT_MCP_VERSION } from "@exaix/mcp";
import { ExaPathDefaults } from "@exaix/core";
import { readFixtureTextSync } from "@exaix/testing";
import type { JSONValue } from "@exaix/core/types";

/** Loosely-typed raw config object used to exercise ConfigSchema parsing. */
type RawConfigCandidate = Record<string, JSONValue>;

/** Loads the config at configPath, asserts the basic system fields, and removes tempDir. */
async function assertLoadsBasicSystemConfig(configPath: string, tempDir: string): Promise<void> {
  try {
    const service = new ConfigService(configPath);
    const config = service.get();

    assertEquals(config.system.version, "1.0.0");
    assertEquals(config.system.log_level, "info");
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
}

/** Parses config and asserts the default provider_strategy values are present. */
function parseAndAssertProviderStrategyDefaults(config: RawConfigCandidate): void {
  const result = ConfigSchema.safeParse(config);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.provider_strategy?.prefer_free, true);
    assertEquals(result.data.provider_strategy?.allow_local, true);
    assertEquals(result.data.provider_strategy?.max_daily_cost_usd, 5.00);
    assertEquals(result.data.provider_strategy?.health_check_enabled, true);
    assertEquals(result.data.provider_strategy?.fallback_enabled, true);
  }
}

/** Parses config, asserts failure, and checks the Zod error path/message. */
function assertParseFailsWith(config: RawConfigCandidate, pathKey: string, messagePart: string): void {
  const result = ConfigSchema.safeParse(config);
  assertEquals(result.success, false);
  if (!result.success) {
    const error = result.error.errors.find((e) => e.path.includes(pathKey));
    assertExists(error);
    assertStringIncludes(error.message, messagePart);
  }
}

Deno.test("ConfigSchema accepts valid minimal config", () => {
  const validConfig = {
    system: {
      version: DEFAULT_MCP_VERSION,
      log_level: "info",
    },
    paths: { ...ExaPathDefaults },
  };

  const result = ConfigSchema.safeParse(validConfig);
  assertEquals(result.success, true);
});

Deno.test("ConfigSchema rejects invalid log_level", () => {
  const invalidConfig = {
    system: {
      log_level: "invalid",
    },
    paths: {
      memory: "./Memory",
    },
  };

  const result = ConfigSchema.safeParse(invalidConfig);
  assertEquals(result.success, false);
});

Deno.test("ConfigSchema accepts budget_enforcement with cloud = false", () => {
  const configWithBudgetEnforcement = {
    system: {
      version: DEFAULT_MCP_VERSION,
      log_level: "info",
    },
    paths: { ...ExaPathDefaults },
    budget_enforcement: {
      cloud: false,
      local: true,
    },
  };

  const result = ConfigSchema.safeParse(configWithBudgetEnforcement);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.budget_enforcement?.cloud, false);
    assertEquals(result.data.budget_enforcement?.local, true);
  }
});

Deno.test("ConfigSchema: rejects budget_enforcement.cloud as string", () => {
  const result = ConfigSchema.safeParse({
    system: {
      version: DEFAULT_MCP_VERSION,
      log_level: "info",
    },
    paths: { ...ExaPathDefaults },
    budget_enforcement: {
      cloud: "yes",
      local: false,
    },
  });

  assertEquals(result.success, false);
});

Deno.test("ConfigSchema: rejects budget_enforcement.local as number", () => {
  const result = ConfigSchema.safeParse({
    system: {
      version: DEFAULT_MCP_VERSION,
      log_level: "info",
    },
    paths: { ...ExaPathDefaults },
    budget_enforcement: {
      cloud: true,
      local: 1,
    },
  });

  assertEquals(result.success, false);
});

Deno.test("ConfigSchema: accepts omitted budget_enforcement (backward compat)", () => {
  const result = ConfigSchema.safeParse({
    system: {
      version: DEFAULT_MCP_VERSION,
      log_level: "info",
    },
    paths: { ...ExaPathDefaults },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.budget_enforcement, undefined);
  }
});

Deno.test("ConfigSchema accepts max_flow_retry_cost_usd", () => {
  const result = ConfigSchema.safeParse({
    system: {
      version: DEFAULT_MCP_VERSION,
      log_level: "info",
    },
    paths: { ...ExaPathDefaults },
    max_flow_retry_cost_usd: 0.25,
  });

  assertEquals(result.success, true);
  if (result.success) {
    const parsed = result.data as { max_flow_retry_cost_usd?: number };
    assertEquals(parsed.max_flow_retry_cost_usd, 0.25);
  }
});

Deno.test("ConfigSchema applies defaults for missing agents section", () => {
  const configWithoutAgents = {
    system: {
      version: DEFAULT_MCP_VERSION,
      log_level: "info",
    },
    paths: { ...ExaPathDefaults },
  };

  const result = ConfigSchema.parse(configWithoutAgents);
  assertEquals(result.agents.default_model, "default");
  assertEquals(result.agents.timeout_sec, 60);
});

Deno.test("ConfigSchema applies defaults for missing watcher section", () => {
  const configWithoutWatcher = {
    system: {
      version: DEFAULT_MCP_VERSION,
      log_level: "info",
    },
    paths: { ...ExaPathDefaults },
  };

  const result = ConfigSchema.parse(configWithoutWatcher);
  assertEquals(result.watcher.debounce_ms, 200);
  assertEquals(result.watcher.stability_check, true);
});

Deno.test("ConfigSchema applies defaults for missing routing section", () => {
  const configWithoutRouting = {
    system: {
      version: DEFAULT_MCP_VERSION,
      log_level: "info",
    },
    paths: { ...ExaPathDefaults },
  };

  const result = ConfigSchema.parse(configWithoutRouting);
  assertEquals(result.routing.enabled, true);
  assertEquals(result.routing.policy_path, ".exaix/routing.policy.yaml");
});

Deno.test("ConfigSchema accepts routing policy configuration", () => {
  const configWithRouting = {
    system: {
      version: DEFAULT_MCP_VERSION,
      log_level: "info",
    },
    paths: { ...ExaPathDefaults },
    routing: {
      enabled: false,
      policy_path: "config/routing.policy.yaml",
    },
  };

  const result = ConfigSchema.safeParse(configWithRouting);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.routing?.enabled, false);
    assertEquals(result.data.routing?.policy_path, "config/routing.policy.yaml");
  }
});

Deno.test("ConfigService computes checksum", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "config-checksum-test-" });

  try {
    const configPath = `${tempDir}/exa.config.toml`;
    const service = new ConfigService(configPath);
    const checksum = service.getChecksum();

    assertExists(checksum);
    assertEquals(checksum.length, 64);
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

Deno.test("ConfigService loads config successfully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "config-load-test-" });

  try {
    const configPath = `${tempDir}/exa.config.toml`;
    const service = new ConfigService(configPath);
    const config = service.get();

    assertExists(config.system);
    assertExists(config.paths);
    assertEquals(config.system.log_level, "info");
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

// ============================================================================
// ConfigService Error Handling Tests
// ============================================================================

Deno.test("ConfigService handles missing config file", async (t) => {
  const tempDir = await Deno.makeTempDir({ prefix: "config-missing-test-" });

  try {
    await t.step("should create default config when file not found", () => {
      const configPath = `${tempDir}/test-missing-config.toml`;

      // ConfigService should create default config
      const service = new ConfigService(configPath);
      const config = service.get();

      // Verify config has defaults (from the created default file)
      assertEquals(config.system.log_level, "info");
      assertEquals(config.paths.memory, ExaPathDefaults.memory); // From file
      assertEquals(config.paths.blueprints, ExaPathDefaults.blueprints); // From file

      // Verify file was created
      const fileExists = (() => {
        try {
          Deno.statSync(configPath);
          return true;
        } catch {
          return false;
        }
      })();
      assertEquals(fileExists, true);
    });

    await t.step("should compute checksum for created default config", () => {
      const configPath = `${tempDir}/test-checksum-config.toml`;

      const service = new ConfigService(configPath);
      const checksum = service.getChecksum();

      // Checksum should be computed for the created file
      assertEquals(typeof checksum, "string");
      assertEquals(checksum.length > 0, true);
    });
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

Deno.test("ConfigService handles invalid TOML syntax", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "config-invalid-toml-test-" });

  try {
    const configPath = `${tempDir}/test-invalid-toml.toml`;

    // Create file with invalid TOML
    await Deno.writeTextFile(configPath, "[system\nthis is not valid TOML");

    assertThrows(
      () => {
        new ConfigService(configPath);
      },
      Error,
    );
  } finally {
    // Clean up
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});

Deno.test("ConfigService handles validation errors", async (t) => {
  const tempDir = await Deno.makeTempDir({ prefix: "config-validation-test-" });

  try {
    await t.step("should exit on missing required fields", () => {
      const configPath = `${tempDir}/test-missing-fields.toml`;

      // Create config missing required system.version
      Deno.writeTextFileSync(
        configPath,
        `
[system]
log_level = "info"
      `.trim(),
      );

      assertThrows(
        () => {
          new ConfigService(configPath);
        },
        Error,
        "Invalid configuration",
      );
    });

    await t.step("should exit on invalid field types", () => {
      const configPath = `${tempDir}/test-invalid-types.toml`;

      // Create config with invalid log_level
      Deno.writeTextFileSync(
        configPath,
        `
[system]
version = "1.0.0"
log_level = "invalid_level"

[paths]
memory = "./Memory"
blueprints = "./Blueprints"
runtime = "./Runtime"
      `.trim(),
      );

      assertThrows(
        () => {
          new ConfigService(configPath);
        },
        Error,
        "Invalid configuration",
      );
    });

    await t.step("should exit on invalid timeout value", () => {
      const configPath = `${tempDir}/test-invalid-timeout.toml`;

      Deno.writeTextFileSync(
        configPath,
        `
[system]
log_level = "info"

[paths]
memory = "./Memory"
blueprints = "./Blueprints"
runtime = "./Runtime"

[agents]
timeout_sec = -5
      `.trim(),
      );

      assertThrows(
        () => {
          new ConfigService(configPath);
        },
        Error,
        "Invalid configuration",
      );
    });
  } finally {
    // Clean up
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});

Deno.test("ConfigService handles edge cases", async (t) => {
  await t.step("should handle empty config file", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "config-empty-test-" });
    const configPath = `${tempDir}/test-empty-config.toml`;

    // Empty TOML currently parses to an empty object, then fails schema validation.
    Deno.writeTextFileSync(configPath, "");

    try {
      assertThrows(
        () => {
          new ConfigService(configPath);
        },
        Error,
        "Invalid configuration",
      );
    } finally {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore
      }
    }
  });

  await t.step("should handle config with comments", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "config-comments-test-" });
    const configPath = `${tempDir}/test-comments-config.toml`;

    const fixture_1 = readFixtureTextSync(import.meta.url, "config", "config_test", "fixture_1.md");
    Deno.writeTextFileSync(
      configPath,
      fixture_1.trim(),
    );

    await assertLoadsBasicSystemConfig(configPath, tempDir);
  });

  await t.step("should handle config with extra unknown fields", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "config-extra-fields-test-" });
    const configPath = `${tempDir}/test-extra-fields.toml`;

    Deno.writeTextFileSync(
      configPath,
      `
[system]
version = "1.0.0"
log_level = "info"
unknown_field = "should be ignored"

[paths]
memory = "./Memory"
blueprints = "./Blueprints"
runtime = "./Runtime"

[unknown_section]
foo = "bar"
    `.trim(),
    );

    // Should load successfully, extra fields ignored
    await assertLoadsBasicSystemConfig(configPath, tempDir);
  });

  await t.step("should handle config with unicode in paths", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "config-unicode-test-" });
    const configPath = `${tempDir}/test-unicode-config.toml`;

    Deno.writeTextFileSync(
      configPath,
      `
[system]
version = "1.0.0"
log_level = "info"

[paths]
memory = "./记忆"
blueprints = "./蓝图"
runtime = "./系統"
    `.trim(),
    );

    try {
      const service = new ConfigService(configPath);
      const config = service.get();

      assertEquals(config.paths.memory, "./记忆");
      assertEquals(config.paths.blueprints, "./蓝图");
      assertEquals(config.paths.runtime, "./系統");
    } finally {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore
      }
    }
  });

  await t.step("should compute consistent checksums", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "config-checksum-consistent-test-" });
    // style-exclude:FIXTURE_READABILITY - The inline TOML content is kept here for compactness and clarity in this checksum test.
    const content = `[system]
log_level = "info"

[paths]
memory = "./Memory"
blueprints = "./Blueprints"
runtime = "./Runtime"`;

    const configPath1 = `${tempDir}/test-checksum-1.toml`;
    const configPath2 = `${tempDir}/test-checksum-2.toml`;

    try {
      Deno.writeTextFileSync(configPath1, content);
      Deno.writeTextFileSync(configPath2, content);

      const service1 = new ConfigService(configPath1);
      const service2 = new ConfigService(configPath2);

      // Same content should produce same checksum
      assertEquals(service1.getChecksum(), service2.getChecksum());
      assertEquals(service1.getChecksum().length, 64); // SHA-256 hex
    } finally {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore
      }
    }
  });

  await t.step("should compute different checksums for different content", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "config-checksum-diff-test-" });
    const configPath1 = `${tempDir}/test-checksum-diff-1.toml`;
    const configPath2 = `${tempDir}/test-checksum-diff-2.toml`;

    try {
      Deno.writeTextFileSync(
        configPath1,
        `[system]
log_level = "info"

[paths]
memory = "./Memory"
blueprints = "./Blueprints"
runtime = "./Runtime"`,
      );

      Deno.writeTextFileSync(
        configPath2,
        `[system]
log_level = "debug"

[paths]
memory = "./Memory"
blueprints = "./Blueprints"
runtime = "./Runtime"`,
      );

      const service1 = new ConfigService(configPath1);
      const service2 = new ConfigService(configPath2);

      // Different content should produce different checksums
      assertEquals(
        service1.getChecksum() !== service2.getChecksum(),
        true,
      );
    } finally {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore
      }
    }
  });
});

// ============================================================================
// Security Tests - Use `deno test --filter "[security]"` to run only these
// ============================================================================

Deno.test("[security] Env Variable Access: EXA_ prefixed vars are accessible", () => {
  // This test verifies the security model where only EXA_* env vars should be accessible
  // In production, the daemon runs with --allow-env=EXA_,HOME,USER

  // Set a test EXA_ variable
  const testValue = "test-value-" + Date.now();
  Deno.env.set("EXA_TEST_VAR", testValue);

  try {
    // EXA_ prefixed vars should be accessible
    const value = Deno.env.get("EXA_TEST_VAR");
    assertEquals(value, testValue, "EXA_ prefixed vars should be accessible");
  } finally {
    Deno.env.delete("EXA_TEST_VAR");
  }
});

Deno.test("[security] Env Variable Access: HOME and USER are accessible for identity", () => {
  // These are explicitly allowed for user identity detection
  // The start:fg task allows: --allow-env=EXA_,HOME,USER

  const home = Deno.env.get("HOME");
  const user = Deno.env.get("USER");

  // At least one should be available on most systems
  assertEquals(
    home !== undefined || user !== undefined,
    true,
    "HOME or USER should be accessible for identity detection",
  );
});

Deno.test("[security] Env Variable Security: Verify sensitive env vars are not in config", async () => {
  // This test ensures the config system doesn't accidentally expose sensitive vars
  // Config should never read API_KEY, AWS_SECRET_ACCESS_KEY, etc.

  const sensitiveVars = [
    "API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "DATABASE_PASSWORD",
    "DB_PASSWORD",
    "SECRET_KEY",
    "PRIVATE_KEY",
    "GITHUB_TOKEN",
    "NPM_TOKEN",
  ];

  // Set dummy sensitive vars for testing
  for (const varName of sensitiveVars) {
    Deno.env.set(varName, "SENSITIVE_VALUE_" + varName);
  }

  try {
    // Create a config and verify it doesn't contain sensitive values
    const tempDir = await Deno.makeTempDir({ prefix: "config-security-test-" });
    const configPath = `${tempDir}/test-security-config.toml`;
    Deno.writeTextFileSync(
      configPath,
      `[system]
log_level = "info"

[paths]
memory = "./Memory"
blueprints = "./Blueprints"
runtime = "./Runtime"`,
    );

    try {
      const service = new ConfigService(configPath);
      const config = service.get();
      const configStr = JSON.stringify(config);

      // Verify none of the sensitive values appear in config
      for (const varName of sensitiveVars) {
        assertEquals(
          configStr.includes("SENSITIVE_VALUE_" + varName),
          false,
          `Config should not contain value of ${varName}`,
        );
      }
    } finally {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore
      }
    }
  } finally {
    // Clean up sensitive vars
    for (const varName of sensitiveVars) {
      Deno.env.delete(varName);
    }
  }
});

Deno.test("[security] Env Variable Security: Config doesn't expand env vars in paths", async () => {
  // Ensure path configuration doesn't expand environment variables
  // which could lead to path injection attacks

  Deno.env.set("MALICIOUS_PATH", "/etc/passwd");

  const tempDir = await Deno.makeTempDir({ prefix: "config-path-injection-test-" });
  const configPath = `${tempDir}/test-path-injection.toml`;

  try {
    // Create config with env var reference in path
    Deno.writeTextFileSync(
      configPath,
      `[system]
log_level = "info"

[paths]
memory = "$MALICIOUS_PATH"
blueprints = "./Blueprints"
runtime = "./Runtime"`,
    );

    const service = new ConfigService(configPath);
    const config = service.get();

    // Path should be literal "$MALICIOUS_PATH", not expanded to /etc/passwd
    assertEquals(
      config.paths.memory.includes("/etc/passwd"),
      false,
      "Env vars in paths should not be expanded",
    );
    assertEquals(
      config.paths.memory.includes("$MALICIOUS_PATH") ||
        config.paths.memory.includes("MALICIOUS_PATH"),
      true,
      "Path should contain literal string, not expanded value",
    );
  } finally {
    Deno.env.delete("MALICIOUS_PATH");
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});

// Provider Strategy Configuration Tests (Improvement 5: Enhanced Configuration Schema)

Deno.test("ConfigSchema accepts provider_strategy section", () => {
  const config = {
    system: { version: DEFAULT_MCP_VERSION },
    paths: {
      workspace: "Workspace",
      runtime: ".exa",
      memory: "Memory",
      portals: "Portals",
      blueprints: "Blueprints",
    },
    provider_strategy: {
      prefer_free: true,
      allow_local: true,
      max_daily_cost_usd: 5.00,
      health_check_enabled: true,
      fallback_enabled: true,
    },
  };

  parseAndAssertProviderStrategyDefaults(config);
});

Deno.test("ConfigSchema accepts provider_strategy.fallback_chains", () => {
  const config = {
    system: { version: DEFAULT_MCP_VERSION },
    paths: { ...ExaPathDefaults },
    provider_strategy: {
      fallback_chains: {
        free: ["google", "ollama", "mock"],
        paid: ["anthropic", "openai"],
        local: ["ollama"],
      },
    },
  };

  const result = ConfigSchema.safeParse(config);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.provider_strategy?.fallback_chains?.free, ["google", "ollama", "mock"]);
    assertEquals(result.data.provider_strategy?.fallback_chains?.paid, ["anthropic", "openai"]);
    assertEquals(result.data.provider_strategy?.fallback_chains?.local, ["ollama"]);
  }
});

Deno.test("ConfigSchema accepts provider_strategy.budgets", () => {
  const config = {
    system: { version: DEFAULT_MCP_VERSION },
    paths: { ...ExaPathDefaults },
    provider_strategy: {
      budgets: {
        anthropic_daily_usd: 3.00,
        openai_daily_usd: 2.00,
      },
    },
  };

  const result = ConfigSchema.safeParse(config);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.provider_strategy?.budgets?.anthropic_daily_usd, 3.00);
    assertEquals(result.data.provider_strategy?.budgets?.openai_daily_usd, 2.00);
  }
});

Deno.test("ConfigSchema accepts provider_strategy.task_routing", () => {
  const config = {
    system: { version: DEFAULT_MCP_VERSION },
    paths: { ...ExaPathDefaults },
    provider_strategy: {
      task_routing: {
        simple: ["ollama", "google"],
        medium: ["google", "anthropic"],
        complex: ["anthropic", "openai"],
        code_generation: ["anthropic", "openai"],
      },
    },
  };

  const result = ConfigSchema.safeParse(config);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.provider_strategy?.task_routing?.simple, ["ollama", "google"]);
    assertEquals(result.data.provider_strategy?.task_routing?.medium, ["google", "anthropic"]);
    assertEquals(result.data.provider_strategy?.task_routing?.complex, ["anthropic", "openai"]);
    assertEquals(result.data.provider_strategy?.task_routing?.code_generation, ["anthropic", "openai"]);
  }
});

// Regression: ensure sample config includes bootstrap entries
// Phase 137: most settings moved to Config DB; sample TOML is bootstrap-only.
Deno.test("[regression] Sample config includes bootstrap entries", () => {
  const samplePath = "templates/exa.config.sample.toml";
  const sampleContent = Deno.readTextFileSync(samplePath);
  interface ConfigToml {
    [section: string]: any;
  }
  const parsed = parseToml(sampleContent) as ConfigToml;

  const getPath = (path: string[]): any => {
    let current: any = parsed;
    for (const key of path) {
      if (current && typeof current === "object" && key in (current as ConfigToml)) {
        current = (current as ConfigToml)[key];
      } else {
        return undefined;
      }
    }
    return current;
  };

  // Bootstrap-only: system.root, schema_version, and portal entries
  assertEquals(getPath(["system", "schema_version"]), "1.0.0");
  assertEquals(typeof getPath(["system", "root"]), "string");
  assertEquals(getPath(["portals", "0", "alias"]), "my-repo");
  assertEquals(getPath(["portals", "0", "target_path"]), "/home/me/projects/my-repo");
});

Deno.test("ConfigSchema accepts providers.* overrides", () => {
  const config = {
    system: { version: DEFAULT_MCP_VERSION },
    paths: { ...ExaPathDefaults },
    providers: {
      google: {
        cost_tier: ProviderCostTier.FREEMIUM,
        free_quota_requests_per_day: 1500,
        timeout_ms: 30000,
      },
      ollama: {
        cost_tier: ProviderCostTier.FREE,
        base_url: "http://localhost:11434",
        timeout_ms: 60000,
      },
      anthropic: {
        cost_tier: ProviderCostTier.PAID,
        timeout_ms: 30000,
        rate_limit_rpm: 50,
      },
    },
  };

  const result = ConfigSchema.safeParse(config);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.providers?.google?.cost_tier, ProviderCostTier.FREEMIUM);
    assertEquals(result.data.providers?.google?.free_quota_requests_per_day, 1500);
    assertEquals(result.data.providers?.ollama?.cost_tier, ProviderCostTier.FREE);
    assertEquals(result.data.providers?.ollama?.base_url, "http://localhost:11434");
    assertEquals(result.data.providers?.anthropic?.cost_tier, ProviderCostTier.PAID);
    assertEquals(result.data.providers?.anthropic?.rate_limit_rpm, 50);
  }
});

Deno.test("ConfigSchema provides defaults for provider_strategy", () => {
  const config = {
    system: { version: DEFAULT_MCP_VERSION },
    paths: { ...ExaPathDefaults },
  };

  // Check that defaults are applied
  parseAndAssertProviderStrategyDefaults(config);
});

Deno.test("ConfigSchema rejects unknown provider names in fallback_chains", () => {
  const config = {
    system: { version: DEFAULT_MCP_VERSION },
    paths: { ...ExaPathDefaults },
    provider_strategy: {
      fallback_chains: {
        free: ["invalid_provider", "google"],
      },
    },
  };

  const result = ConfigSchema.safeParse(config);
  assertEquals(result.success, false);
});

Deno.test("ConfigSchema rejects invalid cost_tier values", () => {
  const config = {
    system: { version: DEFAULT_MCP_VERSION },
    paths: { ...ExaPathDefaults },
    providers: {
      google: {
        cost_tier: "invalid_tier",
      },
    },
  };

  const result = ConfigSchema.safeParse(config);
  assertEquals(result.success, false);
});

Deno.test("ConfigSchema accepts valid cost_tier values", () => {
  const config = {
    system: { version: DEFAULT_MCP_VERSION },
    paths: { ...ExaPathDefaults },
    providers: {
      google: {
        cost_tier: ProviderCostTier.FREE,
      },
      anthropic: {
        cost_tier: ProviderCostTier.PAID,
      },
    },
  };

  const result = ConfigSchema.safeParse(config);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.providers?.google?.cost_tier, ProviderCostTier.FREE);
    assertEquals(result.data.providers?.anthropic?.cost_tier, ProviderCostTier.PAID);
  }
});

Deno.test("ConfigSchema validation: rejects invalid default_model", () => {
  // Config with default_model pointing to nothing
  const config = {
    system: { version: DEFAULT_MCP_VERSION, log_level: "info" },
    paths: { memory: "M", blueprints: "B", runtime: "R" },
    agents: { default_model: "non_existent_model" },
    models: {
      my_model: { provider: "mock", model: "m" },
    },
  };

  assertParseFailsWith(config, "default_model", "not found");
});

Deno.test("ConfigSchema validation: rejects invalid fallback_chain target (with message check)", () => {
  const config = {
    system: { version: DEFAULT_MCP_VERSION, log_level: "info" },
    paths: { memory: "M", blueprints: "B", runtime: "R" },
    provider_strategy: {
      fallback_chains: {
        broken_chain: ["missing_target"],
      },
    },
    models: {
      my_model: { provider: "mock", model: "m" },
    },
  };

  assertParseFailsWith(config, "fallback_chains", "unknown target");
});
