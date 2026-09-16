/**
 * @module PersonaResponseEvidenceSecurityTest
 * @path tests/scenario_framework/tests/unit/persona_response_evidence_security_test.ts
 * @description Rejects invalid selectors and evidence path escapes before capture.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/persona_response_evidence.ts]
 */
import { assertRejects } from "@std/assert";
import { capturePersonaRoleResponse } from "../../runner/persona_response_evidence.ts";
import { createPersonaResponseFixture, personaCaptureInput } from "../helpers/persona_response_fixture.ts";

Deno.test("[security][PersonaResponse] rejects output traversal and invalid trace selectors", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    ctx.seed("answer");
    for (const override of [{ outputAlias: "@Memory/../../../outside.json" }, { traceId: "' OR 1=1 --" }]) {
      await assertRejects(() => capturePersonaRoleResponse({ ...personaCaptureInput(ctx.config), ...override }), Error);
    }
  } finally {
    await ctx.cleanup();
  }
});
