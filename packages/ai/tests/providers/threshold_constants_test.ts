/**
 * @module ThresholdConstantsTest
 * @path packages/ai/tests/providers/threshold_constants_test.ts
 * @description Phase 157 Step 4 — the drift-recapture and capture-failure-product-finding
 *   thresholds are `configurable()` registry keys with documented defaults, not magic
 *   numbers, and the drift/flakiness reporters read them from the registry (their exported
 *   constants) rather than duplicating a literal.
 * @architectural-layer AI
 * @related-files [packages/ai/src/constants.ts, packages/ai/src/providers/mock_llm_provider.ts, packages/ai/src/providers/fixture_reports.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { getRegisteredDefaults } from "@exaix/core/config";
import {
  DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD,
  DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD,
} from "../../src/constants.ts";

Deno.test("[threshold_constants] DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD is a registered configurable() key", () => {
  const entry = getRegisteredDefaults().get("ai.fixture_drift_recapture_threshold");
  assertExists(entry, "the drift-recapture threshold must be registered in the config registry");
  assertEquals(entry?.opts.default, DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD);
});

Deno.test("[threshold_constants] DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD is a registered configurable() key", () => {
  const entry = getRegisteredDefaults().get("ai.capture_failure_product_finding_threshold");
  assertExists(entry, "the capture-failure product-finding threshold must be registered in the config registry");
  assertEquals(entry?.opts.default, DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD);
});

Deno.test("[threshold_constants] both thresholds default to a fraction between 0 and 1", () => {
  assertEquals(DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD > 0 && DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD <= 1, true);
  assertEquals(
    DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD > 0 && DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD <= 1,
    true,
  );
});
