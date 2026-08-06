/**
 * @module BareCellScopeSecurityTest
 * @path tests/scenario_framework/tests/unit/bare_cell_scope_security_test.ts
 * @description Phase 143 fix — [security] regression test that a bare-delegate cell launch is
 *   scoped to its worktree. The bare template must stage an opencode permission config INTO the
 *   sandbox worktree (`$WORKSPACE_ROOT/todo-app/opencode.jsonc` — never the repo) and pass it to
 *   the delegate via `OPENCODE_CONFIG`, mirroring the daemon-run delegate path. The config
 *   denies `external_directory` reads (the leak vector: a bare delegate reaching the repo's
 *   `fixtures/swe_tasks/<task>/reference.patch`), allows edits only under the worktree, and
 *   denies bash.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_templates.ts, packages/session/src/opencode_permission_generator.ts]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { DOGFOOD_DEVELOPER_IDENTITY_ID } from "@exaix/core/types";
import { buildOpencodePermissionConfig } from "@exaix/session";
import { OpencodeConfigSchema } from "@exaix/schemas/opencode_config.ts";
import { type ISweTaskTemplateOptions, renderSweTaskBareTemplate } from "../../runner/scenario_templates.ts";
import { BARE_DELEGATE_STEP_ID, expandMatrix, MatrixSchema } from "../../runner/matrix_expander.ts";
import { type IScenarioStep, ScenarioStepType } from "../../schema/step_schema.ts";

interface IParsedBareStep {
  id: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface IParsedBareScenarioYaml {
  steps: IParsedBareStep[];
}

function makeOpts(overrides: Partial<ISweTaskTemplateOptions> = {}): ISweTaskTemplateOptions {
  return {
    id: "swe-scope-test-task",
    title: "Scope test task",
    requestFixture: "fixtures/requests/swe_tasks/scope-test.md",
    cells: [{
      tool: "opencode",
      provider: "ollama",
      config: "configs/ollama-cli-delegate-all.toml",
      requiresBin: "opencode",
    }],
    ...overrides,
  };
}

function parseBareScenario(): IParsedBareScenarioYaml {
  return parseYaml(renderSweTaskBareTemplate(makeOpts())) as IParsedBareScenarioYaml;
}

Deno.test("[security] bare delegate launch stages a worktree-scoped opencode permission config", () => {
  const scenario = parseBareScenario();

  const configStep = scenario.steps.find((s) => s.id === "stage-bare-opencode-config");
  assertExists(configStep, "a setup step must stage the opencode config");
  assertEquals(configStep.command, "sh");
  const writeArg = (configStep.args ?? []).join(" ");
  assert(
    writeArg.includes("$WORKSPACE_ROOT/todo-app/opencode.jsonc"),
    "config must be written into the sandbox worktree, not the repo",
  );

  const delegate = scenario.steps.find((s) => s.id === BARE_DELEGATE_STEP_ID);
  assertExists(delegate, "delegate step must exist");
  assertEquals(
    delegate.env?.OPENCODE_CONFIG,
    "$WORKSPACE_ROOT/todo-app/opencode.jsonc",
    "delegate must receive the config via OPENCODE_CONFIG",
  );
});

Deno.test("[security] the staged opencode config denies external-directory reads (solution-leak vector)", () => {
  const scenario = parseBareScenario();
  const configStep = scenario.steps.find((s) => s.id === "stage-bare-opencode-config");
  assertExists(configStep);

  const arg = (configStep.args ?? []).find((a) => a.includes("printf")) ?? "";
  const jsonMatch = arg.match(/'(\{.*\})'/);
  assert(jsonMatch, "config JSON must be embedded in the staging command");
  const config = OpencodeConfigSchema.parse(JSON.parse(jsonMatch[1]));

  const agent = config.agent[DOGFOOD_DEVELOPER_IDENTITY_ID];
  assertExists(agent, "config must carry the dogfood identity's permission block");
  assertEquals(agent.external_directory["**"], "deny", "external directory reads must be denied");
  assertEquals(agent.edit["*"], "deny", "edits outside the worktree must be denied");
  assertEquals(agent.edit["**"], "allow", "edits under the worktree must be allowed");
  assertEquals(agent.bash["*"], "deny", "bash must be denied");
});

Deno.test("[security] the staged config matches the shared permission builder (daemon parity)", () => {
  const scenario = parseBareScenario();
  const configStep = scenario.steps.find((s) => s.id === "stage-bare-opencode-config");
  assertExists(configStep);
  const arg = (configStep.args ?? []).find((a) => a.includes("printf")) ?? "";
  const jsonMatch = arg.match(/'(\{.*\})'/);
  assert(jsonMatch);

  const expected = buildOpencodePermissionConfig(["**"]);
  assertEquals(JSON.parse(jsonMatch[1]), expected, "bare config must be byte-identical to the shared builder");
});

function makeBareDelegateStep(): IScenarioStep {
  return {
    id: BARE_DELEGATE_STEP_ID,
    type: ScenarioStepType.SHELL,
    command: "opencode",
    args: ["run"],
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  };
}

function expandBareClaudeCell(): { args: string[] } {
  const matrix = MatrixSchema.parse({
    cells: [{
      tool: "claude-code",
      provider: "anthropic",
      config: "configs/claude-cli-delegate-all.toml",
      requires_bin: "claude",
      harness: "bare",
    }],
  });
  const runs = expandMatrix([makeBareDelegateStep()], matrix, {
    env: { ANTHROPIC_API_KEY: "k" },
    binOnPath: () => true,
  });
  assertEquals(runs.length, 1, "bare claude cell must be runnable");
  const delegate = runs[0].steps.find((s) => s.id === BARE_DELEGATE_STEP_ID);
  assertExists(delegate, "bare delegate step must survive expansion");
  return { args: delegate.args ?? [] };
}

Deno.test("[security] bare claude-code launch carries the worktree-scoped tool flags (Exaix parity)", () => {
  const { args } = expandBareClaudeCell();
  assert(args.includes("--permission-mode"), "must carry --permission-mode");
  assertEquals(args[args.indexOf("--permission-mode") + 1], "acceptEdits");
  assert(args.includes("--allowedTools"), "must carry --allowedTools");
  assertEquals(args[args.indexOf("--allowedTools") + 1], "Read,Edit,Bash(git *)");
  assert(!args.includes("--dangerously-skip-permissions"), "must never bypass permissions");
});

Deno.test("[security] bare claude-code launch is confined by the worktree boundary + tool surface (no wildcard bash)", () => {
  const { args } = expandBareClaudeCell();
  const allowedTools = args[args.indexOf("--allowedTools") + 1];
  // The tool surface is scoped: no bare "Bash" — only git subcommands. Claude Code has no
  // path-deny config (unlike opencode's external_directory), so the leak defense is the
  // worktree boundary + this tool-surface restriction; a wildcard Bash would allow a
  // `find / -name reference.patch` probe, which the scoped tools exclude.
  assertEquals(allowedTools.includes("Bash("), true);
  assertEquals(allowedTools.includes(",Bash,"), false, "no bare bash tool");
});

function expandBareOpencodeCell(): { command: string; args: string[] } {
  const matrix = MatrixSchema.parse({
    cells: [{
      tool: "opencode",
      provider: "ollama",
      config: "configs/ollama-cli-delegate-all.toml",
      requires_bin: "opencode",
      harness: "bare",
    }],
  });
  const runs = expandMatrix([makeBareDelegateStep()], matrix, {
    env: {},
    binOnPath: () => true,
  });
  assertEquals(runs.length, 1, "bare opencode cell must be runnable");
  const delegate = runs[0].steps.find((s) => s.id === BARE_DELEGATE_STEP_ID);
  assertExists(delegate, "bare delegate step must survive expansion");
  return { command: delegate.command ?? "", args: delegate.args ?? [] };
}

Deno.test("[security] bare opencode launch runs in the eval-jail container mounting only the worktree", () => {
  const { command, args } = expandBareOpencodeCell();
  assertEquals(command, "docker", "bare delegate must run via docker");
  assertEquals(args[0], "run");

  const mounts = args.filter((a) => a.startsWith("type=bind"));
  assertEquals(mounts.length, 1, "exactly one bind mount");
  assertEquals(mounts[0], "type=bind,src=$WORKSPACE_ROOT/todo-app,dst=/worktree", "mount is ONLY the worktree");
  assert(!args.some((a) => a.includes("exaix") && a.includes("bind")), "the repo must never be mounted");

  assert(args.includes("--cap-drop=ALL"), "must drop all capabilities");
  assert(args.includes("--security-opt=no-new-privileges"), "must forbid privilege escalation");
  const uid = Deno.uid();
  const gid = Deno.gid();
  if (uid !== null && gid !== null) {
    assertEquals(args[args.indexOf("--user") + 1], `${uid}:${gid}`, "container runs as the host uid (writable mount)");
  }
  assertEquals(args[args.indexOf("--workdir") + 1], "/worktree");

  // The inner delegate command targets the container worktree path.
  const opencodeIdx = args.indexOf("opencode");
  assert(opencodeIdx > 0, "opencode must be the inner command");
  assert(args.slice(opencodeIdx).includes("--dir"), "opencode --dir must be set");
  assert(args.includes("/worktree"), "delegate cwd is the jail worktree");
  assert(args.includes("OPENCODE_CONFIG=/worktree/opencode.jsonc"), "permission config passed into the jail");
  // Claude Code subscription, never API billing: the jail must not pass ANTHROPIC_API_KEY into
  // the container (the daemon path strips it too — cli_delegate_strategy_test.ts). The
  // subscription login is what authenticates, not a metered key.
  assert(
    !args.some((a) => a === "ANTHROPIC_API_KEY" || a === "--env=ANTHROPIC_API_KEY" || a.includes("ANTHROPIC_API_KEY=")),
    "the jail must never pass ANTHROPIC_API_KEY into the container",
  );
});
