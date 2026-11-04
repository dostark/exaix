/**
 * @module TestingPackageDbHelpers
 * @path packages/testing/src/helpers/db.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Shared DB-related test helpers for package-local tests.
 */
import type { ILogActivityDetails, Opt, Reason } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";

interface ILoggedActivity {
  actor: string;
  actionType: string;
  target: string | null;
  payload: Record<string, JSONValue>;
  traceId?: string;
  actorType?: string | null;
  agentRole?: string | null;
  runnerKind?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

interface ITestDatabaseService {
  logActivity(
    actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId?: Opt<string, Reason.OptionalInput>,
    details?: Opt<ILogActivityDetails, Reason.OptionalInput>,
  ): void;
}

interface ILoggingTestDb {
  activities: ILoggedActivity[];
  db: ITestDatabaseService;
}

export function createLoggingTestDb(): ILoggingTestDb {
  const activities: ILoggedActivity[] = [];

  const db: ITestDatabaseService = {
    logActivity(actor, actionType, target, payload, traceId, details) {
      activities.push({
        actor,
        actionType,
        target,
        payload,
        traceId,
        actorType: details?.actorType,
        agentRole: details?.agentRole,
        runnerKind: details?.runnerKind,
        promptTokens: details?.promptTokens,
        completionTokens: details?.completionTokens,
        costUsd: details?.costUsd ?? undefined,
      });
    },
  };

  return {
    activities,
    db,
  };
}
