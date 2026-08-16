// deno-lint-ignore-file no-explicit-any
/**
 * @module LoggingDecoratorTest
 * @path packages/ai/tests/logging_decorator_test.ts
 * @description Verifies the AOP-style logging decorators, ensuring method execution, arguments,
 * and return values are transparently captured by the StructuredLogger.
 */

import { assertEquals } from "@std/assert";
import { LogMethod } from "@exaix/core/logger";
import type { EventLogger } from "@exaix/core/logger";
import { LogLevel } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { JSONObject } from "@exaix/core/types";

type LoggedCall = {
  level: LogLevel;
  action: string;
  target: string;
  payload: JSONObject;
};

function createStubLogger(calls: LoggedCall[]): EventLogger {
  const logger = {
    debug: (action: string, target: string, payload: JSONObject) => {
      calls.push({ level: LogLevel.DEBUG, action, target, payload });
      return Promise.resolve();
    },
    info: (action: string, target: string, payload: JSONObject) => {
      calls.push({ level: LogLevel.INFO, action, target, payload });
      return Promise.resolve();
    },
    error: (action: string, target: string, payload: JSONObject) => {
      calls.push({ level: LogLevel.ERROR, action, target, payload });
      return Promise.resolve();
    },
  };

  return logger as Partial<EventLogger> as EventLogger;
}

Deno.test("LogMethod (standard decorator): wraps method via (value, context)", async () => {
  const calls: LoggedCall[] = [];
  const logger = createStubLogger(calls);

  const original = function (this: any, value: string) {
    return Promise.resolve(`ok:${value}`);
  };

  const context = { kind: "method", name: "doIt" } as Partial<
    ClassMethodDecoratorContext
  > as ClassMethodDecoratorContext;
  const wrapped = LogMethod<unknown, [string], string>(logger, { action: DomainEventType.FlowStepExecuted })(
    original,
    context,
  ) as (
    ...args: string[]
  ) => Promise<unknown>;

  const out = await wrapped.call({ constructor: { name: "C" } }, "x");
  assertEquals(out, "ok:x");
  assertEquals(calls[0].action, DomainEventType.FlowStepExecuted);
  assertEquals(calls[1].target, "completed");
});
