/**
 * @module ApprovalHangProbe
 * @path apps/exactl/tests/helpers/approval_hang_probe.ts
 * @description Standalone script that runs `approval list` with one source that never settles and holds an open timer, so a test can check that the process still exits.
 * @architectural-layer Test
 * @dependencies [apps/exactl/src/commands/approval_commands.ts, apps/exactl/src/command_builders/approval_command.ts, apps/exactl/tests/helpers/test_setup.ts]
 * @related-files [apps/exactl/tests/approval_list_exit_test.ts]
 */

import { ApprovalCommands } from "../../src/commands/approval_commands.ts";
import { ApprovalKind } from "../../src/commands/approval_id.ts";
import type { IApprovalListEntry, IApprovalSource } from "../../src/commands/approval_sources.ts";
import { ToolCommands } from "../../src/commands/tool_commands.ts";
import { WaitStateCommands } from "../../src/commands/wait_state_commands.ts";
import { buildApprovalCommand } from "../../src/command_builders/approval_command.ts";
import { createCliTestContext } from "./test_setup.ts";

const SOURCE_TIMEOUT_MS = 50;
const OPEN_HANDLE_INTERVAL_MS = 1_000;
const TEMP_DIR_MARKER = "TEMP:";
const PROBE_DONE_MARKER = "PROBE_DONE";
const PROBE_PLAN_REF = "plan:probe-plan";

const env = await createCliTestContext();
console.log(`${TEMP_DIR_MARKER}${env.tempDir}`);

const entry: IApprovalListEntry = {
  kind: ApprovalKind.PLAN,
  ref: PROBE_PLAN_REF,
  summary: "Probe plan",
  created_at: "2026-01-01T00:00:00.000Z",
  trace_id: undefined,
  act: "exactl plan approve probe-plan",
};
const hanging: IApprovalSource = {
  kind: ApprovalKind.REVIEW,
  list: () => {
    setInterval(() => undefined, OPEN_HANDLE_INTERVAL_MS);
    return new Promise(() => {});
  },
};
const quick: IApprovalSource = { kind: ApprovalKind.PLAN, list: () => Promise.resolve([entry]) };

const approvalCommands = new ApprovalCommands(
  env.context,
  new WaitStateCommands(env.context),
  new ToolCommands(env.context),
  [hanging, quick],
  SOURCE_TIMEOUT_MS,
);
await buildApprovalCommand({ approvalCommands, display: env.context.display }).parse(["list"]);
console.log(PROBE_DONE_MARKER);
