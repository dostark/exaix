// deno-lint-ignore-file no-explicit-any
/**
 * @module LoggingDecoratorUnitTest
 * @path tests/services/decorators/logging_unit_test.ts
 * @description Unit tests for LogMethod decorator.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { LogMethod } from "../../../src/services/decorators/logging.ts";
import { EventLogger } from "@exaix/core/logger";

interface MockPayload {
  args?: any;
  error?: any;
}

Deno.test("LogMethod (standard decorator): handles errors and custom action", async () => {
  const logCalls: Array<{ level: string; msg: string; payload: MockPayload }> = [];
  const mockLogger: EventLogger = Object.assign(Object.create(EventLogger.prototype), {
    info: (msg: string, _action: string, payload: any) =>
      Promise.resolve(logCalls.push({ level: "info", msg, payload: payload as MockPayload })),
    error: (msg: string, _action: string, payload: any) =>
      Promise.resolve(logCalls.push({ level: "error", msg, payload: payload as MockPayload })),
    debug: (msg: string, _action: string, payload: any) =>
      Promise.resolve(logCalls.push({ level: "debug", msg, payload: payload as MockPayload })),
  });

  class TestClass {
    @LogMethod(mockLogger, "custom.action")
    async failingMethod(arg: string) {
      return await Promise.reject(new Error(`failing: ${arg}`));
    }

    @LogMethod(mockLogger)
    async namedMethod() {
      return await Promise.resolve("ok");
    }
  }

  const obj = new TestClass();

  // Test custom action and error logging
  await assertRejects(() => obj.failingMethod("foo"), Error, "failing: foo");

  const startCall = logCalls.find((c) => c.msg === "custom.action" && c.payload.args);
  const failCall = logCalls.find((c) => c.msg === "custom.action" && c.level === "error");

  assertEquals(!!startCall, true);
  assertEquals(failCall?.payload.error, "failing: foo");

  // Test default action name and success logging
  await obj.namedMethod();
  const successCall = logCalls.find((c) => c.msg === "TestClass.namedMethod" && c.level === "info");
  assertEquals(!!successCall, true);
});
