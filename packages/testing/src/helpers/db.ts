/**
 * @module TestingPackageDbHelpers
 * @path packages/testing/src/helpers/db.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Shared DB-related test helpers for package-local tests.
 */
import type { JSONValue } from "@exaix/core";

export interface ILoggedActivity {
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

export interface ITestDatabaseService {
  logActivity(
    actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId?: string,
    actorType?: string | null,
    agentRole?: string | null,
    runnerKind?: string | null,
    promptTokens?: number,
    completionTokens?: number,
    costUsd?: number,
  ): void;
}

export interface ILoggingTestDb {
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
