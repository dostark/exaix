/**
 * @module ConfigPortalKnowledgeSchemaTest
 * @path packages/schemas/tests/config_portal_knowledge_test.ts
 * @description Tests for the portal_knowledge section of ConfigSchema,
 * covering defaults, valid values, and invalid value rejection.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts"]
 */

import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";

import { ExaPathDefaults, LogLevel, PortalAnalysisMode } from "@exaix/core";
import * as DEFAULTS from "@exaix/core";

// Minimal valid config base (only truly required fields — system + paths)

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

// Tests

Deno.test("[ConfigSchema] validates portal_knowledge section", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    portal_knowledge: {
      auto_analyze_on_mount: false,
      default_mode: "standard",
      quick_scan_limit: 100,
      max_files_to_read: 25,
      staleness_hours: 72,
      use_llm_inference: false,
      ignore_patterns: ["node_modules", ".git"],
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    const pk = result.data.portal_knowledge!;
    assertEquals(pk.auto_analyze_on_mount, false);
    assertEquals(pk.default_mode, PortalAnalysisMode.STANDARD);
    assertEquals(pk.quick_scan_limit, 100);
    assertEquals(pk.max_files_to_read, 25);
    assertEquals(pk.staleness_hours, 72);
    assertEquals(pk.use_llm_inference, false);
    assertEquals(pk.ignore_patterns, ["node_modules", ".git"]);
  }
});

Deno.test("[ConfigSchema] uses defaults when portal_knowledge is absent", () => {
  const result = ConfigSchema.safeParse(baseConfig());

  assertEquals(result.success, true);
  if (result.success) {
    const pk = result.data.portal_knowledge!;
    assertEquals(pk.auto_analyze_on_mount, false);
    assertEquals(pk.default_mode, DEFAULTS.DEFAULT_PORTAL_KNOWLEDGE_MODE);
    assertEquals(pk.quick_scan_limit, DEFAULTS.DEFAULT_QUICK_SCAN_LIMIT);
    assertEquals(pk.max_files_to_read, DEFAULTS.DEFAULT_MAX_FILES_TO_READ);
    assertEquals(pk.staleness_hours, DEFAULTS.DEFAULT_KNOWLEDGE_STALENESS_HOURS);
    assertEquals(pk.use_llm_inference, true);
  }
});

Deno.test("[ConfigSchema] auto_analyze_on_mount defaults to false when the key is omitted", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    portal_knowledge: { default_mode: "standard" },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.portal_knowledge!.auto_analyze_on_mount, false);
  }
});

Deno.test("[ConfigSchema] rejects invalid default_mode value", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    portal_knowledge: {
      default_mode: "ultra",
    },
  });

  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] rejects negative quick_scan_limit", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    portal_knowledge: {
      quick_scan_limit: -1,
    },
  });

  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] rejects non-array ignore_patterns", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    portal_knowledge: {
      ignore_patterns: "node_modules",
    },
  });

  assertEquals(result.success, false);
});
