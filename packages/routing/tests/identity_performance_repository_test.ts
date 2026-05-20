import { assertEquals } from "@std/assert";
import type { IActivityRecord } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/core/types";
import { IdentityPerformanceRepository } from "@exaix/routing";

const makeStubDb = (records: IActivityRecord[]): IDatabaseService => ({
  queryActivity: () => Promise.resolve(records),
  logActivity: () => undefined,
  waitForFlush: () => Promise.resolve(),
  close: () => Promise.resolve(),
  preparedGet: () => Promise.resolve(null),
  preparedAll: () => Promise.resolve([]),
  preparedRun: () => Promise.resolve(undefined),
  getActivitiesByTrace: () => [],
  getActivitiesByTraceSafe: () => Promise.resolve([]),
  getActivitiesByActionType: () => [],
  getActivitiesByActionTypeSafe: () => Promise.resolve([]),
  getRecentActivity: () => Promise.resolve(records),
  insertToolConfirmationRequest: () => Promise.resolve(),
  writeToolConfirmationDecision: () => Promise.resolve(),
  getToolConfirmationDecision: () => Promise.resolve(null),
  listPendingToolConfirmations: () => Promise.resolve([]),
});

Deno.test("[IdentityPerformanceRepository] aggregates performance by identity", async () => {
  const records: IActivityRecord[] = [
    {
      id: "1",
      trace_id: "trace-1",
      actor: "agent",
      actor_type: null,
      identity_id: "senior-coder",
      agent_kind: null,
      action_type: "agent.execution.completed",
      target: "TestPortal",
      payload: JSON.stringify({
        success: true,
        confidence: 88,
        capabilities: ["code_review"],
        version: "2.0.0",
        portal: "TestPortal",
      }),
      prompt_tokens: 120,
      completion_tokens: 240,
      cost_usd: 0.12,
      timestamp: "2026-04-20T00:00:00.000Z",
    },
  ];

  const repo = new IdentityPerformanceRepository({ db: makeStubDb(records) });
  const snapshots = await repo.getPerformanceByIdentity("senior-coder");

  assertEquals(snapshots.length, 1);
  assertEquals(snapshots[0].identityId, "senior-coder");
  assertEquals(snapshots[0].version, "2.0.0");
  assertEquals(snapshots[0].sampleSize, 1);
  assertEquals(snapshots[0].successRate, 1);
  assertEquals(snapshots[0].averageConfidence, 88);
  assertEquals(snapshots[0].averagePromptTokens, 120);
  assertEquals(snapshots[0].averageCostUsd, 0.12);
  assertEquals(snapshots[0].stable, false);
});

Deno.test("[IdentityPerformanceRepository] filters by capability and portal name", async () => {
  const records: IActivityRecord[] = [
    {
      id: "1",
      trace_id: "trace-1",
      actor: "agent",
      actor_type: null,
      identity_id: "security-architect",
      agent_kind: null,
      action_type: "agent.execution.completed",
      target: "TestPortal",
      payload: JSON.stringify({
        success: false,
        confidence: 60,
        capabilities: ["security_analysis"],
        version: "1.2.0",
        portal: "TestPortal",
      }),
      prompt_tokens: 80,
      completion_tokens: 150,
      cost_usd: 0.05,
      timestamp: "2026-04-20T01:00:00.000Z",
    },
    {
      id: "2",
      trace_id: "trace-2",
      actor: "agent",
      actor_type: null,
      identity_id: "security-architect",
      agent_kind: null,
      action_type: "agent.execution.completed",
      target: "OtherPortal",
      payload: JSON.stringify({
        success: true,
        confidence: 92,
        capabilities: ["security_analysis"],
        version: "1.2.0",
        portal: "OtherPortal",
      }),
      prompt_tokens: 100,
      completion_tokens: 210,
      cost_usd: 0.08,
      timestamp: "2026-04-21T01:00:00.000Z",
    },
  ];

  const repo = new IdentityPerformanceRepository({ db: makeStubDb(records) });
  const snapshots = await repo.getPerformanceByCapability("security_analysis", "TestPortal");

  assertEquals(snapshots.length, 1);
  assertEquals(snapshots[0].identityId, "security-architect");
  assertEquals(snapshots[0].version, "1.2.0");
  assertEquals(snapshots[0].sampleSize, 1);
  assertEquals(snapshots[0].averageConfidence, 60);
  assertEquals(snapshots[0].stable, false);
});

Deno.test("[IdentityPerformanceRepository] marks snapshots stable when sample threshold is reached", async () => {
  const records: IActivityRecord[] = Array.from({ length: 5 }, (_, index) => ({
    id: `${index + 1}`,
    trace_id: `trace-${index + 1}`,
    actor: "agent",
    actor_type: null,
    identity_id: "stability-agent",
    agent_kind: null,
    action_type: "agent.execution.completed",
    target: "TestPortal",
    payload: JSON.stringify({
      success: true,
      confidence: 80,
      capabilities: ["code_review"],
      version: "1.0.0",
      portal: "TestPortal",
    }),
    prompt_tokens: 100,
    completion_tokens: 200,
    cost_usd: 0.1,
    timestamp: `2026-04-20T0${index}:00:00.000Z`,
  }));

  const repo = new IdentityPerformanceRepository({
    db: makeStubDb(records),
    sampleThreshold: 5,
  });

  const snapshots = await repo.getPerformanceByIdentity("stability-agent");

  assertEquals(snapshots.length, 1);
  assertEquals(snapshots[0].stable, true);
});
