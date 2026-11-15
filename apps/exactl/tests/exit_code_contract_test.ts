/**
 * @module ExitCodeContractTest
 * @path apps/exactl/tests/exit_code_contract_test.ts
 * @description Runs the real exactl entry point to check that each failure class ends the process with its documented exit code, and that no command calls Deno.exit.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/exactl_error_handler.ts, packages/cli/src/errors/exactl_errors.ts]
 */

import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { handleExaCtlError } from "../src/exactl_error_handler.ts";
import { EvalCommands } from "../src/commands/eval_commands.ts";
import { createExaCtlCommand } from "../src/exactl.ts";
import { runExactlInTempWorkspace, runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";
import { withStubbedChildExit } from "./helpers/stub_child_process.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

const EXACTL_SRC = join(import.meta.dirname!, "..", "src");
const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");
const ROOT_ENTRY = "exactl.ts";
const APPROVED_PLAN_ID = "plan-approved";
const BROKEN_SKILL_DIR = join("Blueprints", "Skills", "broken");
const CHILD_FAILURE_CODE = 2;
const LOG_WAIT_TIMEOUT_SECONDS = "1";

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, content);
}

Deno.test("plan show <missing> exits 3", async () => {
  const run = await runExactlInTempWorkspace(["plan", "show", "no-such-plan"]);
  assertEquals(run.code, ExaCtlExitCode.NOT_FOUND, run.stderr);
  assertStringIncludes(run.stderr, "Plan not found: no-such-plan");
});

const MISSING_ENTITY_COMMANDS: ReadonlyArray<readonly string[]> = [
  ["portal", "show", "nope"],
  ["portal", "verify", "nope"],
  ["flow", "show", "nope"],
  ["flow", "bindings", "nope"],
  ["request", "analyze", "nope"],
  ["config", "get", "no.such.key"],
];

Deno.test("portal show, portal verify, flow show, flow bindings, request analyze and config get of a missing entity exit 3", async () => {
  const runs = await runExactlSeededWorkspace(() => {}, MISSING_ENTITY_COMMANDS.map((args) => [...args]));
  runs.forEach((run, index) => {
    assertEquals(run.code, ExaCtlExitCode.NOT_FOUND, `${MISSING_ENTITY_COMMANDS[index].join(" ")}: ${run.stderr}`);
  });
});

Deno.test("plan approve <approved plan> exits 4", async () => {
  const [run] = await runExactlSeededWorkspace(
    (root) =>
      writeFile(
        join(root, "Workspace", "Plans", `${APPROVED_PLAN_ID}.md`),
        `---\ntrace_id: "trace-approved"\nstatus: approved\nagent_role: senior-coder\ncreated_at: "2026-01-01T00:00:00Z"\n---\n\n# Plan\n`,
      ),
    [["plan", "approve", APPROVED_PLAN_ID]],
  );
  assertEquals(run.code, ExaCtlExitCode.STATE_CONFLICT, run.stderr);
  assertStringIncludes(run.stderr, "Only plans with status='review' can be approved");
});

Deno.test("skill validate on an invalid skill exits 6", async () => {
  const [run] = await runExactlSeededWorkspace(
    (root) => writeFile(join(root, BROKEN_SKILL_DIR, "SKILL.md"), "no frontmatter at all\n"),
    [["skill", "validate", "-o", "json"]],
  );
  assertEquals(run.code, ExaCtlExitCode.INVALID, run.stderr);
  assertEquals(JSON.parse(run.stdout).valid, false);
});

Deno.test("log wait with a 1-second timeout and no event exits 124", async () => {
  const run = await runExactlInTempWorkspace([
    "log",
    "wait",
    "--event",
    "never.happens",
    "--timeout",
    LOG_WAIT_TIMEOUT_SECONDS,
  ]);
  assertEquals(run.code, ExaCtlExitCode.TIMEOUT, run.stderr);
  assertStringIncludes(run.stderr, "Timeout after 1s waiting for journal event: never.happens");
});

Deno.test("an ExaCtlError with child code 2 exits 2 and its JSON error code is CHILD_EXIT", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const thrown = await withStubbedChildExit(
      CHILD_FAILURE_CODE,
      () => new EvalCommands(context).run({}).then(() => null, (error: Error) => error),
    );
    assertEquals(thrown instanceof ExaCtlError, true);
    assertEquals((thrown as ExaCtlError).code, CHILD_FAILURE_CODE);

    const lines: string[] = [];
    const consoleError = stub(console, "error", (...parts: string[]) => {
      lines.push(parts.join(" "));
    });
    let exitCode: number | null = null;
    try {
      handleExaCtlError(thrown as Error, ["eval", "run", "--json"], (code: number): never => {
        exitCode = code;
        throw new Error("exit");
      }, createExaCtlCommand());
    } catch {
      // The exit stub throws to end the handler.
    } finally {
      consoleError.restore();
    }
    assertEquals(exitCode, CHILD_FAILURE_CODE);
    assertEquals(JSON.parse(lines.join("\n")).error.code, "CHILD_EXIT");
  } finally {
    await cleanup();
  }
});

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) yield* sourceFiles(path);
    else if (entry.name.endsWith(".ts")) yield path;
  }
}

Deno.test("no exactl source calls Deno.exit outside the root entry", async () => {
  const offenders: string[] = [];
  for await (const path of sourceFiles(EXACTL_SRC)) {
    if (path.endsWith(`${EXACTL_SRC}/${ROOT_ENTRY}`)) continue;
    if (/Deno\.exit\(/.test(await Deno.readTextFile(path))) offenders.push(path);
  }
  assertEquals(offenders, []);
});

Deno.test("ContextInspectExitCode no longer exists", async () => {
  const enums = await Deno.readTextFile(join(REPO_ROOT, "packages", "core", "src", "types", "enums.ts"));
  assertFalse(enums.includes("ContextInspectExitCode"));
});
