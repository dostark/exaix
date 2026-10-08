/**
 * @module FlowCutoverFixtureSecurityTest
 * @path tests/security/flow_cutover_fixture_security_test.ts
 * @description Verifies that edition input cannot select binaries outside the compiled flow fixture boundary.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/helpers/compiled_flow_fixture.ts]
 */
import { assertRejects } from "@std/assert";
import { resolveFlowBinaries } from "../scenario_framework/tests/helpers/compiled_flow_fixture.ts";

Deno.test("[security] compiled flow fixtures reject traversal and unsupported editions", async () => {
  for (const edition of ["../../outside", "solo/../../outside", "enterprise", "team; touch /tmp/unwanted"]) {
    await assertRejects(() => resolveFlowBinaries(edition), Error, "Unsupported flow fixture edition");
  }
});
