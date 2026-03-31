/**
 * @module AuditLoggerTest
 * @path tests/audit_logger_test.ts
 * @description Verifies the AuditLogger service, ensuring that internal system
 * events and security violations are correctly logged for traceability.
 */

import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";

import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { initTestDbService } from "../../helpers/db.ts";
import { AuditLogger } from "../../../src/services/core/audit_logger.ts";
import { SecurityEventResult, SecurityEventType, SecuritySeverity } from "../../../src/shared/enums.ts";
import { join } from "@std/path";
import { TEST_MODEL_ANTHROPIC } from "../../config/constants.ts";

/**
 * Clean up audit folder created during tests
 */
async function cleanupAuditFolder(): Promise<void> {
  try {
    const auditDir = join(".", "audit");
    await Deno.remove(auditDir, { recursive: true });
  } catch {
    // Ignore if audit folder doesn't exist or can't be removed
  }
}

Deno.test("AuditLogger: logs security events to database", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const auditLogger = new AuditLogger({ db });
    const logSpy = spy(db, "logActivity");

    const event = {
      type: SecurityEventType.PERMISSION,
      action: "portal_access_check",
      actor: "agent123",
      resource: "/portal/secure",
      result: SecurityEventResult.DENIED,
      metadata: { reason: "insufficient_permissions" },
      severity: SecuritySeverity.HIGH,
    };

    await auditLogger.logSecurityEvent(event);

    assertSpyCalls(logSpy, 1);
    const args = logSpy.calls[0].args;
    // actor, action, target, payload
    assertEquals(args[0], "agent123");
    assertEquals(args[1], "audit.permission.portal_access_check");
  } finally {
    await cleanup();
    await cleanupAuditFolder();
  }
});

Deno.test("AuditLogger: fallback to file only on DB failure", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const auditLogger = new AuditLogger({ db });
    // Mock db to throw
    const logStub = stub(db, "logActivity", () => {
      throw new Error("DB Error");
    });

    const consoleSpy = spy(console, "warn");

    const event = {
      type: SecurityEventType.AUTH,
      action: "login_fail",
      actor: "user",
      resource: "system",
      result: SecurityEventResult.ERROR,
      severity: SecuritySeverity.LOW,
    };

    await auditLogger.logSecurityEvent(event);

    // Should verify console warning
    assertSpyCalls(consoleSpy, 1);
    assertStringIncludes(consoleSpy.calls[0].args[0], "Failed to write to audit database");

    // File verification
    const auditFile = `audit/${new Date().toISOString().split("T")[0]}.jsonl`;
    const content = await Deno.readTextFile(auditFile);
    assertStringIncludes(content, "login_fail");

    logStub.restore();
    consoleSpy.restore();
  } finally {
    await cleanup();
    await cleanupAuditFolder();
  }
});

Deno.test("AuditLogger: works without DB configured", async () => {
  const auditLogger = new AuditLogger({}); // No DB

  const event = {
    type: SecurityEventType.CONFIG_CHANGE,
    action: "change",
    actor: "admin",
    resource: "settings",
    result: SecurityEventResult.SUCCESS,
    severity: SecuritySeverity.LOW,
  };

  await auditLogger.logSecurityEvent(event);

  // File verification
  const auditFile = `audit/${new Date().toISOString().split("T")[0]}.jsonl`;
  const content = await Deno.readTextFile(auditFile);
  assertStringIncludes(content, "settings");

  await cleanupAuditFolder();
});

Deno.test("AuditLogger: sends alerts for critical events", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const auditLogger = new AuditLogger({ db });
    const alertSpy = spy(auditLogger, "sendSecurityAlert");

    const criticalEvent = {
      type: SecurityEventType.AUTH,
      action: "api_key_exposed",
      actor: "system",
      resource: "anthropic_api_key",
      result: SecurityEventResult.ERROR,
      metadata: { location: "memory_dump" },
      severity: SecuritySeverity.CRITICAL,
    };

    await auditLogger.logSecurityEvent(criticalEvent);

    assertSpyCalls(alertSpy, 1);
    const alertArgs = alertSpy.calls[0].args[0] as { severity: SecuritySeverity; action: string };
    assertEquals(alertArgs.severity, SecuritySeverity.CRITICAL);
    assertEquals(alertArgs.action, "api_key_exposed");
  } finally {
    await cleanup();
    await cleanupAuditFolder();
  }
});

Deno.test("AuditLogger: masks sensitive data in logs (comprehensive)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const auditLogger = new AuditLogger({ db });
    const event = {
      type: SecurityEventType.AUTH,
      action: "test_masking",
      actor: "tester",
      resource: "test",
      result: SecurityEventResult.SUCCESS,
      metadata: {
        api_key: "sk-ant-api03-1234567890abcdef",
        short_key: "12345",
        password: "secret_password",
        token: "ghp_sometokenvalue1234567890",
        short_token: "abc",
        model: TEST_MODEL_ANTHROPIC,
        nested: {
          password: "nested_secret",
        },
        list: ["not", "masked"], // Arrays skipped
      },
      severity: SecuritySeverity.LOW,
    };

    await auditLogger.logSecurityEvent(event);

    const auditFile = `audit/${new Date().toISOString().split("T")[0]}.jsonl`;
    const content = await Deno.readTextFile(auditFile);
    const lines = content.trim().split("\n");
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    const metadata = lastEntry.metadata;

    // API Key (long)
    assertFalse(metadata.api_key.includes("very-long"));
    assertStringIncludes(metadata.api_key, "***");
    assertEquals(metadata.api_key.startsWith("sk-a"), true);

    // Token (long)
    assertFalse(metadata.token.includes("sometoken"));
    assertEquals(metadata.token.startsWith("ghp_"), true);

    // Password
    assertEquals(metadata.password, "***");

    // Nested
    assertEquals(metadata.nested.password, "***");

    // Test Short Keys (Separate event)
    const shortEvent = {
      ...event,
      metadata: {
        api_key: "12345",
        token: "abc",
      },
    };
    await auditLogger.logSecurityEvent(shortEvent);

    // Read new last line
    const content2 = await Deno.readTextFile(auditFile);
    const lines2 = content2.trim().split("\n");
    const lastEntry2 = JSON.parse(lines2[lines2.length - 1]);

    assertEquals(lastEntry2.metadata.api_key, "***");
    assertEquals(lastEntry2.metadata.token, "***");
  } finally {
    await cleanup();
    await cleanupAuditFolder();
  }
});
