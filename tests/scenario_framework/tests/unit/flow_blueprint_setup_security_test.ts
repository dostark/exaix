/**
 * @module FlowBlueprintSetupSecurityTest
 * @path tests/scenario_framework/tests/unit/flow_blueprint_setup_security_test.ts
 * @description Verifies that the replay delegate rejects invalid and missing recording keys.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/fixtures/cli/flow_blueprint_delegate.ts]
 */
import { assert, assertEquals } from "@std/assert";

const DELEGATE = new URL("../../fixtures/cli/flow_blueprint_delegate.ts", import.meta.url);

for (const model of ["../exa.config", "unknown__submit__gate__0"]) {
  Deno.test(`[security] [flow blueprint delegate] refuses invalid or missing recording ${model}`, async () => {
    const run = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", DELEGATE.pathname, "--model", model, "--print", "Review"],
    }).output();
    assertEquals(run.code, 1);
    assertEquals(new TextDecoder().decode(run.stdout), "");
    assert(
      new TextDecoder().decode(run.stderr).includes(model.startsWith("../") ? "Invalid recording key" : "No such file"),
    );
  });
}
