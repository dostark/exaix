/**
 * @module GuardrailRunnerTest
 * @path packages-team/guardrail/tests/guardrail_runner_test.ts
 * @description Unit tests for the GuardrailRunner implementation (Phase 107 Step 2).
 */

import { assertEquals, assertExists } from "@std/assert";
import type { ILogEvent, LogMetadata } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { IModelProvider } from "@exaix/ai";
import {
  type GuardrailConfig,
  GuardrailConfigSchema,
  GuardrailPolicySchema,
} from "@exaix/schemas";
import { GuardrailRunner } from "../mod.ts";

interface ITestGenResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
}

const MOCK_RESULT_BASE = {
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  model: "mock",
  provider: "mock",
};

function makePassProvider(): IModelProvider {
  return {
    id: "mock-pass",
    generate(): Promise<ITestGenResult> {
      return Promise.resolve({
        content: JSON.stringify({ verdict: "pass", explanation: "OK" }),
        ...MOCK_RESULT_BASE,
      });
    },
  };
}

function makeViolationProvider(severity: string): IModelProvider {
  return {
    id: "mock-violation",
    generate(): Promise<ITestGenResult> {
      return Promise.resolve({
        content: JSON.stringify({
          verdict: "violation",
          explanation: severity,
        }),
        ...MOCK_RESULT_BASE,
      });
    },
  };
}

function makeThrowProvider(): IModelProvider {
  return {
    id: "mock-throw",
    generate(): Promise<ITestGenResult> {
      return Promise.reject(new Error("Provider crash"));
    },
  };
}

class MockLogger implements IEventLogger {
  readonly events: Array<{ event: string; payload?: LogMetadata }> = [];
  info(
    event: string,
    _target: string | null,
    payload?: LogMetadata,
  ): Promise<void> {
    this.events.push({ event, payload });
    return Promise.resolve();
  }
  log(_event: ILogEvent): Promise<void> {
    return Promise.resolve();
  }
  child(_overrides: Partial<ILogEvent>): IEventLogger {
    return this;
  }
  debug(
    _action: string,
    _target: string | null,
    _payload?: LogMetadata,
    _traceId?: string,
  ): Promise<void> {
    return Promise.resolve();
  }
  warn(
    _action: string,
    _target: string | null,
    _payload?: LogMetadata,
    _traceId?: string,
  ): Promise<void> {
    return Promise.resolve();
  }
  error(
    _action: string,
    _target: string | null,
    _payload?: LogMetadata,
    _traceId?: string,
  ): Promise<void> {
    return Promise.resolve();
  }
  fatal(
    _action: string,
    _target: string | null,
    _payload?: LogMetadata,
    _traceId?: string,
  ): Promise<void> {
    return Promise.resolve();
  }
}

function makeConfig(overrides?: Partial<GuardrailConfig>): GuardrailConfig {
  return GuardrailConfigSchema.parse(overrides ?? {});
}

Deno.test("disabled-is-noop", async () => {
  const config = makeConfig({ enabled: false });
  const logger = new MockLogger();
  const runner = new GuardrailRunner(config, makePassProvider(), logger);

  const incidents = await runner.screen("test output", "trace-1", 0);
  assertEquals(incidents, []);
  assertEquals(logger.events.length, 0);
});

Deno.test("clean-output-journals-pass", async () => {
  const config = makeConfig({
    enabled: true,
    policies: [
      GuardrailPolicySchema.parse({
        policy_id: "p1",
        description: "test",
        blueprint: "test-blueprint",
      }),
    ],
  });
  const logger = new MockLogger();
  const runner = new GuardrailRunner(config, makePassProvider(), logger);

  const incidents = await runner.screen("clean output", "trace-1", 0);
  assertEquals(incidents, []);
  const passEvents = logger.events.filter((e) =>
    e.event === "guardrail.screen.pass"
  );
  assertEquals(passEvents.length, 1);
});

Deno.test("block-sets-blocking-flag", async () => {
  const config = makeConfig({
    enabled: true,
    policies: [GuardrailPolicySchema.parse({
      policy_id: "p1",
      description: "test",
      blueprint: "test-blueprint",
      severity: "block",
    })],
  });
  const logger = new MockLogger();
  const runner = new GuardrailRunner(
    config,
    makeViolationProvider("block"),
    logger,
  );

  await runner.screen("bad output", "trace-1", 0);
  assertEquals(runner.hasBlockingViolation("trace-1"), true);
  const violEvents = logger.events.filter((e) =>
    e.event === "guardrail.screen.violation"
  );
  assertEquals(violEvents.length, 1);
});

Deno.test("warn-does-not-block", async () => {
  const config = makeConfig({
    enabled: true,
    policies: [GuardrailPolicySchema.parse({
      policy_id: "p1",
      description: "test",
      blueprint: "test-blueprint",
      severity: "warn",
    })],
  });
  const logger = new MockLogger();
  const runner = new GuardrailRunner(
    config,
    makeViolationProvider("warn"),
    logger,
  );

  await runner.screen("warn output", "trace-1", 0);
  assertEquals(runner.hasBlockingViolation("trace-1"), false);
  const warnEvents = logger.events.filter((e) => e.event === "guardrail.warn");
  assertEquals(warnEvents.length, 1);
});

Deno.test("policy-throw-is-nonblocking", async () => {
  const config = makeConfig({
    enabled: true,
    policies: [
      GuardrailPolicySchema.parse({
        policy_id: "p1",
        description: "test",
        blueprint: "test-blueprint",
      }),
    ],
  });
  const logger = new MockLogger();
  const runner = new GuardrailRunner(config, makeThrowProvider(), logger);

  const incidents = await runner.screen("test", "trace-1", 0);
  assertEquals(runner.hasBlockingViolation("trace-1"), false);
  assertEquals(incidents.length, 0);
  const errorEvents = logger.events.filter((e) =>
    e.event === "guardrail.screen.error"
  );
  assertEquals(errorEvents.length, 1);
  assertExists(errorEvents[0].payload);
});
