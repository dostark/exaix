/**
 * @module ConfigValidateExitTest
 * @path apps/exactl/tests/config_validate_exit_test.ts
 * @description Verifies that `config validate` fails with the INVALID exit code when the report holds issues, and returns when the report is valid.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/command_builders/config_command.ts]
 * @related-files [apps/exactl/src/command_builders/config_command.ts, packages/cli/src/errors/exactl_errors.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { buildConfigCommand } from "../src/command_builders/config_command.ts";
import type { IExaCtlRuntime } from "../src/exactl_runtime.ts";
import { createStubContext } from "@exaix/testing";
import { defaultOutputSink } from "../src/output/exactl_output.ts";

interface IValidationReport {
  valid: boolean;
  issues: Array<{ path: string; message: string; code: string }>;
}

function configRuntime(report: IValidationReport): IExaCtlRuntime {
  const context = createStubContext();
  return {
    display: context.display,
    outputSink: defaultOutputSink,
    configCommands: { validate: () => Promise.resolve(report) },
  } as IExaCtlRuntime;
}

Deno.test("config validate throws INVALID when the report holds issues", async () => {
  const report: IValidationReport = {
    valid: false,
    issues: [{ path: "ai.timeout_ms", message: "below the minimum", code: "too_small" }],
  };
  const failure = await assertRejects(
    () => buildConfigCommand(configRuntime(report)).parse(["validate"]),
    ExaCtlError,
  );
  assertEquals(failure.code, ExaCtlExitCode.INVALID);
});

Deno.test("config validate returns when the report is valid", async () => {
  await buildConfigCommand(configRuntime({ valid: true, issues: [] })).parse(["validate"]);
});
