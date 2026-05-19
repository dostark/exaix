/**
 * @module PlanAdapterTest
 * @path tests/services/adapters/plan_adapter_test.ts
 * @description Unit tests for the PlanAdapter in src/services/adapters/
 */

import { assertEquals } from "@std/assert";
import { PlanAdapter } from "../../../src/services/adapters/plan_adapter.ts";
import { PlanStatus } from "@exaix/core/status";
import type { IPlanDetails, IPlanMetadata } from "@exaix/core/types";

function createPlanCommandService(overrides: Partial<{
  approve: (planId: string, skills?: string[]) => Promise<void>;
  reject: (planId: string, reason?: string) => Promise<void>;
  revise: (planId: string, comments: string[]) => Promise<void>;
  list: (statusFilter?: string) => Promise<IPlanMetadata[]>;
  show: (planId: string) => Promise<IPlanDetails>;
}> = {}) {
  return {
    approve: async (_planId: string, _skills?: string[]) => {},
    reject: async (_planId: string, _reason?: string) => {},
    revise: async (_planId: string, _comments: string[]) => {},
    list: (_statusFilter?: string): Promise<IPlanMetadata[]> => Promise.resolve([]),
    show: (planId: string): Promise<IPlanDetails> =>
      Promise.resolve({ metadata: { id: planId, status: PlanStatus.REVIEW }, content: "some content" }),
    ...overrides,
  };
}

Deno.test("[adapters/PlanAdapter] approve() success path", async () => {
  const mockService = createPlanCommandService({
    approve: (planId: string, skills?: string[]) => {
      assertEquals(planId, "plan-123");
      assertEquals(skills, ["skill1"]);
      return Promise.resolve();
    },
  });
  const adapter = new PlanAdapter(mockService);
  const result = await adapter.approve("plan-123", "reviewer", ["skill1"]);
  assertEquals(result, true);
});

Deno.test("[adapters/PlanAdapter] approve() failure path", async () => {
  const mockService = createPlanCommandService({
    approve: () => Promise.reject(new Error("Failed")),
  });
  const adapter = new PlanAdapter(mockService);
  const result = await adapter.approve("plan-123");
  assertEquals(result, false);
});

Deno.test("[adapters/PlanAdapter] reject() success path", async () => {
  const mockService = createPlanCommandService({
    reject: (planId: string, reason?: string) => {
      assertEquals(planId, "plan-456");
      assertEquals(reason, "No good");
      return Promise.resolve();
    },
  });
  const adapter = new PlanAdapter(mockService);
  const result = await adapter.reject("plan-456", "reviewer", "No good");
  assertEquals(result, true);
});

Deno.test("[adapters/PlanAdapter] reject() use default reasoning", async () => {
  const mockService = createPlanCommandService({
    reject: (_planId: string, reason?: string) => {
      assertEquals(reason, "Rejected via TUI");
      return Promise.resolve();
    },
  });
  const adapter = new PlanAdapter(mockService);
  const result = await adapter.reject("plan-456");
  assertEquals(result, true);
});

Deno.test("[adapters/PlanAdapter] reject() failure path", async () => {
  const mockService = createPlanCommandService({
    reject: () => Promise.reject(new Error("Failed")),
  });
  const adapter = new PlanAdapter(mockService);
  const result = await adapter.reject("plan-456");
  assertEquals(result, false);
});

Deno.test("[adapters/PlanAdapter] revise() calls service", async () => {
  let called = false;
  const mockService = createPlanCommandService({
    revise: (planId: string, comments: string[]) => {
      assertEquals(planId, "plan-789");
      assertEquals(comments, ["fix this"]);
      called = true;
      return Promise.resolve();
    },
  });
  const adapter = new PlanAdapter(mockService);
  await adapter.revise("plan-789", ["fix this"]);
  assertEquals(called, true);
});

Deno.test("[adapters/PlanAdapter] list() calls service", async () => {
  const mockService = createPlanCommandService({
    list: (statusFilter?: string) => {
      assertEquals(statusFilter, PlanStatus.APPROVED);
      return Promise.resolve([{ id: "p1", status: PlanStatus.APPROVED }]);
    },
  });
  const adapter = new PlanAdapter(mockService);
  const result = await adapter.list(PlanStatus.APPROVED);
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "p1");
});

Deno.test("[adapters/PlanAdapter] listPending() calls list with REVIEW status", async () => {
  const mockService = createPlanCommandService({
    list: (statusFilter?: string) => {
      assertEquals(statusFilter, PlanStatus.REVIEW);
      return Promise.resolve([]);
    },
  });
  const adapter = new PlanAdapter(mockService);
  await adapter.listPending();
});

Deno.test("[adapters/PlanAdapter] show() calls service", async () => {
  const mockService = createPlanCommandService({
    show: (planId: string) => {
      assertEquals(planId, "plan-abc");
      return Promise.resolve({
        metadata: { id: "plan-abc", status: PlanStatus.REVIEW },
        content: "some content",
      });
    },
  });
  const adapter = new PlanAdapter(mockService);
  const result = await adapter.show("plan-abc");
  assertEquals(result.metadata.id, "plan-abc");
});

Deno.test("[adapters/PlanAdapter] getDiff() formats content as diff", async () => {
  const mockService = createPlanCommandService({
    show: (planId: string) => {
      return Promise.resolve({
        metadata: { id: planId, status: PlanStatus.REVIEW },
        content: "plan content",
      });
    },
  });
  const adapter = new PlanAdapter(mockService);
  const result = await adapter.getDiff("plan-diff");
  assertEquals(result, "Diff for plan plan-diff:\n\nplan content");
});
