/**
 * @module ExitCodeCases
 * @path apps/exactl/tests/helpers/exit_code_cases.ts
 * @description One command for each exit-code class of exactl, with the workspace that makes it fail, for tests that run the real binary.
 * @architectural-layer Test
 * @dependencies [@std/path, @exaix/shared, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/tests/exactl_contracts_cutover_test.ts, apps/exactl/tests/exit_code_contract_test.ts]
 */

import { join } from "@std/path";
import { runtimePath } from "@exaix/shared";
import { ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { type IExaCtlCliRun, runExactlSeededWorkspace, SOLO_ENTRY } from "./exactl_cli_process.ts";
import { seedWorkNouns } from "./work_nouns_seed.ts";

export interface IExitCodeCase {
  label: string;
  args: string[];
  expected: ExaCtlExitCode;
  seed?: (root: string) => Promise<void> | void;
  unsetEnv?: readonly string[];
}

const APPROVED_PLAN_ID = "plan-approved";
const DEAD_PID = "99999";
const PROVIDER_KEY_VARIABLES: readonly string[] = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"];
const LOG_WAIT_TIMEOUT_SECONDS = "1";

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, content);
}

async function seedApprovedPlan(root: string): Promise<void> {
  await writeFile(
    join(root, "Workspace", "Plans", `${APPROVED_PLAN_ID}.md`),
    `---\ntrace_id: "trace-approved"\nstatus: approved\nagent_role: senior-coder\ncreated_at: "2026-01-01T00:00:00Z"\n---\n\n# Plan\n`,
  );
}

function seedBrokenSkill(root: string): Promise<void> {
  return writeFile(join(root, "Blueprints", "Skills", "broken", "SKILL.md"), "no frontmatter at all\n");
}

function seedKeylessProvider(root: string): void {
  const path = join(root, "exa.config.toml");
  Deno.writeTextFileSync(
    path,
    Deno.readTextFileSync(path).replace(
      '[models.mock]\nprovider = "mock"\nmodel = "test"',
      '[models.mock]\nprovider = "anthropic"\nmodel = "claude-haiku-5-5"',
    ),
  );
}

export const EXIT_CODE_CASES: readonly IExitCodeCase[] = [
  {
    label: "a confirming verb without a terminal",
    args: ["plan", "approve", "--all"],
    expected: ExaCtlExitCode.USAGE,
    seed: seedWorkNouns,
  },
  { label: "a missing plan", args: ["plan", "show", "no-such-plan"], expected: ExaCtlExitCode.NOT_FOUND },
  {
    label: "an approved plan",
    args: ["plan", "approve", APPROVED_PLAN_ID, "--yes"],
    expected: ExaCtlExitCode.STATE_CONFLICT,
    seed: seedApprovedPlan,
  },
  { label: "an invalid skill", args: ["skill", "validate"], expected: ExaCtlExitCode.INVALID, seed: seedBrokenSkill },
  {
    label: "a log wait without its event",
    args: ["log", "wait", "--event", "never.happens", "--timeout", LOG_WAIT_TIMEOUT_SECONDS],
    expected: ExaCtlExitCode.TIMEOUT,
  },
  {
    label: "a PID file with a dead process",
    args: ["doctor"],
    expected: ExaCtlExitCode.DAEMON_UNAVAILABLE,
    seed: (root) => Deno.writeTextFileSync(runtimePath(root, "daemon.pid"), DEAD_PID),
  },
  {
    label: "a provider without its credential",
    args: ["doctor"],
    expected: ExaCtlExitCode.CREDENTIALS,
    seed: seedKeylessProvider,
    unsetEnv: PROVIDER_KEY_VARIABLES,
  },
];

/** Runs the command of a case in a workspace that its seed prepared. */
export async function runExitCodeCase(exitCase: IExitCodeCase): Promise<IExaCtlCliRun> {
  const [run] = await runExactlSeededWorkspace(
    exitCase.seed ?? (() => {}),
    [exitCase.args],
    SOLO_ENTRY,
    exitCase.unsetEnv,
  );
  return run;
}
