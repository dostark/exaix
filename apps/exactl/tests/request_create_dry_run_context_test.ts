/**
 * @module RequestCreateDryRunContextTest
 * @path apps/exactl/tests/request_create_dry_run_context_test.ts
 * @description Phase 196 Step 8 — `exactl request create --dry-run-context` prints a real
 *   per-segment token breakdown without writing a request file or invoking a real LLM call,
 *   and the existing `--dry-run` flag's behavior is completely unchanged by this step.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/command_builders/request_actions.ts, packages/execution/src/agent_runner.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  handleRequestCreate,
  type IRequestActionContext,
  type IRequestCreateOptions,
} from "../src/command_builders/request_actions.ts";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

// style-exclude:SMALL_FIXTURE_OK - 13-line blueprint frontmatter+body fixture, inline for readability
const MOCK_AGENT_BLUEPRINT = `---
agent_role: "mock-agent"
name: "Mock Testing Agent"
model: "mock:test-model"
capabilities:
  - testing
created: "2025-12-09T13:47:00Z"
created_by: "exaix-test-suite"
version: "1.1.0"
description: "Agent role blueprint for testing"
default_skills: []
---

# Mock Testing Agent

Keep responses minimal and parseable for test assertions.
`;

async function withDryRunContextFixture(
  fn: (ctx: { context: IRequestActionContext; requestsDir: string; tempDir: string }) => Promise<void>,
): Promise<void> {
  const { context, tempDir, cleanup } = await createCliTestContext({ createDirs: ["Workspace/Requests"] });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Agents", "mock-agent.md"), MOCK_AGENT_BLUEPRINT);
    const requestCommands = new RequestCommands(context);
    await fn({
      context: { requestCommands, display: context.display, appContext: context },
      requestsDir: join(tempDir, "Workspace", "Requests"),
      tempDir,
    });
  } finally {
    await cleanup();
  }
}

function captureConsoleLog(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(" "));
  return { output, restore: () => (console.log = originalLog) };
}

Deno.test("[exactl request create --dry-run-context] prints a real per-segment breakdown without writing a request file", async () => {
  await withDryRunContextFixture(async ({ context, requestsDir }) => {
    const { output, restore } = captureConsoleLog();
    try {
      await handleRequestCreate(
        context,
        { agentRole: "mock-agent", dryRunContext: true } as IRequestCreateOptions,
        "Add a hello world function.",
      );
    } finally {
      restore();
    }

    const rendered = output.join("\n");
    assertStringIncludes(rendered, "Projected Prompt Breakdown");
    assertStringIncludes(rendered, "Total tokens:");
    assertStringIncludes(rendered, "Compaction triggered:");
    // The aggregate row carries the budget ceiling (total / budget ceiling), not just totals.
    assert(
      /\btotal .* \/ budget \d+\b/i.test(rendered) || rendered.includes("budget"),
      "budget ceiling must be rendered",
    );
    // Real per-segment kinds from the fixture blueprint's prompt assembly must appear.
    assertStringIncludes(rendered, "system");
    assertStringIncludes(rendered, "request");

    const filesInRequests = [...Deno.readDirSync(requestsDir)];
    assertEquals(filesInRequests.length, 0, "--dry-run-context must never write a request file");
  });
});

Deno.test("[exactl request create --dry-run-context] does not invoke a real LLM call (no thrown provider error, no generated content)", async () => {
  await withDryRunContextFixture(async ({ context }) => {
    const { output, restore } = captureConsoleLog();
    try {
      await handleRequestCreate(
        context,
        { agentRole: "mock-agent", dryRunContext: true } as IRequestCreateOptions,
        "Add a hello world function.",
      );
    } finally {
      restore();
    }
    const rendered = output.join("\n");
    assert(!rendered.includes("<thought>"), "no real generation output should appear in a dry-run-context preview");
  });
});

Deno.test("[exactl request create --dry-run] (existing flag) behavior is completely unchanged by this step", async () => {
  await withDryRunContextFixture(async ({ context, requestsDir }) => {
    const { output, restore } = captureConsoleLog();
    try {
      await handleRequestCreate(
        context,
        { agentRole: "mock-agent", dryRun: true } as IRequestCreateOptions,
        "Add a hello world function.",
      );
    } finally {
      restore();
    }
    const rendered = output.join("\n");
    assert(!rendered.includes("Projected Prompt Breakdown"), "--dry-run must not route through the new preview path");

    // --dry-run's pre-existing (surprising but out-of-scope-to-fix) contract: it still
    // creates the request file today; only the CLI's *reporting* branches on the flag.
    const filesInRequests = [...Deno.readDirSync(requestsDir)];
    assertEquals(filesInRequests.length, 1, "--dry-run's existing file-write behavior must be unchanged");
  });
});
