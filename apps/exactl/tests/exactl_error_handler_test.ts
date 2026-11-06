/**
 * @module ExaCtlErrorHandlerTest
 * @path apps/exactl/tests/exactl_error_handler_test.ts
 * @description Verifies the root error handler maps ExaCtlError to exit codes, prints rename hints and registers on every root command.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/testing, @cliffy/command, apps/exactl/src/exactl_error_handler.ts]
 * @related-files [apps/exactl/src/exactl_error_handler.ts, apps/exactl/src/exactl.ts]
 */

import { assert, assertEquals, assertStrictEquals, assertStringIncludes } from "@std/assert";
import { stub } from "@std/testing/mock";
import { ValidationError } from "@cliffy/command";
import { createExaCtlCommand } from "../src/exactl.ts";
import { handleExaCtlError } from "../src/exactl_error_handler.ts";
import { ExaCtlError, ExaCtlExitCode } from "../src/exactl_errors.ts";

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

interface IHandlerRun {
  exitCode: number | null;
  stderr: string;
}

const root = createExaCtlCommand();

function runHandler(error: Error, argv: string[]): IHandlerRun {
  const lines: string[] = [];
  const consoleError = stub(console, "error", (...parts: string[]) => {
    lines.push(parts.join(" "));
  });
  let exitCode: number | null = null;
  try {
    handleExaCtlError(error, argv, (code: number): never => {
      throw new ExitCalled(code);
    }, root);
  } catch (thrown) {
    if (!(thrown instanceof ExitCalled)) throw thrown;
    exitCode = thrown.code;
  } finally {
    consoleError.restore();
  }
  return { exitCode, stderr: lines.join("\n") };
}

Deno.test("a ValidationError under every root command reaches the handler", () => {
  const handler = root["getErrorHandler"]();
  assert(handler !== undefined, "the root command has no error handler");
  const roots = root.getCommands(true).filter((command) => command.getName() !== "help");
  assert(roots.length > 0);
  for (const command of roots) {
    assertStrictEquals(command["getErrorHandler"](), handler, `root ${command.getName()}`);
  }
});

Deno.test("an unknown option after a renamed command word still yields the hint", () => {
  const run = runHandler(new ValidationError('Unknown option "--bogus"'), ["blueprint", "ls", "--bogus"]);
  assertEquals(run.exitCode, ExaCtlExitCode.USAGE);
  assertStringIncludes(run.stderr, "use 'exactl blueprint list'");
});

Deno.test("an unknown command under a renamed prefix yields the hint", () => {
  const run = runHandler(new ValidationError('Unknown command "agent-role"'), ["blueprint", "agent-role", "list"]);
  assertEquals(run.exitCode, ExaCtlExitCode.USAGE);
  assertStringIncludes(run.stderr, "use 'exactl blueprint list'");
});

Deno.test("an ExaCtlError exits with its code", () => {
  const run = runHandler(new ExaCtlError(ExaCtlExitCode.NOT_FOUND, "plan p-1 not found"), ["plan", "show", "p-1"]);
  assertEquals(run.exitCode, ExaCtlExitCode.NOT_FOUND);
  assertStringIncludes(run.stderr, "plan p-1 not found");
});

Deno.test("a miss returns without calling exit", () => {
  const validation = runHandler(new ValidationError('Unknown option "--bogus"'), ["blueprint", "list", "--bogus"]);
  assertEquals(validation.exitCode, null);
  assertEquals(validation.stderr, "");
  const other = runHandler(new Error("boom"), ["blueprint", "ls"]);
  assertEquals(other.exitCode, null);
  assertEquals(other.stderr, "");
});

Deno.test("only the words before the first option select the rename row", () => {
  const run = runHandler(new ValidationError('Unknown option "-n"'), ["blueprint", "list", "-n", "ls"]);
  assertEquals(run.exitCode, null);
});

Deno.test("free text after request yields the request create hint", () => {
  const run = runHandler(new ValidationError('Unknown command "Fix"'), ["request", "Fix", "bug", "--priority", "high"]);
  assertEquals(run.exitCode, ExaCtlExitCode.USAGE);
  assertStringIncludes(run.stderr, "exactl request create 'Fix bug'");
});

Deno.test("a request subcommand that fails is not mistaken for free text", () => {
  const run = runHandler(new ValidationError('Unknown option "--bogus"'), ["request", "list", "--bogus"]);
  assertEquals(run.exitCode, null);
  assertEquals(run.stderr, "");
});

Deno.test("a legacy option on request create yields the option hint", () => {
  const run = runHandler(new ValidationError('Unknown option "--agent-role"'), [
    "request",
    "create",
    "Fix bug",
    "--agent-role",
    "qa",
  ]);
  assertEquals(run.exitCode, ExaCtlExitCode.USAGE);
  assertStringIncludes(run.stderr, "use '--agent'");
});
