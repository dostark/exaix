// deno-lint-ignore-file no-explicit-any
/**
 * @module RequestActionsTest
 * @path apps/exactl/tests/request_actions_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies CLI presentation logic for agent requests, ensuring detailed views
 * correctly include trace_id, agent assignments, and token usage statistics.
 */

import { assertEquals } from "@std/assert";
import { TEST_MODEL_ANTHROPIC, TEST_PROVIDER_ID_ANTHROPIC } from "@exaix/testing";
import {
  handleRequestAnalyze,
  handleRequestCreate,
  handleRequestShow,
  type IRequestActionContext,
} from "../src/command_builders/request_actions.ts";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { EventLogger, type IEventLoggerConfig } from "@exaix/core/logger";

import { LogLevel } from "@exaix/core";

type TestPayload = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  token_provider?: string;
  token_model?: string;
  token_cost_usd?: number;
  [key: string]: any;
};

class MockEventLogger extends EventLogger {
  public calls: Array<{ level: LogLevel; a: string; b: string; c: TestPayload | undefined }> = [];

  constructor() {
    super({ minLevel: LogLevel.DEBUG } as IEventLoggerConfig);
  }

  override info(action: string, target: string, payload?: TestPayload): Promise<void> {
    this.calls.push({ level: LogLevel.INFO, a: action, b: target, c: payload });
    return Promise.resolve();
  }

  override error(action: string, target: string, payload?: TestPayload): Promise<void> {
    this.calls.push({ level: LogLevel.ERROR, a: action, b: target, c: payload });
    return Promise.resolve();
  }
}

function createDisplay() {
  const display = new MockEventLogger();
  return { display, calls: display.calls };
}

Deno.test("handleRequestShow: includes token stats when present", async () => {
  const { display, calls } = createDisplay();
  const requestCommands = {
    show: () =>
      Promise.resolve({
        metadata: {
          trace_id: "trace-1",
          status: "planned",
          priority: "normal",
          identity: "agent",
          created_by: "tester",
          created: "time",
          input_tokens: 200,
          output_tokens: 80,
          total_tokens: 280,
          token_provider: TEST_PROVIDER_ID_ANTHROPIC,
          token_model: TEST_MODEL_ANTHROPIC,
          token_cost_usd: 0.0042,
        },
        content: "Hello world",
      }),
  };

  const context: IRequestActionContext = {
    requestCommands: Object.assign(Object.create(RequestCommands.prototype), requestCommands),
    display,
  };
  await handleRequestShow(context, "trace-1");

  assertEquals(calls.length, 2);
  assertEquals(calls[0].a, "request.show");
  if (calls[0].c) {
    assertEquals(calls[0].c.input_tokens, 200);
    assertEquals(calls[0].c.output_tokens, 80);
    assertEquals(calls[0].c.total_tokens, 280);
    assertEquals(calls[0].c.token_provider, TEST_PROVIDER_ID_ANTHROPIC);
    assertEquals(calls[0].c.token_model, TEST_MODEL_ANTHROPIC);
    assertEquals(calls[0].c.token_cost_usd, 0.0042);
  } else {
    throw new Error("calls[0].c is undefined");
  }
  assertEquals(calls[1].a, "request.content");
});

Deno.test("handleRequestShow: includes analysis when present", async () => {
  const { display, calls } = createDisplay();
  const requestCommands = {
    show: () =>
      Promise.resolve({
        metadata: {
          trace_id: "trace-2",
          status: "planned",
          priority: "normal",
          identity: "agent",
          created_by: "tester",
          created: "time",
        },
        content: "Hello analysis",
        analysis: {
          complexity: "medium",
          actionabilityScore: 80,
          ambiguities: [{ description: "A bit vague", impact: "low", interpretations: [] }],
          metadata: { analyzedAt: "now", durationMs: 123, mode: "heuristic" },
          goals: [],
          requirements: [],
          constraints: [],
          acceptanceCriteria: [],
          taskType: "feature",
          tags: [],
          referencedFiles: [],
        },
      }),
  };

  const context: IRequestActionContext = {
    requestCommands: Object.assign(Object.create(RequestCommands.prototype), requestCommands),
    display,
  };
  await handleRequestShow(context, "trace-2");

  // Should have 3 calls: request.show, request.analysis, request.content
  assertEquals(calls.length, 3);
  assertEquals(calls[0].a, "request.show");
  assertEquals(calls[1].a, "request.analysis");
  if (calls[1].c) {
    assertEquals(calls[1].c.complexity, "medium");
    assertEquals(calls[1].c.actionability, "80%");
    assertEquals(calls[1].c.ambiguity, "1 items");
  } else {
    throw new Error("calls[1].c is undefined");
  }
  assertEquals(calls[2].a, "request.content");
});

Deno.test("handleRequestAnalyze: trigger and display analysis", async () => {
  const { display, calls } = createDisplay();
  const requestCommands = {
    analyze: (_id: string, mode: string) =>
      Promise.resolve({
        complexity: "complex",
        actionabilityScore: 42,
        ambiguities: [{ description: "Confusing", impact: "high", interpretations: [] }],
        goals: [{ description: "Win", priority: 1, explicit: true }],
        requirements: [{ description: "Fast", confidence: 1, type: "functional", explicit: true }],
        metadata: { analyzedAt: "now", durationMs: 500, mode },
        constraints: [],
        acceptanceCriteria: [],
        taskType: "feature",
        tags: [],
        referencedFiles: [],
      }),
  };

  const context: IRequestActionContext = {
    requestCommands: Object.assign(Object.create(RequestCommands.prototype), requestCommands),
    display,
  };

  await handleRequestAnalyze(context, "trace-3", { engine: "llm" });

  assertEquals(calls.length, 2);
  assertEquals(calls[0].a, "request.analyzed");
  if (calls[0].c) {
    assertEquals(calls[0].c.mode, "llm");
    assertEquals(calls[0].c.complexity, "complex");
    assertEquals(calls[0].c.actionability, "42%");
  }
  assertEquals(calls[1].a, "request.ambiguities");
});

Deno.test("handleRequestAnalyze: default to hybrid (DEFAULT_ANALYZER_MODE)", async () => {
  const { display, calls } = createDisplay();
  const requestCommands = {
    analyze: (_id: string, mode: string) =>
      Promise.resolve({
        complexity: "simple",
        actionabilityScore: 100,
        ambiguities: [],
        goals: [],
        requirements: [],
        metadata: { analyzedAt: "now", durationMs: 10, mode },
        constraints: [],
        acceptanceCriteria: [],
        taskType: "feature",
        tags: [],
        referencedFiles: [],
      }),
  };

  const context: IRequestActionContext = {
    requestCommands: Object.assign(Object.create(RequestCommands.prototype), requestCommands),
    display,
  };

  await handleRequestAnalyze(context, "trace-4", {});

  assertEquals(calls.length, 1);
  assertEquals(calls[0].a, "request.analyzed");
  if (calls[0].c) {
    assertEquals(calls[0].c.mode, "hybrid");
  }
});

Deno.test("handleRequestCreate: displays analysis when analyze=true", async () => {
  const { display, calls } = createDisplay();
  const requestCommands = {
    create: () =>
      Promise.resolve({
        trace_id: "trace-6",
        filename: "request-trace-6.md",
        status: "pending",
        priority: "normal",
        identity: "coder",
        created: "time",
        created_by: "tester",
        subject: "Build app",
        analysis: {
          complexity: "medium",
          actionabilityScore: 90,
          ambiguities: [],
          goals: [],
          requirements: [],
          metadata: { mode: "heuristic", durationMs: 10, analyzedAt: "now" },
        },
      }),
  };

  const context: IRequestActionContext = {
    requestCommands: Object.assign(Object.create(RequestCommands.prototype), requestCommands),
    display,
  };

  await handleRequestCreate(context, { analyze: true }, "Build an app");

  // Should have 2 calls: request.created and request.analysis
  // (printRequestResult is called by handleRequestCreate)
  assertEquals(calls.length, 2);
  assertEquals(calls[0].a, "request.created");
  assertEquals(calls[1].a, "request.analysis");
  if (calls[1].c) {
    assertEquals(calls[1].c.complexity, "medium");
    assertEquals(calls[1].c.actionability, "90%");
  }
});

// ---------------------------------------------------------------------------
// Step 22: hybrid mode engine routes to HYBRID, not HEURISTIC
// ---------------------------------------------------------------------------

Deno.test("handleRequestAnalyze: hybrid engine routes to HYBRID mode", async () => {
  const { display, calls } = createDisplay();
  const requestCommands = {
    analyze: (_id: string, mode: string) =>
      Promise.resolve({
        complexity: "medium",
        actionabilityScore: 70,
        ambiguities: [],
        goals: [],
        requirements: [],
        metadata: { analyzedAt: "now", durationMs: 20, mode },
        constraints: [],
        acceptanceCriteria: [],
        taskType: "feature",
        tags: [],
        referencedFiles: [],
      }),
  };

  const context: IRequestActionContext = {
    requestCommands: Object.assign(Object.create(RequestCommands.prototype), requestCommands),
    display,
  };

  await handleRequestAnalyze(context, "trace-5", { engine: "hybrid" });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].a, "request.analyzed");
  if (calls[0].c) {
    assertEquals(calls[0].c.mode, "hybrid");
  }
});
