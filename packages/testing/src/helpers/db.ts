/**
 * @module TestingPackageDbHelpers
 * @path packages/testing/src/helpers/db.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Shared DB-related test helpers for package-local tests.
 */
import type { Opt, Reason } from "@exaix/core/types";
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
    actorType?: Opt<string | null, Reason.OptionalInput>,
    agentRole?: Opt<string | null, Reason.OptionalInput>,
    runnerKind?: Opt<string | null, Reason.OptionalInput>,
    promptTokens?: Opt<number, Reason.OptionalInput>,
    completionTokens?: Opt<number, Reason.OptionalInput>,
    costUsd?: Opt<number, Reason.OptionalInput>,
  ): void;
}

interface ILoggingTestDb {
  activities: ILoggedActivity[];
  db: ITestDatabaseService;
}

export function createLoggingTestDb(): ILoggingTestDb {
  const activities: ILoggedActivity[] = [];

  const db: ITestDatabaseService = {
    logActivity(
      actor,
      actionType,
      target,
      payload,
      traceId,
      actorType,
      agentRole,
      runnerKind,
      promptTokens,
      completionTokens,
      costUsd,
    ) {
      activities.push({
        actor,
        actionType,
        target,
        payload,
        traceId,
        actorType,
        agentRole,
        runnerKind,
        promptTokens,
        completionTokens,
        costUsd,
      });
    },
  };

  return {
    activities,
    db,
  };
}
