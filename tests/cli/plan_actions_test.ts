/**
 * @module PlanActionsTest
 * @path tests/cli/plan_actions_test.ts
 * @description Verifies the logic for CLI plan presentation, covering metadata listing,
 * diff colorization, and status truncation for terminal display.
 */

import { assertEquals } from "@std/assert";
import { TEST_MODEL_OPENAI, TEST_PROVIDER_ID_OPENAI } from "../config/constants.ts";
import {
  handlePlanApprove,
  handlePlanList,
  handlePlanReject,
  handlePlanRevise,
  handlePlanShow,
  type IPlanActionContext,
} from "../../src/cli/command_builders/plan_actions.ts";
import { PlanCommands } from "../../src/cli/commands/plan_commands.ts";
import { EventLogger } from "../../src/services/core/event_logger.ts";
import { LogLevel } from "../../src/shared/enums.ts";
import type { IPlanDetails } from "../../src/shared/types/plan.ts";
import type { LogMetadata } from "../../src/shared/types/json.ts";

function createDisplay() {
  const calls: Array<{ level: LogLevel; a: string; b: string; c: LogMetadata }> = [];
  const display = Object.assign(Object.create(EventLogger.prototype), {
    info: (a: string, b: string, c: LogMetadata = {}) => {
      calls.push({ level: LogLevel.INFO, a, b, c });
      return Promise.resolve();
    },
    error: (a: string, b: string, c: LogMetadata = {}) => {
      calls.push({ level: LogLevel.ERROR, a, b, c });
      return Promise.resolve();
    },
  });
  return { display, calls };
}

Deno.test("handlePlanList: displays empty result", async () => {
  const { display, calls } = createDisplay();
  const planCommands = {
    list: () => Promise.resolve([]),
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanList(context, { status: "review" });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].a, "plan.list");
  assertEquals(calls[0].c.count, 0);
});

Deno.test("handlePlanList: displays plan rows with truncation", async () => {
  const { display, calls } = createDisplay();
  const longSubject = "x".repeat(60);
  const planCommands = {
    list: () =>
      Promise.resolve([
        {
          id: "p1",
          status: "review",
          trace_id: "1234567890abcdef",
          request_subject: longSubject,
          request_agent: "agent",
          request_portal: "portal",
          request_priority: "p",
        },
      ]),
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanList(context, { status: "review" });

  assertEquals(calls.length, 2);
  assertEquals(calls[1].a.startsWith("🔍 p1"), true);
  assertEquals((calls[1].c.request as string).endsWith("..."), true);
  assertEquals((calls[1].c.trace as string).endsWith("..."), true);
});

Deno.test("handlePlanShow: prints metadata and content", async () => {
  const { display, calls } = createDisplay();
  const planCommands = {
    show: () =>
      Promise.resolve({
        metadata: {
          id: "p1",
          status: "review",
          trace_id: "t",
          request_id: "r",
          request_subject: "subject",
          input_tokens: "120",
          output_tokens: "45",
          total_tokens: "165",
          token_provider: TEST_PROVIDER_ID_OPENAI,
          token_model: TEST_MODEL_OPENAI,
          token_cost_usd: "0.0025",
        },
        content: "C",
      } as IPlanDetails),
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanShow(context, "p1");

  assertEquals(calls.length, 2);
  assertEquals(calls[0].a, "plan.show");
  assertEquals(calls[0].c.input_tokens, "120");
  assertEquals(calls[0].c.output_tokens, "45");
  assertEquals(calls[0].c.total_tokens, "165");
  assertEquals(calls[0].c.token_provider, TEST_PROVIDER_ID_OPENAI);
  assertEquals(calls[0].c.token_model, TEST_MODEL_OPENAI);
  assertEquals(calls[0].c.token_cost_usd, "0.0025");
  assertEquals(calls[0].c.request_subject, "subject");
  assertEquals(calls[1].a, "plan.content");
});

Deno.test("handlePlanApprove: splits skills", async () => {
  const { display } = createDisplay();
  // Use explicit type for calls array, per code style
  const calls: Array<{ id: string; skills?: string[] }> = [];
  const planCommands = {
    approve: (id: string, skills?: string[]) => {
      calls.push({ id, skills });
      return Promise.resolve();
    },
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanApprove(context, "p1", { skills: "a, b" });
  assertEquals(calls[0].skills, ["a", "b"]);
});

Deno.test("handlePlanReject/Revise: delegates", async () => {
  const { display } = createDisplay();
  const calls: string[] = [];
  const planCommands = {
    reject: () => {
      calls.push("reject");
      return Promise.resolve();
    },
    revise: () => {
      calls.push("revise");
      return Promise.resolve();
    },
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanReject(context, "p", "r");
  await handlePlanRevise(context, "p", ["c"]);

  assertEquals(calls, ["reject", "revise"]);
});
