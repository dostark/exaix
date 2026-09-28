/**
 * @module AgentComposerReactStrategyTest
 * @path packages/execution/tests/agent_composer_react_strategy_test.ts
 * @description Exercises ReAct strategy dispatch through AgentComposer and PlanExecutor.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_composer.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { AgentComposer, StrategyRegistry } from "@exaix/execution";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import type { IModelProvider, IProviderTurn } from "@exaix/ai/types.ts";
import { EventLogger } from "@exaix/core/logger";
import { PlanExecutor } from "@exaix/core/planning";
import {
  AGENT_EVENT_EXECUTION_COMPLETED,
  AGENT_EVENT_EXECUTION_FAILED,
  AGENT_EVENT_EXECUTION_STARTED,
  ExecutionStrategyName,
  PricingTier,
  ProviderCostTier,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  SecurityMode,
  ToolName,
} from "@exaix/core";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { initTestDbService } from "@exaix/testing";
import { createTestConfig } from "../../ai/tests/helpers/test_config.ts";

const PROVIDER_ID = "native-react-strategy-fixture";

async function git(cwd: string, ...args: string[]): Promise<void> {
  const result = await new Deno.Command("git", { cwd, args }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}

async function setup() {
  const dbFixture = await initTestDbService();
  const root = dbFixture.tempDir;
  const portal = join(root, "TestPortal");
  await Deno.mkdir(portal, { recursive: true });
  await Deno.mkdir(join(root, "Blueprints", "Agents"), { recursive: true });
  await git(portal, "init");
  await git(portal, "config", "user.name", "Test User");
  await git(portal, "config", "user.email", "test@example.invalid");
  await Deno.writeTextFile(join(portal, "README.md"), "# Portal\n");
  await git(portal, "add", "README.md");
  await git(portal, "commit", "-m", "initial");
  await Deno.writeTextFile(
    join(root, "Blueprints", "Agents", "test-agent.md"),
    "---\nmodel: test\nprovider: mock\ncapabilities: []\npermitted_tools: [read_file]\n---\nRead the portal.",
  );
  const config = createTestConfig();
  config.system.root = root;
  config.paths = { ...config.paths, blueprints: join(root, "Blueprints") };
  config.portals = [{
    alias: "TestPortal",
    target_path: portal,
    agents_allowed: ["*"],
    operations: ["read", "write", "git"],
  }] as never;
  return { ...dbFixture, config, portal };
}

Deno.test("capability-free blueprint uses one native ReAct loop with replay and usage", async () => {
  const fixture = await setup();
  ProviderRegistry.registerWithMetadata(PROVIDER_ID, new MockProviderFactory(), {
    name: PROVIDER_ID,
    description: "Cutover fixture",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
  });
  const calls: Array<{ tools?: Array<{ name: string }>; priorTurn?: IProviderTurn }> = [];
  const provider: IModelProvider = {
    id: PROVIDER_ID,
    generate: (_prompt, options) => {
      calls.push({ tools: options?.tools, priorTurn: options?.priorTurn });
      return Promise.resolve(
        calls.length === 1
          ? {
            content: "",
            toolCalls: [{ id: "call-1", name: ToolName.READ_FILE, input: { path: "README.md" }, type: "function" }],
            usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
            model: "test",
            provider: PROVIDER_ID,
            cost_usd: 0.01,
          }
          : {
            content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
            usage: { promptTokens: 11, completionTokens: 5, totalTokens: 16 },
            model: "test",
            provider: PROVIDER_ID,
            cost_usd: 0.02,
          },
      );
    },
  };
  const { config, db, cleanup } = fixture;
  const composer = new AgentComposer({
    config,
    db,
    logger: new EventLogger({ db }),
    pathResolver: new PathResolver(config),
    permissions: new PortalPermissionsService(config.portals),
    provider,
    toolRegistry: {
      getTools:
        () => [{ name: ToolName.READ_FILE, description: "Read", parameters: { type: "object", properties: {} } }],
      execute: () => Promise.resolve({ success: true, data: { content: "# Portal" } }),
      getBaseDir: () => fixture.portal,
    } as never,
  });
  const traceId = crypto.randomUUID();
  try {
    const result = await composer.executeStep(
      { trace_id: traceId, request_id: "request-1", request: "Read", plan: "Read the portal", portal: "TestPortal" },
      {
        portal: "TestPortal",
        agent_role: "test-agent",
        security_mode: SecurityMode.HYBRID,
        timeout_ms: 30000,
        max_tool_calls: 5,
        audit_enabled: true,
        native_tools_enabled: true,
      },
    );
    assertEquals(calls.length, 2);
    assertEquals(calls[0].tools?.map((tool) => tool.name), [ToolName.READ_FILE]);
    assertEquals(calls[1].priorTurn !== undefined, true);
    assertEquals(result.description, "done");
    assertEquals(result.tool_calls, 1);
    assertEquals(result.usage?.prompt_tokens, 18);
    assertEquals(result.usage?.completion_tokens, 8);
    const nextTraceId = crypto.randomUUID();
    const nextResult = await composer.executeStep(
      {
        trace_id: nextTraceId,
        request_id: "request-2",
        request: "Read again",
        plan: "Read the portal",
        portal: "TestPortal",
      },
      {
        portal: "TestPortal",
        agent_role: "test-agent",
        security_mode: SecurityMode.HYBRID,
        timeout_ms: 30000,
        max_tool_calls: 5,
        audit_enabled: true,
        native_tools_enabled: true,
      },
    );
    assertEquals(calls.length, 3);
    assertEquals(nextResult.description, "done");
    assertEquals(nextResult.tool_calls, 0);
    assertEquals(nextResult.usage?.prompt_tokens, 11);
    await db.waitForFlush();
    const started = await db.queryActivity({ traceId, actionType: AGENT_EVENT_EXECUTION_STARTED });
    const completed = await db.queryActivity({ traceId, actionType: AGENT_EVENT_EXECUTION_COMPLETED });
    assertEquals(started.length, 1);
    assertEquals(completed.length, 1);
    assertEquals(
      (await db.queryActivity({ traceId: nextTraceId, actionType: AGENT_EVENT_EXECUTION_COMPLETED })).length,
      1,
    );
  } finally {
    composer.dispose();
    await cleanup();
  }
});

Deno.test("ReAct is the default strategy while MCP and CLI precedence stays intact", async () => {
  const { config, db, cleanup } = await setup();
  const controlProviderId = "cutover-control-fixture";
  const selected: string[] = [];
  const registry = new StrategyRegistry();
  for (
    const name of [
      ExecutionStrategyName.REACT,
      ExecutionStrategyName.MCP,
      ExecutionStrategyName.CLI_DELEGATE,
    ]
  ) {
    registry.register({
      name,
      execute: () => {
        selected.push(name);
        return Promise.resolve({
          branch: `feat/${name}`,
          commit_sha: "",
          files_changed: [],
          description: name,
          tool_calls: 0,
          execution_time_ms: 1,
        });
      },
    });
  }
  const provider: IModelProvider = {
    id: controlProviderId,
    generate: () => {
      throw new Error("unexpected model call");
    },
  };
  const composer = new AgentComposer({
    config,
    db,
    logger: new EventLogger({ db }),
    pathResolver: new PathResolver(config),
    permissions: new PortalPermissionsService(config.portals),
    provider,
    strategyRegistry: registry,
  });
  const blueprintPath = join(config.paths.blueprints, "Agents", "test-agent.md");
  const run = async (native: boolean) => {
    const traceId = crypto.randomUUID();
    const result = await composer.executeStep(
      {
        trace_id: traceId,
        request_id: `request-${selected.length}`,
        request: "Read",
        plan: "Read",
        portal: "TestPortal",
      },
      {
        portal: "TestPortal",
        agent_role: "test-agent",
        security_mode: SecurityMode.HYBRID,
        timeout_ms: 30000,
        max_tool_calls: 5,
        audit_enabled: true,
        native_tools_enabled: native,
      },
    );
    await db.waitForFlush();
    const started = await db.queryActivity({ traceId, actionType: AGENT_EVENT_EXECUTION_STARTED });
    return { result, startPayload: JSON.parse(started[0].payload) };
  };
  try {
    const flagOff = await run(false);
    assertEquals(flagOff.result.description, ExecutionStrategyName.REACT);
    const noMetadata = await run(true);
    assertEquals(noMetadata.result.description, ExecutionStrategyName.REACT);
    ProviderRegistry.registerWithMetadata(controlProviderId, new MockProviderFactory(), {
      name: controlProviderId,
      description: "Cutover fixture",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      supportsNativeTools: true,
    });
    const routed = await run(true);
    assertEquals(routed.result.description, ExecutionStrategyName.REACT);
    await Deno.writeTextFile(blueprintPath, "---\nmodel: test\nprovider: mock\ncapabilities: [mcp]\n---\nRead.");
    assertEquals((await run(true)).result.description, ExecutionStrategyName.MCP);
    await Deno.writeTextFile(
      blueprintPath,
      "---\nmodel: test\nprovider: mock\ncapabilities: [cli_delegate]\n---\nRead.",
    );
    assertEquals((await run(true)).result.description, ExecutionStrategyName.CLI_DELEGATE);
    await Deno.writeTextFile(blueprintPath, "---\nmodel: test\nprovider: mock\ncapabilities: []\n---\nRead.");
    const noProviderComposer = new AgentComposer({
      config,
      db,
      logger: new EventLogger({ db }),
      pathResolver: new PathResolver(config),
      permissions: new PortalPermissionsService(config.portals),
      strategyRegistry: registry,
    });
    try {
      const noProvider = await noProviderComposer.executeStep(
        {
          trace_id: crypto.randomUUID(),
          request_id: "request-no-provider",
          request: "Read",
          plan: "Read",
          portal: "TestPortal",
        },
        {
          portal: "TestPortal",
          agent_role: "test-agent",
          security_mode: SecurityMode.HYBRID,
          timeout_ms: 30000,
          max_tool_calls: 5,
          audit_enabled: true,
          native_tools_enabled: true,
        },
      );
      assertEquals(noProvider.description, ExecutionStrategyName.REACT);
    } finally {
      noProviderComposer.dispose();
    }
    assertEquals(selected, [
      ExecutionStrategyName.REACT,
      ExecutionStrategyName.REACT,
      ExecutionStrategyName.REACT,
      ExecutionStrategyName.MCP,
      ExecutionStrategyName.CLI_DELEGATE,
      ExecutionStrategyName.REACT,
    ]);
  } finally {
    composer.dispose();
    await cleanup();
  }
});

Deno.test("failed native ReAct request does not retry through a text path", async () => {
  const { config, db, cleanup } = await setup();
  ProviderRegistry.registerWithMetadata(PROVIDER_ID, new MockProviderFactory(), {
    name: PROVIDER_ID,
    description: "Cutover fixture",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
  });
  let calls = 0;
  const provider: IModelProvider = {
    id: PROVIDER_ID,
    generate: () => {
      calls++;
      throw new Error("native request failed");
    },
  };
  const composer = new AgentComposer({
    config,
    db,
    logger: new EventLogger({ db }),
    pathResolver: new PathResolver(config),
    permissions: new PortalPermissionsService(config.portals),
    provider,
  });
  const traceId = crypto.randomUUID();
  try {
    await assertRejects(
      () =>
        composer.executeStep(
          { trace_id: traceId, request_id: "request-failure", request: "Read", plan: "Read", portal: "TestPortal" },
          {
            portal: "TestPortal",
            agent_role: "test-agent",
            security_mode: SecurityMode.HYBRID,
            timeout_ms: 30000,
            max_tool_calls: 5,
            audit_enabled: true,
            native_tools_enabled: true,
          },
        ),
      Error,
      "native request failed",
    );
    assertEquals(calls, 1);
    await db.waitForFlush();
    assertEquals((await db.queryActivity({ traceId, actionType: AGENT_EVENT_EXECUTION_STARTED })).length, 1);
    assertEquals((await db.queryActivity({ traceId, actionType: AGENT_EVENT_EXECUTION_FAILED })).length, 1);
    assertEquals((await db.queryActivity({ traceId, actionType: AGENT_EVENT_EXECUTION_COMPLETED })).length, 0);
  } finally {
    composer.dispose();
    await cleanup();
  }
});

Deno.test("PlanExecutor passes configured native flag to ReAct execution", async () => {
  const { config, db, portal, cleanup } = await setup();
  config.execution = { ...config.execution, native_tools_enabled: true };
  ProviderRegistry.registerWithMetadata(PROVIDER_ID, new MockProviderFactory(), {
    name: PROVIDER_ID,
    description: "Cutover fixture",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
  });
  let calls = 0;
  const nativeToolNames: string[][] = [];
  const provider: IModelProvider = {
    id: PROVIDER_ID,
    generate: (_prompt, options) => {
      calls++;
      nativeToolNames.push((options?.tools ?? []).map((tool) => tool.name));
      return Promise.resolve({
        content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
        usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
        model: "test",
        provider: PROVIDER_ID,
        cost_usd: 0.01,
      });
    },
  };
  const logger = new EventLogger({ db });
  const executor = new PlanExecutor(config, provider, db, portal, logger, { enableGit: false, generateReport: false });
  const traceId = crypto.randomUUID();
  try {
    await executor.execute(join(portal, "plan.md"), {
      trace_id: traceId,
      request_id: "request-plan-cutover",
      agent_role: "test-agent",
      frontmatter: { portal: "TestPortal" },
      steps: [{ number: 1, title: "Read", content: "Read the portal" }],
    } as never);
    assertEquals(calls, 1);
    assertEquals(nativeToolNames[0].includes(ToolName.READ_FILE), true);
    await db.waitForFlush();
    const started = await db.queryActivity({ traceId, actionType: AGENT_EVENT_EXECUTION_STARTED });
    assertEquals(started.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("capability-free blueprint denies a native tool outside its role scope", async () => {
  const { config, db, portal, cleanup } = await setup();
  ProviderRegistry.registerWithMetadata(PROVIDER_ID, new MockProviderFactory(), {
    name: PROVIDER_ID,
    description: "Cutover fixture",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
  });
  let providerCalls = 0;
  let toolExecutions = 0;
  const provider: IModelProvider = {
    id: PROVIDER_ID,
    generate: () => {
      providerCalls++;
      return Promise.resolve({
        content: providerCalls === 1 ? "" : `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
        ...(providerCalls === 1
          ? {
            toolCalls: [{
              id: "denied-1",
              name: ToolName.WRITE_FILE,
              input: { path: "README.md", content: "changed" },
              type: "function" as const,
            }],
          }
          : {}),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: "test",
        provider: PROVIDER_ID,
        cost_usd: 0.01,
      });
    },
  };
  const composer = new AgentComposer({
    config,
    db,
    logger: new EventLogger({ db }),
    pathResolver: new PathResolver(config),
    permissions: new PortalPermissionsService(config.portals),
    provider,
    toolRegistry: {
      getTools:
        () => [{ name: ToolName.READ_FILE, description: "Read", parameters: { type: "object", properties: {} } }, {
          name: ToolName.WRITE_FILE,
          description: "Write",
          parameters: { type: "object", properties: {} },
        }],
      execute: () => {
        toolExecutions++;
        return Promise.resolve({ success: true });
      },
      getBaseDir: () => portal,
    } as never,
  });
  try {
    const result = await composer.executeStep(
      {
        trace_id: crypto.randomUUID(),
        request_id: "request-denied",
        request: "Read",
        plan: "Read",
        portal: "TestPortal",
      },
      {
        portal: "TestPortal",
        agent_role: "test-agent",
        security_mode: SecurityMode.HYBRID,
        timeout_ms: 30000,
        max_tool_calls: 5,
        audit_enabled: true,
        native_tools_enabled: true,
      },
    );
    assertEquals(providerCalls, 2);
    assertEquals(toolExecutions, 0);
    assertEquals(result.description, "done");
    assertEquals(await Deno.readTextFile(join(portal, "README.md")), "# Portal\n");
  } finally {
    composer.dispose();
    await cleanup();
  }
});

Deno.test("flag-off and incapable providers use the one-turn ReAct path", async () => {
  const { config, db, cleanup } = await setup();
  ProviderRegistry.registerWithMetadata(PROVIDER_ID, new MockProviderFactory(), {
    name: PROVIDER_ID,
    description: "Cutover fixture",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
  });
  try {
    for (const [id, nativeEnabled] of [[PROVIDER_ID, false], ["incapable-cutover-fixture", true]] as const) {
      let calls = 0;
      const provider: IModelProvider = {
        id,
        generate: () => {
          calls++;
          return Promise.resolve({
            content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}react result`,
            usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
            model: "test",
            provider: id,
            cost_usd: 0.02,
          });
        },
      };
      const composer = new AgentComposer({
        config,
        db,
        logger: new EventLogger({ db }),
        pathResolver: new PathResolver(config),
        permissions: new PortalPermissionsService(config.portals),
        provider,
      });
      const traceId = crypto.randomUUID();
      try {
        const result = await composer.executeStep(
          { trace_id: traceId, request_id: `request-${id}`, request: "Read", plan: "Read", portal: "TestPortal" },
          {
            portal: "TestPortal",
            agent_role: "test-agent",
            security_mode: SecurityMode.HYBRID,
            timeout_ms: 30000,
            max_tool_calls: 5,
            audit_enabled: true,
            native_tools_enabled: nativeEnabled,
          },
        );
        assertEquals(calls, 1);
        assertEquals(result.description, "react result");
        assertEquals(result.usage?.prompt_tokens, 4);
        assertEquals(result.usage?.completion_tokens, 2);
      } finally {
        composer.dispose();
      }
    }
  } finally {
    await cleanup();
  }
});
