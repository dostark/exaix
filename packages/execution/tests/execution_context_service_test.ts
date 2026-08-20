/**
 * @module ExecutionContextServiceTest
 * @path packages/execution/tests/execution_context_service_test.ts
 * @description Tests for ExecutionContextService's event-logging coverage on its
 * synchronous state-changing methods: clearBudget, invalidateCache, markSectionsStable.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/execution_context_service.ts"
 * ]
 */

import { assertEquals } from "@std/assert";
import { ContextCache } from "@exaix/core/context";
import { DomainEventType } from "@exaix/core/events";
import { ExecutionContextService, type IPromptBudgetAllocator } from "@exaix/execution";
import { castAny, initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";

interface ICapturedEvent {
  action: string;
  target: string | null;
  payload?: LogMetadata;
}

/** In-memory IEventLogger recording every emitted event for assertion. */
function createCapturingLogger(captured: ICapturedEvent[]): IEventLogger {
  const record = (action: string, target: string | null, payload?: LogMetadata): Promise<void> => {
    captured.push({ action, target, payload });
    return Promise.resolve();
  };
  const logger: IEventLogger = {
    log: (event) => record(event.action ?? "", event.target ?? null, event.payload),
    info: record,
    warn: record,
    error: record,
    fatal: record,
    debug: record,
    child: () => logger,
  };
  return logger;
}

Deno.test("[ExecutionContextService] clearBudget emits ExecutionContextBudgetCleared", () => {
  const captured: ICapturedEvent[] = [];
  const logger = createCapturingLogger(captured);
  const service = new ExecutionContextService(castAny({}), logger, {});

  service.clearBudget();

  const events = captured.filter((e) => e.action === DomainEventType.ExecutionContextBudgetCleared);
  assertEquals(events.length, 1);
  assertEquals(events[0].payload?.hadBudget, false);
  assertEquals(events[0].payload?.model, null);
});

Deno.test("[ExecutionContextService] allocateBudget emits ExecutionContextBudgetAllocated", async () => {
  const captured: ICapturedEvent[] = [];
  const logger = createCapturingLogger(captured);
  const mockBudget = { model: "test-model", sections: { system: 100, plan: 200 } };
  const promptBudgetAllocator = castAny<IPromptBudgetAllocator>({ allocate: () => Promise.resolve(mockBudget) });
  const service = new ExecutionContextService(castAny({}), logger, { promptBudgetAllocator });

  await service.allocateBudget("test-model");

  const events = captured.filter((e) => e.action === DomainEventType.ExecutionContextBudgetAllocated);
  assertEquals(events.length, 1);
  assertEquals(events[0].payload?.model, "test-model");
  assertEquals(events[0].payload?.sections, ["system", "plan"]);
});

Deno.test("[ExecutionContextService] invalidateCache emits ExecutionContextCacheInvalidated", () => {
  const captured: ICapturedEvent[] = [];
  const logger = createCapturingLogger(captured);
  const contextCache = new ContextCache();
  const service = new ExecutionContextService(castAny({}), logger, { contextCache });

  service.invalidateCache();

  const events = captured.filter((e) => e.action === DomainEventType.ExecutionContextCacheInvalidated);
  assertEquals(events.length, 1);
  assertEquals(events[0].payload?.cachePresent, true);
});

Deno.test("[ExecutionContextService] markSectionsStable emits ExecutionContextSectionsStabilized when cache and budget are set", async () => {
  const captured: ICapturedEvent[] = [];
  const logger = createCapturingLogger(captured);
  const contextCache = new ContextCache();
  const mockBudgetAllocator = {
    allocate: () =>
      Promise.resolve({
        model: "anthropic:claude-sonnet-5",
        totalBudgetTokens: 200_000,
        safetyBufferTokens: 20_000,
        sections: {
          system: 1000,
          plan: 2000,
          portalKnowledge: 3000,
          memory: 4000,
          skills: 5000,
          loopHistory: 6000,
        },
      }),
  };
  const service = new ExecutionContextService(castAny({}), logger, {
    contextCache,
    promptBudgetAllocator: mockBudgetAllocator,
  });
  await service.allocateBudget("anthropic:claude-sonnet-5");

  service.markSectionsStable(
    { system: "sys", plan: "plan", portalKnowledge: "pk", memory: "mem", skills: "sk" },
    service.currentPromptBudget!.sections,
  );

  const events = captured.filter((e) => e.action === DomainEventType.ExecutionContextSectionsStabilized);
  assertEquals(events.length, 1);
  assertEquals(events[0].payload?.system, 1000);
  assertEquals(events[0].payload?.plan, 2000);
  assertEquals(events[0].payload?.portalKnowledge, 3000);
  assertEquals(events[0].payload?.memory, 4000);
  assertEquals(events[0].payload?.skills, 5000);
});

Deno.test("[ExecutionContextService] markSectionsStable does not emit when cache is absent", () => {
  const captured: ICapturedEvent[] = [];
  const logger = createCapturingLogger(captured);
  const service = new ExecutionContextService(castAny({}), logger, {});

  service.markSectionsStable(
    { system: "sys", plan: "plan", portalKnowledge: "pk", memory: "mem", skills: "sk" },
    { system: 1, plan: 1, portalKnowledge: 1, memory: 1, skills: 1, loopHistory: 1 },
  );

  const events = captured.filter((e) => e.action === DomainEventType.ExecutionContextSectionsStabilized);
  assertEquals(events.length, 0);
});

Deno.test("[ExecutionContextService] allocateBudget emits ExecutionContextBudgetAllocated with a real, field-level payload (real EventLogger)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const mockBudget = { model: "test-model", sections: { system: 100, plan: 200 } };
    const promptBudgetAllocator = castAny<IPromptBudgetAllocator>({ allocate: () => Promise.resolve(mockBudget) });
    const service = new ExecutionContextService(config, logger, { promptBudgetAllocator });

    await service.allocateBudget("test-model");
    await db.waitForFlush();

    const rows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.ExecutionContextBudgetAllocated) as Array<{ payload: string }>;
    assertEquals(rows.length, 1, "execution.context.budget_allocated must be logged exactly once");
    const payload = JSON.parse(rows[0].payload);
    assertEquals(payload.model, "test-model");
    assertEquals(payload.sections, ["system", "plan"]);
  } finally {
    await cleanup();
  }
});
