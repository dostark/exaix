/**
 * @module PersonaResponseEvidenceSecurityTest
 * @path tests/scenario_framework/tests/unit/persona_response_evidence_security_test.ts
 * @description Rejects invalid selectors, evidence path escapes, and explicit judge-file
 *   traversal before capture.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/persona_response_evidence.ts]
 */
import { assertRejects } from "@std/assert";
import { join } from "@std/path";
import { capturePersonaRoleResponse, preparePersonaJudgeContext } from "../../runner/persona_response_evidence.ts";
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

Deno.test("[security][PersonaResponse] explicit judge file traversal is rejected before reading", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    const portalRoot = join(ctx.tempDir, "Portals/task/src");
    await Deno.mkdir(portalRoot, { recursive: true });
    await Deno.mkdir(join(ctx.tempDir, "Portals/sibling"), { recursive: true });
    await Deno.writeTextFile(join(ctx.tempDir, "Portals/sibling/secret.ts"), "must never be read");
    await assertRejects(
      () =>
        preparePersonaJudgeContext(ctx.config, "Read safe files", ["@Portals/task"], [{
          alias: "@Portals/task",
          path: "../sibling/secret.ts",
        }]),
      Error,
      "outside",
    );
    await assertRejects(
      () => Deno.stat(join(ctx.tempDir, "Memory/persona-judge-context.txt")),
      Deno.errors.NotFound,
    );
  } finally {
    await ctx.cleanup();
  }
});
