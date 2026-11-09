/**
 * @module OutputContractOperationsATest
 * @path apps/exactl/tests/output_contract_operations_a_test.ts
 * @description Runs every COLLECTION and ITEM leaf of memory, config, git, mcp and version with -o json on a seeded workspace and parses stdout.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts, apps/exactl/src/command_docs/mod.ts]
 * @related-files [apps/exactl/tests/helpers/operations_a_seed.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { assertEquals } from "@std/assert";
import { ExaCtlOutputKind } from "@exaix/cli";
import { EXACTL_COMMAND_DOCS } from "../src/command_docs/mod.ts";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";
import { seedOperationsA } from "./helpers/operations_a_seed.ts";

const OPERATIONS_A_NOUNS = ["memory", "config", "git", "mcp"];
const READ_KINDS: readonly ExaCtlOutputKind[] = [ExaCtlOutputKind.COLLECTION, ExaCtlOutputKind.ITEM];
const JSON_FLAGS = ["-o", "json"];
const CONFIG_KEY = "ai.timeout_ms";

/** Leaves that run here, with their arguments on the seeded workspace. */
const INVOCATIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["memory list", ["memory", "list"]],
  ["memory search", ["memory", "search", "anything"]],
  ["memory project list", ["memory", "project", "list"]],
  ["memory execution list", ["memory", "execution", "list"]],
  ["memory proposal list", ["memory", "proposal", "list"]],
  ["config get", ["config", "get", CONFIG_KEY]],
  ["config history", ["config", "history", CONFIG_KEY]],
  ["config validate", ["config", "validate"]],
  ["config show", ["config", "show"]],
  ["config diff", ["config", "diff"]],
  ["config block list", ["config", "block", "list"]],
  ["config lock list", ["config", "lock", "list"]],
  ["config profile list", ["config", "profile", "list"]],
  ["git worktree list", ["git", "worktree", "list"]],
  ["git branch list", ["git", "branch", "list"]],
  ["git status", ["git", "status"]],
  ["git log", ["git", "log", "--trace", "trace-sweep"]],
]);

/** Leaves whose JSON needs a fixture that this workspace cannot seed cheaply, with the test that holds each. */
const COVERED_ELSEWHERE: ReadonlyMap<string, string> = new Map([
  ["memory project show", "memory_output_test.ts"],
  ["memory execution show", "memory_output_test.ts"],
  ["memory proposal show", "memory_output_test.ts"],
  ["mcp tool list", "mcp_tool_cli_test.ts"],
  ["mcp tool call", "mcp_tool_cli_test.ts"],
]);

const sweptLeaves = EXACTL_COMMAND_DOCS
  .filter((doc) => OPERATIONS_A_NOUNS.includes(doc.path[0]) && READ_KINDS.includes(doc.output))
  .map((doc) => doc.path.join(" "));

Deno.test("every COLLECTION and ITEM leaf of memory, config, git and mcp is swept or covered by a named test", () => {
  const known = new Set([...INVOCATIONS.keys(), ...COVERED_ELSEWHERE.keys()]);
  assertEquals(sweptLeaves.filter((leaf) => !known.has(leaf)), []);
  assertEquals([...known].filter((leaf) => !sweptLeaves.includes(leaf)), []);
});

Deno.test("every swept COLLECTION and ITEM leaf of memory, config, git and mcp, and version, prints valid JSON with -o json", async () => {
  const leaves = [...INVOCATIONS.keys(), "version"];
  const argsList = [...INVOCATIONS.values(), ["version"]].map((args) => [...args, ...JSON_FLAGS]);
  const runs = await runExactlSeededWorkspace(seedOperationsA, argsList);
  runs.forEach((run, index) => {
    assertEquals(run.code, 0, `${leaves[index]}: ${run.stderr}`);
    JSON.parse(run.stdout);
  });
});

Deno.test("git worktree prune prints a mutation result with -o json", async () => {
  const [run] = await runExactlSeededWorkspace(seedOperationsA, [[
    "git",
    "worktree",
    "prune",
    "--dry-run",
    ...JSON_FLAGS,
  ]]);
  assertEquals(run.code, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assertEquals([result.action, result.status], ["prune", "previewed"]);
  assertEquals(typeof result.id, "string");
});
