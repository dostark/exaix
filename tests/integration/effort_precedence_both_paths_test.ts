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
import { TestEnvironment } from "./helpers/test_environment.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import { EFFORT_MAX_TOKENS } from "@exaix/ai";
import { AgentComposer, StrategyRegistry } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IChangesetResult } from "@exaix/schemas/agent_composer.ts";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { ExecutionStrategyName, MockStrategy, SecurityMode } from "@exaix/core";

const PLAN_RESPONSE = '<thought>ok</thought><content>{"subject":"Test","description":"A plan.",' +
  '"steps":[{"step":1,"title":"Step","description":"Do it."}]}</content>';

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
      // IAgentComposerOptions.requestDeclaration (Step 2 transport).
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
