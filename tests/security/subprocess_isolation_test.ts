// deno-lint-ignore-file no-explicit-any
/**
 * @module SubprocessIsolationTest
 * @path tests/security/subprocess_isolation_test.ts
 * @description Verify that McpAgentStrategy.buildAgentArgs() produces Deno permission
 * flags that prevent subprocess write access. Satisfies Step 61.7 (G3) success
 * criterion: subprocess_isolation_test asserts permission flags match
 * SecurityMode.SANDBOXED. SANDBOXED's read+net scope is the named prior-phase contract;
 * Phase 170 (Weakness 1, Security_Decision_Ledger D006) additionally reduced the
 * non-SANDBOXED (HYBRID) branch to that same scoped set, removing the unrestricted
 * --allow-all grant this file previously asserted.
 * @architectural-layer Tests
 * @related-files [packages/execution/src/strategies/mcp_agent_strategy.ts]
 */

import { assert, assertFalse } from "@std/assert";
import { McpAgentStrategy } from "@exaix/execution";
import type { AgentOrchestrator, IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions } from "@exaix/schemas/agent_orchestrator.ts";
import { SecurityMode } from "@exaix/core";

/** Minimal blueprint sufficient for buildAgentArgs (no blueprint fields are read) */
const TEST_BLUEPRINT: IAgentFileBlueprint = {
  name: "test-agent",
  model: "mock",
  provider: "mock",
  capabilities: ["mcp"],
  systemPrompt: "Test",
};

const SANDBOXED_OPTIONS: IAgentExecutionOptions = {
  agent_role: "test-agent",
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
  const strategy = new McpAgentStrategy({} as AgentOrchestrator);
  try {
    fn((strategy as any) as BuildArgsFn);
  } finally {
    strategy.dispose();
  }
}

Deno.test("[security] subprocess isolation: SANDBOXED buildAgentArgs includes --allow-read", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, SANDBOXED_OPTIONS);
    assert(
      args.includes("--allow-read"),
      `SANDBOXED args must include --allow-read, got: ${args.join(" ")}`,
    );
  });
});

Deno.test("[security] subprocess isolation: SANDBOXED buildAgentArgs includes --allow-net", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, SANDBOXED_OPTIONS);
    assert(
      args.includes("--allow-net"),
      `SANDBOXED args must include --allow-net, got: ${args.join(" ")}`,
    );
  });
});

Deno.test("[security] subprocess isolation: SANDBOXED buildAgentArgs excludes --allow-write", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, SANDBOXED_OPTIONS);
    assertFalse(
      args.some((a) => a === "--allow-write" || a.startsWith("--allow-write=")),
      `SANDBOXED args must NOT include --allow-write*, got: ${args.join(" ")}`,
    );
  });
});

Deno.test("[security] subprocess isolation: HYBRID buildAgentArgs includes --allow-read (Phase 170)", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, HYBRID_OPTIONS);
    assert(
      args.includes("--allow-read"),
      `Non-SANDBOXED args must include --allow-read, got: ${args.join(" ")}`,
    );
  });
});

Deno.test("[security] subprocess isolation: HYBRID buildAgentArgs includes --allow-net (Phase 170)", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, HYBRID_OPTIONS);
    assert(
      args.includes("--allow-net"),
      `Non-SANDBOXED args must include --allow-net, got: ${args.join(" ")}`,
    );
  });
});

Deno.test("[security] subprocess isolation: HYBRID buildAgentArgs no longer grants --allow-all (Phase 170 Weakness 1)", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, HYBRID_OPTIONS);
    assertFalse(
      args.includes("--allow-all"),
      `Non-SANDBOXED args must not include unrestricted --allow-all (Security_Decision_Ledger D006), got: ${
        args.join(" ")
      }`,
    );
  });
});

Deno.test("[security] subprocess isolation: HYBRID buildAgentArgs does not add --allow-write separately", () => {
  withStrategy((s) => {
    const args = s.buildAgentArgs(TEST_BLUEPRINT, HYBRID_OPTIONS);
    // The scoped --allow-read/--allow-net grant already excludes write; there must not be a
    // redundant --allow-write flag.
    assertFalse(
      args.some((a) => a === "--allow-write" || a.startsWith("--allow-write=")),
      `Non-SANDBOXED args must not add a separate --allow-write* flag, got: ${args.join(" ")}`,
    );
  });
});
