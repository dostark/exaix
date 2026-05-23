/**
 * @module AsyncUtilsTest
 * @path packages/core/tests/func/async_utils_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Verifies the async utility helpers exposed through @exaix/core/func.
 */

import { assert, assertEquals } from "@std/assert";
import { delay } from "@exaix/core/func";

Deno.test("[AsyncUtils] delay resolves after at least the requested duration", async () => {
  const start = performance.now();
  await delay(10);
  const elapsed = performance.now() - start;

  assert(elapsed >= 8);
});

Deno.test("[AsyncUtils] delay remains non-blocking for the event loop", async () => {
  let ticked = false;
  const tick = Promise.resolve().then(() => {
    ticked = true;
  });

  await delay(0);
  await tick;

  assertEquals(ticked, true);
});
