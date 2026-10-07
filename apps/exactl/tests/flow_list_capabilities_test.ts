/**
 * @module FlowListCapabilitiesTest
 * @path apps/exactl/tests/flow_list_capabilities_test.ts
 * @description Keeps local edition eligibility separate from unknown daemon availability.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { FlowCommands } from "../src/commands/flow_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

for (const edition of ["solo", "team", "enterprise", "unknown"]) {
  Deno.test(`[cli] flow list reports capability eligibility for ${edition}`, async () => {
    const { context, cleanup } = await createCliTestContext();
    const original = console.log;
    const output: string[] = [];
    console.log = (...args: string[]) => {
      output.push(args.join(" "));
    };
    try {
      const config = context.config.get();
      const directory = join(config.system.root, config.paths.flows);
      await Deno.mkdir(directory, { recursive: true });
      await Deno.writeTextFile(
        join(directory, "capability-flow.flow.yaml"),
        `
id: capability-flow
name: Capability flow
description: Needs voting
requires_capabilities: [voting]
steps: [{ id: first, name: First, agent_role: code-analyst }]
output: { from: first }
`,
      );
      const commands = new FlowCommands({ ...context, edition });
      await commands.listFlows({ json: true });
      const eligible = edition === "team" || edition === "enterprise";
      const rows = JSON.parse(output.join(""));
      assertEquals(rows.length, 1);
      assertEquals(rows[0].requiresCapabilities, ["voting"]);
      assertEquals(rows[0].tierEligible, eligible);
      assertEquals(rows[0].runtimeAvailability, "unknown");
      output.length = 0;
      await commands.listFlows();
      assertStringIncludes(output.join(""), eligible ? "eligible (runtime unverified)" : "unavailable (needs voting)");
    } finally {
      console.log = original;
      await cleanup();
    }
  });
}
