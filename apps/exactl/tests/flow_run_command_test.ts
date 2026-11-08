/**
 * @module FlowRunCommandTest
 * @path apps/exactl/tests/flow_run_command_test.ts
 * @description Verifies `exactl flow run` creates the same request as `exactl request create --flow`.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/test_utils.ts]
 * @related-files [apps/exactl/src/command_builders/flow_command.ts, apps/exactl/src/command_builders/request_command.ts]
 */

import "./helpers/set_test_mode.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import type { IRequestOptions } from "@exaix/core/types";
import { captureConsoleOutput } from "./helpers/console_utils.ts";
import { createdFlowRequest, withTestMod } from "./helpers/test_utils.ts";
import { runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const FLOW_ID = "code-review";
const DESCRIPTION = "Review the auth module";
const USAGE_EXIT_CODE = 2;

interface ICreateCall {
  description: string;
  options: IRequestOptions | undefined;
}

async function captureCreate(argv: string[]): Promise<ICreateCall[]> {
  const calls: ICreateCall[] = [];
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.create = (description: string, options?: IRequestOptions) => {
      calls.push({ description, options });
      return Promise.resolve(createdFlowRequest(FLOW_ID, "t-flow"));
    };
    await captureConsoleOutput(async () => {
      await mod.__test_command.parse(argv);
    });
  });
  return calls;
}

Deno.test("flow run X and request create --flow X write identical request frontmatter", async () => {
  const viaFlow = await captureCreate(["flow", "run", FLOW_ID, DESCRIPTION, "-p", "high", "--portal", "p1"]);
  const viaRequest = await captureCreate([
    "request",
    "create",
    DESCRIPTION,
    "--flow",
    FLOW_ID,
    "-p",
    "high",
    "--portal",
    "p1",
  ]);
  assertEquals(viaFlow.length, 1);
  assertEquals(viaFlow, viaRequest);
  assertEquals(viaFlow[0].options?.flow, FLOW_ID);
});

Deno.test("flow run sets no agent role", async () => {
  const [call] = await captureCreate(["flow", "run", FLOW_ID, DESCRIPTION]);
  assertEquals(call.options?.agent_role, undefined);
});

Deno.test("flow run needs a flow id and a description", async () => {
  const [noArgs, noDescription] = await runExactlSequenceInTempWorkspace([["flow", "run"], ["flow", "run", FLOW_ID]]);
  assertEquals(noArgs.code, USAGE_EXIT_CODE, noArgs.stderr);
  assertEquals(noDescription.code, USAGE_EXIT_CODE, noDescription.stderr);
  assertStringIncludes(noDescription.stderr, "description");
});
