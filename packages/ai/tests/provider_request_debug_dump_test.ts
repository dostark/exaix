/**
 * @module ProviderRequestDebugDumpTest
 * @path packages/ai/tests/provider_request_debug_dump_test.ts
 * @description Verifies request debug journaling, trace correlation, compatible privacy and malformed body handling.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/core/src/logger/event_logger.ts]
 */
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { stub } from "@std/testing/mock";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import type { ILogEvent, Opt, Reason } from "@exaix/core/types";
import { LogLevel, PROVIDER_EVENT_REQUEST_DEBUG_DUMP, PROVIDER_EVENT_RESPONSE_DEBUG_DUMP } from "@exaix/core";
import { AuthenticationError } from "../src/providers/common.ts";
import { performProviderCall } from "../src/provider_common_utils.ts";

const PROVIDER_ID = "request-dump-fixture";
const TRACE_ID = "trace-request-dump-fixture";
const SECRET = "header-only-fixture-secret";
const REQUEST_BODY = {
  model: "fixture-model",
  messages: [{ role: "user", content: "Inspect the boundary.\nKeep context." }],
};
const FETCH_OPTIONS: RequestInit = {
  method: "POST",
  body: JSON.stringify(REQUEST_BODY),
  headers: { Authorization: `Bearer ${SECRET}`, "x-api-key": SECRET, "Content-Type": "application/json" },
};
type ITestDb = Awaited<ReturnType<typeof initTestDbService>>["db"];
interface IRequestDumpContext {
  db: ITestDb;
  logger: EventLogger;
  events: ILogEvent[];
  call: (
    request?: Opt<RequestInit, Reason.OptionalInput>,
    logResponseBody?: Opt<boolean, Reason.OptionalContext>,
  ) => ReturnType<typeof performProviderCall>;
}

async function withDebugJournal(
  run: (context: IRequestDumpContext) => Promise<void>,
  minLevel: LogLevel = LogLevel.DEBUG,
  status: number = 200,
): Promise<void> {
  const { db, cleanup } = await initTestDbService();
  const consoleStub = stub(console, "log", () => {});
  const fetchStub = stub(globalThis, "fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          status === 200 ? { choices: [{ message: { content: "ok" } }] } : { error: { message: "fixture denied" } },
        ),
        { status },
      ),
    ));
  try {
    const events: ILogEvent[] = [];
    const logger = new EventLogger({
      db,
      minLevel,
      outputs: [{
        write: (event) => {
          events.push(event);
        },
      }],
    });
    await run({
      db,
      logger,
      events,
      call: (request = {}, logResponseBody) =>
        performProviderCall(
          "https://example.invalid/v1/chat/completions",
          { ...FETCH_OPTIONS, ...request },
          { id: PROVIDER_ID, logger, traceId: TRACE_ID, maxAttempts: 1, logResponseBody },
        ),
    });
  } finally {
    fetchStub.restore();
    consoleStub.restore();
    await cleanup();
  }
}

Deno.test("[request-dump] performProviderCall journals the request body at debug level", async () => {
  await withDebugJournal(async ({ db, events, call }) => {
    await call();
    await db.waitForFlush();
    const rows = db.getActivitiesByTrace(TRACE_ID).filter((row) =>
      row.action_type === PROVIDER_EVENT_REQUEST_DEBUG_DUMP
    );
    assertEquals(rows.length, 1);
    assertEquals(events.find((event) => event.action === PROVIDER_EVENT_REQUEST_DEBUG_DUMP)?.level, LogLevel.DEBUG);
    assertEquals(rows[0].target, PROVIDER_ID);
    assertEquals(JSON.parse(rows[0].payload), { provider: PROVIDER_ID, request_body: REQUEST_BODY });
  });
});

Deno.test("[request-dump] the compatible branch journals no request body", async () => {
  await withDebugJournal(async ({ db, call }) => {
    await call({}, false);
    await db.waitForFlush();
    assertEquals(db.getActivitiesByActionType(PROVIDER_EVENT_REQUEST_DEBUG_DUMP), []);
    assertEquals(db.getActivitiesByActionType(PROVIDER_EVENT_RESPONSE_DEBUG_DUMP), []);
  });
});

Deno.test("[request-dump][security] no header value appears in the event", async () => {
  await withDebugJournal(async ({ db, call }) => {
    await call();
    await db.waitForFlush();
    const rows = db.getActivitiesByActionType(PROVIDER_EVENT_REQUEST_DEBUG_DUMP);
    assertEquals(rows.length, 1);
    assertEquals(JSON.stringify(rows).includes(SECRET), false);
    assertEquals(JSON.stringify(rows).includes("Authorization"), false);
    assertEquals(JSON.stringify(rows).includes("x-api-key"), false);
  });
});

Deno.test("[request-dump] the default info logger journals no request body", async () => {
  await withDebugJournal(async ({ db, call }) => {
    await call();
    await db.waitForFlush();
    assertEquals(db.getActivitiesByActionType(PROVIDER_EVENT_REQUEST_DEBUG_DUMP), []);
  }, LogLevel.INFO);
});

for (
  const [label, body] of [
    ["malformed JSON", "not-json"],
    ["missing body", undefined],
    ["binary body", new TextEncoder().encode(JSON.stringify(REQUEST_BODY))],
  ] as const
) {
  Deno.test(`[request-dump] ${label} keeps the provider call usable without a request dump`, async () => {
    await withDebugJournal(async ({ db, call }) => {
      const result = await call({ body });
      await db.waitForFlush();
      assertEquals(result.content, "ok");
      assertEquals(db.getActivitiesByActionType(PROVIDER_EVENT_REQUEST_DEBUG_DUMP), []);
      assertEquals(db.getActivitiesByActionType(PROVIDER_EVENT_RESPONSE_DEBUG_DUMP).length, 1);
    });
  });
}

Deno.test("[request-dump] rejected HTTP requests still have a trace-correlated request dump", async () => {
  await withDebugJournal(
    async ({ db, call }) => {
      await assertRejects(() => call(), AuthenticationError);
      await db.waitForFlush();
      const row = db.getActivitiesByTrace(TRACE_ID).find((row) =>
        row.action_type === PROVIDER_EVENT_REQUEST_DEBUG_DUMP
      );
      assertExists(row);
      assertEquals(JSON.parse(row.payload).request_body, REQUEST_BODY);
    },
    LogLevel.DEBUG,
    401,
  );
});

Deno.test("[request-dump] no logger keeps the provider call usable", async () => {
  await withDebugJournal(async () => {
    const result = await performProviderCall("https://example.invalid/v1/chat/completions", FETCH_OPTIONS, {
      id: PROVIDER_ID,
    });
    assertEquals(result.content, "ok");
  });
});
