/**
 * @module RoutingCommandsTest
 * @path tests/cli/commands/routing_commands_test.ts
 * @description Validates CLI routing inspection and policy validation helpers.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createCliTestContext } from "../helpers/test_setup.ts";
import { RoutingCommands } from "../../../apps/exactl/src/commands/routing_commands.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

Deno.test("RoutingCommands: validatePolicy rejects invalid routing policy YAML", async () => {
  const { tempDir, context, cleanup } = await createCliTestContext();
  try {
    const policyDir = join(tempDir, ".exa");
    const policyPath = join(policyDir, "routing.policy.yaml");
    const invalidPolicy = `
version: "1.0"
rules:
  - match:
      capability: code_generation
    prefer:
      identityId: ""
`;
    await Deno.writeTextFile(policyPath, invalidPolicy);

    const commands = new RoutingCommands(context);
    const result = await commands.validatePolicy(policyPath);

    assertEquals(result.success, false);
    assertEquals(result.path, policyPath);
    assertEquals(result.errors.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("RoutingCommands: explainRequest returns explicit routing decision for request file", async () => {
  const { tempDir, context, cleanup } = await createCliTestContext();
  try {
    const blueprintsDir = join(tempDir, "Blueprints", "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });

    const fixture_1 = readFixtureTextSync(import.meta.url, "cli", "commands", "routing_commands_test", "fixture_1.md");
    await Deno.writeTextFile(
      join(blueprintsDir, "senior-coder.md"),
      fixture_1,
    );

    const fixture_2 = readFixtureTextSync(import.meta.url, "cli", "commands", "routing_commands_test", "fixture_2.md");
    await Deno.writeTextFile(
      join(blueprintsDir, "default-agent.md"),
      fixture_2,
    );

    const requestPath = join(tempDir, "request.md");
    await Deno.writeTextFile(
      requestPath,
      `---
trace_id: trace-1
identity: senior-coder
allow_dynamic_routing: true
---
Please generate code for the new feature.
`,
    );

    const commands = new RoutingCommands(context);
    const result = await commands.explainRequest(requestPath);

    assertEquals(result.selectedIdentityId, "senior-coder");
    assertEquals(result.strategy, "explicit");
    assertEquals(result.candidates.length, 2);
  } finally {
    await cleanup();
  }
});
