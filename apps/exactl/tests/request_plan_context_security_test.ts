/**
 * @module RequestPlanContextSecurityTest
 * @path apps/exactl/tests/request_plan_context_security_test.ts
 * @description Verifies that file submission rejects unsafe plan context pointers before writing a request.
 * @architectural-layer Test
 * @dependencies [@exaix/portal]
 * @related-files [apps/exactl/src/handlers/request_create_handler.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { PathResolver } from "@exaix/portal";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

Deno.test("[security] request file rejects absolute and traversing plan context pointers before creation", async () => {
  const { tempDir, context, cleanup } = await createCliTestContext({ createDirs: ["Workspace/Requests"] });
  try {
    const commands = new RequestCommands(context);
    const file = join(tempDir, "input.md");
    for (const pointer of ["/tmp/escape.md", ".exa/PlanContext/../escape.md", ".exa/PlanContext/nested/escape.md"]) {
      await Deno.writeTextFile(file, `---\nplan_context_ref: ${pointer}\n---\nRun the hardened plan.\n`);
      await assertRejects(() => commands.createFromFile(file), Error, "plan_context_ref");
    }
    const requests = await new PathResolver(context.config.getAll()).resolve("@Workspace/Requests");
    assertEquals([...Deno.readDirSync(requests)], []);
  } finally {
    await cleanup();
  }
});
