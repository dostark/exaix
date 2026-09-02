#!/usr/bin/env -S deno run --allow-all
/**
 * @module RunSoloScratchpadExtraction
 * @path tests/scenario_framework/scripts/run_solo_scratchpad_extraction.ts
 * @description Phase 147 Step 10 scenario driver: a real Solo ReAct loop calls remember_fact
 *   through a real, context-wired ToolRegistry (the tool result must reach the agent's next
 *   turn), then scratchpad-informed extraction files the captured insight through the normal
 *   Pending -> approval pipeline — never directly into global memory.
 * @architectural-layer Test
 * @dependencies [packages/execution, packages/tool-runtime, packages/memory]
 * @related-files [tests/scenario_framework/scenarios/agent_flows/scratchpad-extraction.yaml]
 */

import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, REACT_THOUGHT_PREFIX, SecurityMode, ToolName } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import type { IApplicationContext } from "@exaix/core/types";
import { ExecutionContextService, OutputParser, ReActLoopAdapter, ReActLoopStrategy } from "@exaix/execution";
import {
  HeuristicExtractionStrategy,
  MemoryBankService,
  MemoryExtractorService,
  ScratchpadService,
} from "@exaix/memory";
import { ToolRegistry } from "@exaix/tool-runtime";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import {
  createMinimalExecutionMemory,
  createStubConfig,
  createStubDisplay,
  createStubGit,
  initTestDbService,
} from "@exaix/testing";

const CAPTURED_CONTENT = "Rate limiter resets on full restart, not per request";
const NO_PORTAL = "none";
const MAX_TOOL_CALLS = 3;
const EXECUTION_TIMEOUT_MS = 120_000;

/** The first turn must see the identity-authorized tool; the second may complete only
 * after the real scratchpad write result appears in ReAct history. */
class RememberFactProvider implements IModelProvider {
  readonly id = "phase-147-scratchpad";
  private callCount = 0;

  generate(prompt: string): Promise<IGenerateResult> {
    const availableTools = prompt.match(/AVAILABLE TOOLS:\n([^\n]+)/)?.[1]?.split(", ") ?? [];
    let content: string;
    if (this.callCount === 0) {
      if (!availableTools.includes(ToolName.REMEMBER_FACT)) {
        throw new Error("the ReAct turn did not expose remember_fact to the agent");
      }
      content = `${REACT_THOUGHT_PREFIX}Capture the rate-limiter gotcha before it is lost.
\`\`\`toml
[[actions]]
tool = "${ToolName.REMEMBER_FACT}"
[actions.params]
content = "${CAPTURED_CONTENT}"
\`\`\``;
    } else {
      if (!prompt.includes("entry_id")) {
        throw new Error("remember_fact result did not reach the agent's next turn");
      }
      content = `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Captured the rate-limiter gotcha via remember_fact.`;
    }
    this.callCount++;
    return Promise.resolve({
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "phase-147-scripted",
      provider: this.id,
      cost_usd: 0,
    });
  }
}

function usageError(): never {
  console.error("Usage: run_solo_scratchpad_extraction.ts <workspace-root>");
  Deno.exit(1);
}

if (import.meta.main) {
  const workspaceRoot = Deno.args[0];
  if (!workspaceRoot) usageError();

  const config: Config = ConfigSchema.parse({
    system: { root: workspaceRoot },
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [],
    mcp: {},
  });

  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const provider = new RememberFactProvider();
    const scratchpad = new ScratchpadService(config, logger);
    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider,
      git: createStubGit(),
      display: createStubDisplay(db),
      scratchpad,
    } as IApplicationContext;
    const traceId = crypto.randomUUID();
    const registry = new ToolRegistry({ config, traceId, baseDir: workspaceRoot, context });
    const adapter = new ReActLoopAdapter(
      new OutputParser(),
      new ExecutionContextService(config, logger, {}),
      logger,
      registry,
    );
    const strategy = new ReActLoopStrategy(adapter, provider);
    const executionContext: IExecutionContext = {
      trace_id: traceId,
      request_id: `phase-147-${traceId}`,
      request: "Capture anything worth remembering during this run via remember_fact.",
      plan: "Notice and record in-the-moment insights with the scratchpad tool.",
      portal: NO_PORTAL,
    };
    const options: IAgentExecutionOptions = {
      identity_id: "phase-147-scratchpad",
      portal: NO_PORTAL,
      permitted_tools: [ToolName.REMEMBER_FACT],
      security_mode: SecurityMode.SANDBOXED,
      timeout_ms: EXECUTION_TIMEOUT_MS,
      max_tool_calls: MAX_TOOL_CALLS,
      audit_enabled: true,
    };

    const result = await strategy.execute(
      { name: "scratchpad-agent", capabilities: ["memory-capture"], model: "phase-147-scripted" } as never,
      executionContext,
      options,
    );
    await db.waitForFlush();
    const event = db.getActivitiesByTrace(traceId)
      .find((activity) => activity.action_type === DomainEventType.AgentDynamicToolCall);
    if (!event) throw new Error("real ReAct execution emitted no dynamic_tool_call event");

    const entries = await scratchpad.read(traceId);
    if (entries.length !== 1 || entries[0].content !== CAPTURED_CONTENT) {
      throw new Error(`expected exactly the captured note in the trace scratchpad, got ${JSON.stringify(entries)}`);
    }

    const memoryBank = new MemoryBankService(config, logger);
    const extractor = new MemoryExtractorService(config, db, memoryBank, logger, {
      heuristicStrategy: new HeuristicExtractionStrategy(scratchpad),
    });
    const execution = createMinimalExecutionMemory({
      trace_id: traceId,
      summary: "Agent captured an in-the-moment gotcha via remember_fact.",
    });
    const candidates = await extractor.analyzeExecution(execution);
    for (const candidate of candidates) {
      await extractor.createProposal(candidate, execution, "scenario-identity");
    }
    const pending = await extractor.listPending();
    const global = await memoryBank.getGlobalMemory();
    const globalLearnings = global?.learnings?.length ?? 0;
    if (candidates.length < 1 || pending.length !== candidates.length || globalLearnings !== 0) {
      throw new Error(
        `pipeline invariant violated: candidates=${candidates.length} pending=${pending.length} globalLearnings=${globalLearnings}`,
      );
    }
    console.log(JSON.stringify({
      scratchpad_entries: entries.length,
      candidates: candidates.length,
      pending_count: pending.length,
      global_learnings: globalLearnings,
      tool_calls: result.tool_calls ?? 0,
    }));
  } finally {
    await cleanup();
  }
}
