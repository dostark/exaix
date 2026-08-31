/**
 * @module PortalPermissionsTest
 * @path packages/portal/tests/portal_permissions_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Verifies the capability-based security model for portals, ensuring strict
 * enforcement of agent whitelisting and protection against unauthorized tool access.
 */

import { assertEquals, assertExists } from "@std/assert";

import { PermissionAction, PortalOperation, SecurityMode } from "@exaix/core";
import { PortalPermissionsService } from "@exaix/portal";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

// Test Helpers

function createTestPortal(overrides: Partial<IPortalPermissions> = {}): IPortalPermissions {
  return {
    alias: "TestPortal",
    target_path: "/tmp/test-portal",
    default_branch: TEST_DEFAULT_BRANCH,
    identities_allowed: ["agent-1", "agent-2"],
    operations: [
      PortalOperation.READ,
      PortalOperation.WRITE,
      PortalOperation.GIT,
    ],
    security: {
      mode: SecurityMode.SANDBOXED,
      audit_enabled: true,
      log_all_actions: true,
    },
    ...overrides,
  };
}

function createTestService(portals: IPortalPermissions[] = [createTestPortal()]): PortalPermissionsService {
  return new PortalPermissionsService(portals, undefined);
}

// Agent Whitelist Tests

Deno.test("IPortalPermissions: allows whitelisted agent", () => {
  const service = createTestService();

  const result = service.checkAgentAllowed("TestPortal", "agent-1");

  assertEquals(result.allowed, true);
  assertEquals(result.portal, "TestPortal");
  assertEquals(result.identity_id, "agent-1");
});

Deno.test("IPortalPermissions: rejects non-whitelisted agent", () => {
  const service = createTestService();

  const result = service.checkAgentAllowed("TestPortal", "unauthorized-agent");

  assertEquals(result.allowed, false);
  assertExists(result.reason);
  assertEquals(result.reason?.includes("not allowed"), true);
});

Deno.test("IPortalPermissions: allows all agents with wildcard", () => {
  const portal = createTestPortal({
    identities_allowed: ["*"],
  });
  const service = createTestService([portal]);

  const result = service.checkAgentAllowed("TestPortal", "any-agent");

  assertEquals(result.allowed, true);
});

Deno.test("IPortalPermissions: rejects unknown portal", () => {
  const portal = createTestPortal();
  const service = createTestService([portal]);

  const result = service.checkAgentAllowed("UnknownPortal", "agent-1");

  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("not found"), true);
});

// Operation Permission Tests

Deno.test("IPortalPermissions: allows permitted read operation", () => {
  const portal = createTestPortal({
    operations: [
      PortalOperation.READ,
      PortalOperation.WRITE,
    ],
  });
  const service = createTestService([portal]);

  const result = service.checkOperationAllowed("TestPortal", "agent-1", PortalOperation.READ);

  assertEquals(result.allowed, true);
  assertEquals(result.operation, PortalOperation.READ);
});

Deno.test("IPortalPermissions: allows permitted write operation", () => {
  const portal = createTestPortal({
    operations: [
      PortalOperation.READ,
      PortalOperation.WRITE,
    ],
  });
  const service = createTestService([portal]);

  const result = service.checkOperationAllowed("TestPortal", "agent-1", PortalOperation.WRITE);

  assertEquals(result.allowed, true);
  assertEquals(result.operation, PortalOperation.WRITE);
});

Deno.test("IPortalPermissions: allows permitted git operation", () => {
  const portal = createTestPortal({
    operations: [
      PortalOperation.READ,
      PortalOperation.GIT,
    ],
  });
  const service = createTestService([portal]);

  const result = service.checkOperationAllowed("TestPortal", "agent-1", PortalOperation.GIT);

  assertEquals(result.allowed, true);
  assertEquals(result.operation, PortalOperation.GIT);
});

Deno.test("IPortalPermissions: rejects unpermitted operation", () => {
  const portal = createTestPortal({
    operations: [PortalOperation.READ], // No write or git
  });
  const service = createTestService([portal]);

  const result = service.checkOperationAllowed("TestPortal", "agent-1", PortalOperation.WRITE);

  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("not permitted"), true);
});

Deno.test("IPortalPermissions: rejects operation for non-whitelisted agent", () => {
  const portal = createTestPortal();
  const service = createTestService([portal]);

  const result = service.checkOperationAllowed("TestPortal", "unauthorized-agent", PortalOperation.READ);

  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("not allowed"), true);
});

// Security Mode Tests

Deno.test("IPortalPermissions: returns sandboxed security mode", () => {
  const portal = createTestPortal({
    security: {
      mode: SecurityMode.SANDBOXED,
      audit_enabled: true,
      log_all_actions: true,
    },
  });
  const service = createTestService([portal]);

  const mode = service.getSecurityMode("TestPortal");

  assertEquals(mode, SecurityMode.SANDBOXED);
});

Deno.test("IPortalPermissions: returns hybrid security mode", () => {
  const portal = createTestPortal({
    security: {
      mode: SecurityMode.HYBRID,
      audit_enabled: true,
      log_all_actions: true,
    },
  });
  const service = createTestService([portal]);

  const mode = service.getSecurityMode("TestPortal");

  assertEquals(mode, SecurityMode.HYBRID);
});

Deno.test("IPortalPermissions: defaults to sandboxed if no security config", () => {
  const portal = createTestPortal({
    security: undefined,
  });
  const service = createTestService([portal]);

  const mode = service.getSecurityMode("TestPortal");

  assertEquals(mode, SecurityMode.SANDBOXED);
});

// Multiple Portals Tests

Deno.test("IPortalPermissions: handles multiple portals independently", () => {
  const portal1 = createTestPortal({
    alias: "Portal1",
    identities_allowed: ["agent-1"],
    operations: [PortalOperation.READ],
  });
  const portal2 = createTestPortal({
    alias: "Portal2",
    identities_allowed: ["agent-2"],
    operations: [
      PortalOperation.READ,
      PortalOperation.WRITE,
    ],
  });
  const service = createTestService([portal1, portal2]);

  // Agent-1 allowed on Portal1, not Portal2
  const result1 = service.checkAgentAllowed("Portal1", "agent-1");
  assertEquals(result1.allowed, true);

  const result2 = service.checkAgentAllowed("Portal2", "agent-1");
  assertEquals(result2.allowed, false);

  // Agent-2 allowed on Portal2, not Portal1
  const result3 = service.checkAgentAllowed("Portal1", "agent-2");
  assertEquals(result3.allowed, false);

  const result4 = service.checkAgentAllowed("Portal2", "agent-2");
  assertEquals(result4.allowed, true);
});

Deno.test("IPortalPermissions: validates operations per portal", () => {
  const portal1 = createTestPortal({
    alias: "Portal1",
    operations: [PortalOperation.READ],
  });
  const portal2 = createTestPortal({
    alias: "Portal2",
    operations: [
      PortalOperation.READ,
      PortalOperation.WRITE,
      PortalOperation.GIT,
    ],
  });
  const service = createTestService([portal1, portal2]);

  // Portal1: only read allowed
  const read1 = service.checkOperationAllowed("Portal1", "agent-1", PortalOperation.READ);
  assertEquals(read1.allowed, true);

  const write1 = service.checkOperationAllowed("Portal1", "agent-1", PortalOperation.WRITE);
  assertEquals(write1.allowed, false);

  // Portal2: all operations allowed
  const read2 = service.checkOperationAllowed("Portal2", "agent-2", PortalOperation.READ);
  assertEquals(read2.allowed, true);

  const write2 = service.checkOperationAllowed("Portal2", "agent-2", PortalOperation.WRITE);
  assertEquals(write2.allowed, true);

  const git2 = service.checkOperationAllowed("Portal2", "agent-2", PortalOperation.GIT);
  assertEquals(git2.allowed, true);
});

// Audit Configuration Tests

Deno.test("IPortalPermissions: returns audit configuration", () => {
  const portal = createTestPortal({
    security: {
      mode: SecurityMode.HYBRID,
      audit_enabled: true,
      log_all_actions: false,
    },
  });
  const service = createTestService([portal]);

  const config = service.getSecurityConfig("TestPortal");

  assertExists(config);
  assertEquals(config?.mode, SecurityMode.HYBRID);
  assertEquals(config?.audit_enabled, true);
  assertEquals(config?.log_all_actions, false);
});

Deno.test("IPortalPermissions: returns default audit config if not specified", () => {
  const portal = createTestPortal({
    security: undefined,
  });
  const service = createTestService([portal]);

  const config = service.getSecurityConfig("TestPortal");

  assertExists(config);
  assertEquals(config?.mode, SecurityMode.SANDBOXED);
  assertEquals(config?.audit_enabled, true);
  assertEquals(config?.log_all_actions, true);
});

// Enhanced RBAC Permission Tests

Deno.test("IPortalPermissions: RBAC allows matching permission", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/*",
      action: [PermissionAction.READ, PermissionAction.WRITE],
      conditions: {},
    }],
  });
  const service = createTestService([portal]);

  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.READ, "/portal/project");

  assertEquals(result.allowed, true);
  assertEquals(result.action, PermissionAction.READ);
  assertEquals(result.resource, "/portal/project");
});

Deno.test("IPortalPermissions: RBAC denies non-matching resource", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/allowed",
      action: [PermissionAction.READ],
    }],
  });
  const service = createTestService([portal]);

  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.READ, "/portal/forbidden");

  assertEquals(result.allowed, false);
  assertEquals(result.reason, "No matching permission found");
});

Deno.test("IPortalPermissions: RBAC denies non-matching action", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/*",
      action: [PermissionAction.READ], // No write permission
    }],
  });
  const service = createTestService([portal]);

  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.WRITE, "/portal/project");

  assertEquals(result.allowed, false);
  assertEquals(result.reason, "No matching permission found");
});

Deno.test("IPortalPermissions: RBAC enforces time windows", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/*",
      action: [PermissionAction.WRITE],
      conditions: {
        timeWindow: {
          start: "09:00",
          end: "17:00",
        },
      },
    }],
  });
  const service = createTestService([portal]);

  // Test outside window (current time assumed to be outside 09:00-17:00)
  const context = { timestamp: new Date("2024-01-01T20:00:00Z"), ip: "1.2.3.4" };
  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.WRITE, "/portal/project", context);

  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("time window"), true);
});

Deno.test("IPortalPermissions: RBAC enforces IP whitelist", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/*",
      action: [PermissionAction.READ],
      conditions: {
        ipWhitelist: ["192.168.1.0/24"],
      },
    }],
  });
  const service = createTestService([portal]);

  const context = { timestamp: new Date(), ip: "10.0.0.1" };
  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.READ, "/portal/project", context);

  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("not in whitelist"), true);
});

Deno.test("IPortalPermissions: RBAC allows within IP whitelist", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/*",
      action: [PermissionAction.READ],
      conditions: {
        ipWhitelist: ["192.168.1.100"],
      },
    }],
  });
  const service = createTestService([portal]);

  const context = { timestamp: new Date(), ip: "192.168.1.100" };
  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.READ, "/portal/project", context);

  assertEquals(result.allowed, true);
});

Deno.test("IPortalPermissions: RBAC allows within time window", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/*",
      action: [PermissionAction.WRITE],
      conditions: {
        timeWindow: {
          start: "00:00",
          end: "23:59", // Always allowed
        },
      },
    }],
  });
  const service = createTestService([portal]);

  const context = { timestamp: new Date(), ip: "1.2.3.4" };
  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.WRITE, "/portal/project", context);

  assertEquals(result.allowed, true);
});

Deno.test("IPortalPermissions: RBAC supports single action permissions", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/*",
      action: [PermissionAction.READ], // Single action in array]
      conditions: {},
    }],
  });
  const service = createTestService([portal]);

  const readResult = service.checkPermission("TestPortal", "agent1", PermissionAction.READ, "/portal/project");
  assertEquals(readResult.allowed, true);

  const writeResult = service.checkPermission("TestPortal", "agent1", PermissionAction.WRITE, "/portal/project");
  assertEquals(writeResult.allowed, false);
});

Deno.test("IPortalPermissions: RBAC supports wildcard resources", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/*",
      action: [PermissionAction.WRITE],
    }],
  });
  const service = createTestService([portal]);

  const result1 = service.checkPermission("TestPortal", "agent1", PermissionAction.READ, "/portal/project1");
  assertEquals(result1.allowed, true);

  const result2 = service.checkPermission("TestPortal", "agent1", PermissionAction.WRITE, "/portal/project2");
  assertEquals(result2.allowed, true);

  const result3 = service.checkPermission("TestPortal", "agent1", PermissionAction.READ, "/other/resource");
  assertEquals(result3.allowed, false);
});

Deno.test("IPortalPermissions: RBAC supports exact resource matches", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/specific",
      action: [PermissionAction.READ],
    }],
  });
  const service = createTestService([portal]);

  const result1 = service.checkPermission("TestPortal", "agent1", PermissionAction.READ, "/portal/specific");
  assertEquals(result1.allowed, true);

  const result2 = service.checkPermission("TestPortal", "agent1", PermissionAction.READ, "/portal/other");
  assertEquals(result2.allowed, false);
});

Deno.test("IPortalPermissions: RBAC denies unknown portal", () => {
  const portal = createTestPortal({
    permissions: [{
      resource: "/portal/*",
      action: [PermissionAction.READ],
    }],
  });
  const service = createTestService([portal]);

  const result = service.checkPermission("UnknownPortal", "agent1", PermissionAction.READ, "/portal/project");

  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("not found"), true);
});

Deno.test("IPortalPermissions: RBAC falls back to legacy permissions when no RBAC defined", () => {
  const portal = createTestPortal({
    // No permissions array - should use legacy model
    identities_allowed: ["agent1"],
    operations: [PortalOperation.READ],
  });
  const service = createTestService([portal]);

  const result1 = service.checkPermission("TestPortal", "agent1", PermissionAction.READ, "/portal/project");
  assertEquals(result1.allowed, true);

  const result2 = service.checkPermission("TestPortal", "agent2", PermissionAction.READ, "/portal/project");
  assertEquals(result2.allowed, false);

  const result3 = service.checkPermission("TestPortal", "agent1", PermissionAction.WRITE, "/portal/project");
  assertEquals(result3.allowed, false); // write not in operations
});

Deno.test("IPortalPermissions: RBAC maps execute action to git operation", () => {
  const portal = createTestPortal({
    // Legacy model
    identities_allowed: ["agent1"],
    operations: [PortalOperation.GIT],
  });
  const service = createTestService([portal]);

  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.EXECUTE, "/portal/project");

  assertEquals(result.allowed, true);
});

Deno.test("IPortalPermissions: RBAC maps delete action to write operation", () => {
  const portal = createTestPortal({
    // Legacy model
    identities_allowed: ["agent1"],
    operations: [PortalOperation.WRITE],
  });
  const service = createTestService([portal]);

  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.DELETE, "/portal/project");

  assertEquals(result.allowed, true);
});

Deno.test("IPortalPermissions: RBAC denies execute without git permission", () => {
  const portal = createTestPortal({
    // Legacy model
    identities_allowed: ["agent1"],
    operations: [
      PortalOperation.READ,
      PortalOperation.WRITE,
    ], // No git
  });
  const service = createTestService([portal]);

  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.EXECUTE, "/portal/project");

  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("git operation"), true);
});

Deno.test("IPortalPermissions: RBAC denies delete without write permission", () => {
  const portal = createTestPortal({
    // Legacy model
    identities_allowed: ["agent1"],
    operations: [PortalOperation.READ], // No write
  });
  const service = createTestService([portal]);

  const result = service.checkPermission("TestPortal", "agent1", PermissionAction.DELETE, "/portal/project");

  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("write operation"), true);
});
