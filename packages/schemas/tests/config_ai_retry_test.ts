/**
 * @module ConfigAiRetryTest
 * @path packages/schemas/tests/config_ai_retry_test.ts
 * @description ConfigSchema keeps ai_retry.retry_after_max_ms and defaults it to the registered constant.
 * @architectural-layer Schemas
 * @dependencies [@exaix/schemas, @exaix/core]
 * @related-files [packages/schemas/src/config.ts, packages/core/src/types/constants.ts]
 */

import { assertEquals } from "@std/assert";
import { DEFAULT_AI_RETRY_AFTER_MAX_MS } from "@exaix/core";
import { ConfigSchema } from "../src/config.ts";

const OVERRIDE_MS = 1_500;

Deno.test("ConfigSchema keeps ai_retry.retry_after_max_ms and defaults it to DEFAULT_AI_RETRY_AFTER_MAX_MS", () => {
  const defaults = ConfigSchema.parse({ system: { root: "/tmp/ai-retry-schema" } });
  assertEquals(defaults.ai_retry.retry_after_max_ms, DEFAULT_AI_RETRY_AFTER_MAX_MS);

  const overridden = ConfigSchema.parse({
    system: { root: "/tmp/ai-retry-schema" },
    ai_retry: {
      max_attempts: 3,
      backoff_base_ms: 100,
      timeout_per_request_ms: 30_000,
      retry_after_max_ms: OVERRIDE_MS,
    },
  });
  assertEquals(overridden.ai_retry.retry_after_max_ms, OVERRIDE_MS);
});
