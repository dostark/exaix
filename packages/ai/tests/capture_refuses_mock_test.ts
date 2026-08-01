/**
 * @module CaptureRefusesMockTest
 * @path packages/ai/tests/capture_refuses_mock_test.ts
 * @description Phase 157 Step 2 — capturing from a configured mock provider is refused with a
 *   stated reason at ProviderFactory wiring time, not merely discouraged. Capturing the mock's
 *   own regex output would manufacture a fixture set that looks authoritative and encodes the
 *   very guesses this phase removes (R4).
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_factory.ts, packages/ai/src/providers/capture_recording_provider.ts]
 */

import { assertRejects } from "@std/assert";
import { ProviderType } from "@exaix/core";
import { ProviderFactory } from "../src/provider_factory.ts";
import { ProviderFactoryError } from "../src/errors.ts";
import { withEnv } from "@exaix/testing";
import { createTestConfig } from "./helpers/test_config.ts";

Deno.test("[capture_refuses_mock] capturing from a mock provider is refused with a stated reason", async () => {
  const dir = await Deno.makeTempDir();
  await withEnv({ EXA_CAPTURE_FIXTURES_DIR: dir }, async () => {
    const config = createTestConfig({ provider: ProviderType.MOCK });
    config.rate_limiting.enabled = false;

    await assertRejects(
      async () => await ProviderFactory.create(config),
      ProviderFactoryError,
      "mock",
    );
  });
});
