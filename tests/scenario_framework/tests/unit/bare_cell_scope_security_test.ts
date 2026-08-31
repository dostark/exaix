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
import type { Opt, Reason } from "@exaix/core/types";
import { buildOpencodePermissionConfig } from "@exaix/session";
import { OpencodeConfigSchema } from "@exaix/schemas/opencode_config.ts";
import {
  BARE_DELEGATE_AGENT_ID,
  type ISweTaskTemplateOptions,
  renderSweTaskBareTemplate,
} from "../../runner/scenario_templates.ts";
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

  const agent = config.agent[BARE_DELEGATE_AGENT_ID];
  assertExists(agent, "config must carry the bare-delegate identity's permission block");
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

  const expected = buildOpencodePermissionConfig(["**"], BARE_DELEGATE_AGENT_ID);
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
  // Claude Code has no path-deny config (unlike opencode's external_directory), so the leak
  // defense is the worktree boundary + this tool-surface restriction — no bare "Bash", only
  // git subcommands, since a wildcard Bash would allow a `find / -name reference.patch` probe.
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

/** Run `fn` with HOME pointed at `homeDir`, restoring the caller's HOME afterwards. Lets the
 *  credentials-mount tests control whether `resolveCredentialMounts` finds a host login
 *  (the CI runner has none, a dev machine usually has one). */
function withHome(homeDir: string, fn: () => void): void {
  const previous = Deno.env.get("HOME");
  Deno.env.set("HOME", homeDir);
  try {
    fn();
  } finally {
    if (previous === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", previous);
  }
}

interface IJailMountExpectation {
  expectCredentialsMount: boolean;
  /** The simulated host HOME, used to assert the credentials mount never points at the live file. */
  liveCredentialsHome?: Opt<string, Reason.OptionalInput>;
}

/** Shared eval-jail mount-surface assertions: the worktree bind is always first and is the
 *  ONLY mandatory mount; a second mount is allowed only for the disposable staged credentials
 *  copy (never the live host file); the repo must never appear. */
function assertJailMountSurface(args: string[], expectation: IJailMountExpectation): void {
  const mounts = args.filter((a) => a.startsWith("type=bind"));
  assertEquals(
    mounts.length,
    expectation.expectCredentialsMount ? 2 : 1,
    "the jail carries the worktree mount plus, only when a host login exists, ONE disposable credentials copy",
  );
  assertEquals(
    mounts[0],
    "type=bind,src=$WORKSPACE_ROOT/todo-app,dst=/worktree",
    "the primary mount is ONLY the worktree",
  );
  if (expectation.expectCredentialsMount) {
    assertEquals(
      mounts[1].endsWith(",dst=/tmp/.local"),
      true,
      "an opencode delegate must get its OWN staged auth.json (opencode's real credential store is " +
        "~/.local/share/opencode/auth.json, not ~/.claude/.credentials.json) — mounting claude's " +
        "credentials into an opencode container is a no-op that silently leaves opencode unauthenticated. " +
        "Mounted at /tmp/.local (not the narrower /tmp/.local/share/opencode): opencode also writes " +
        "session/model-cache state under ~/.local/state/opencode at runtime, and Docker auto-creates an " +
        "unmounted parent as root-owned — discovered via a real jailed run (Phase 144 Step 5) failing " +
        "with EACCES on mkdir '/tmp/.local/state'.",
    );
    assertEquals(
      mounts[1].includes(",ro"),
      false,
      "the staged copy is writable (in-container writes cannot reach the real host credentials — only the disposable copy)",
    );
    if (expectation.liveCredentialsHome !== undefined) {
      assert(
        !mounts[1].includes(expectation.liveCredentialsHome),
        "the staged temp copy is mounted, never the live host credential file",
      );
    }
  }
  assert(!args.some((a) => a.includes("exaix") && a.includes("bind")), "the repo must never be mounted");
}

Deno.test("[security] bare opencode launch runs in the eval-jail container mounting only the worktree", () => {
  // CI-equivalent host: no opencode login — `resolveCredentialMounts` yields no credentials
  // mount, so the jail must be complete with exactly ONE bind mount (the worktree). The
  // two-mount (logged-in host) branch is covered by the next test with a staged fake login.
  const bareHome = Deno.makeTempDirSync({ prefix: "jail-no-creds-" });
  try {
    withHome(bareHome, () => {
      const { command, args } = expandBareOpencodeCell();
      assertEquals(command, "docker", "bare delegate must run via docker");
      assertEquals(args[0], "run");

      assertJailMountSurface(args, { expectCredentialsMount: false });

      assert(args.includes("--cap-drop=ALL"), "must drop all capabilities");
      assert(args.includes("--security-opt=no-new-privileges"), "must forbid privilege escalation");
      const uid = Deno.uid();
      const gid = Deno.gid();
      if (uid !== null && gid !== null) {
        assertEquals(
          args[args.indexOf("--user") + 1],
          `${uid}:${gid}`,
          "container runs as the host uid (writable mount)",
        );
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
        !args.some((a) =>
          a === "ANTHROPIC_API_KEY" || a === "--env=ANTHROPIC_API_KEY" || a.includes("ANTHROPIC_API_KEY=")
        ),
        "the jail must never pass ANTHROPIC_API_KEY into the container",
      );
    });
  } finally {
    Deno.removeSync(bareHome, { recursive: true });
  }
});

Deno.test("[security] bare opencode launch stages a disposable auth.json copy when a host login exists", () => {
  // Logged-in host: the jail gains exactly ONE extra bind mount — the disposable staged copy
  // of ~/.local/share/opencode/auth.json, writable, never the live host file.
  const credsHome = Deno.makeTempDirSync({ prefix: "jail-creds-" });
  try {
    Deno.mkdirSync(`${credsHome}/.local/share/opencode`, { recursive: true });
    Deno.writeTextFileSync(`${credsHome}/.local/share/opencode/auth.json`, "{}");
    withHome(credsHome, () => {
      const { command, args } = expandBareOpencodeCell();
      assertEquals(command, "docker", "bare delegate must run via docker");
      assertJailMountSurface(args, { expectCredentialsMount: true, liveCredentialsHome: credsHome });
    });
  } finally {
    Deno.removeSync(credsHome, { recursive: true });
  }
});

function expandBareOpencodeGoCell(): { command: string; args: string[] } {
  const matrix = MatrixSchema.parse({
    cells: [{
      tool: "opencode-go",
      provider: "opencode-cli",
      config: "configs/opencode-go-delegate-all.toml",
      requires_bin: "opencode",
      harness: "bare",
    }],
  });
  const runs = expandMatrix([makeBareDelegateStep()], matrix, {
    env: {},
    binOnPath: () => true,
  });
  assertEquals(runs.length, 1, "bare opencode-go cell must be runnable");
  const delegate = runs[0].steps.find((s) => s.id === BARE_DELEGATE_STEP_ID);
  assertExists(delegate, "bare delegate step must survive expansion");
  return { command: delegate.command ?? "", args: delegate.args ?? [] };
}

Deno.test("[security] bare opencode-go launch pins the deepseek-v4-flash model via --model and stays worktree-scoped", () => {
  // CI-equivalent host: no opencode login — exactly one bind mount (the worktree).
  const bareHome = Deno.makeTempDirSync({ prefix: "jail-no-creds-" });
  try {
    withHome(bareHome, () => {
      const { command, args } = expandBareOpencodeGoCell();
      assertEquals(command, "docker", "bare delegate must run via docker");

      const opencodeIdx = args.indexOf("opencode");
      assert(opencodeIdx > 0, "opencode must be the inner command");
      const inner = args.slice(opencodeIdx);
      assert(inner.includes("--model"), "opencode-go must pin its model via --model");
      assertEquals(
        inner[inner.indexOf("--model") + 1],
        "opencode-go/deepseek-v4-flash",
        "--model must be the exact opencode-go deepseek-v4-flash model string",
      );

      assertJailMountSurface(args, { expectCredentialsMount: false });
    });
  } finally {
    Deno.removeSync(bareHome, { recursive: true });
  }
});

Deno.test("[security] bare opencode-go launch stages the opencode auth.json copy when a host login exists", () => {
  // opencode-go shares opencode's binary, so it authenticates the same way — the staged
  // auth.json copy, never the live host file.
  const credsHome = Deno.makeTempDirSync({ prefix: "jail-creds-" });
  try {
    Deno.mkdirSync(`${credsHome}/.local/share/opencode`, { recursive: true });
    Deno.writeTextFileSync(`${credsHome}/.local/share/opencode/auth.json`, "{}");
    withHome(credsHome, () => {
      const { command, args } = expandBareOpencodeGoCell();
      assertEquals(command, "docker", "bare delegate must run via docker");
      assertJailMountSurface(args, { expectCredentialsMount: true, liveCredentialsHome: credsHome });
    });
  } finally {
    Deno.removeSync(credsHome, { recursive: true });
  }
});
