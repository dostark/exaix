/**
 * @module PlanActionsTest
 * @path apps/exactl/tests/plan_actions_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies the logic for CLI plan presentation, covering metadata listing,
 * diff colorization, and status truncation for terminal display.
 */

import { assertEquals } from "@std/assert";
import { TEST_MODEL_OPENAI, TEST_PROVIDER_ID_OPENAI } from "@exaix/testing";
import {
  handlePlanAmendmentApprove,
  handlePlanAmendmentApproveAll,
  handlePlanAmendmentList,
  handlePlanAmendmentReject,
  handlePlanAmendmentShow,
  handlePlanAmendmentShowAll,
  handlePlanApprove,
  handlePlanApproveAll,
  handlePlanList,
  handlePlanReject,
  handlePlanRevise,
  handlePlanShow,
  type IPlanActionContext,
} from "../src/command_builders/plan_actions.ts";
import { PlanCommands } from "../src/commands/plan_commands.ts";
import { stub } from "@std/testing/mock";
import { EventLogger } from "@exaix/core/logger";
import { LogLevel } from "@exaix/core";
import type { IPlanDetails } from "@exaix/core/types";
import type { LogMetadata } from "@exaix/core/types";

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

Deno.test("handlePlanApproveAll: delegates to approveAll", async () => {
  const { display } = createDisplay();
  const calls: Array<{ skills?: string[] }> = [];
  const planCommands = {
    approveAll: (skills?: string[]) => {
      calls.push({ skills });
      return Promise.resolve();
    },
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanApproveAll(context, { skills: "x,y" });
  assertEquals(calls[0].skills, ["x", "y"]);
});

Deno.test("handlePlanAmendmentList: displays amendments", async () => {
  const { display, calls } = createDisplay();
  const planCommands = {
    listAmendments: () =>
      Promise.resolve([
        { id: "a1", trace_id: "trace123" },
      ]),
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanAmendmentList(context);

  assertEquals(calls.length, 2);
  assertEquals(calls[0].a, "plan.amendment.list");
  assertEquals(calls[1].a.includes("amendment_pending: a1"), true);
});

Deno.test("handlePlanAmendmentList: handles empty list", async () => {
  const { display, calls } = createDisplay();
  const planCommands = {
    listAmendments: () => Promise.resolve([]),
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanAmendmentList(context);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].a, "plan.amendment.list");
  assertEquals(calls[0].c.count, 0);
});

Deno.test("handlePlanAmendmentShow: displays patch details", async () => {
  const { display, calls } = createDisplay();
  const planCommands = {
    getAmendment: () =>
      Promise.resolve({
        amendmentId: "am1",
        summary: "Sum",
        affectedRemainingStepIds: ["s1"],
        createdAt: "2024-01-01",
        adds: [{ number: 2, title: "Add", content: "C" }],
        updates: [{ number: 1, title: "Upd", content: "C" }],
        removes: [3],
      }),
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanAmendmentShow(context, "a1");

  assertEquals(calls.some((c) => c.a === "Adds"), true);
  assertEquals(calls.some((c) => c.a === "Updates"), true);
  assertEquals(calls.some((c) => c.a === "Removes"), true);
});

Deno.test("handlePlanAmendmentApprove/Reject: delegates", async () => {
  const { display, calls } = createDisplay();
  const cmdCalls: string[] = [];
  const planCommands = {
    approveAmendment: () => {
      cmdCalls.push("approve");
      return Promise.resolve();
    },
    rejectAmendment: () => {
      cmdCalls.push("reject");
      return Promise.resolve();
    },
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanAmendmentApprove(context, "a1");
  await handlePlanAmendmentReject(context, "a1", "reason");

  assertEquals(cmdCalls, ["approve", "reject"]);
  assertEquals(calls.some((c) => c.a === "plan.amendment.approved"), true);
  assertEquals(calls.some((c) => c.a === "plan.amendment.rejected"), true);
});

Deno.test("handlePlanAmendmentApproveAll: delegates", async () => {
  const { display } = createDisplay();
  let called = false;
  const planCommands = {
    approveAllAmendments: () => {
      called = true;
      return Promise.resolve();
    },
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanAmendmentApproveAll(context);
  assertEquals(called, true);
});

Deno.test("handlePlanAmendmentShowAll: displays all amendments", async () => {
  const { display, calls } = createDisplay();
  const planCommands = {
    getAmendments: () =>
      Promise.resolve([
        {
          id: "a1",
          patch: {
            amendmentId: "am1",
            summary: "Sum",
            affectedRemainingStepIds: ["s1"],
            adds: [],
            updates: [],
            removes: [],
          },
        },
      ]),
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };
  await handlePlanAmendmentShowAll(context);

  assertEquals(calls.length > 1, true);
  assertEquals(calls[0].a, "plan.amendment.show_all");
});

Deno.test("Error Handling: handlePlanList calls Deno.exit(1) on failure", async () => {
  const { display, calls } = createDisplay();
  const planCommands = {
    list: () => Promise.reject(new Error("Failure")),
  };

  const context: IPlanActionContext = {
    planCommands: Object.assign(Object.create(PlanCommands.prototype), planCommands),
    display,
  };

  const exitStub = stub(Deno, "exit", () => {
    throw new Error("Deno.exit called");
  });

  try {
    try {
      await handlePlanList(context, {});
    } catch (e) {
      assertEquals((e as Error).message, "Deno.exit called");
    }
    assertEquals(calls.length, 1);
    assertEquals(calls[0].level, LogLevel.ERROR);
  } finally {
    exitStub.restore();
  }
});
