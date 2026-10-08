/**
 * @module ConfigSecurityTest
 * @path tests/config/config_security_test.ts
 * @description Security-focused validation of the global configuration schema and
 * ConfigService: environment-variable access boundaries, sensitive-variable non-exposure,
 * and refusal to expand environment variables inside path configuration.
 * @architectural-layer Test
 * @related-files [packages/schemas/src/config.ts, packages/core/src/config/service.ts]
 */

import { assertEquals } from "@std/assert";
import { ConfigService } from "@exaix/core/config";

// Security tests, selected by the tests/**/*_security_test.ts glob.

Deno.test("[security] Env Variable Access: EXA_ prefixed vars are accessible", () => {
  // Only EXA_* env vars should be reachable.
  // The daemon runs with --allow-env=EXA_,HOME,USER in production.

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
