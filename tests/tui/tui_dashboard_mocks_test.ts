/**
 * @module TUIDashboardMocksTest
 * @path tests/tui/tui_dashboard_mocks_test.ts
 * @description Verifies internal mock services used for TUI testing, ensuring stable
 * simulation of portals, plans, and activity logs.
 */

import {
  MockAgentService,
  MockDaemonService,
  MockLogService,
  MockMemoryService,
  MockPlanService,
  MockPortalService,
  MockRequestService,
  MockSkillsService,
  MockStructuredLogger,
  MockStructuredLoggerService,
} from "../../src/tui/tui_dashboard_mocks.ts";
import { RequestStatus } from "@exaix/core";
import { RequestPriority } from "@exaix/core";
import type { IStructuredLogEntry } from "@exaix/core/types/logging.ts";
import {
  TEST_MODEL_OPENAI,
  TEST_PROPOSAL_ID,
  TEST_SKILL_ID_LEARNED,
  TEST_SKILL_ID_USER,
  TEST_UNKNOWN_PROPOSAL_ID,
} from "@exaix/testing";

Deno.test("MockPortalService: returns portals", async () => {
  const service = new MockPortalService();
  const portals = await service.listPortals();
  if (!Array.isArray(portals)) throw new Error("Portals not array");
});

Deno.test("MockPlanService: returns pending plans", async () => {
  const service = new MockPlanService();
  const plans = await service.listPending();
  if (!Array.isArray(plans)) throw new Error("Plans not array");
});

Deno.test("MockLogService: returns recent activity", async () => {
  const service = new MockLogService();
  const logs = await service.getRecentActivity();
  if (!Array.isArray(logs)) throw new Error("Logs not array");
});

Deno.test("MockDaemonService: returns status", async () => {
  const service = new MockDaemonService();
  const status = await service.getStatus();
  if (!status) throw new Error("No daemon status");
});

Deno.test("MockRequestService: returns requests", async () => {
  const service = new MockRequestService();
  const requests = await service.listRequests();
  if (!Array.isArray(requests)) throw new Error("Requests not array");
});

Deno.test("MockAgentService: returns agent list", async () => {
  const service = new MockAgentService();
  const agents = await service.listAgents();
  if (!Array.isArray(agents)) throw new Error("Agent list not array");
});

Deno.test("MockPortalService: all methods", async () => {
  const service = new MockPortalService();
  const portals = await service.listPortals();
  if (!Array.isArray(portals)) throw new Error("Portals not array");
  const details = await service.getPortalDetails("main");
  if (typeof details !== "object" || !details.alias) throw new Error("Invalid portal details");
  if (await service.openPortal("main") !== true) throw new Error("openPortal failed");
  if (await service.closePortal("main") !== true) throw new Error("closePortal failed");
  if (await service.refreshPortal("main") !== true) throw new Error("refreshPortal failed");
  if (await service.removePortal("main") !== true) throw new Error("removePortal failed");
  if (typeof await service.quickJumpToPortalDir("main") !== "string") throw new Error("quickJumpToPortalDir failed");
  if (typeof await service.getPortalFilesystemPath("main") !== "string") {
    throw new Error("getPortalFilesystemPath failed");
  }
  if (!Array.isArray(service.getPortalActivityLog("main"))) throw new Error("getPortalActivityLog failed");
});

Deno.test("MockPlanService: all methods", async () => {
  const service = new MockPlanService();
  if (!Array.isArray(await service.listPending())) throw new Error("listPending failed");
  if (typeof await service.getDiff("test-plan-id") !== "string") throw new Error("getDiff failed");
  if (await service.approve("test-plan-id") !== true) throw new Error("approve failed");
  if (await service.reject("test-plan-id") !== true) throw new Error("reject failed");
});

Deno.test("MockLogService: all methods", async () => {
  const service = new MockLogService();
  if (!Array.isArray(await service.getRecentActivity())) throw new Error("getRecentActivity failed");
});

Deno.test("MockDaemonService: all methods", async () => {
  const service = new MockDaemonService();
  await service.start();
  await service.stop();
  await service.restart();
  if (typeof await service.getStatus() !== "string") throw new Error("getStatus failed");
  if (!Array.isArray(await service.getLogs())) throw new Error("getLogs failed");
  if (!Array.isArray(await service.getErrors())) throw new Error("getErrors failed");
});

Deno.test("MockRequestService: all methods", async () => {
  const service = new MockRequestService();
  const all = await service.listRequests();
  if (!Array.isArray(all)) throw new Error("listRequests failed");
  const pending = await service.listRequests(RequestStatus.PENDING);
  if (!Array.isArray(pending) || pending.some((r) => r.status !== RequestStatus.PENDING)) {
    throw new Error("listRequests status filter failed");
  }
  const content = await service.getRequestContent("test-id");
  if (typeof content !== "string" || !content.includes("test-id")) throw new Error("getRequestContent failed");
  const newReq = await service.createRequest("desc", {
    priority: RequestPriority.HIGH,
    identity: "test",
    portal: "main",
    model: TEST_MODEL_OPENAI,
  });
  if (typeof newReq !== "object" || newReq.priority !== RequestPriority.HIGH || newReq.identity !== "test") {
    throw new Error("createRequest failed");
  }
  if (await service.updateRequestStatus("id", "planned") !== true) throw new Error("updateRequestStatus failed");
});

Deno.test("MockAgentService: all methods", async () => {
  const service = new MockAgentService();
  const agents = await service.listAgents();
  if (!Array.isArray(agents) || agents.length < 2) throw new Error("listAgents failed");
  const health1 = await service.getAgentHealth("agent-1");
  if (health1.status !== "healthy" || health1.issues.length !== 0) throw new Error("getAgentHealth agent-1 failed");
  const health2 = await service.getAgentHealth("agent-2");
  if (health2.status !== "warning" || health2.issues.length !== 1) throw new Error("getAgentHealth agent-2 failed");
  const logs = await service.getAgentLogs("agent-1", 2);
  if (!Array.isArray(logs) || logs.length < 2) throw new Error("getAgentLogs failed");
});

Deno.test("MockMemoryService: returns memory data", async () => {
  const service = new MockMemoryService();
  const projects = await service.getProjects();
  if (!Array.isArray(projects) || projects.length === 0) throw new Error("getProjects failed");

  const projectMemory = await service.getProjectMemory(projects[0]);
  if (!projectMemory || !projectMemory.portal) throw new Error("getProjectMemory failed");

  const globalMemory = await service.getGlobalMemory();
  if (!globalMemory || !Array.isArray(globalMemory.learnings)) throw new Error("getGlobalMemory failed");

  const exec = await service.getExecutionByTraceId("trace-id");
  if (!exec || !exec.trace_id) throw new Error("getExecutionByTraceId failed");

  const history = await service.getExecutionHistory();
  if (!Array.isArray(history) || history.length === 0) throw new Error("getExecutionHistory failed");

  const results = await service.search("query");
  if (!Array.isArray(results) || results.length === 0) throw new Error("search failed");

  const pending = await service.listPending();
  if (!Array.isArray(pending) || pending.length === 0) throw new Error("listPending failed");

  const pendingItem = await service.getPending(TEST_PROPOSAL_ID);
  if (!pendingItem || pendingItem.id !== TEST_PROPOSAL_ID) throw new Error("getPending failed");

  const missing = await service.getPending(TEST_UNKNOWN_PROPOSAL_ID);
  if (missing !== null) throw new Error("getPending should return null for unknown");

  await service.approvePending(TEST_PROPOSAL_ID);
  await service.rejectPending(TEST_PROPOSAL_ID, "reason");
});

Deno.test("MockSkillsService: filters and deletes skills", async () => {
  const service = new MockSkillsService();
  const all = await service.listSkills();
  if (!Array.isArray(all) || all.length === 0) throw new Error("listSkills failed");

  const userSkill = await service.getSkill(TEST_SKILL_ID_USER);
  if (!userSkill) throw new Error("getSkill user failed");

  const learnedSkill = await service.getSkill(TEST_SKILL_ID_LEARNED);
  if (!learnedSkill) throw new Error("getSkill learned failed");

  const userDelete = await service.deleteSkill(TEST_SKILL_ID_USER);
  if (userDelete !== false) throw new Error("deleteSkill user should be false");

  const learnedDelete = await service.deleteSkill(TEST_SKILL_ID_LEARNED);
  if (learnedDelete !== true) throw new Error("deleteSkill learned should be true");
});

Deno.test("MockStructuredLogger: methods are callable", async () => {
  const logger = new MockStructuredLogger();
  logger.setContext({});
  if (logger.child({}) !== logger) throw new Error("child should return logger");
  logger.debug("test");
  logger.info("test");
  logger.warn("test");
  logger.error("test");
  logger.fatal("test");
  const result = await logger.time("op", () => Promise.resolve("ok"));
  if (result !== "ok") throw new Error("time should return result");
});

Deno.test("MockStructuredLoggerService: returns empty logs and unsubscribe", async () => {
  const service = new MockStructuredLoggerService();
  if (!Array.isArray(await service.getStructuredLogs({}))) throw new Error("getStructuredLogs failed");
  if (!Array.isArray(await service.getLogsByCorrelationId("cid"))) throw new Error("getLogsByCorrelationId failed");
  if (!Array.isArray(await service.getLogsByTraceId("tid"))) throw new Error("getLogsByTraceId failed");
  if (!Array.isArray(await service.getLogsByAgentId("aid"))) throw new Error("getLogsByAgentId failed");
  const unsubscribe = service.subscribeToLogs((_entry: IStructuredLogEntry) => {});
  if (typeof unsubscribe !== "function") throw new Error("subscribeToLogs failed");
  await service.exportLogs("file", []);
});
