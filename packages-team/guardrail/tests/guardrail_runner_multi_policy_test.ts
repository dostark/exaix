/**
 * @module GuardrailRunnerMultiPolicyTest
 * @path packages-team/guardrail/tests/guardrail_runner_multi_policy_test.ts
 * @description Multi-policy parallelism tests for GuardrailRunner (Phase 107 Step 6).
 */

import { assertEquals, assertExists } from "@std/assert";
import type { ILogEvent, JSONObject, LogMetadata } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { IModelProvider } from "@exaix/ai";
import { GuardrailConfigSchema, GuardrailPolicySchema } from "@exaix/schemas";
import { GuardrailRunner } from "../mod.ts";

class MockLogger implements IEventLogger {
  readonly events: Array<{ event: string; payload?: LogMetadata }> = [];
  info(event: string, _target: string | null, payload?: LogMetadata): Promise<void> {
    this.events.push({ event, payload });
    return Promise.resolve();
  }
  log(_event: ILogEvent): Promise<void> {
    return Promise.resolve();
  }
  child(_overrides: Partial<ILogEvent>): IEventLogger {
    return this;
  }
  debug(_action: string, _target: string | null, _payload?: LogMetadata, _traceId?: string): Promise<void> {
    return Promise.resolve();
  }
  warn(_action: string, _target: string | null, _payload?: LogMetadata, _traceId?: string): Promise<void> {
    return Promise.resolve();
  }
  error(_action: string, _target: string | null, _payload?: LogMetadata, _traceId?: string): Promise<void> {
    return Promise.resolve();
  }
  fatal(_action: string, _target: string | null, _payload?: LogMetadata, _traceId?: string): Promise<void> {
    return Promise.resolve();
  }
}

function makeProvider(verdict: string): IModelProvider {
  return {
    id: "mock-" + verdict,
    generate(): Promise<
      {
        content: string;
        usage: { promptTokens: number; completionTokens: number; totalTokens: number };
        model: string;
        provider: string;
      }
    > {
      return Promise.resolve({
        content: JSON.stringify({ verdict, explanation: verdict }),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock",
        provider: "mock",
      });
    },
  };
}

Deno.test("mixed-warn-pass", async () => {
  // The single shared provider returns "pass" for all policies.
  // One policy is warn-severity, one is block-severity — but since verdict
  // is "pass", both emit guardrail.screen.pass and neither blocks.
  const config = GuardrailConfigSchema.parse({
    enabled: true,
    policies: [
      GuardrailPolicySchema.parse({
        policy_id: "warn-policy",
        description: "warns",
        blueprint: "bp",
        severity: "warn",
      }),
      GuardrailPolicySchema.parse({ policy_id: "pass-policy", description: "passes", blueprint: "bp" }),
    ],
  });
  const logger = new MockLogger();
  const runner = new GuardrailRunner(config, makeProvider("pass"), logger);

  const incidents = await runner.screen("test output", "trace-1", 0);
  assertEquals(runner.hasBlockingViolation("trace-1"), false);
  const passEvents = logger.events.filter((e) => e.event === "guardrail.screen.pass");
  assertEquals(passEvents.length, 2);
  assertExists(incidents);
});

Deno.test("block-among-many", async () => {
  // Three policies, all return "violation" via the shared provider.
  // Default severity is "block" for all — all set blocking flag.
  const config = GuardrailConfigSchema.parse({
    enabled: true,
    policies: [
      GuardrailPolicySchema.parse({ policy_id: "p1", description: "pass", blueprint: "bp" }),
      GuardrailPolicySchema.parse({ policy_id: "p2", description: "block", blueprint: "bp", severity: "block" }),
      GuardrailPolicySchema.parse({ policy_id: "p3", description: "pass", blueprint: "bp" }),
    ],
  });
  const logger = new MockLogger();
  const runner = new GuardrailRunner(config, makeProvider("violation"), logger);

  await runner.screen("bad output", "trace-1", 0);
  assertEquals(runner.hasBlockingViolation("trace-1"), true);
  const blockEvents = logger.events.filter((e) => e.event === "guardrail.block");
  assertEquals(blockEvents.length, 3);
});

Deno.test("event-payloads-typed", async () => {
  const config = GuardrailConfigSchema.parse({
    enabled: true,
    policies: [
      GuardrailPolicySchema.parse({ policy_id: "p1", description: "test", blueprint: "bp", severity: "block" }),
    ],
  });
  const logger = new MockLogger();
  const runner = new GuardrailRunner(config, makeProvider("violation"), logger);

  await runner.screen("bad output", "trace-1", 0);
  const blockEvent = logger.events.find((e) => e.event === "guardrail.block");
  assertExists(blockEvent);
  assertExists(blockEvent.payload);
  const payload = blockEvent.payload as JSONObject;
  assertEquals(payload.policy_id, "p1");
  assertEquals(payload.verdict, "violation");
  assertEquals(payload.severity, "block");
  assertEquals(payload.iteration, 0);
});
