/**
 * @module VerificationKnownSecretsWiringTest
 * @path apps/daemon/tests/verification_known_secrets_wiring_test.ts
 * @related-files ["apps/daemon/main.ts"]
 * @architectural-layer Tests
 * @description Asserts the daemon derives its known-secret list outside the dogfood
 *   branch and passes it to the ExecutionLoop, so verification redaction is wired even
 *   when the dogfood context is disabled.
 */

import { assert } from "@std/assert";

const MAIN_SOURCE = new URL("../main.ts", import.meta.url);

Deno.test("[daemon-wiring] the daemon passes knownSecrets to ExecutionLoop when dogfood context is disabled", async () => {
  const source = await Deno.readTextFile(MAIN_SOURCE);

  const derivationIndex = source.indexOf("const knownSecrets = Object.entries(Deno.env.toObject())");
  const dogfoodBranchIndex = source.indexOf("if (config.dogfood.context.enabled)");
  const executionLoopIndex = source.indexOf("const executionLoop = new ExecutionLoop({");

  assert(derivationIndex >= 0, "main.ts must derive the known-secret list");
  assert(dogfoodBranchIndex >= 0, "main.ts must keep its dogfood branch");
  assert(executionLoopIndex >= 0, "main.ts must construct the ExecutionLoop");
  assert(
    derivationIndex < dogfoodBranchIndex,
    "the known-secret derivation must sit outside (before) the dogfood branch",
  );
  assert(derivationIndex < executionLoopIndex, "the derivation must precede the ExecutionLoop");

  const executionLoopBlock = source.slice(executionLoopIndex, source.indexOf("});", executionLoopIndex));
  assert(
    executionLoopBlock.includes("knownSecrets"),
    "the ExecutionLoop construction must receive knownSecrets",
  );
});
