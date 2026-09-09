/**
 * @module InspectCommandsTest
 * @path apps/exactl/tests/inspect_commands_test.ts
 * @description Phase 176 Step 3 — `exactl request inspect` over a fake
 * `IContextInspectionReader`: single/multiple child records, parent-trace lineage
 * fallback, JSON/raw output, all exit categories (success, malformed input, no
 * capture, corrupt/inaccessible read), native-visibility fields, and that `--raw`
 * never runs to a TTY or an ambiguous multi-record set.
 * @architectural-layer Tests
 * @related-files [apps/exactl/src/commands/inspect_commands.ts, packages/session/src/context_record_store.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createStubContext } from "@exaix/testing";
import { InspectCommands } from "../src/commands/inspect_commands.ts";
import type { IContextInspectionReader } from "@exaix/core/types";
import {
  CONTEXT_RECORD_SCHEMA_VERSION,
  type ContextRecord,
  type ContextRecordSummary,
} from "@exaix/schemas/dogfood_context.ts";
import { captureConsoleOutput, expectExitWithLogs } from "./helpers/test_utils.ts";

const TRACE_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_TRACE_ID = "22222222-2222-4222-8222-222222222222";
const RECORD_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_TRACE_ID = "44444444-4444-4444-8444-444444444444";

function makeRecord(overrides: Partial<ContextRecord> = {}): ContextRecord {
  return {
    schemaVersion: CONTEXT_RECORD_SCHEMA_VERSION,
    recordId: RECORD_ID,
    executionTraceId: TRACE_ID,
    parentTraceId: PARENT_TRACE_ID,
    stepId: "step-1",
    sequence: 1,
    turn: 0,
    attempt: 1,
    surface: "session_delegate_cycle",
    model: "anthropic:claude-sonnet-5",
    timestamp: "2026-09-10T00:00:00.000Z",
    originalInputSha256: "a".repeat(64),
    promptText: "the exact post-redaction submission",
    promptSha256: "b".repeat(64),
    originalTokenCount: 100,
    finalTokenCount: 80,
    tokenSource: "counted",
    effectiveInputLimit: 16384,
    effectiveReserveLimit: 4096,
    sections: [],
    tools: [],
    visibility: "exaix_submission_only",
    nativePrompt: "unknown",
    nativeTools: "unknown",
    nativeHistory: "unknown",
    ...overrides,
  };
}

function toSummary(record: ContextRecord): ContextRecordSummary {
  return {
    recordId: record.recordId,
    executionTraceId: record.executionTraceId,
    parentTraceId: record.parentTraceId,
    stepId: record.stepId,
    sequence: record.sequence,
    turn: record.turn,
    attempt: record.attempt,
    surface: record.surface,
    model: record.model,
    timestamp: record.timestamp,
  };
}

/** Deterministic in-memory fake — the real store's own filesystem behavior (symlink
 *  refusal, atomic write, retention) is covered by phase176_context_record_store_test.ts. */
class FakeReader implements IContextInspectionReader {
  constructor(
    private readonly byExecutionTrace: Map<string, ContextRecord[]> = new Map(),
    private readonly readError?: (traceId: string, recordId: string) => Error | undefined,
  ) {}

  list(traceId: string): Promise<readonly ContextRecordSummary[]> {
    return Promise.resolve((this.byExecutionTrace.get(traceId) ?? []).map(toSummary));
  }

  listByParentTrace(parentTraceId: string): Promise<readonly ContextRecordSummary[]> {
    const all = [...this.byExecutionTrace.values()].flat();
    return Promise.resolve(all.filter((r) => r.parentTraceId === parentTraceId).map(toSummary));
  }

  read(traceId: string, recordId: string): Promise<ContextRecord> {
    const forcedError = this.readError?.(traceId, recordId);
    if (forcedError) return Promise.reject(forcedError);
    const record = (this.byExecutionTrace.get(traceId) ?? []).find((r) => r.recordId === recordId);
    if (!record) return Promise.reject(new Deno.errors.NotFound(`no record ${recordId} under ${traceId}`));
    return Promise.resolve(record);
  }
}

function inspectCommand(store: IContextInspectionReader): InspectCommands {
  return new InspectCommands(createStubContext(), { store });
}

function exitCode(err: Error): number {
  const match = err.message.match(/^DENO_EXIT:(\d+)$/);
  assert(match, `expected a DENO_EXIT:<code> message, got: ${err.message}`);
  return Number(match[1]);
}

Deno.test("[inspect] a single captured record auto-shows detail (no --record needed)", async () => {
  const store = new FakeReader(new Map([[TRACE_ID, [makeRecord()]]]));
  const out = await captureConsoleOutput(() => inspectCommand(store).inspect(TRACE_ID, {}));
  assertStringIncludes(out, RECORD_ID);
  assertStringIncludes(out, "anthropic:claude-sonnet-5");
});

Deno.test("[inspect] --json emits parseable JSON for a single-record detail view", async () => {
  const store = new FakeReader(new Map([[TRACE_ID, [makeRecord()]]]));
  const out = await captureConsoleOutput(() => inspectCommand(store).inspect(TRACE_ID, { json: true }));
  const parsed = JSON.parse(out);
  assertEquals(parsed.recordId, RECORD_ID);
  assertEquals(parsed.nativePrompt, "unknown");
  assertEquals(parsed.nativeTools, "unknown");
  assertEquals(parsed.nativeHistory, "unknown");
});

Deno.test("[inspect] multiple records under one trace show a summary list, not auto-detail", async () => {
  const second = makeRecord({ recordId: "55555555-5555-4555-8555-555555555555", sequence: 2 });
  const store = new FakeReader(new Map([[TRACE_ID, [makeRecord(), second]]]));
  const out = await captureConsoleOutput(() => inspectCommand(store).inspect(TRACE_ID, {}));
  assertStringIncludes(out, RECORD_ID);
  assertStringIncludes(out, second.recordId);
});

Deno.test("[inspect] --record selects a specific record out of a multi-record trace", async () => {
  const second = makeRecord({ recordId: "55555555-5555-4555-8555-555555555555", sequence: 2, promptText: "second" });
  const store = new FakeReader(new Map([[TRACE_ID, [makeRecord(), second]]]));
  const out = await captureConsoleOutput(() =>
    inspectCommand(store).inspect(TRACE_ID, { record: second.recordId, json: true })
  );
  assertEquals(JSON.parse(out).recordId, second.recordId);
});

Deno.test("[inspect] a parent trace_id (no direct records) falls back to bounded child lineage lookup", async () => {
  const child = makeRecord({ executionTraceId: CHILD_TRACE_ID, parentTraceId: PARENT_TRACE_ID });
  const store = new FakeReader(new Map([[CHILD_TRACE_ID, [child]]]));
  const out = await captureConsoleOutput(() => inspectCommand(store).inspect(PARENT_TRACE_ID, { json: true }));
  assertEquals(JSON.parse(out).recordId, RECORD_ID);
});

Deno.test("[inspect] --raw exports the exact promptText bytes, nothing else, no trailing decoration", async () => {
  const store = new FakeReader(new Map([[TRACE_ID, [makeRecord({ promptText: "exact bytes\nwith a newline" })]]]));
  const written: string[] = [];
  const cmd = new InspectCommands(createStubContext(), {
    store,
    writeRaw: (text: string) => {
      written.push(text);
      return Promise.resolve();
    },
    isStdoutTty: () => false,
  });
  await cmd.inspect(TRACE_ID, { record: RECORD_ID, raw: true });
  assertEquals(written, ["exact bytes\nwith a newline"]);
});

Deno.test("[inspect][security] --raw refuses to write to a TTY", async () => {
  const store = new FakeReader(new Map([[TRACE_ID, [makeRecord()]]]));
  const cmd = new InspectCommands(createStubContext(), { store, isStdoutTty: () => true });
  const result = await expectExitWithLogs(() => cmd.inspect(TRACE_ID, { record: RECORD_ID, raw: true }));
  assertEquals(exitCode(result.err), 2);
  assertStringIncludes(result.errors.join("\n"), "TTY");
});

Deno.test("[inspect][security] --raw without --record is ambiguous when multiple records exist", async () => {
  const second = makeRecord({ recordId: "55555555-5555-4555-8555-555555555555", sequence: 2 });
  const store = new FakeReader(new Map([[TRACE_ID, [makeRecord(), second]]]));
  const cmd = new InspectCommands(createStubContext(), { store, isStdoutTty: () => false });
  const result = await expectExitWithLogs(() => cmd.inspect(TRACE_ID, { raw: true }));
  assertEquals(exitCode(result.err), 2);
  assertStringIncludes(result.errors.join("\n"), "--record");
});

Deno.test("[inspect][security] --json and --raw together are rejected", async () => {
  const store = new FakeReader(new Map([[TRACE_ID, [makeRecord()]]]));
  const cmd = new InspectCommands(createStubContext(), { store, isStdoutTty: () => false });
  const result = await expectExitWithLogs(() => cmd.inspect(TRACE_ID, { record: RECORD_ID, json: true, raw: true }));
  assertEquals(exitCode(result.err), 2);
});

Deno.test("[inspect][security] a malformed trace_id (not a UUID) is rejected before any store access", async () => {
  const store = new FakeReader();
  const cmd = inspectCommand(store);
  const result = await expectExitWithLogs(() => cmd.inspect("not-a-uuid", {}));
  assertEquals(exitCode(result.err), 2);
});

Deno.test("[inspect][security] a malformed --record (not a UUID) is rejected", async () => {
  const store = new FakeReader(new Map([[TRACE_ID, [makeRecord()]]]));
  const cmd = inspectCommand(store);
  const result = await expectExitWithLogs(() => cmd.inspect(TRACE_ID, { record: "short-id" }));
  assertEquals(exitCode(result.err), 2);
});

Deno.test("[inspect] no captured records for the trace (or its lineage) is a structured no_capture, exit 3", async () => {
  const store = new FakeReader();
  const cmd = inspectCommand(store);
  const result = await expectExitWithLogs(() => cmd.inspect(TRACE_ID, {}));
  assertEquals(exitCode(result.err), 3);
  assertStringIncludes(result.errors.join("\n").toLowerCase(), "no captured context");
});

Deno.test("[inspect] a deleted/expired record referenced by --record is no_capture, exit 3 — never reconstructed", async () => {
  const store = new FakeReader(new Map()); // record was pruned; nothing on disk
  const cmd = inspectCommand(store);
  const result = await expectExitWithLogs(() => cmd.inspect(TRACE_ID, { record: RECORD_ID }));
  assertEquals(exitCode(result.err), 3);
});

Deno.test("[inspect] a corrupt/unparseable record read is a read failure, exit 1", async () => {
  const store = new FakeReader(
    new Map([[TRACE_ID, [makeRecord()]]]),
    () => new SyntaxError("Unexpected token in JSON"),
  );
  const cmd = inspectCommand(store);
  const result = await expectExitWithLogs(() => cmd.inspect(TRACE_ID, { record: RECORD_ID }));
  assertEquals(exitCode(result.err), 1);
});

Deno.test("[inspect] a permission-denied record read is a read failure, exit 1", async () => {
  const store = new FakeReader(
    new Map([[TRACE_ID, [makeRecord()]]]),
    () => new Deno.errors.PermissionDenied("denied"),
  );
  const cmd = inspectCommand(store);
  const result = await expectExitWithLogs(() => cmd.inspect(TRACE_ID, { record: RECORD_ID }));
  assertEquals(exitCode(result.err), 1);
});

Deno.test("[inspect] control bytes in promptText are escaped in the non-raw preview, never sent raw to the terminal", async () => {
  const store = new FakeReader(new Map([[TRACE_ID, [makeRecord({ promptText: "before\x07bell\x1bafter" })]]]));
  const out = await captureConsoleOutput(() => inspectCommand(store).inspect(TRACE_ID, {}));
  assert(!out.includes("\x07"), "raw BEL control byte must never reach the terminal preview");
  assert(!out.includes("\x1b"), "raw ESC control byte must never reach the terminal preview");
});

Deno.test("[inspect] reports the granted tool schemas captured on the record", async () => {
  const record = makeRecord({
    tools: [{
      name: "search_memory",
      description: "d",
      inputSchema: {},
      outputSchema: {},
      schemaDigest: "digest-1",
    }],
  });
  const store = new FakeReader(new Map([[TRACE_ID, [record]]]));
  const out = await captureConsoleOutput(() => inspectCommand(store).inspect(TRACE_ID, { json: true }));
  assertEquals(JSON.parse(out).tools[0].name, "search_memory");
});
