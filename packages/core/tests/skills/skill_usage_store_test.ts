/**
 * @module SkillUsageStoreTest
 * @path packages/core/tests/skills/skill_usage_store_test.ts
 * @description Phase 206 Step 5 — SkillUsageStore over a real journal DB and EventLogger: one row
 *   per skill per submission, an atomic full-vector insert, idempotent re-record, concurrent
 *   duplicate calls, per-use provenance, per-name and per-revision summaries, trace joins and
 *   fail-closed terminal errors.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/skills/skill_usage_store.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { SkillMatchSource, SkillRenderOutcome, SkillRootKind, SkillSubmissionKind } from "@exaix/core";
import { DomainEventType, EventRegistry } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import {
  computeRevisionId,
  computeSkillContentSha256,
  type ILoadedSkill,
  type ISkillOperationContext,
  type ISkillRevisionSnapshot,
  type ISkillSubmission,
  parseSkillSnapshot,
  SkillAuditUnavailableError,
  SkillRevisionStore,
  SkillUsageStore,
} from "@exaix/core/skills";
import { buildRootContext } from "../../src/skills/skill_snapshot.ts";
import { initTestDbService } from "@exaix/testing";

const CTX: ISkillOperationContext = {
  portal: null,
  traceId: "55555555-5555-4555-8555-555555555555",
  requestId: "req-1",
  flowId: "flow-1",
  flowStepId: "step-1",
  agentRole: "tester",
  configGeneration: "static",
};

async function loaded(name: string, body: string): Promise<ILoadedSkill> {
  const snapshot: ISkillRevisionSnapshot = {
    skill_md: `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`,
    exaix_yaml: null,
    references: [],
  };
  const root = { path: "/x", kind: SkillRootKind.BLUEPRINT, writable: false, project: null };
  const skill = await parseSkillSnapshot(snapshot, buildRootContext(root, name));
  return {
    skill,
    revisionId: await computeRevisionId(await computeSkillContentSha256(snapshot)),
    contentSha256: skill.content_sha256,
    rootKind: SkillRootKind.BLUEPRINT,
    sourcePath: name,
    snapshot,
  };
}

function submission(callId: string, items: ILoadedSkill[], round = 1, attempt = 1): ISkillSubmission {
  return {
    callId,
    submissionKind: SkillSubmissionKind.PROVIDER,
    round,
    attempt,
    items: items.map((entry) => ({
      skillName: entry.skill.name,
      revisionId: entry.revisionId,
      matchSource: SkillMatchSource.PINNED,
      renderMode: SkillRenderOutcome.FULL,
      rootKind: entry.rootKind,
      sourcePath: entry.sourcePath,
    })),
  };
}

async function withStores(
  fn: (
    usage: SkillUsageStore,
    revisions: SkillRevisionStore,
    env: Awaited<ReturnType<typeof initTestDbService>>,
  ) => Promise<void>,
): Promise<void> {
  const env = await initTestDbService();
  try {
    const logger = new EventLogger({ db: env.db });
    const registry = new EventRegistry(logger);
    const deps = { db: env.db, logger, eventRegistry: registry };
    await fn(new SkillUsageStore(deps), new SkillRevisionStore(deps), env);
  } finally {
    await env.cleanup();
  }
}

Deno.test("[usage] record writes one row per skill with full provenance and journals one event", async () => {
  await withStores(async (usage, revisions, env) => {
    const a = await loaded("skill-a", "Body A");
    const b = await loaded("skill-b", "Body B");
    await revisions.record(a, CTX);
    await revisions.record(b, CTX);
    await usage.record(submission("call-1", [a, b]), CTX);
    const rows = await env.db.preparedAll<Record<string, string | number>>(
      "SELECT * FROM skill_usage ORDER BY skill_name",
    );
    assertEquals(rows.length, 2);
    assertEquals(rows[0].skill_name, "skill-a");
    assertEquals(rows[0].call_id, "call-1");
    assertEquals(rows[0].revision_id, a.revisionId);
    assertEquals(
      [rows[0].trace_id, rows[0].request_id, rows[0].flow_id, rows[0].flow_step_id, rows[0].agent_role],
      [CTX.traceId, "req-1", "flow-1", "step-1", "tester"],
    );
    assertEquals(
      [rows[0].match_source, rows[0].render_mode, rows[0].submission_kind, rows[0].round, rows[0].attempt],
      ["pinned", "full", "provider", 1, 1],
    );
    assertEquals([rows[0].root_kind, rows[0].source_path, rows[0].config_generation], [
      "blueprint",
      "skill-a",
      "static",
    ]);
    await env.db.waitForFlush();
    const events = await env.db.getActivitiesByActionTypeSafe(DomainEventType.SkillsUsageRecorded);
    assertEquals(events.length, 1);
    assertEquals(events[0].trace_id, CTX.traceId);
    assertEquals(JSON.parse(events[0].payload).count, 2);
  });
});

Deno.test("[usage] re-recording the same call is idempotent and distinct calls add rows", async () => {
  await withStores(async (usage, revisions, env) => {
    const a = await loaded("skill-a", "Body A");
    await revisions.record(a, CTX);
    await usage.record(submission("call-1", [a]), CTX);
    await usage.record(submission("call-1", [a]), CTX);
    await usage.record(submission("call-2", [a], 1, 2), CTX);
    const rows = await env.db.preparedAll<{ call_id: string }>("SELECT call_id FROM skill_usage ORDER BY id");
    assertEquals(rows.map((r) => r.call_id), ["call-1", "call-2"]);
  });
});

Deno.test("[usage] concurrent duplicate calls leave exactly one row per skill", async () => {
  await withStores(async (usage, revisions, env) => {
    const a = await loaded("skill-a", "Body A");
    await revisions.record(a, CTX);
    await Promise.all([1, 2, 3, 4].map(() => usage.record(submission("call-1", [a]), CTX)));
    assertEquals((await env.db.preparedAll("SELECT id FROM skill_usage")).length, 1);
  });
});

Deno.test("[usage] a vector with an unrecorded revision writes no partial row and fails closed", async () => {
  await withStores(async (usage, revisions, env) => {
    const a = await loaded("skill-a", "Body A");
    const missing = await loaded("skill-missing", "Never recorded");
    await revisions.record(a, CTX);
    await env.db.preparedRun("PRAGMA foreign_keys = ON");
    const error = await assertRejects(
      () => usage.record(submission("call-1", [a, missing]), CTX),
      SkillAuditUnavailableError,
    );
    assertEquals(error.code, "skill_audit_unavailable");
    assertEquals((await env.db.preparedAll("SELECT id FROM skill_usage")).length, 0, "the vector is all or nothing");
    await env.db.waitForFlush();
    const failures = await env.db.getActivitiesByActionTypeSafe(DomainEventType.SkillsAuditFailed);
    const payload = JSON.parse(failures[0].payload);
    assertEquals([payload.stage, payload.call_id], ["usage", "call-1"]);
  });
});

Deno.test("[usage] an empty vector writes nothing and a dropped table fails closed", async () => {
  await withStores(async (usage, revisions, env) => {
    await usage.record(submission("call-0", []), CTX);
    assertEquals((await env.db.preparedAll("SELECT id FROM skill_usage")).length, 0);
    const a = await loaded("skill-a", "Body A");
    await revisions.record(a, CTX);
    await env.db.preparedRun("DROP TABLE skill_usage");
    await assertRejects(() => usage.record(submission("call-1", [a]), CTX), SkillAuditUnavailableError);
  });
});

Deno.test("[usage] summary totals per name and per revision, with first seen and last use", async () => {
  await withStores(async (usage, revisions) => {
    const one = await loaded("skill-a", "Body one");
    const two = await loaded("skill-a", "Body two");
    await revisions.record(one, CTX);
    await revisions.record(two, CTX);
    await usage.record(submission("c1", [one]), CTX);
    await usage.record(submission("c2", [one], 1, 2), CTX);
    await usage.record(submission("c3", [two]), CTX);
    const summary = await usage.summary("skill-a", CTX);
    assertEquals(summary.name, "skill-a");
    assertEquals(summary.totalUses, 3);
    assertEquals(summary.revisions.length, 2);
    const byId = new Map(summary.revisions.map((r) => [r.revisionId, r]));
    assertEquals(byId.get(one.revisionId)?.useCount, 2);
    assertEquals(byId.get(two.revisionId)?.useCount, 1);
    assertEquals(typeof summary.lastUsedAt, "string");
    assertEquals(typeof byId.get(one.revisionId)?.firstSeenAt, "string");
    const none = await usage.summary("never-used", CTX);
    assertEquals([none.totalUses, none.lastUsedAt, none.revisions], [0, null, []]);
  });
});

Deno.test("[usage] byTrace returns every use on one trace joined to its canonical snapshot", async () => {
  await withStores(async (usage, revisions) => {
    const a = await loaded("skill-a", "Body A");
    await revisions.record(a, CTX);
    await usage.record(submission("c1", [a]), CTX);
    await usage.record(submission("c2", [a], 2, 1), { ...CTX, traceId: "other-trace" });
    const rows = await usage.byTrace(CTX.traceId, CTX);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].callId, "c1");
    assertEquals(rows[0].snapshot.skill_md.includes("Body A"), true);
    assertEquals(rows[0].flowId, "flow-1");
  });
});
