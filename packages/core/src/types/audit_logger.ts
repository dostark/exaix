/**
 * @module AuditLoggerTypes
 * @path packages/core/src/types/audit_logger.ts
 * @related-files []
 * @architectural-layer Core
 * @description Interfaces for audit logging.
 */

import type { SecurityEventResult, SecurityEventType, SecuritySeverity } from "@exaix/core";
import type { JSONValue } from "@exaix/core/types";

export interface ISecurityEvent {
  type: SecurityEventType;
  action: string;
  actor: string;
  resource: string;
  result: SecurityEventResult;
  metadata?: Record<string, JSONValue>;
  severity?: SecuritySeverity;
}

export interface IAuditLogger {
  logSecurityEvent(event: ISecurityEvent): void;
}
