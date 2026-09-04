#!/usr/bin/env -S deno run --allow-all
/**
 * @module RunSoloRelationshipAgent
 * @path tests/scenario_framework/scripts/run_solo_relationship_agent.ts
 * @description Phase 175 Step 6 integration driver: loads the shipped code-analyst
 *   blueprint, runs the real Solo ReActLoopStrategy against a real ToolRegistry and
 *   the scenario's persisted portal knowledge, and requires the tool result to reach
 *   the agent's next turn before it may complete.
 * @architectural-layer Test
 * @dependencies [packages/execution, packages/tool-runtime, packages/portal]
 * @related-files [tests/scenario_framework/scenarios/portal_knowledge/portal-knowledge-strategies.yaml]
 */

import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import {
  PortalOperation,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  REACT_THOUGHT_PREFIX,
  SecurityMode,
  ToolName,
} from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import type { IApplicationContext, IPortalKnowledgeService } from "@exaix/core/types";
import {
  BlueprintService,
  ExecutionContextService,
  OutputParser,
  ReActLoopAdapter,
  ReActLoopStrategy,
} from "@exaix/execution";
import { ToolRegistry } from "@exaix/tool-runtime";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { PortalKnowledgeSchema } from "@exaix/schemas/portal_knowledge.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import { createStubConfig, createStubDisplay, createStubGit, initTestDbService } from "@exaix/testing";
import { join } from "@std/path";

const CODE_ANALYST_ID = "code-analyst";
const EXPECTED_FROM = "packages/ai-ollama/mod.ts";
const EXPECTED_TARGET = "packages/ai-ollama/src/ollama_provider.ts";
const MAX_TOOL_CALLS = 3;
const EXECUTION_TIMEOUT_MS = 120_000;

class SnapshotPortalKnowledgeService implements IPortalKnowledgeService {
  constructor(private readonly knowledge: IPortalKnowledge) {}

  analyze(): Promise<IPortalKnowledge> {
    return Promise.resolve(this.knowledge);
  }

  getOrAnalyze(): Promise<IPortalKnowledge> {
    return Promise.resolve(this.knowledge);
  }

  isStale(): Promise<boolean> {
    return Promise.resolve(false);
  }

  updateKnowledge(): Promise<IPortalKnowledge> {
    return Promise.resolve(this.knowledge);
  }

  getRelevantContext(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
}

/** The first turn must see the agent-role-authorized tool; the second may complete only
 * after the real ToolRegistry result appears in ReAct history. */
class RelationshipQueryProvider implements IModelProvider {
  readonly id = "phase-175-solo-cutover";
  private callCount = 0;

  generate(prompt: string): Promise<IGenerateResult> {
    const availableTools = prompt.match(/AVAILABLE TOOLS:\n([^\n]+)/)?.[1]?.split(", ") ?? [];
    let content: string;
    if (this.callCount === 0) {
      if (!availableTools.includes(ToolName.QUERY_RELATIONSHIPS)) {
        throw new Error("code-analyst did not expose query_relationships to the ReAct turn");
      }
      content = `${REACT_THOUGHT_PREFIX}Inspect the persisted internal-import graph.
\`\`\`toml
[[actions]]
tool = "${ToolName.QUERY_RELATIONSHIPS}"
[actions.params]
from = "${EXPECTED_FROM}"
kind = "file_imports_file_internal"
\`\`\``;
    } else {
      if (!prompt.includes(EXPECTED_TARGET)) {
        throw new Error("query_relationships result did not reach the agent's next turn");
      }
      content =
        `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Observed ${EXPECTED_TARGET} through relationship querying.`;
    }
    this.callCount++;
    return Promise.resolve({
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "phase-175-scripted",
      provider: this.id,
      cost_usd: 0,
    });
  }
}

function usageError(): never {
  console.error("Usage: run_solo_relationship_agent.ts <workspace-root> <portal-alias> <portal-path>");
  Deno.exit(1);
}

if (import.meta.main) {
  const [workspaceRoot, portalAlias, portalPath] = Deno.args;
  if (!workspaceRoot || !portalAlias || !portalPath) usageError();

  const knowledgePath = join(workspaceRoot, "Memory", "Projects", portalAlias, "knowledge.json");
  const knowledge = PortalKnowledgeSchema.parse(JSON.parse(await Deno.readTextFile(knowledgePath)));
  const config: Config = ConfigSchema.parse({
    system: { root: workspaceRoot },
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [{
      alias: portalAlias,
      target_path: portalPath,
      default_branch: "main",
      agents_allowed: ["*"],
      operations: [PortalOperation.READ],
    }],
    mcp: {},
  });

  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const provider = new RelationshipQueryProvider();
    const portalKnowledge = new SnapshotPortalKnowledgeService(knowledge);
    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider,
      git: createStubGit(),
      display: createStubDisplay(db),
      portalKnowledge,
    };
    const registry = new ToolRegistry({ config, baseDir: portalPath, context });
    const blueprint = (await new BlueprintService(config, logger).loadBlueprint(CODE_ANALYST_ID)).blueprint;
    const adapter = new ReActLoopAdapter(
      new OutputParser(),
      new ExecutionContextService(config, logger, {}),
      logger,
      registry,
    );
    const strategy = new ReActLoopStrategy(adapter, provider);
    const traceId = crypto.randomUUID();
    const executionContext: IExecutionContext = {
      trace_id: traceId,
      request_id: `phase-175-${traceId}`,
      request: "Inspect the real portal import graph with query_relationships.",
      plan: "Use the relationship-aware explore mechanism before answering.",
      portal: portalAlias,
    };
    const options: IAgentExecutionOptions = {
      agent_role: CODE_ANALYST_ID,
      portal: portalAlias,
      permitted_tools: blueprint.permitted_tools,
      security_mode: SecurityMode.HYBRID,
      timeout_ms: EXECUTION_TIMEOUT_MS,
      max_tool_calls: MAX_TOOL_CALLS,
      audit_enabled: true,
    };

    const result = await strategy.execute(blueprint, executionContext, options);
    await db.waitForFlush();
    const event = db.getActivitiesByTrace(traceId)
      .find((activity) => activity.action_type === DomainEventType.AgentDynamicToolCall);
    if (!event) throw new Error("real ReAct execution emitted no dynamic_tool_call event");
    const payload = JSON.parse(event.payload);
    console.log(JSON.stringify({ ...payload, tool_calls: result.tool_calls }));
  } finally {
    await cleanup();
  }
}
