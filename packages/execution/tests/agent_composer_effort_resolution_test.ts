/**
 * @module AgentComposerEffortResolutionTest
 * @path packages/execution/tests/agent_composer_effort_resolution_test.ts
 * @description Verifies AgentComposer.executeStep resolves declaration-time effort/thinking
 *   AFTER ModelResolver (whose intent never carries "auto" — spy) and rebuilds
 *   _resolvedCallOptions from the resolution: a request-level concrete effort overrides the
 *   blueprint and restores EFFORT_MAX_TOKENS from the final tier, an "auto" request effort
 *   resolves heuristically from the persisted request_analysis complexity without touching
 *   max_tokens, and thinking auto never reaches the ModelResolver intent (GAP-3, GAP-8).
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/blueprint_service.ts, packages/ai/src/effort_resolver.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { initTestDbService, REPO_ROOT } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { AgentComposer, StrategyRegistry } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import { ExecutionStrategyName, SecurityMode } from "@exaix/core";
import type { IResolvedModel, ModelResolver } from "@exaix/ai";
import type { IModelIntent } from "@exaix/schemas";
import { type IRequestAnalysis, RequestAnalysisComplexity } from "@exaix/schemas/request_analysis.ts";
import { EFFORT_MAX_TOKENS } from "@exaix/ai";
import type { IModelCallOptions } from "@exaix/schemas";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import type { IChangesetResult } from "@exaix/schemas/agent_composer.ts";
import { ProviderCallPolicyError, ProviderFactoryError } from "@exaix/ai/errors.ts";
import { AGENT_EVENT_EXECUTION_FAILED } from "@exaix/core";

function makeCapturingResolver(): {
  resolver: ModelResolver;
  captured: IModelIntent[];
} {
  const captured: IModelIntent[] = [];
  const resolver = {
    resolve: (intent: IModelIntent): Promise<IResolvedModel> => {
      captured.push(intent);
      return Promise.resolve({ provider: "mock", model: "test", attempt: 1, options: {} as never });
    },
  } as object as ModelResolver;
  return { resolver, captured };
}

async function setup(): Promise<{
  testDir: string;
  cleanup: () => Promise<void>;
}> {
  const testDir = await Deno.makeTempDir({ prefix: "ac-effort-" });
  await Deno.mkdir(join(testDir, "Blueprints", "Agents"), { recursive: true });
  await Deno.writeTextFile(
    join(testDir, "Blueprints", "Agents", "test-agent.md"),
    "---\nagent_role: test-agent\nname: Test\nmodel: mock:test\neffort: low\n---\nYou are a test agent.\n",
  );
  const cleanup = () => Deno.remove(testDir, { recursive: true }).catch(() => {});
  return { testDir, cleanup };
}

function makeOptions(portalAlias: string): IAgentExecutionOptions {
  return {
    portal: portalAlias,
    agent_role: "test-agent",
    security_mode: SecurityMode.HYBRID,
    timeout_ms: 30000,
    max_tool_calls: 5,
    audit_enabled: true,
  } as IAgentExecutionOptions;
}

function makeContext(_repoPath: string): IExecutionContext {
  return {
    trace_id: crypto.randomUUID(),
    request_id: "effort-req",
    request: "Implement the feature",
    plan: "Implement the feature",
    portal: "TestPortal",
  } as never;
}

function makeStubStrategy(name: string = ExecutionStrategyName.LEGACY) {
  let capturedCallOptions: IModelCallOptions | undefined;
  const stub: {
    name: string;
    callOptions?: IModelCallOptions;
    execute: (
      _blueprint: IAgentFileBlueprint,
      _context: IExecutionContext,
      _options: IAgentExecutionOptions,
    ) => Promise<IChangesetResult>;
  } = {
    name,
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
  return { strategyRegistry, getCallOptions: () => capturedCallOptions };
}

Deno.test("AgentComposer projects real role effort onto compatible capabilities and rejects concrete overrides before strategy execution", async () => {
  const { db, cleanup } = await initTestDbService();
  const { testDir, cleanup: dirCleanup } = await setup();
  try {
    for (const [role, effort] of [["senior-coder", "high"], ["code-reviewer", "low"]] as const) {
      await Deno.copyFile(
        join(REPO_ROOT, "Blueprints", "Agents", `${role}.md`),
        join(testDir, "Blueprints", "Agents", `${role}.md`),
      );
      for (const override of ["role", "request", "flow"] as const) {
        const config = createTestConfig();
        config.system.root = testDir;
        config.portals = [{ alias: "TestPortal", target_path: testDir, operations: [] }] as never;
        const { resolver } = makeCapturingResolver();
        const { strategyRegistry, getCallOptions } = makeStubStrategy(ExecutionStrategyName.REACT);
        const composer = new AgentComposer({
          config,
          db,
          logger: new EventLogger({ db }),
          pathResolver: new PathResolver(config),
          permissions: new PortalPermissionsService(config.portals as never),
          strategyRegistry,
          modelResolver: resolver,
          provider: {
            id: "openai-chat-fixture",
            callCapabilities: { profile: "openai", supportsThinking: false, supportedEffortTiers: [] },
            generate: () => {
              throw new Error("unexpected provider call");
            },
          },
          options: override === "request" ? { requestDeclaration: { effort: "high" } } : undefined,
        });
        try {
          const context = makeContext(testDir);
          const options = {
            ...makeOptions("TestPortal"),
            agent_role: role,
            ...(override === "flow" ? { effort: "high" as const } : {}),
          };
          if (override === "role") {
            await composer.executeStep(context, options);
            assertEquals(getCallOptions()?.effort, undefined);
            assertEquals(getCallOptions()?.thinking, undefined);
            assertEquals(getCallOptions()?.max_tokens, EFFORT_MAX_TOKENS[effort]);
          } else {
            const error = await assertRejects(() => composer.executeStep(context, options), ProviderCallPolicyError);
            assertEquals(error.reasonCode, "unsupported_call_option");
            assertEquals(getCallOptions(), undefined);
            await db.waitForFlush();
            const rows = await db.queryActivity({
              traceId: context.trace_id,
              actionType: AGENT_EVENT_EXECUTION_FAILED,
            });
            assertEquals(rows.length, 1);
            assertEquals(JSON.parse(rows[0].payload).providerReasonCode, "unsupported_call_option");
          }
        } finally {
          composer.dispose();
        }
      }
    }
  } finally {
    await dirCleanup();
    await cleanup();
  }
});

Deno.test("AgentComposer preserves a pre-generation factory rejection and records one correlated terminal event", async () => {
  const { db, cleanup } = await initTestDbService();
  const { testDir, cleanup: dirCleanup } = await setup();
  let composer: AgentComposer | undefined;
  try {
    const config = createTestConfig();
    config.system.root = testDir;
    config.portals = [{ alias: "TestPortal", target_path: testDir, operations: [] }] as never;
    const failure = new ProviderFactoryError("Compatible profile is not qualified", "profile_mismatch");
    const resolver = { resolve: () => Promise.reject(failure) } as object as ModelResolver;
    const { strategyRegistry, getCallOptions } = makeStubStrategy();
    composer = new AgentComposer({
      config,
      db,
      logger: new EventLogger({ db }),
      pathResolver: new PathResolver(config),
      permissions: new PortalPermissionsService(config.portals as never),
      strategyRegistry,
      modelResolver: resolver,
    });
    const context = makeContext(testDir);
    const error = await assertRejects(() => composer!.executeStep(context, makeOptions("TestPortal")));
    assertEquals(error, failure);
    assertEquals(getCallOptions(), undefined);
    await db.waitForFlush();
    const events = await db.preparedAll<{ trace_id: string; payload: string }>(
      "SELECT trace_id, payload FROM activity WHERE action_type = ?",
      [AGENT_EVENT_EXECUTION_FAILED],
    );
    assertEquals(events.length, 1);
    assertEquals(events[0].trace_id, context.trace_id);
    assertEquals(JSON.parse(events[0].payload).providerReasonCode, "profile_mismatch");
  } finally {
    composer?.dispose();
    await dirCleanup();
    await cleanup();
  }
});

Deno.test("AgentComposer.executeStep: request effort high overrides blueprint low and restores max_tokens from the final tier", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const { testDir, cleanup: dirCleanup } = await setup();
    try {
      const config = createTestConfig();
      config.system.root = testDir;
      config.portals = [{ alias: "TestPortal", target_path: testDir, operations: [] }] as never;

      const { resolver, captured } = makeCapturingResolver();
      const logger = new EventLogger({ db });
      const pathResolver = new PathResolver(config);
      const permissions = new PortalPermissionsService(config.portals as never);
      const { strategyRegistry, getCallOptions } = makeStubStrategy();
      const composer = new AgentComposer({
        config,
        db,
        logger,
        pathResolver,
        permissions,
        strategyRegistry,
        modelResolver: resolver,
        options: { requestDeclaration: { effort: "high" } },
      });

      const result = await composer.executeStep(makeContext(testDir), makeOptions("TestPortal"));
      assertEquals(result.description, "Done");
      assertEquals(getCallOptions()?.effort, "high");
      assertEquals(getCallOptions()?.max_tokens, EFFORT_MAX_TOKENS.high);
      assertEquals(captured[0].effort, "low", "the intent reaches ModelResolver with concrete values only");
      composer.dispose();
    } finally {
      await dirCleanup();
    }
  } finally {
    await cleanup();
  }
});

Deno.test("AgentComposer.executeStep: effort auto + request_analysis complexity simple resolves low without max_tokens", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const { testDir, cleanup: dirCleanup } = await setup();
    try {
      const config = createTestConfig();
      config.system.root = testDir;
      config.portals = [{ alias: "TestPortal", target_path: testDir, operations: [] }] as never;

      const { resolver } = makeCapturingResolver();
      const logger = new EventLogger({ db });
      const pathResolver = new PathResolver(config);
      const permissions = new PortalPermissionsService(config.portals as never);
      const { strategyRegistry, getCallOptions } = makeStubStrategy();
      const composer = new AgentComposer({
        config,
        db,
        logger,
        pathResolver,
        permissions,
        strategyRegistry,
        modelResolver: resolver,
        options: { requestDeclaration: { effort: "auto" } },
      });

      const analysis: IRequestAnalysis = {
        complexity: RequestAnalysisComplexity.SIMPLE,
      } as IRequestAnalysis;
      const options: IAgentExecutionOptions = {
        ...makeOptions("TestPortal"),
        request_analysis: analysis as never,
      };
      await composer.executeStep(makeContext(testDir), options);

      assertEquals(getCallOptions()?.effort, "low");
      assertEquals(getCallOptions()?.max_tokens, undefined, "auto-resolved effort must not set max_tokens");
      composer.dispose();
    } finally {
      await dirCleanup();
    }
  } finally {
    await cleanup();
  }
});

Deno.test("AgentComposer.executeStep: thinking auto never appears in the ModelResolver intent", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const { testDir, cleanup: dirCleanup } = await setup();
    try {
      const config = createTestConfig();
      config.system.root = testDir;
      config.portals = [{ alias: "TestPortal", target_path: testDir, operations: [] }] as never;

      const { resolver, captured } = makeCapturingResolver();
      const logger = new EventLogger({ db });
      const pathResolver = new PathResolver(config);
      const permissions = new PortalPermissionsService(config.portals as never);
      const { strategyRegistry } = makeStubStrategy();
      const composer = new AgentComposer({
        config,
        db,
        logger,
        pathResolver,
        permissions,
        strategyRegistry,
        modelResolver: resolver,
        options: { requestDeclaration: { thinking: "auto" } },
      });

      await composer.executeStep(makeContext(testDir), makeOptions("TestPortal"));

      assertEquals(captured[0].thinking, undefined, "the intent must not carry declaration-time auto");
      composer.dispose();
    } finally {
      await dirCleanup();
    }
  } finally {
    await cleanup();
  }
});

Deno.test("AgentComposer.executeStep: a failsafe blueprint thinking false sends thinking false and applies no thinking constraint", async () => {
  // GAP-6 (Step 13): on main, `thinking: false` arrived from failsafe YAML as the truthy
  // string "false", so the intent carried `thinking: true`. The declaration preprocess now
  // maps it to boolean false: the execution path sends `thinking: false` (Anthropic
  // {type:"disabled"}) and no longer forces thinking-capable provider selection.
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir({ prefix: "ac-effort-thinking-false-" });
    await Deno.mkdir(join(testDir, "Blueprints", "Agents"), { recursive: true });
    await Deno.writeTextFile(
      join(testDir, "Blueprints", "Agents", "test-agent.md"),
      "---\nagent_role: test-agent\nname: Test\nmodel: mock:test\nthinking: false\n---\nYou are a test agent.\n",
    );
    try {
      const config = createTestConfig();
      config.system.root = testDir;
      config.portals = [{ alias: "TestPortal", target_path: testDir, operations: [] }] as never;

      const { resolver, captured } = makeCapturingResolver();
      const logger = new EventLogger({ db });
      const pathResolver = new PathResolver(config);
      const permissions = new PortalPermissionsService(config.portals as never);
      const { strategyRegistry, getCallOptions } = makeStubStrategy();
      const composer = new AgentComposer({
        config,
        db,
        logger,
        pathResolver,
        permissions,
        strategyRegistry,
        modelResolver: resolver,
      });

      await composer.executeStep(makeContext(testDir), makeOptions("TestPortal"));

      assertEquals(
        captured[0].thinking,
        false,
        "a failsafe 'false' string must read as boolean false, not a truthy thinking",
      );
      assertEquals(getCallOptions()?.thinking, false, "the execution path must send thinking false");
      composer.dispose();
    } finally {
      await Deno.remove(testDir, { recursive: true }).catch(() => {});
    }
  } finally {
    await cleanup();
  }
});
