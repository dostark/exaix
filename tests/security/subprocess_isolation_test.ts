/**
 * @module SubprocessIsolationTest
 * @path tests/security/subprocess_isolation_test.ts
 * @description Verify that McpAgentStrategy.buildAgentArgs() produces Deno permission
 * flags that prevent subprocess write access in SANDBOXED SecurityMode. Satisfies Step
 * 61.7 (G3) success criterion: subprocess_isolation_test asserts permission flags match
 * SecurityMode.SANDBOXED.
 * @architectural-layer Tests
 * @related-files [src/services/agent/strategies/mcp_agent_strategy.ts]
 */

import { assert, assertFalse } from "@std/assert";
import { McpAgentStrategy } from "../../src/services/agent/strategies/mcp_agent_strategy.ts";
import type { AgentExecutor, IAgentFileBlueprint } from "../../src/services/agent/agent_executor.ts";
import type { IAgentExecutionOptions } from "@exaix/schemas/agent_executor.ts";
import { SecurityMode } from "../../src/shared/enums.ts";

/** Minimal blueprint sufficient for buildAgentArgs (no blueprint fields are read) */
const TEST_BLUEPRINT: IAgentFileBlueprint = {
  name: "test-agent",
  model: "mock",
  provider: "mock",
  capabilities: ["mcp"],
  systemPrompt: "Test",
};

const SANDBOXED_OPTIONS: IAgentExecutionOptions = {
  identity_id: "test-agent",
  portal: "workspace",
  security_mode: SecurityMode.SANDBOXED,
  audit_enabled: true,
  timeout_ms: 30000,
  max_tool_calls: 10,
};

const HYBRID_OPTIONS: IAgentExecutionOptions = {
  ...SANDBOXED_OPTIONS,
  security_mode: SecurityMode.HYBRID,
};

/** Helper — instantiate strategy, call buildAgentArgs, dispose. Disposes the ProcessManager
 * signal listeners to prevent Deno test sanitizer failures.
 */
type BuildArgsFn = {
  buildAgentArgs(bp: IAgentFileBlueprint, opts: IAgentExecutionOptions): string[];
  dispose(): void;
};

function withStrategy(fn: (strategy: BuildArgsFn) => void): void {
  const strategy = new McpAgentStrategy({} as AgentExecutor);
  try {
    fn((strategy as unknown) as BuildArgsFn);
  } finally {
    strategy.dispose();
  }
}

Deno.test("subprocess isolation: SANDBOXED buildAgentArgs includes --allow-read", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, SANDBOXED_OPTIONS);
    assert(
      args.includes("--allow-read"),
      `SANDBOXED args must include --allow-read, got: ${args.join(" ")}`,
    );
  });
});

Deno.test("subprocess isolation: SANDBOXED buildAgentArgs includes --allow-net", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, SANDBOXED_OPTIONS);
    assert(
      args.includes("--allow-net"),
      `SANDBOXED args must include --allow-net, got: ${args.join(" ")}`,
    );
  });
});

Deno.test("subprocess isolation: SANDBOXED buildAgentArgs excludes --allow-write", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, SANDBOXED_OPTIONS);
    assertFalse(
      args.some((a) => a === "--allow-write" || a.startsWith("--allow-write=")),
      `SANDBOXED args must NOT include --allow-write*, got: ${args.join(" ")}`,
    );
  });
});

Deno.test("subprocess isolation: non-SANDBOXED buildAgentArgs uses --allow-all", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, HYBRID_OPTIONS);
    assert(
      args.includes("--allow-all"),
      `Non-SANDBOXED args must include --allow-all, got: ${args.join(" ")}`,
    );
  });
});

Deno.test("subprocess isolation: non-SANDBOXED buildAgentArgs does not add --allow-write separately", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, HYBRID_OPTIONS);
    // --allow-all already grants write; there must not be a redundant --allow-write flag
    assertFalse(
      args.some((a) => a === "--allow-write" || a.startsWith("--allow-write=")),
      `Non-SANDBOXED args must not add a separate --allow-write* flag, got: ${args.join(" ")}`,
    );
  });
});
