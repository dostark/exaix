/**
 * @module DockerProbeTest
 * @path tests/scenario_framework/tests/unit/docker_probe_test.ts
 * @description Validates dockerProbeSkipReason: absent-docker path yields a SKIPPED reason
 *   string, not a failure, and present-docker path yields null (runnable). Phase 144 Step 2.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts]
 */

import { assertEquals } from "@std/assert";
import { dockerProbeSkipReason } from "../../runner/matrix_expander.ts";

Deno.test("[DockerProbe] docker present on PATH yields null (runnable)", () => {
  const reason = dockerProbeSkipReason(() => true);
  assertEquals(reason, null);
});

Deno.test("[DockerProbe] docker absent from PATH yields a structured SKIP reason, not a throw", () => {
  const reason = dockerProbeSkipReason(() => false);
  assertEquals(reason, "binary 'docker' not on PATH");
});

Deno.test("[DockerProbe] default binOnPath uses the real PATH probe (binIsOnPath)", () => {
  // No injected predicate — exercises the real default, proving the wiring (not just the
  // injectable seam) resolves to a boolean without throwing.
  const reason = dockerProbeSkipReason();
  assertEquals(typeof reason === "string" || reason === null, true);
});
