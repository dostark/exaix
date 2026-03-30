/**
 * @module AuditLogger
 * @path src/services/audit_logger.ts
 * @description specialized audit logger for security-critical operations, providing tamper-evident logging with alerting.
 * @architectural-layer Services
 * @dependencies [DatabaseService, Path, SecurityEnums]
 * @related-files [src/services/db.ts, src/enums.ts]
 */

import type { DatabaseService } from "../core/db.ts";
import { dirname, join } from "@std/path";
import { SecurityEventResult, SecurityEventType, SecuritySeverity } from "../../shared/enums.ts";
import { JSONValue } from "../../shared/types/json.ts";

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Structured security audit event
 */
export interface ISecurityEvent {
  /** Type of security event */
  type: SecurityEventType;

  /** Specific action performed */
  action: string;

  /** Actor performing the action (user, agent, system) */
  actor: string;

  /** Resource being accessed/modified */
  resource: string;

  /** Result of the operation */
  result: SecurityEventResult;

  /** Additional context data */
  metadata?: Record<string, JSONValue>;

  /** Severity level for alerting */
  severity: SecuritySeverity;
}

/**
 * Configuration for AuditLogger
 */
export interface AuditLoggerConfig {
  /** DatabaseService instance (optional - allows file-only mode) */
  db?: DatabaseService;

  /** Base configuration for audit paths */
  config?: { paths?: { runtime?: string } };
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Specialized audit logger for security-critical operations.
 * Provides tamper-evident logging with alerting capabilities.
 */
export class AuditLogger {
  private readonly db?: DatabaseService;
  private readonly config: AuditLoggerConfig;
  private currentSessionId: string;

  constructor(config: AuditLoggerConfig = {}) {
    this.db = config.db;
    this.config = config;
    this.currentSessionId = crypto.randomUUID();
  }

  /**
   * Log a security event to database and tamper-evident audit file
   */
  async logSecurityEvent(event: ISecurityEvent): Promise<void> {
    const auditEntry = this.createAuditEntry(event);

    // Log to database (if available)
    if (this.db) {
      try {
        // Use the existing logActivity method with audit-specific action type
        this.db.logActivity(
          auditEntry.actor as string,
          `audit.${auditEntry.type}.${auditEntry.action}`,
          auditEntry.resource as string,
          auditEntry as Record<string, JSONValue>,
          auditEntry.trace_id as string,
          null, // identityId
        );
      } catch (error) {
        console.warn("[AuditLogger] Failed to write to audit database:", error);
        // Continue with file logging even if DB fails
      }
    }

    // Write to tamper-evident audit file
    await this.appendToAuditFile(auditEntry);

    // Send alert for critical events
    if (event.severity === "critical") {
      await this.sendSecurityAlert(auditEntry);
    }
  }

  /**
   * Send security alert for critical events
   * This is a placeholder - in production this would integrate with
   * alerting systems, email, Slack, etc.
   */
  async sendSecurityAlert(auditEntry: Record<string, JSONValue>): Promise<void> {
    // Placeholder implementation
    await console.error("[SECURITY ALERT]", JSON.stringify(auditEntry, null, 2));

    // TODO: Integrate with actual alerting system
    // - Send email to security team
    // - Post to Slack/Discord security channel
    // - Trigger PagerDuty/monitoring alerts
    // - Log to SIEM system
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Create a complete audit entry with all required fields
   */
  private createAuditEntry(event: ISecurityEvent): Record<string, JSONValue> {
    const now = new Date();
    const maskedMetadata = this.maskSensitiveData(event.metadata || {});

    return {
      type: event.type,
      action: event.action,
      actor: event.actor,
      resource: event.resource,
      result: event.result,
      severity: event.severity,
      metadata: maskedMetadata,
      timestamp: now.getTime(),
      timestamp_iso: now.toISOString(),
      trace_id: crypto.randomUUID(),
      session_id: this.currentSessionId,
    };
  }

  /**
   * Mask sensitive data in metadata to prevent leakage in logs
   */
  private maskSensitiveData(metadata: Record<string, JSONValue>): Record<string, JSONValue> {
    const masked = { ...metadata };

    // Mask API keys
    if (typeof masked.api_key === "string") {
      masked.api_key = this.maskApiKey(masked.api_key);
    }

    // Mask passwords
    if (typeof masked.password === "string") {
      masked.password = "***";
    }

    // Mask tokens
    if (typeof masked.token === "string") {
      masked.token = this.maskToken(masked.token);
    }

    // Recursively mask nested objects
    for (const [key, value] of Object.entries(masked)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        masked[key] = this.maskSensitiveData(value as Record<string, JSONValue>);
      }
    }

    return masked;
  }

  /**
   * Mask API key while preserving structure for debugging
   */
  private maskApiKey(apiKey: string): string {
    if (apiKey.length < 10) return "***";

    // Keep first few chars and last few chars for identification
    const prefix = apiKey.substring(0, 4);
    const suffix = apiKey.substring(apiKey.length - 4);
    return `${prefix}***${suffix}`;
  }

  /**
   * Mask token
   */
  private maskToken(token: string): string {
    if (token.length < 8) return "***";
    return `${token.substring(0, 4)}***${token.substring(token.length - 4)}`;
  }

  /**
   * Append audit entry to tamper-evident JSONL file
   */
  private async appendToAuditFile(entry: Record<string, JSONValue>): Promise<void> {
    const runtimeDir = this.config.config?.paths?.runtime || ".";
    const auditDir = join(runtimeDir, "audit");
    const dateString = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const auditFile = join(auditDir, `${dateString}.jsonl`);

    // Ensure directory exists
    await Deno.mkdir(dirname(auditFile), { recursive: true });

    // Append to file (JSONL format - one JSON object per line)
    const file = await Deno.open(auditFile, {
      write: true,
      create: true,
      append: true,
    });

    try {
      const encoder = new TextEncoder();
      const jsonLine = JSON.stringify(entry) + "\n";
      await file.write(encoder.encode(jsonLine));
    } finally {
      file.close();
    }
  }
}
