/**
 * @module SkillPinnedExecutionE2eTest
 * @path tests/integration/skill_pinned_execution_e2e_test.ts
 * @description A real RequestProcessor and AgentRunner plan with a named skill, the live skill file
 *   is edited, and a real PlanExecutor then runs the plan through AgentComposer and the ReAct
 *   strategy. The execution provider sees the approved body, never the edit, and the journal holds
 *   `plan_pinned` rows for the pinned revision. A swapped pin runs nothing. The composer also
 *   carries the typed pins through the MCP subprocess context without recording usage, and through
 *   the CLI delegate objective with a recorded launch.
 * @architectural-layer Integration
 * @dependencies [@exaix/request, @exaix/execution, @exaix/core/planning, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/agent_composer.ts]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { AgentComposer, AgentRunner, McpAgentStrategy, StrategyRegistry } from "@exaix/execution";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { MockStrategy, ProcessManager, SecurityMode } from "@exaix/core";
import type { JSONObject, JSONValue } from "@exaix/core/types";
import { RequestProcessor } from "@exaix/request";
import { PlanExecutor } from "@exaix/core/planning";
import { SkillsService, SkillUnavailableError } from "@exaix/core/skills";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  makeGenerateResult,
  writeSkillFolder,
} from "@exaix/testing";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";

const PLAN_RESPONSE = '<thought>ok</thought><content>{"subject":"Test","description":"A plan.",' +
  '"steps":[{"step":1,"title":"Step","description":"Do it."}]}</content>';
const SKILL = "approved-skill";
const OTHER = "other-skill";

interface IUsageRow {
  skill_name: string;
  match_source: string;
  submission_kind: string;
  revision_id: string;
  trace_id: string;
}

async function planWithPinnedSkill() {
  const env = await TestEnvironment.create({
    initGit: false,
    configOverrides: { request_analysis: { mode: "heuristic" } } as never,
  });
  const root = await Deno.makeTempDir({ prefix: "skill-pinned-exec-" });
  const skillsDir = join(root, "Skills");
  await writeSkillFolder(skillsDir, { name: SKILL, instructions: "Approved body A." });
  await writeSkillFolder(skillsDir, { name: OTHER, instructions: "Other body." });
  const skills = new SkillsService(
    { memoryDir: join(root, "Memory"), blueprintSkillsDir: skillsDir },
    env.db,
    undefined,
    new EventLogger({ db: env.db }),
  );
  await skills.initialize();
  await Deno.writeTextFile(
    join(env.tempDir, "Blueprints", "Agents", "default.md"),
    "---\nagent_role: default\nmodel: mock:test\n---\nYou are a helpful assistant.\n",
  );
  const provider = env.createMockProvider(MockStrategy.RECORDED, [{
    promptHash: ".*",
    promptPreview: "You are a helpful assistant.",
    response: PLAN_RESPONSE,
    model: "test",
    tokens: { input: 0, output: 0 },
    recordedAt: new Date().toISOString(),
  }]);
  const applicationContext = {
    config: createStubConfig(env.config),
    db: env.db,
    provider,
    git: createStubGit(),
    display: createStubDisplay(env.db),
    skills,
  } as never;
  const processor = new RequestProcessor({
    workspacePath: join(env.tempDir, "Workspace"),
    requestsDir: join(env.tempDir, "Workspace", "Requests"),
    blueprintsPath: join(env.tempDir, "Blueprints", "Agents"),
    includeReasoning: true,
    context: applicationContext,
    testProvider: provider,
    agentRunner: new AgentRunner(provider, { skillsService: skills, disableRetry: true }),
  });
  const traceId = crypto.randomUUID();
  const requestPath = join(env.tempDir, "Workspace", "Requests", `request-${traceId.slice(0, 8)}.md`);
  await Deno.writeTextFile(
    requestPath,
    `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: default
source: cli
created_by: "test@example.com"
subject: "Pinned execution"
skills: ["${SKILL}"]
---
# Request
Do the pinned thing.
`,
  );
  const planPath = await processor.process(requestPath);
  assert(planPath, "planning must produce a plan path");
  const planContent = await Deno.readTextFile(String(planPath));
  const frontmatter = parseYaml((planContent.match(/^---\n([\s\S]*?)\n---/) ?? [])[1] ?? "") as JSONObject;
  return {
    env,
    root,
    skills,
    skillsDir,
    applicationContext,
    frontmatter,
    usage: (traceId: string) =>
      env.db.preparedAll<IUsageRow>(
        "SELECT skill_name, match_source, submission_kind, revision_id, trace_id FROM skill_usage WHERE trace_id = ? ORDER BY id",
        [traceId],
      ),
    cleanup: async () => {
      await Deno.remove(root, { recursive: true }).catch(() => {});
      await env.cleanup();
    },
  };
}

function capturingProvider(prompts: string[]): IModelProvider {
  return {
    id: "pinned-exec-capture",
    generate: (prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve(makeGenerateResult("STATUS: COMPLETE\nSUMMARY: done"));
    },
  };
}

function executorFor(fx: Awaited<ReturnType<typeof planWithPinnedSkill>>, provider: IModelProvider): PlanExecutor {
  return new PlanExecutor(fx.env.config, provider, fx.env.db, fx.env.tempDir, new EventLogger({ db: fx.env.db }), {
    enableGit: false,
    generateReport: false,
    context: fx.applicationContext,
  });
}

Deno.test("[real execution] the executor sees the approved body after a live edit and journals plan_pinned rows", async () => {
  const fx = await planWithPinnedSkill();
  try {
    const pins = fx.frontmatter.resolved_skills as Array<{ name: string; revision_id: string }>;
    assertEquals(pins.map((pin) => pin.name), [SKILL], "planning pinned the named skill");
    await writeSkillFolder(fx.skillsDir, { name: SKILL, instructions: "Live body B." });

    const prompts: string[] = [];
    const executionTrace = crypto.randomUUID();
    await executorFor(fx, capturingProvider(prompts)).execute(`${fx.env.tempDir}/plan.md`, {
      trace_id: executionTrace,
      request_id: `request-${executionTrace.slice(0, 8)}`,
      agent_role: "default",
      frontmatter: fx.frontmatter as never,
      steps: [{ number: 1, title: "Review", content: "Do the task." }],
    });

    assertEquals(prompts.length, 1);
    assertStringIncludes(prompts[0], "Approved body A.");
    assertEquals(prompts[0].includes("Live body B."), false);
    const rows = await fx.usage(executionTrace);
    assertEquals(rows.map((row) => [row.skill_name, row.match_source, row.submission_kind]), [
      [SKILL, "plan_pinned", "provider"],
    ]);
    assertEquals(rows[0].revision_id, pins[0].revision_id);
    await fx.env.db.waitForFlush();
    const drift = await fx.env.db.queryActivity({ traceId: executionTrace, actionType: "skills.pin_drifted" });
    assertEquals(drift.length, 1, "the edit is reported as drift once");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("[security] a swapped pin or a missing snapshot runs nothing and writes no usage", async () => {
  const fx = await planWithPinnedSkill();
  try {
    const original = (fx.frontmatter.resolved_skills as JSONObject[])[0];
    const executionTrace = crypto.randomUUID();
    const prompts: string[] = [];
    const attempt = (pins: JSONValue) =>
      executorFor(fx, capturingProvider(prompts)).execute(`${fx.env.tempDir}/plan.md`, {
        trace_id: executionTrace,
        request_id: "req-swap",
        agent_role: "default",
        frontmatter: { ...fx.frontmatter, resolved_skills: pins } as never,
        steps: [{ number: 1, title: "Review", content: "Do the task." }],
      });
    await assertRejects(() => attempt([{ ...original, name: OTHER }]), SkillUnavailableError);
    await assertRejects(() => attempt([{ ...original, content_sha256: "e".repeat(64) }]), SkillUnavailableError);
    await assertRejects(() => attempt([{ ...original, revision_id: crypto.randomUUID() }]), SkillUnavailableError);
    await assertRejects(() => attempt([{ name: "broken" }]), SkillUnavailableError);
    assertEquals(prompts.length, 0);
    assertEquals((await fx.usage(executionTrace)).length, 0);
  } finally {
    await fx.cleanup();
  }
});

async function composerWithPortal(fx: Awaited<ReturnType<typeof planWithPinnedSkill>>, capabilities: string) {
  const portalPath = join(fx.env.tempDir, "portal-pinned");
  await Deno.mkdir(portalPath, { recursive: true });
  for (
    const args of [
      ["init", "-b", "main"],
      ["config", "user.name", "Test User"],
      ["config", "user.email", "test@example.com"],
    ]
  ) {
    await new Deno.Command("git", { args, cwd: portalPath, stdout: "null", stderr: "null" }).output();
  }
  await Deno.writeTextFile(join(portalPath, "README.md"), "# Test\n");
  await new Deno.Command("git", { args: ["add", "."], cwd: portalPath, stdout: "null" }).output();
  await new Deno.Command("git", { args: ["commit", "-m", "Initial"], cwd: portalPath, stdout: "null", stderr: "null" })
    .output();
  const portal: IPortalPermissions = {
    alias: "test",
    target_path: portalPath,
    default_branch: "main",
    agents_allowed: ["*"],
    operations: [],
  };
  const config = fx.env.config;
  config.portals = [portal];
  await Deno.writeTextFile(
    join(fx.env.tempDir, "Blueprints", "Agents", "pin-agent.md"),
    `---\nagent_role: pin-agent\nmodel: mock:test\ncapabilities: [${capabilities}]\n---\nYou are a pinned agent.\n`,
  );
  return { config, portal, portalPath };
}

Deno.test("[mcp] the typed pins reach the subprocess context and the stub dispatch records no usage", async () => {
  const fx = await planWithPinnedSkill();
  const processManager = new ProcessManager();
  Deno.env.set("EXAIX_AGENT_ENTRYPOINT", "tests/integration/agent/mock_agent.ts");
  try {
    const { config, portal } = await composerWithPortal(fx, "mcp");
    const logger = new EventLogger({ db: fx.env.db });
    const strategyRegistry = new StrategyRegistry();
    const composer = new AgentComposer({
      config,
      db: fx.env.db,
      logger,
      pathResolver: new PathResolver(config),
      permissions: new PortalPermissionsService([portal]),
      strategyRegistry,
      skills: fx.skills,
    });
    strategyRegistry.register(new McpAgentStrategy(composer, processManager));
    const pins = fx.frontmatter.resolved_skills as never;
    const trace = crypto.randomUUID();
    const result = await composer.executeStep(
      {
        trace_id: trace,
        request_id: "req-mcp",
        request: "echo_context",
        plan: "Echo",
        portal: "test",
        resolved_skills: pins,
      },
      { agent_role: "pin-agent", portal: "test", security_mode: SecurityMode.HYBRID, resolved_skills: pins },
    );
    const received = JSON.parse(result.description) as {
      context: { resolved_skills: Array<{ name: string }> };
      options: { resolved_skills: Array<{ name: string }> };
    };
    assertEquals(received.context.resolved_skills.map((pin) => pin.name), [SKILL]);
    assertEquals(received.options.resolved_skills.map((pin) => pin.name), [SKILL]);
    assertEquals((await fx.usage(trace)).length, 0, "an MCP dispatch makes no counted call");
  } finally {
    processManager.cleanup();
    Deno.env.delete("EXAIX_AGENT_ENTRYPOINT");
    await fx.cleanup();
  }
});

Deno.test("[cli] the delegate objective carries the approved body and the launch is recorded", async () => {
  const fx = await planWithPinnedSkill();
  try {
    await writeSkillFolder(fx.skillsDir, { name: SKILL, instructions: "Live body B." });
    const { config, portal } = await composerWithPortal(fx, "cli_delegate");
    const launches: string[][] = [];
    const composer = new AgentComposer({
      config,
      db: fx.env.db,
      logger: new EventLogger({ db: fx.env.db }),
      pathResolver: new PathResolver(config),
      permissions: new PortalPermissionsService([portal]),
      skills: fx.skills,
      cliDelegateBinding: { tool: "claude-code", model: "test-model" },
      cliDelegateRun: (_command, args) => {
        launches.push(args);
        return Promise.resolve({
          code: 0,
          stdout: [
            JSON.stringify({ type: "system", session_id: "ses_1" }),
            JSON.stringify({ type: "result", result: "done", usage: { input_tokens: 1, output_tokens: 1 } }),
          ].join("\n"),
          stderr: "",
        });
      },
    });
    const pins = fx.frontmatter.resolved_skills as never;
    const trace = crypto.randomUUID();
    await composer.executeStep(
      {
        trace_id: trace,
        request_id: "req-cli",
        request: "Do it",
        plan: "Step 1",
        portal: "test",
        resolved_skills: pins,
      },
      { agent_role: "pin-agent", portal: "test", security_mode: SecurityMode.HYBRID, resolved_skills: pins },
    );
    assertEquals(launches.length, 1);
    assertStringIncludes(launches[0][1], "Approved body A.");
    assertEquals(launches[0][1].includes("Live body B."), false);
    const rows = await fx.usage(trace);
    assertEquals(rows.map((row) => [row.skill_name, row.match_source, row.submission_kind]), [
      [SKILL, "plan_pinned", "cli_delegate"],
    ]);
    composer.dispose();
  } finally {
    await fx.cleanup();
  }
});
