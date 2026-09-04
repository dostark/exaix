/**
 * @module IActivityRepository
 * @path packages/core/src/repositories/activity_repository.ts
 * @description Implements the Repository pattern for IActivity Journal data access, abstracting database operations from domain logic.
 * @architectural-layer Repositories
 * @related-files ["packages/storage-sqlite/src/database_service.ts", "packages/core/src/logger/event_logger.ts"]
 */

import type { IDatabaseService } from "../types/i_database_service.ts";
import type { JSONValue } from "../types/json.ts";

import type { IActivityRecord } from "@exaix/core/types";

/**
 * Domain entity representing an activity/event
 */
export interface IActivity {
  id: string;
  traceId: string;
  actor: string | null;
  actorType: string | null;
  runnerId: string | null;
  runnerKind?: string | null;
  agentRole: string | null;
  actionType: string;
  target: string | null;
  payload: Record<string, JSONValue>;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  timestamp: string;
}

/**
 * IActivity logging request (without generated fields)
 */
export interface ILogActivityRequest {
  actor: string;
  actionType: string;
  target: string | null;
  payload?: Record<string, JSONValue>;
  traceId?: string;
  runnerId?: string | null;
  actorType?: string | null;
  runnerKind?: string | null;
  agentRole?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

/**
 * Repository interface for activity data access
 */
export interface IActivityRepository {
  /**
   * Log an activity/event
   */
  logActivity(request: ILogActivityRequest): Promise<void>;

  /**
   * Get activities by trace ID
   */
  getActivitiesByTraceId(traceId: string): Promise<IActivity[]>;

  /**
   * Get activities by action type
   */
  getActivitiesByActionType(actionType: string): Promise<IActivity[]>;

  /**
   * Get recent activities
   */
  getRecentActivities(limit?: number): Promise<IActivity[]>;
}

/**
 * Database implementation of IActivityRepository
 */
export class DatabaseActivityRepository implements IActivityRepository {
  constructor(private db: IDatabaseService) {}

  async logActivity(request: ILogActivityRequest): Promise<void> {
    this.db.logActivity(
      request.actor,
      request.actionType,
      request.target,
      request.payload ?? {},
      request.traceId,
      request.actorType,
      request.agentRole,
      request.runnerKind,
      request.promptTokens,
      request.completionTokens,
      request.costUsd,
    );

    // Wait for the activity to be flushed to ensure it's persisted
    // This is important for tests and immediate reads
    await this.db.waitForFlush();
  }

  async getActivitiesByTraceId(traceId: string): Promise<IActivity[]> {
    const records = await this.db.getActivitiesByTraceSafe(traceId);
    return records.map(this.mapRecordToActivity);
  }

  async getActivitiesByActionType(actionType: string): Promise<IActivity[]> {
    const records = await this.db.getActivitiesByActionTypeSafe(actionType);
    return records.map(this.mapRecordToActivity);
  }

  async getRecentActivities(limit: number = 100): Promise<IActivity[]> {
    const records = await this.db.getRecentActivity(limit);
    return records.map(this.mapRecordToActivity);
  }

  /**
   * Map database record to domain entity
   */
  private mapRecordToActivity(record: IActivityRecord): IActivity {
    let payload: Record<string, JSONValue> = {};
    try {
      payload = JSON.parse(record.payload);
    } catch {
      // If payload is malformed, return empty object
      payload = {};
    }

    return {
      id: record.id,
      traceId: record.trace_id,
      actor: record.actor,
      actorType: record.actor_type,
      runnerId: null, // Legacy: no longer tracked this way
      runnerKind: record.runner_kind,
      agentRole: record.agent_role,
      actionType: record.action_type,
      target: record.target,
      payload,
      promptTokens: record.prompt_tokens ?? 0,
      completionTokens: record.completion_tokens ?? 0,
      costUsd: record.cost_usd ?? 0,
      timestamp: record.timestamp,
    };
  }
}
