/**
 * @module AciInjectionIntegrationTest
 * @path tests/integration/aci_injection_test.ts
 * @description Phase 112 Step 3 — drives `PlanExecutor.execute` -> `createAgentExecutor` ->
 * `AgentOrchestrator` -> `ReActLoopStrategy` end-to-end with a real `MockLLMProvider`, proving
 * the `read_file` ACI fragment reaches the provider prompt through the real production
 * construction path (the renderer and adapter are never hand-built here), and that the
 * daemon-level `agents.inject_aci_docs` config flag gates both the rendered prompt content
 * and the `agent.prompt_assembled` (react) event end-to-end, through a real EventLogger/DB.
 * @architectural-layer Integration
 * @related-files [
 *   "packages/core/src/planning/plan_executor.ts",
 *   "packages/execution/src/agent_orchestrator.ts",
 *   "packages/execution/src/strategies/react_loop_strategy.ts",
 *   "packages/execution/src/react_loop_adapter.ts"
 * ]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { MockLLMProvider } from "@exaix/ai/providers";
import { MockStrategy } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import type { IPlanContext } from "@exaix/core/planning";
import { PlanExecutor } from "@exaix/core/planning";
import { getBlueprintsAgentsDir, initTestDbService, readFixtureTextSync } from "@exaix/testing";

const IDENTITY_ID = "aci-react-agent";

/** A minimal ReAct-capable blueprint scoped to exactly one tool, so the rendered ACI
 * section (when enabled) is unambiguous: it must be the real `read_file` fragment. */
const REACT_BLUEPRINT = readFixtureTextSync(import.meta.url, "integration", "aci_injection_test", "blueprint.md");

/** Ends the ReAct loop after exactly one provider-bound iteration, regardless of prompt content. */
const SCRIPTED_COMPLETE_RESPONSE =
  "THOUGHT: No changes are needed for this task.\nSTATUS: COMPLETE\nSUMMARY: Nothing to report.";

async function setupExecution(aciDocsEnabled: boolean, providerStrategy: MockStrategy = MockStrategy.SCRIPTED) {
  const { db, config, tempDir, cleanup } = await initTestDbService();
  config.agents.inject_aci_docs = aciDocsEnabled;

  const agentsDir = getBlueprintsAgentsDir(tempDir);
  await Deno.mkdir(agentsDir, { recursive: true });
  await Deno.writeTextFile(join(agentsDir, `${IDENTITY_ID}.md`), REACT_BLUEPRINT);

  const logger = new EventLogger({ db });
  const provider = new MockLLMProvider(providerStrategy, { responses: [SCRIPTED_COMPLETE_RESPONSE] });
  // enableGit: false — this test's concern is ACI injection, not git/worktree behavior;
  // matches the proven pattern in tests/integration/services/plan_amendment_test_helper.ts.
  const executor = new PlanExecutor(config, provider, db, tempDir, logger, { enableGit: false });

  const traceId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const context: IPlanContext = {
    trace_id: traceId,
    request_id: requestId,
    identity: IDENTITY_ID,
    frontmatter: {},
    steps: [{
      number: 1,
      title: "Read a file",
      content: "Confirm you can see the read_file tool guidance, then finish.",
    }],
  };
  const planPath = join(tempDir, "Workspace", "Plans", "Active", `${traceId}.md`);

  return { db, executor, context, planPath, traceId, requestId, cleanup };
}

Deno.test(
  "[AciInjection] enabled: PlanExecutor delivers the read_file ACI fragment to MockLLMProvider and journals one trace-linked agent.prompt_assembled(react) event",
  async () => {
    const { db, executor, context, planPath, traceId, requestId, cleanup } = await setupExecution(true);
    try {
      await executor.execute(planPath, context);
      await db.waitForFlush();

      const activities = db.getActivitiesByTrace(traceId);
      const promptAssembledEvents = activities.filter((a) => a.action_type === DomainEventType.AgentPromptAssembled);
      assertEquals(promptAssembledEvents.length, 1, "exactly one provider-bound iteration ran");

      const [event] = promptAssembledEvents;
      assertEquals(event.target, requestId);
      assertEquals(event.trace_id, traceId);
      const payload = JSON.parse(event.payload);
      assertEquals(payload.prompt_kind, "react");
      assertEquals(payload.iteration, 0);
      assertEquals(payload.toolIds, ["read_file"]);
      assertEquals(payload.fragmentCount, 1, "the real read_file ACI doc rendered exactly one fragment");
      assertEquals(payload.truncated, false);
      if (!(payload.fragmentChars > 0)) {
        throw new Error("expected a non-empty rendered ACI fragment from the real read_file tool schema");
      }
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "[AciInjection] disabled: PlanExecutor runs the same plan through MockLLMProvider without emitting any agent.prompt_assembled(react) event",
  async () => {
    const { db, executor, context, planPath, traceId, cleanup } = await setupExecution(false);
    try {
      await executor.execute(planPath, context);
      await db.waitForFlush();

      const activities = db.getActivitiesByTrace(traceId);
      const promptAssembledEvents = activities.filter((a) => a.action_type === DomainEventType.AgentPromptAssembled);
      assertEquals(promptAssembledEvents.length, 0, "disabled mode never emits agent.prompt_assembled");
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "[AciInjection] a provider failure after prompt logging still leaves the agent.prompt_assembled audit record",
  async () => {
    const { db, executor, context, planPath, traceId, requestId, cleanup } = await setupExecution(
      true,
      MockStrategy.FAILING,
    );
    try {
      // The event is emitted immediately before the provider-bound call, so a subsequent
      // provider failure must not erase it.
      await assertRejects(() => executor.execute(planPath, context));
      await db.waitForFlush();

      const activities = db.getActivitiesByTrace(traceId);
      const promptAssembledEvents = activities.filter((a) => a.action_type === DomainEventType.AgentPromptAssembled);
      assertEquals(promptAssembledEvents.length, 1, "the assembly audit record survives a subsequent provider failure");
      assertEquals(promptAssembledEvents[0].target, requestId);
      const payload = JSON.parse(promptAssembledEvents[0].payload);
      assertEquals(payload.toolIds, ["read_file"]);
    } finally {
      await cleanup();
    }
  },
);
