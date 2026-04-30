/**
 * @module ConfigRequestAnalysisSchemaTest
 * @path tests/schemas/config_request_analysis_test.ts
 * @description Tests for the request_analysis section of ConfigSchema,
 * covering defaults, valid values, and invalid value rejection.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts"]
 */

import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { ExaPathDefaults } from "@exaix/core";
import { AnalysisMode } from "@exaix/core";
import { LogLevel } from "@exaix/core";

// ---------------------------------------------------------------------------
// Minimal valid config base (only truly required fields — system + paths)
// ---------------------------------------------------------------------------

interface IBaseConfig {
  system: { root: string; log_level: string };
  paths: typeof ExaPathDefaults;
}

function baseConfig(): IBaseConfig {
  return {
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[ConfigSchema] validates request_analysis section", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    request_analysis: {
      enabled: true,
      mode: "hybrid",
      actionability_threshold: 70,
      infer_acceptance_criteria: false,
      persist_analysis: false,
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    const ra = result.data.request_analysis!;
    assertEquals(ra.enabled, true);
    assertEquals(ra.mode, AnalysisMode.HYBRID);
    assertEquals(ra.actionability_threshold, 70);
    assertEquals(ra.infer_acceptance_criteria, false);
    assertEquals(ra.persist_analysis, false);
  }
});

Deno.test("[ConfigSchema] uses defaults when request_analysis is absent", () => {
  const result = ConfigSchema.safeParse(baseConfig());

  assertEquals(result.success, true);
  if (result.success) {
    const ra = result.data.request_analysis!;
    assertEquals(ra.enabled, true);
    assertEquals(ra.mode, AnalysisMode.HYBRID);
    assertEquals(ra.actionability_threshold, 60);
    assertEquals(ra.infer_acceptance_criteria, true);
    assertEquals(ra.persist_analysis, true);
  }
});

Deno.test("[ConfigSchema] rejects invalid mode value", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    request_analysis: {
      mode: "instant",
    },
  });

  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] rejects actionability_threshold below 0", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    request_analysis: {
      actionability_threshold: -1,
    },
  });

  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] rejects actionability_threshold above 100", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    request_analysis: {
      actionability_threshold: 101,
    },
  });

  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] request_analysis.enabled defaults to true", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    request_analysis: {
      mode: "heuristic",
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.request_analysis!.enabled, true);
  }
});

Deno.test("[ConfigSchema] request_analysis.persist_analysis defaults to true", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    request_analysis: {
      mode: "heuristic",
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.request_analysis!.persist_analysis, true);
  }
});

Deno.test("[ConfigSchema] accepts enabled: false to disable analysis", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    request_analysis: {
      enabled: false,
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.request_analysis!.enabled, false);
  }
});

Deno.test("[ConfigSchema] accepts persist_analysis: false to skip file write", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    request_analysis: {
      persist_analysis: false,
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.request_analysis!.persist_analysis, false);
  }
});

Deno.test("[ConfigSchema] accepts all three mode values", () => {
  for (const mode of ["heuristic", "llm", "hybrid"] as const) {
    const result = ConfigSchema.safeParse({
      ...baseConfig(),
      request_analysis: { mode },
    });
    assertEquals(result.success, true, `mode '${mode}' should be valid`);
    if (result.success) {
      assertEquals(result.data.request_analysis!.mode, mode);
    }
  }
});
