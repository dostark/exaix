/**
 * @module LoggingDecoratorUnitTest
 * @path packages/core/tests/logging_unit_test.ts
 * @description Unit tests for the LogMethod decorator family (LogMethod, LogSyncMethod,
 *   LogGeneratorMethod) — Phase 168's hardened, DomainEventType-constrained instrumentation
 *   primitives.
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { LogGeneratorMethod, LogMethod, LogSyncMethod } from "@exaix/core/logger";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { LogMetadata } from "@exaix/core";

interface ILogCall {
  level: string;
  msg: string;
  payload: LogMetadata;
  traceId?: string;
}

function mockLogger(logCalls: ILogCall[]): IEventLogger {
  return {
    info: (msg: string, _action: string | null, payload: LogMetadata = {}, traceId?: string) => {
      logCalls.push({ level: "info", msg, payload, traceId });
      return Promise.resolve();
    },
    error: (msg: string, _action: string | null, payload: LogMetadata = {}, traceId?: string) => {
      logCalls.push({ level: "error", msg, payload, traceId });
      return Promise.resolve();
    },
    warn: (msg: string, _action: string | null, payload: LogMetadata = {}, traceId?: string) => {
      logCalls.push({ level: "warn", msg, payload, traceId });
      return Promise.resolve();
    },
    debug: (msg: string, _action: string | null, payload: LogMetadata = {}, traceId?: string) => {
      logCalls.push({ level: "debug", msg, payload, traceId });
      return Promise.resolve();
    },
    fatal: () => Promise.resolve(),
    log: () => Promise.resolve(),
    child: () => mockLogger(logCalls),
  };
}

Deno.test("LogMethod (standard decorator): handles errors and custom action", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class TestClass {
    @LogMethod(logger, { action: DomainEventType.FlowStepExecuted })
    async failingMethod(arg: string) {
      return await Promise.reject(new Error(`failing: ${arg}`));
    }

    @LogMethod(logger, { action: DomainEventType.FlowStepExecuted })
    async namedMethod() {
      return await Promise.resolve("ok");
    }
  }

  const obj = new TestClass();

  // Test custom action and error logging
  await assertRejects(() => obj.failingMethod("foo"), Error, "failing: foo");

  const startCall = logCalls.find((c) => c.msg === DomainEventType.FlowStepExecuted && c.payload.args);
  const failCall = logCalls.find((c) => c.msg === DomainEventType.FlowStepExecuted && c.level === "error");

  assertEquals(!!startCall, true);
  assertEquals(failCall?.payload.error, "failing: foo");

  // Test default action name and success logging
  await obj.namedMethod();
  const successCall = logCalls.find((c) => c.msg === DomainEventType.FlowStepExecuted && c.level === "info");
  assertEquals(!!successCall, true);
});
Deno.test("[LogMethod] payloadMapper shapes the success payload when supplied", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Fetcher {
    @LogMethod<Fetcher, [string], string>(logger, {
      action: DomainEventType.FlowStepExecuted,
      payloadMapper: (_args, result) => ({ resultLength: result?.length ?? 0 }),
    })
    fetch(url: string): Promise<string> {
      return Promise.resolve(`content-of-${url}`);
    }
  }

  const obj = new Fetcher();
  await obj.fetch("https://example.com");

  const completedCall = logCalls.find((c) => c.level === "info");
  assertEquals(completedCall?.payload.resultLength, "content-of-https://example.com".length);
  assertEquals(completedCall?.payload.duration_ms, undefined);
});

Deno.test("[LogSyncMethod] wraps a synchronous method, emits started/completed without awaiting the target", () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Calculator {
    @LogSyncMethod(logger, { action: DomainEventType.FlowStepExecuted })
    double(n: number): number {
      return n * 2;
    }
  }

  const obj = new Calculator();
  const result = obj.double(21);

  assertEquals(result, 42);
  assertEquals(logCalls.map((c) => c.level), ["debug", "info"]);
});

Deno.test("[LogSyncMethod] emits failed and rethrows when the sync target throws", () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Calculator {
    @LogSyncMethod(logger, { action: DomainEventType.FlowStepExecuted })
    divide(n: number, by: number): number {
      if (by === 0) throw new Error("division by zero");
      return n / by;
    }
  }

  const obj = new Calculator();
  assertThrows(() => obj.divide(1, 0), Error, "division by zero");
  assertEquals(logCalls.map((c) => c.level), ["debug", "error"]);
});

Deno.test("[LogGeneratorMethod] emits started before the first yield, completed after the generator returns", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Streamer {
    @LogGeneratorMethod(logger, { action: DomainEventType.FlowStepExecuted })
    async *stream(): AsyncGenerator<string> {
      yield "a";
      yield "b";
    }
  }

  const obj = new Streamer();
  const received: string[] = [];
  for await (const value of obj.stream()) {
    received.push(value);
    assertEquals(logCalls.filter((c) => c.level === "debug").length, 1);
    assertEquals(logCalls.some((c) => c.level === "info"), false);
  }

  assertEquals(received, ["a", "b"]);
  assertEquals(logCalls.map((c) => c.level), ["debug", "info"]);
});

Deno.test("[LogGeneratorMethod] emits failed when the wrapped generator throws mid-iteration", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class FailingStreamer {
    @LogGeneratorMethod(logger, { action: DomainEventType.FlowStepExecuted })
    async *stream(): AsyncGenerator<string> {
      yield "a";
      throw new Error("stream broke");
    }
  }

  const obj = new FailingStreamer();
  const received: string[] = [];
  await assertRejects(
    async () => {
      for await (const value of obj.stream()) {
        received.push(value);
      }
    },
    Error,
    "stream broke",
  );

  assertEquals(received, ["a"]);
  assertEquals(logCalls.map((c) => c.level), ["debug", "error"]);
});

Deno.test("[LogGeneratorMethod] emits failed (not started-without-resolution) when the target throws synchronously before producing a generator at all", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class ThrowingStreamer {
    @LogGeneratorMethod(logger, { action: DomainEventType.FlowStepExecuted })
    stream(): AsyncGenerator<string> {
      throw new Error("no generator for you");
    }
  }

  const obj = new ThrowingStreamer();
  const gen = obj.stream();
  await assertRejects(() => gen.next(), Error, "no generator for you");

  assertEquals(logCalls.map((c) => c.level), ["debug", "error"]);
});

Deno.test("[LogGeneratorMethod] resolves a constructor-injected logger and emits cancellation on early return", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Streamer {
    constructor(private readonly logger: IEventLogger) {}

    @LogGeneratorMethod((self: Streamer) => self.logger, { action: DomainEventType.FlowStepExecuted })
    async *stream(): AsyncGenerator<string> {
      yield "a";
      yield "b";
    }
  }

  const stream = new Streamer(logger).stream();
  await stream.next();
  await stream.return(undefined);

  assertEquals(logCalls.map((call) => call.level), ["debug", "warn"]);
});

Deno.test("[LogSyncMethod] resolves a constructor-injected logger at invocation time", () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Calculator {
    constructor(private readonly logger: IEventLogger) {}

    @LogSyncMethod((self: Calculator) => self.logger, { action: DomainEventType.FlowStepExecuted })
    double(value: number): number {
      return value * 2;
    }
  }

  assertEquals(new Calculator(logger).double(21), 42);
  assertEquals(logCalls.map((call) => call.level), ["debug", "info"]);
});

Deno.test("[LogMethod] shares one canonical trace ID across started/completed for one call, a different one on the next call", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Svc {
    @LogMethod(logger, { action: DomainEventType.FlowStepExecuted })
    async run(): Promise<void> {}
  }

  const obj = new Svc();
  await obj.run();
  const [firstStarted, firstCompleted] = logCalls;
  assertEquals(typeof firstStarted.traceId, "string");
  assertEquals(firstStarted.traceId, firstCompleted.traceId);

  await obj.run();
  const [, , secondStarted] = logCalls;
  assertEquals(secondStarted.traceId === firstStarted.traceId, false);
});

Deno.test("[LogGeneratorMethod] shares one canonical trace ID across started/completed/failed/cancelled", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Streamer {
    @LogGeneratorMethod(logger, { action: DomainEventType.FlowStepExecuted })
    async *stream(): AsyncGenerator<string> {
      yield "a";
    }
  }

  const obj = new Streamer();
  for await (const _value of obj.stream()) { /* drain */ }

  assertEquals(logCalls.length, 2);
  assertEquals(typeof logCalls[0].traceId, "string");
  assertEquals(logCalls[0].traceId, logCalls[1].traceId);
});

Deno.test("[LogMethod] uses per-phase actions when action is an ILifecycleActions object", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Svc {
    @LogMethod(logger, {
      action: {
        started: DomainEventType.ExecutionStarted,
        completed: DomainEventType.ExecutionCompleted,
        failed: DomainEventType.ExecutionFailed,
      },
    })
    async run(shouldFail: boolean): Promise<void> {
      if (shouldFail) throw new Error("boom");
      await Promise.resolve();
    }
  }

  const obj = new Svc();
  await obj.run(false);
  assertEquals(logCalls[0].msg, DomainEventType.ExecutionStarted);
  assertEquals(logCalls[1].msg, DomainEventType.ExecutionCompleted);

  await assertRejects(() => obj.run(true));
  assertEquals(logCalls[3].msg, DomainEventType.ExecutionFailed);
});

Deno.test("[LogGeneratorMethod] uses the cancelled action from an IGeneratorLifecycleActions object on early return", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Streamer {
    @LogGeneratorMethod(logger, {
      action: {
        started: DomainEventType.LlmCallStarted,
        completed: DomainEventType.LlmStreamCompleted,
        failed: DomainEventType.LlmStreamFailed,
        cancelled: DomainEventType.LlmStreamCancelled,
      },
    })
    async *stream(): AsyncGenerator<string> {
      yield "a";
      yield "b";
    }
  }

  const stream = new Streamer().stream();
  await stream.next();
  await stream.return(undefined);

  assertEquals(logCalls.map((c) => c.level), ["debug", "warn"]);
  assertEquals(logCalls[1].msg, DomainEventType.LlmStreamCancelled);
});

Deno.test("[LogGeneratorMethod] payloadMapper shapes the completed payload from args, yield count, and duration", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Streamer {
    @LogGeneratorMethod<Streamer, [string], string>(logger, {
      action: DomainEventType.FlowStepExecuted,
      payloadMapper: (args, yieldCount, durationMs) => ({
        label: args[0],
        chunk_count: yieldCount,
        duration_ms: Math.round(durationMs),
      }),
    })
    async *stream(_label: string): AsyncGenerator<string> {
      yield "a";
      yield "b";
      yield "c";
    }
  }

  const received: string[] = [];
  for await (const value of new Streamer().stream("run-1")) received.push(value);

  assertEquals(received, ["a", "b", "c"]);
  const completedCall = logCalls.find((c) => c.level === "info");
  assertEquals(completedCall?.payload.label, "run-1");
  assertEquals(completedCall?.payload.chunk_count, 3);
  assertEquals(typeof completedCall?.payload.duration_ms, "number");
});

Deno.test("[LogGeneratorMethod] startedPayloadMapper replaces the default raw-argument dump", async () => {
  const logCalls: ILogCall[] = [];
  const logger = mockLogger(logCalls);

  class Streamer {
    @LogGeneratorMethod<Streamer, [string], string>(logger, {
      action: DomainEventType.FlowStepExecuted,
      startedPayloadMapper: (args) => ({ prompt_length: args[0].length }),
    })
    async *stream(prompt: string): AsyncGenerator<string> {
      void prompt;
      yield "a";
    }
  }

  const received: string[] = [];
  for await (const value of new Streamer().stream("a very long prompt that must not be logged in full")) {
    received.push(value);
  }

  assertEquals(received, ["a"]);
  const startedCall = logCalls.find((c) => c.level === "debug");
  assertEquals(startedCall?.payload.prompt_length, "a very long prompt that must not be logged in full".length);
  assertEquals(startedCall?.payload.args, undefined);
});
