/**
 * @module ConfigQualityGateSchemaTest
 * @path packages/schemas/tests/config_quality_gate_test.ts
 * @description Tests for the quality_gate section of ConfigSchema (Phase 47).
 * Covers defaults, valid values, nested thresholds, and invalid value rejection.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts", "packages/core/src/types/enums.ts"]
 */

import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";

import { ExaPathDefaults, LogLevel, QualityGateMode } from "@exaix/core";
import {
  DEFAULT_MAX_CLARIFICATION_ROUNDS,
  DEFAULT_QG_ENRICHMENT_THRESHOLD,
  DEFAULT_QG_MINIMUM_THRESHOLD,
  DEFAULT_QG_PROCEED_THRESHOLD,
} from "@exaix/core";

function baseConfig() {
  return {
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[ConfigSchema] validates quality_gate section", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    quality_gate: {
      enabled: true,
      mode: "hybrid",
      auto_enrich: true,
      block_unactionable: false,
      max_clarification_rounds: 3,
      thresholds: {
        minimum: 15,
        enrichment: 45,
        proceed: 65,
      },
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    const qg = result.data.quality_gate!;
    assertEquals(qg.enabled, true);
    assertEquals(qg.mode, QualityGateMode.HYBRID);
    assertEquals(qg.auto_enrich, true);
    assertEquals(qg.block_unactionable, false);
    assertEquals(qg.max_clarification_rounds, 3);
    assertEquals(qg.thresholds.minimum, 15);
    assertEquals(qg.thresholds.enrichment, 45);
    assertEquals(qg.thresholds.proceed, 65);
  }
});

Deno.test("[ConfigSchema] validates nested thresholds", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    quality_gate: {
      thresholds: { minimum: 10, enrichment: 40, proceed: 60 },
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    const qg = result.data.quality_gate!;
    assertEquals(qg.thresholds.minimum, 10);
    assertEquals(qg.thresholds.enrichment, 40);
    assertEquals(qg.thresholds.proceed, 60);
  }
});

Deno.test("[ConfigSchema] uses defaults when quality_gate is absent", () => {
  const result = ConfigSchema.safeParse(baseConfig());

  assertEquals(result.success, true);
  if (result.success) {
    const qg = result.data.quality_gate!;
    assertEquals(qg.enabled, true);
    assertEquals(qg.mode, QualityGateMode.HYBRID);
    assertEquals(qg.auto_enrich, true);
    assertEquals(qg.block_unactionable, false);
    assertEquals(qg.max_clarification_rounds, DEFAULT_MAX_CLARIFICATION_ROUNDS);
    assertEquals(qg.thresholds.minimum, DEFAULT_QG_MINIMUM_THRESHOLD);
    assertEquals(qg.thresholds.enrichment, DEFAULT_QG_ENRICHMENT_THRESHOLD);
    assertEquals(qg.thresholds.proceed, DEFAULT_QG_PROCEED_THRESHOLD);
  }
});

Deno.test("[ConfigSchema] rejects invalid mode value", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    quality_gate: { mode: "instant" },
  });

  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] rejects threshold outside 0-100", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    quality_gate: {
      thresholds: { minimum: -5, enrichment: 50, proceed: 70 },
    },
  });

  assertEquals(result.success, false);
});
