/**
 * @module McpHandshakeTest
 * @path tests/integration/agent/mcp_handshake_test.ts
 * @description Integration tests for McpAgentStrategy subprocess lifecycle, handshake, and parent context query.
 */

import { assertEquals } from "@std/assert";
import { McpAgentStrategy } from "@exaix/execution";
import { ProcessManager } from "@exaix/core";
import type { AgentOrchestrator, IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import { SecurityMode } from "@exaix/core";

type IMcpHandshakeExecutor = Pick<
  AgentOrchestrator,
  "validateReviewResult" | "getRecentActivitiesByTraceId" | "logAgentOutput"
>;

Deno.test("McpAgentStrategy - Subprocess Spawn and Handshake", async () => {
  const processManager = new ProcessManager();
  const mockExecutor: IMcpHandshakeExecutor = {
    validateReviewResult: (res: IChangesetResult) => res,
    getRecentActivitiesByTraceId: () => Promise.resolve([]),
    logAgentOutput: () => Promise.resolve(),
  };

  const strategy = new McpAgentStrategy(mockExecutor as AgentOrchestrator, processManager);

  const blueprint: IAgentFileBlueprint = {
    name: "mcp-test",
    model: "gpt-4",
    provider: "openai",
    capabilities: ["mcp"],
    systemPrompt: "You are a sub-agent.",
  };

  const context: IExecutionContext = {
    trace_id: crypto.randomUUID(),
    request_id: "REQ-123",
    request: "Test request",
    plan: "Test plan",
    portal: "main",
  };

  const options: IAgentExecutionOptions = {
    identity_id: "mcp-test",
    portal: "main",
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 30000,
    max_tool_calls: 10,
    audit_enabled: false,
  };

  const result = await strategy.execute(blueprint, context, options);

  assertEquals(result.branch, "feat/mcp-test");
  assertEquals(result.commit_sha, "0000000000000000000000000000000000000000");
  assertEquals(result.description, "Simulated MCP success");

  processManager.cleanup();
});

Deno.test("McpAgentStrategy - Parent Context Query", async () => {
  const processManager = new ProcessManager();
  const mockExecutor: IMcpHandshakeExecutor = {
    validateReviewResult: (res: IChangesetResult) => res,
    getRecentActivitiesByTraceId: (_traceId: string) => Promise.resolve([]),
    logAgentOutput: () => Promise.resolve(),
  };

  const strategy = new McpAgentStrategy(mockExecutor as AgentOrchestrator, processManager);

  const blueprint: IAgentFileBlueprint = {
    name: "mcp-query-test",
    model: "gpt-4",
    provider: "openai",
    capabilities: ["mcp"],
    systemPrompt: "You are a sub-agent with query capability.",
  };

  const context: IExecutionContext = {
    trace_id: "trace-123",
    request_id: "REQ-123",
    request: "Test query_parent please",
    plan: "Test plan",
    portal: "main_portal",
  };

  const options: IAgentExecutionOptions = {
    identity_id: "mcp-query-test",
    portal: "main_portal",
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 30000,
    max_tool_calls: 10,
    audit_enabled: false,
  };

  const result = await strategy.execute(blueprint, context, options);

  // The agent_entrypoint is scripted to return successful query result
  // The description will contain the query response stringified.
  assertEquals(result.branch, "feat/mcp-query");
  assertEquals(result.commit_sha, "0000000000000000000000000000000000000000");

  // Verify that parent context was correctly passed back
  const expectedInfo =
    '{"trace_id":"trace-123","current_step":"Test query_parent please","portal":"main_portal","recent_activities":[],"memory_banks":[{"name":"main","path":"@memory/main.md"}]}';
  assertEquals(result.description, `Query result: ${expectedInfo}`);

  processManager.cleanup();
});
