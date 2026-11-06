/**
 * @module RequestCreateCommandTest
 * @path apps/exactl/tests/request_create_command_test.ts
 * @description Runs `exactl request create` as a subprocess and checks the request it writes.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/request_command.ts, apps/exactl/src/command_builders/request_actions.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runExactlSeededWorkspace, runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const REQUEST_FILE_PATTERN = /Workspace\/Requests\/request-[\w-]+\.md/;
const FILE_REQUEST_NAME = "from-file.md";
const FILE_REQUEST_BODY = "# Request\n\nBody from a file\n";

Deno.test("request create with a description creates a request file", async () => {
  const [created, listed] = await runExactlSequenceInTempWorkspace([
    ["request", "create", "Write the docs"],
    ["request", "list", "--json"],
  ]);
  assertEquals(created.code, 0, created.stderr);
  assertEquals(REQUEST_FILE_PATTERN.test(created.stdout), true, created.stdout);
  assertStringIncludes(listed.stdout, "Write the docs");
});

Deno.test("request create --file creates from file", async () => {
  const [created, listed] = await runExactlSeededWorkspace(
    (root) => Deno.writeTextFile(join(root, FILE_REQUEST_NAME), FILE_REQUEST_BODY),
    [["request", "create", "--file", FILE_REQUEST_NAME], ["request", "list", "--json"]],
  );
  assertEquals(created.code, 0, created.stderr);
  assertStringIncludes(listed.stdout, '"source": "file"');
});

Deno.test("request create --agent sets the agent role", async () => {
  const [created, listed] = await runExactlSequenceInTempWorkspace([
    ["request", "create", "Review the change", "--agent", "code-reviewer"],
    ["request", "list", "--json"],
  ]);
  assertEquals(created.code, 0, created.stderr);
  assertStringIncludes(created.stdout, "agent_role: code-reviewer");
  assertStringIncludes(listed.stdout, "code-reviewer");
});

Deno.test("request create without a description or file exits 1", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["request", "create"]]);
  assertEquals(run.code, 1);
  assertStringIncludes(run.stderr, "exactl request create");
});
