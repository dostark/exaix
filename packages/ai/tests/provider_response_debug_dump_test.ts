/**
 * @module ProviderResponseDebugDumpTest
 * @path packages/ai/tests/provider_response_debug_dump_test.ts
 * @related-files [packages/ai/src/provider_common_utils.ts]
 * @architectural-layer AI
 * @description Verifies performProviderCall journals the COMPLETE raw provider
 * response body (provider.response_debug_dump, debug level) — including the parts
 * the content extractor deliberately strips, such as thinking blocks and
 * stop_reason — so a live-provider failure can be investigated from the journal
 * alone, symmetric with the existing provider.request_debug_dump.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { stub } from "@std/testing/mock";
import { performProviderCall } from "../src/provider_common_utils.ts";
import { PROVIDER_EVENT_RESPONSE_DEBUG_DUMP } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";

const PROVIDER_ID = "anthropic-test";
const THINKING_TEXT = "Let me reason about the null guard first.";
const ANSWER_TEXT = "Add the optional chain.";

interface ICapturedDebug {
  action: string;
  target: string | null;
  payload?: LogMetadata;
}

function buildDebugCapturingLogger(sink: ICapturedDebug[]): IEventLogger {
  const logger: IEventLogger = {
    log: () => Promise.resolve(),
    info: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: (action: string, target: string | null, payload?: LogMetadata) => {
      sink.push({ action, target, payload });
      return Promise.resolve();
    },
    child: () => logger,
  };
  return logger;
}

function anthropicThinkingResponse(): Response {
  return new Response(
    JSON.stringify({
      id: "msg_debugdump",
      content: [
        { type: "thinking", thinking: THINKING_TEXT },
        { type: "text", text: ANSWER_TEXT },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200 },
  );
}

Deno.test("[response-dump] performProviderCall journals the complete raw response body at debug level", async () => {
  const debugEvents: ICapturedDebug[] = [];
  const fetchStub = stub(globalThis, "fetch", () => Promise.resolve(anthropicThinkingResponse()));
  try {
    await performProviderCall("https://example.invalid/v1/messages", { method: "POST" }, {
      id: PROVIDER_ID,
      logger: buildDebugCapturingLogger(debugEvents),
    });
  } finally {
    fetchStub.restore();
  }

  const dump = debugEvents.find((e) => e.action === PROVIDER_EVENT_RESPONSE_DEBUG_DUMP);
  assertExists(dump, "the raw response body must be journaled for follow-up investigation");
  assertEquals(dump.target, PROVIDER_ID);
  const body = JSON.stringify(dump.payload?.response_body ?? {});
  assert(
    body.includes(THINKING_TEXT),
    "the dump must preserve thinking blocks that content extraction strips",
  );
  assert(body.includes(ANSWER_TEXT), "the dump must contain the text content");
  assert(body.includes("end_turn"), "the dump must contain stop_reason");
});

Deno.test("[response-dump] no logger means no dump and no crash", async () => {
  const fetchStub = stub(globalThis, "fetch", () => Promise.resolve(anthropicThinkingResponse()));
  try {
    const result = await performProviderCall("https://example.invalid/v1/messages", { method: "POST" }, {
      id: PROVIDER_ID,
    });
    assertEquals(result.provider, PROVIDER_ID);
  } finally {
    fetchStub.restore();
  }
});
