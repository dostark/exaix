/**
 * @module EnvSchemaValidationTest
 * @path packages/core/tests/env_schema_test.ts
 * @description Verifies the validation logic for environment variables, ensuring
 * correct override behaviors for AI providers and system configuration.
 */

import { assertEquals, assertExists } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { getValidatedEnvOverrides } from "@exaix/core/config/env_schema.ts";

Deno.test("EnvLLMOverride: returns empty object when no env vars set", async () => {
  await withEnv({}, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides, {});
  });
});

Deno.test("EnvLLMOverride: validates EXA_LLM_PROVIDER with valid provider", async () => {
  await withEnv({ EXA_LLM_PROVIDER: "ollama" }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_PROVIDER, "ollama");
  });
});

Deno.test("EnvLLMOverride: rejects EXA_LLM_PROVIDER with invalid provider", async () => {
  await withEnv({ EXA_LLM_PROVIDER: "invalid-provider-xyz" }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_PROVIDER, undefined);
  });
});

Deno.test("EnvLLMOverride: validates EXA_LLM_MODEL with non-empty string", async () => {
  await withEnv({ EXA_LLM_MODEL: "llama3.2" }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_MODEL, "llama3.2");
  });
});

Deno.test("EnvLLMOverride: rejects EXA_LLM_MODEL with empty string", async () => {
  await withEnv({ EXA_LLM_MODEL: "" }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_MODEL, undefined);
  });
});

Deno.test("EnvLLMOverride: validates EXA_LLM_BASE_URL with valid URL", async () => {
  await withEnv({ EXA_LLM_BASE_URL: "http://localhost:11434" }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_BASE_URL, "http://localhost:11434");
  });
});

Deno.test("EnvLLMOverride: rejects EXA_LLM_BASE_URL with invalid URL", async () => {
  await withEnv({ EXA_LLM_BASE_URL: "not-a-url" }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_BASE_URL, undefined);
  });
});

Deno.test("EnvLLMOverride: validates EXA_LLM_TIMEOUT_MS with valid number string", async () => {
  await withEnv({ EXA_LLM_TIMEOUT_MS: "60000" }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_TIMEOUT_MS, 60000);
  });
});

Deno.test("EnvLLMOverride: rejects EXA_LLM_TIMEOUT_MS below minimum (1000ms)", async () => {
  await withEnv({ EXA_LLM_TIMEOUT_MS: "999" }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_TIMEOUT_MS, undefined);
  });
});

Deno.test("EnvLLMOverride: rejects EXA_LLM_TIMEOUT_MS above maximum (300000ms)", async () => {
  await withEnv({ EXA_LLM_TIMEOUT_MS: "300001" }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_TIMEOUT_MS, undefined);
  });
});

Deno.test("EnvLLMOverride: rejects EXA_LLM_TIMEOUT_MS with non-numeric string", async () => {
  await withEnv({ EXA_LLM_TIMEOUT_MS: "not-a-number" }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_TIMEOUT_MS, undefined);
  });
});

Deno.test("EnvLLMOverride: handles multiple valid env vars together", async () => {
  await withEnv({
    EXA_LLM_PROVIDER: "anthropic",
    EXA_LLM_MODEL: "claude-opus-4-6",
    EXA_LLM_BASE_URL: "https://api.anthropic.com/v1/messages",
    EXA_LLM_TIMEOUT_MS: "60000",
  }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_PROVIDER, "anthropic");
    assertEquals(overrides.EXA_LLM_MODEL, "claude-opus-4-6");
    assertEquals(overrides.EXA_LLM_BASE_URL, "https://api.anthropic.com/v1/messages");
    assertEquals(overrides.EXA_LLM_TIMEOUT_MS, 60000);
  });
});

Deno.test("EnvLLMOverride: filters out invalid vars but keeps valid ones", async () => {
  await withEnv({
    EXA_LLM_PROVIDER: "ollama",
    EXA_LLM_MODEL: "",
    EXA_LLM_TIMEOUT_MS: "999",
  }, () => {
    const overrides = getValidatedEnvOverrides();
    assertEquals(overrides.EXA_LLM_PROVIDER, "ollama");
    assertEquals(overrides.EXA_LLM_MODEL, undefined);
    assertEquals(overrides.EXA_LLM_TIMEOUT_MS, undefined);
  });
});

Deno.test("EnvLLMOverride: warns on validation failure", async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: string[]) => warnings.push(args.join(" "));

  try {
    await withEnv({ EXA_LLM_TIMEOUT_MS: "invalid" }, () => {
      getValidatedEnvOverrides();
    });

    assertExists(warnings.find((warning) => warning.includes("Invalid EXA_LLM_TIMEOUT_MS")));
  } finally {
    console.warn = originalWarn;
  }
});
