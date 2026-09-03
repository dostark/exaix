/**
 * @module SessionDelegationResultStoreTest
 * @path packages/session/tests/session_delegation_result_store_test.ts
 * @description Phase 174 Step 1 tests for durable typed delegation outcomes,
 *   exactly-once delivery transitions, and validated brief recovery reads.
 * @architectural-layer Tests
 * @related-files [packages/session/src/session_delegation_result_store.ts, packages/session/src/session_brief_reader.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import {
  SessionDelegationOutcomeSchema,
  SessionDelegationResultRecordSchema,
} from "@exaix/session/session_delegation.ts";
import { SessionBriefReader } from "@exaix/session/session_brief_reader.ts";
import { SessionDelegationResultStore } from "@exaix/session/session_delegation_result_store.ts";

const TRACE_ID = "00000000-0000-4000-8000-000000000174";
const PARENT_TRACE_ID = "00000000-0000-4000-8000-000000000173";

function completedOutcome(summary: string) {
  return SessionDelegationOutcomeSchema.parse({
    delegationTraceId: TRACE_ID,
    parentTraceId: PARENT_TRACE_ID,
    parentStepId: "1",
    sequence: 1,
    status: "completed",
    decision: "changes_made",
    summary,
    pathsTouched: ["src/coordinator.ts"],
    tokenStats: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    },
    costUsd: 0.01,
  });
}

Deno.test("[session_result_store] accepted outcome is hidden until delivered and CAS delivers once", async () => {
  const root = await Deno.makeTempDir();
  try {
    const store = new SessionDelegationResultStore(root);
    const outcome = completedOutcome("first accepted result");

    await store.publishAccepted(TRACE_ID, outcome);
    assertEquals(await store.get(TRACE_ID), null);

    const onDisk = SessionDelegationResultRecordSchema.parse(
      JSON.parse(
        await Deno.readTextFile(
          join(root, TRACE_ID, "session_delegate_result.json"),
        ),
      ),
    );
    assertEquals(onDisk.state, "reconciled");
    assertEquals(onDisk.outcome.summary, "first accepted result");

    const transitions = await Promise.all([
      store.markDelivered(TRACE_ID),
      store.markDelivered(TRACE_ID),
    ]);
    assertEquals(transitions.filter(Boolean).length, 1);
    assertEquals((await store.get(TRACE_ID))?.summary, "first accepted result");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[session_result_store][race] duplicate publication preserves the first typed outcome", async () => {
  const root = await Deno.makeTempDir();
  try {
    const store = new SessionDelegationResultStore(root);
    await Promise.all([
      store.publishAccepted(TRACE_ID, completedOutcome("authoritative")),
      store.publishAccepted(TRACE_ID, completedOutcome("duplicate")),
    ]);

    assertEquals((await store.getRecord(TRACE_ID))?.outcome.summary, "authoritative");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[session_result_store][security] trace mismatch is rejected before persistence", async () => {
  const root = await Deno.makeTempDir();
  try {
    const store = new SessionDelegationResultStore(root);
    await assertRejects(
      () => store.publishAccepted(crypto.randomUUID(), completedOutcome("mismatch")),
      Error,
      "trace mismatch",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[session_brief_reader][security] recovery reads a schema-validated brief by trace", async () => {
  const root = await Deno.makeTempDir();
  try {
    const traceDir = join(root, TRACE_ID);
    await Deno.mkdir(traceDir, { recursive: true });
    const brief = SessionBriefSchema.parse({
      trace_id: TRACE_ID,
      parent_trace_id: PARENT_TRACE_ID,
      parent_step_id: "1",
      sequence: 1,
      agent_role: "test-identity",
      gate: "code_changes",
      tool: "codex",
      objective: "Recover this validated objective.",
      artifact_ref: ".exa/PlanContext/phase-174.md",
      permitted_paths: ["packages/**"],
      token_budget: {
        max_input_tokens: 100,
        max_output_tokens: 100,
        max_total_tokens: 200,
      },
      resume_token: "secret-token",
      deadline: "2026-12-31T00:00:00.000Z",
    });
    await Deno.writeTextFile(join(traceDir, "brief.json"), JSON.stringify(brief));

    const reader = new SessionBriefReader(root);
    assertEquals((await reader.read(TRACE_ID)).objective, "Recover this validated objective.");

    await Deno.writeTextFile(join(traceDir, "brief.json"), JSON.stringify({ ...brief, unexpected: true }));
    await assertRejects(() => reader.read(TRACE_ID));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
