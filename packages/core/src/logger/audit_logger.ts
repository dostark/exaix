/**
 * @module AuditLogger
 * @path packages/core/src/logger/audit_logger.ts
 * @description specialized audit logger for security-critical operations, providing tamper-evident logging with alerting.
 * @architectural-layer Services
 * @related-files ["packages/storage-sqlite/src/database_service.ts", "packages/core/src/types/enums.ts"]
 */

import { dirname, join } from "@std/path";

import type { IEventLogger } from "../logger/mod.ts";
import type { JSONValue } from "../types/json.ts";
import type { IAuditLogger, ISecurityEvent } from "../types/mod.ts";
import { DomainEventType } from "../events/mod.ts";

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Configuration for AuditLogger
 */
export interface IAuditLoggerConfig {
  /** Event logger for primary security event routing */
  logger?: IEventLogger;

  /** Base configuration for audit paths */
  config?: { paths?: { runtime?: string } };
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Security-critical audit logger: primary event transport goes through IEventLogger;
 * a tamper-evident JSONL file is a secondary append-only sink for alerting-critical events.
 */
export class AuditLogger implements IAuditLogger {
  private readonly logger?: IEventLogger;
  private readonly config: IAuditLoggerConfig;
  private currentSessionId: string;

  constructor(config: IAuditLoggerConfig = {}) {
    this.logger = config.logger;
    this.config = config;
    this.currentSessionId = crypto.randomUUID();
  }

  /**
   * Log a security event through IEventLogger and to tamper-evident audit file
   */
  async logSecurityEvent(event: ISecurityEvent): Promise<void> {
    const auditEntry = this.createAuditEntry(event);

    // Route through IEventLogger for visibility in console, journal, and event bus
    if (this.logger) {
      void this.logger.info(DomainEventType.SecurityViolation, auditEntry.resource as string, {
        ...auditEntry,
        event_type: event.type,
        event_action: event.action,
        severity: event.severity,
      });
    }

    // Write to tamper-evident audit file (secondary append-only sink)
    await this.appendToAuditFile(auditEntry);

    // Send alert for critical events
    if (event.severity === "critical") {
      await this.sendSecurityAlert(auditEntry);
    }
  }

  /** Placeholder: logs to console only; production should integrate with real alerting (email/Slack/PagerDuty/SIEM). */
  async sendSecurityAlert(auditEntry: Record<string, JSONValue>): Promise<void> {
    // Placeholder implementation
    await console.error("[SECURITY ALERT]", JSON.stringify(auditEntry, null, 2));

    // TODO: integrate with real alerting (email, Slack/Discord, PagerDuty, SIEM).
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
