/**
 * @module ActivityRepository
 * @path src/repositories/activity_repository.ts
 * @description Implements the Repository pattern for IActivity Journal data access, abstracting database operations from domain logic.
 * @architectural-layer Repositories
 * @dependencies [db_schema, db_service]
 * @related-files [src/services/db.ts, src/services/event_logger.ts]
 */

import type { ActivityRecord, IDatabaseService } from "../services/core/db.ts";
import { JSONValue } from "../shared/types/json.ts";

/**
 * Domain entity representing an activity/event
 */
export interface IActivity {
  id: string;
  traceId: string;
  actor: string | null;
  actorType: string | null;
  agentId: string | null;
  agentKind?: string | null;
  identityId: string | null;
  actionType: string;
  target: string | null;
  payload: Record<string, JSONValue>;
  timestamp: string;
}

/**
 * IActivity logging request (without generated fields)
 */
export interface LogActivityRequest {
  actor: string;
  actionType: string;
  target: string | null;
  payload?: Record<string, JSONValue>;
  traceId?: string;
  agentId?: string | null;
  actorType?: string | null;
  agentKind?: string | null;
  identityId?: string | null;
}

/**
 * Repository interface for activity data access
 */
export interface ActivityRepository {
  /**
   * Log an activity/event
   */
  logActivity(request: LogActivityRequest): Promise<void>;

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
 * Database implementation of ActivityRepository
 */
export class DatabaseActivityRepository implements ActivityRepository {
  constructor(private db: IDatabaseService) {}

  async logActivity(request: LogActivityRequest): Promise<void> {
    this.db.logActivity(
      request.actor,
      request.actionType,
      request.target,
      request.payload ?? {},
      request.traceId,
      request.actorType,
      request.identityId,
      request.agentKind,
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
  private mapRecordToActivity(record: ActivityRecord): IActivity {
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
      agentId: null, // Legacy: no longer tracked this way
      agentKind: record.agent_kind,
      identityId: record.identity_id,
      actionType: record.action_type,
      target: record.target,
      payload,
      timestamp: record.timestamp,
    };
  }
}
