/**
 * @module EffortPrecedenceBothPathsTest
 * @path tests/integration/effort_precedence_both_paths_test.ts
 * @description GAP-15's both-paths integration proof for phase-197 Step 2: with one
 *   request fixture declaring `effort: high` and a blueprint declaring `effort: low`, the
 *   REQUEST-level value wins on BOTH paths — (1) plan generation through a real
 *   RequestProcessor + AgentRunner observes `effort === "high"` at the planning provider
 *   call, and (2) the execution path resolves the PlanExecutor-threaded requestDeclaration
 *   the same way through a real AgentComposer, restoring EFFORT_MAX_TOKENS from the final
 *   tier. The execution harness uses a stub strategy to observe the resolved call options
 *   (the resolution happens in executeStep before strategy dispatch).
 * @architectural-layer Integration
 * @related-files [packages/request/src/processor.ts, packages/execution/src/agent_runner.ts, packages/execution/src/agent_composer.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { TestEnvironment } from "./helpers/test_environment.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import { EFFORT_MAX_TOKENS } from "@exaix/ai";
import { AgentComposer, AgentRunner, StrategyRegistry } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IChangesetResult } from "@exaix/schemas/agent_composer.ts";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { ExecutionStrategyName, MockStrategy, SecurityMode } from "@exaix/core";
import { RequestProcessor } from "@exaix/request";
import { PlanExecutor } from "@exaix/core/planning";
import { SkillsService } from "@exaix/core/skills";
import { buildSkillsIndex } from "../../scripts/build_skills_index.ts";
import { createStubConfig, createStubDisplay, createStubGit, REPO_ROOT } from "@exaix/testing";

const PLAN_RESPONSE = '<thought>ok</thought><content>{"subject":"Test","description":"A plan.",' +
  '"steps":[{"step":1,"title":"Step","description":"Do it."}]}</content>';

const FLOOR_SKILL_ID = "response-contract-security-analysis";

Deno.test("[integration] request effort high beats blueprint effort low on the planning call", async () => {
  const env = await TestEnvironment.create({
    initGit: false,
    configOverrides: { request_analysis: { mode: "heuristic" } } as never,
  });
  try {
    const blueprintPath = join(env.tempDir, "Blueprints", "Agents", "default.md");
    await Deno.writeTextFile(
      blueprintPath,
      "---\nagent_role: default\nmodel: mock:test\neffort: low\n---\nYou are a helpful assistant.\n",
    );

    const recordings = [{
      promptHash: ".*",
      promptPreview: "You are a helpful assistant.",
      response: PLAN_RESPONSE,
      model: "test",
      tokens: { input: 0, output: 0 },
      recordedAt: new Date().toISOString(),
    }];
    const { provider, processor } = env.createRequestProcessor({
      providerMode: MockStrategy.RECORDED,
      recordings,
    });
    // Rebind the wrapper over the provider instance the processor+runner share.
    const observedOptions: IModelOptions[] = [];
    const original = provider.generate.bind(provider);
    provider.generate = (prompt: string, opts?: IModelOptions) => {
      observedOptions.push(opts ?? {});
      return original(prompt, opts);
    };

    const traceId = crypto.randomUUID();
    const requestPath = join(
      env.tempDir,
      "Workspace",
      "Requests",
      `request-${traceId.slice(0, 8)}.md`,
    );
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
subject: "Effort Precedence"
effort: high
---
# Request
Implement the feature.
`,
    );
    const planPath = await processor.process(requestPath);
    assert(planPath, "planning must produce a plan path");

    const planningEffort = observedOptions.map((o) => o.effort).find((e) => e !== undefined);
    assertEquals(planningEffort, "high", "the request-level effort must reach the planning generate()");

    const planContent = await Deno.readTextFile(String(planPath));
    assert(
      planContent.includes("request_effort_declaration"),
      "the written plan must persist the request effort declaration passthrough",
    );
  } finally {
    await env.cleanup();
  }
});

Deno.test("[integration] executing the plan's requestDeclaration through AgentComposer also resolves high", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    const blueprintPath = join(env.tempDir, "Blueprints", "Agents", "default.md");
    await Deno.writeTextFile(
      blueprintPath,
      "---\nagent_role: default\nmodel: mock:test\neffort: low\n---\nYou are a helpful assistant.\n",
    );

    const config = env.config;
    config.system.root = env.tempDir;
    config.portals = [{ alias: "TestPortal", target_path: env.tempDir, operations: [] }] as never;

    let capturedCallOptions: IModelOptions | undefined;
    const stub: {
      name: string;
      callOptions?: IModelOptions;
      execute: (
        _blueprint: IAgentFileBlueprint,
        _context: IExecutionContext,
        _options: IAgentExecutionOptions,
      ) => Promise<IChangesetResult>;
    } = {
      name: ExecutionStrategyName.LEGACY,
      callOptions: {},
      execute: () => {
        capturedCallOptions = stub.callOptions;
        return Promise.resolve({
          branch: "feat/effort",
          commit_sha: "0000000000000000000000000000000000000000",
          files_changed: [],
          description: "Done",
          tool_calls: 0,
          execution_time_ms: 1,
        } as IChangesetResult);
      },
    };
    const strategyRegistry = new StrategyRegistry();
    strategyRegistry.register(stub as never);

    const logger = new EventLogger({ db: env.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService(config.portals as never);
    const composer = new AgentComposer({
      config,
      db: env.db,
      logger,
      pathResolver,
      permissions,
      strategyRegistry,
      // ExecutionLoop threads the plan's request_effort_declaration into
      // IAgentComposerOptions.requestDeclaration (the execution-path transport).
      options: { requestDeclaration: { effort: "high" } },
    });

    const context: IExecutionContext = {
      trace_id: crypto.randomUUID(),
      request_id: "effort-both",
      request: "Implement the feature",
      plan: "Implement the feature",
      portal: "TestPortal",
    } as never;
    const options: IAgentExecutionOptions = {
      portal: "TestPortal",
      agent_role: "default",
      security_mode: SecurityMode.HYBRID,
      timeout_ms: 30000,
      max_tool_calls: 5,
      audit_enabled: true,
    } as IAgentExecutionOptions;

    await composer.executeStep(context, options);
    assertEquals(capturedCallOptions?.effort, "high");
    assertEquals(capturedCallOptions?.max_tokens, EFFORT_MAX_TOKENS.high);
    composer.dispose();
  } finally {
    await env.cleanup();
  }
});

Deno.test("[integration] a pinned floor-bearing skill resolves medium on both plan generation and step execution", async () => {
  // The planning run's final resolved skill set is persisted to the plan frontmatter
  // (resolved_skill_ids) and the execution path reads it, so --skills pins survive the
  // plan→execution hand-off even when the skill's triggers never match the subject.
  const env = await TestEnvironment.create({
    initGit: false,
    configOverrides: { request_analysis: { mode: "heuristic" } } as never,
  });
  const root = await Deno.makeTempDir({ prefix: "effort-pinned-skill-" });
  try {
    const memoryDir = join(root, "Memory");
    const targetSkillsDir = join(memoryDir, "Skills");
    const generated = await buildSkillsIndex(join(REPO_ROOT, "Blueprints", "Skills"), targetSkillsDir, root);
    if (!generated.success) throw new Error(`buildSkillsIndex failed: ${generated.errors.join("; ")}`);
    const skillsService = new SkillsService({ memoryDir }, env.db);
    await skillsService.initialize();
    const getSkillCalls: string[] = [];
    const originalGetSkill = skillsService.getSkill.bind(skillsService);
    skillsService.getSkill = (skillId: string) => {
      getSkillCalls.push(skillId);
      return originalGetSkill(skillId);
    };

    const blueprintPath = join(env.tempDir, "Blueprints", "Agents", "default.md");
    await Deno.writeTextFile(
      blueprintPath,
      "---\nagent_role: default\nmodel: mock:test\n---\nYou are a helpful assistant.\n",
    );

    const recordings = [{
      promptHash: ".*",
      promptPreview: "You are a helpful assistant.",
      response: PLAN_RESPONSE,
      model: "test",
      tokens: { input: 0, output: 0 },
      recordedAt: new Date().toISOString(),
    }];
    const provider = env.createMockProvider(MockStrategy.RECORDED, recordings);
    const planningOptions: IModelOptions[] = [];
    const original = provider.generate.bind(provider);
    provider.generate = (prompt: string, opts?: IModelOptions) => {
      planningOptions.push(opts ?? {});
      return original(prompt, opts);
    };

    const applicationContext = {
      config: createStubConfig(env.config),
      db: env.db,
      provider,
      git: createStubGit(),
      display: createStubDisplay(env.db),
      skills: skillsService,
    } as never;
    const processor = new RequestProcessor({
      workspacePath: join(env.tempDir, "Workspace"),
      requestsDir: join(env.tempDir, "Workspace", "Requests"),
      blueprintsPath: join(env.tempDir, "Blueprints", "Agents"),
      includeReasoning: true,
      context: applicationContext,
      testProvider: provider,
      agentRunner: new AgentRunner(provider, { skillsService, disableRetry: true }),
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
subject: "Pinned Skill Floor"
skills: ["${FLOOR_SKILL_ID}"]
---
# Request
Review the response contract for injection risks and fix the login handler.
`,
    );
    const planPath = await processor.process(requestPath);
    assert(planPath, "planning must produce a plan path");

    const planningEffort = planningOptions.map((o) => o.effort).find((e) => e !== undefined);
    assertEquals(planningEffort, "medium", "the pinned skill floor must raise plan generation to medium");

    const planContent = await Deno.readTextFile(String(planPath));
    assert(
      planContent.includes("resolved_skill_ids"),
      "the written plan must persist the final resolved skill id set",
    );

    // Execution path: thread the written plan's frontmatter exactly as ExecutionLoop does
    // and drive a real PlanExecutor (frontmatter carries resolved_skill_ids + request
    // effort declaration; context reuses the same floor-bearing SkillsService).
    const planFrontmatter = parseYaml((planContent.match(/^---\n([\s\S]*?)\n---/) ?? [])[1] ?? "") as never;
    const config = env.config;

    const executionProvider = env.createMockProvider(MockStrategy.RECORDED, [{
      promptHash: "execution-step",
      promptPreview: "You are a helpful assistant.",
      response: "<thought>ok</thought><content>done</content>",
      model: "test",
      tokens: { input: 0, output: 0 },
      recordedAt: new Date().toISOString(),
    }]);

    const executor = new PlanExecutor(
      config,
      executionProvider,
      env.db,
      env.tempDir,
      new EventLogger({ db: env.db }),
      {
        enableGit: false,
        generateReport: false,
        context: applicationContext,
      },
    );
    const stepTraceId = crypto.randomUUID();
    await executor.execute(`${env.tempDir}/plan.md`, {
      trace_id: stepTraceId,
      request_id: `request-${stepTraceId.slice(0, 8)}`,
      agent_role: "default",
      frontmatter: planFrontmatter,
      steps: [{ number: 1, title: "Review", content: "Do the task." }],
    } as never);

    assertEquals(
      getSkillCalls.includes(FLOOR_SKILL_ID),
      true,
      "the execution path must consult the persisted resolved_skill_ids via getSkill",
    );
    await env.db.waitForFlush();
    const effortRows = await env.db.queryActivity({ traceId: stepTraceId, actionType: "agent.effort_resolved" });
    assertEquals(effortRows.length >= 1, true, "the execution path must journal its resolution");
    const executedPayload = JSON.parse(effortRows[0].payload) as { effort?: string; effort_basis: string };
    assertEquals(
      executedPayload.effort,
      "medium",
      "a once-pinned floor-bearing skill must resolve the same tier on step execution",
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
    await env.cleanup();
  }
});
