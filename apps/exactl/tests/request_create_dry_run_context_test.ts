/**
 * @module RequestCreateDryRunContextTest
 * @path apps/exactl/tests/request_create_dry_run_context_test.ts
 * @description Phase 196 Step 8 — `exactl request create --dry-run-context` prints a real
 *   per-segment token breakdown without writing a request file or invoking a real LLM call,
 *   and the existing `--dry-run` flag's behavior is completely unchanged by this step.
 *   Phase 199 Step 4 adds the planning read-only tool preview: with `[planning]
 *   tools_enabled = true` the same command also prints the `Available read-only planning
 *   tools:` catalog (with an `(inactive: ...)` suffix for non-native-tools providers) and a
 *   `Planning tools worst case: +<N> tokens` cost line; flag off keeps the output unchanged.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/command_builders/request_actions.ts, packages/execution/src/agent_runner.ts, packages/execution/src/native_tool_turns.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PortalAnalysisMode } from "@exaix/core";
import type { IApplicationContext, ICliApplicationContext, IPortalKnowledgeConfig } from "@exaix/core/types";
import { PortalKnowledgeService } from "@exaix/portal/knowledge";
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

    // A Pct% column shows each segment's share of the total; the values must sum to ~100%.
    assertStringIncludes(rendered, "Pct%");
    const pctMatches = [...rendered.matchAll(/(\d+\.\d)%/g)].map((m) => parseFloat(m[1]));
    assert(pctMatches.length >= 2, `expected per-segment Pct% values, got ${rendered}`);
    const pctSum = pctMatches.reduce((sum, p) => sum + p, 0);
    assert(
      Math.abs(pctSum - 100) < 1.5,
      `per-segment Pct% values must sum to ~100%, got ${pctSum}`,
    );

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

/// Real-portal variant: `--dry-run-context --portal <alias>` must inject the same
/// `portal_context` (file listing) + `portal_knowledge` (knowledge summary) segments the
/// daemon's real request path injects (mirrors `buildRequestContext`).

// style-exclude:SMALL_FIXTURE_OK - 4-file mock portal fixture, inline for readability
const MOCK_PORTAL_FILES: Array<[string, string]> = [
  ["deno.json", JSON.stringify({ name: "mock-portal", version: "1.0.0" })],
  ["README.md", "# Mock Portal\n\nA minimal TypeScript project for testing.\n"],
  ["src/main.ts", "/** @module Main */\nexport function run(): void { console.log('hello'); }\n"],
  [
    "src/services/greeter.ts",
    "export class Greeter {\n  greet(name: string): string { return `Hello, ${name}!`; }\n}\n",
  ],
  ["src/models/user.ts", "export interface IUser { id: string; name: string; }\n"],
];

function makePortalKnowledgeConfig(): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.QUICK,
    quickScanLimit: 50,
    maxFilesToRead: 10,
    ignorePatterns: ["node_modules", ".git"],
    staleness: 168,
    useLlmInference: false,
    relevanceSearchEmbeddingEnabled: false,
    enableAstAnalysis: false,
    enableTestExecution: false,
    enableVulnerabilityScan: false,
    enableGitHistoryAnalysis: false,
  };
}

Deno.test("[exactl request create --dry-run-context] with --portal injects the real portal_context + portal_knowledge segments the daemon's request path would", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext({ createDirs: ["Workspace/Requests"] });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Agents", "mock-agent.md"), MOCK_AGENT_BLUEPRINT);

    // Real tiny portal + real (quick-mode) PortalKnowledgeService, wired exactly as the CLI
    // init.ts wires it — the preview must resolve real knowledge, not a fabricated summary.
    const portalDir = join(tempDir, "mock-portal");
    await ensureDir(join(portalDir, "src", "services"));
    await ensureDir(join(portalDir, "src", "models"));
    for (const [rel, content] of MOCK_PORTAL_FILES) {
      await Deno.writeTextFile(join(portalDir, rel), content);
    }
    const portalKnowledge = new PortalKnowledgeService({
      config: makePortalKnowledgeConfig(),
      memoryBank: null as never,
      projectsDir: join(tempDir, "Memory", "Projects"),
    });
    await portalKnowledge.analyze("mock-portal", portalDir, PortalAnalysisMode.QUICK);
    (context as IApplicationContext).portalKnowledge = portalKnowledge;
    // Register the portal so the handler (via appContext.portals.show) can resolve its target_path.
    await context.portals!.add(portalDir, "mock-portal");

    const requestCommands = new RequestCommands(context);
    const { output, restore } = captureConsoleLog();
    try {
      await handleRequestCreate(
        { requestCommands, display: context.display, appContext: context },
        { agentRole: "mock-agent", dryRunContext: true, portal: "mock-portal" } as IRequestCreateOptions,
        "Add a Greeter to the mock portal's services.",
      );
    } finally {
      restore();
    }
    const rendered = output.join("\n");
    // The daemon's real request path injects BOTH a portal_context (file listing) segment and a
    // portal_knowledge (knowledge summary) segment — the preview must show two portal_knowledge
    // rows, proving the real portal context reached `previewPrompt` (not a fabricated {} context).
    const portalRows = [...rendered.matchAll(/portal_knowledge/g)].length;
    assertEquals(
      portalRows,
      2,
      `expected two portal_knowledge rows (file listing + knowledge summary), got:\n${rendered}`,
    );
    assertStringIncludes(rendered, "Matched skills: None", "preview must still render its aggregate row");
  } finally {
    await cleanup();
  }
});

Deno.test("[exactl request create --dry-run-context] a cold portal never triggers analysis or persistence", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext({ createDirs: ["Workspace/Requests"] });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Agents", "mock-agent.md"), MOCK_AGENT_BLUEPRINT);
    const portalDir = join(tempDir, "cold-portal");
    await ensureDir(portalDir);
    await Deno.writeTextFile(join(portalDir, "README.md"), "# Cold portal\n");
    const projectsDir = join(tempDir, "Memory", "Projects");
    const portalKnowledge = new PortalKnowledgeService({
      config: makePortalKnowledgeConfig(),
      memoryBank: null as never,
      projectsDir,
    });
    let analyzeCalls = 0;
    portalKnowledge.analyze = () => {
      analyzeCalls += 1;
      return Promise.reject(new Error("preview must not analyze"));
    };
    (context as IApplicationContext).portalKnowledge = portalKnowledge;
    await context.portals!.add(portalDir, "cold-portal");

    const requestCommands = new RequestCommands(context);
    const { output, restore } = captureConsoleLog();
    try {
      await handleRequestCreate(
        { requestCommands, display: context.display, appContext: context },
        { agentRole: "mock-agent", dryRunContext: true, portal: "cold-portal" },
        "Inspect the cold portal.",
      );
    } finally {
      restore();
    }

    assertEquals(analyzeCalls, 0);
    assertStringIncludes(output.join("\n"), "Portal knowledge: unavailable");
    // `portals.add()` writes a context card here, so the dir is not empty — the invariant
    // is that the PREVIEW creates no knowledge artifact.
    const knowledgeJson = join(projectsDir, "cold-portal", "knowledge.json");
    await Deno.stat(knowledgeJson).then(
      () => {
        throw new Error("preview must not persist knowledge.json for a cold portal");
      },
      (error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      },
    );
  } finally {
    await cleanup();
  }
});

/// With `[planning] tools_enabled = true` the dry-run preview also shows the planner's
/// read-only tool catalog, its activation state and the worst-case extra cost.

/** Rewrites the fixture's `config.toml` with a `[planning]` block and reloads the context
 *  config so `handleRequestCreateDryRunContext` sees the effective flag value. */
async function writePlanningToolsConfigBlock(
  tempDir: string,
  appContext: ICliApplicationContext,
  toolsEnabled: boolean,
): Promise<void> {
  await Deno.writeTextFile(
    join(tempDir, "config.toml"),
    `[system]\nroot = "."\n\n[planning]\ntools_enabled = ${toolsEnabled}\nmax_tool_rounds = 2\nmax_tool_result_tokens = 2000\n`,
  );
  appContext.config.reload();
}

async function runDryRunContextPreview(
  context: IRequestActionContext,
  description = "Add a hello world function.",
): Promise<string> {
  const { output, restore } = captureConsoleLog();
  try {
    await handleRequestCreate(
      context,
      { agentRole: "mock-agent", dryRunContext: true } as IRequestCreateOptions,
      description,
    );
  } finally {
    restore();
  }
  return output.join("\n");
}

Deno.test("[exactl request create --dry-run-context] with planning.tools_enabled=true prints the available read-only planning tools line", async () => {
  await withDryRunContextFixture(async ({ context, tempDir }) => {
    await writePlanningToolsConfigBlock(tempDir, context.appContext!, true);
    const rendered = await runDryRunContextPreview(context);

    assertStringIncludes(rendered, "Projected Prompt Breakdown", "flag-on must still preview the prompt");
    assertStringIncludes(rendered, "Available read-only planning tools:");
    // Two real NONE-scope catalog members must appear; write tools must not.
    assertStringIncludes(rendered, "read_file");
    assertStringIncludes(rendered, "query_relationships");
    assert(!rendered.includes("write_file"), "a write tool must never be advertised to the planner preview");
  });
});

Deno.test("[exactl request create --dry-run-context] with a non-native-tools default model the tools line carries the (inactive: ...) suffix", async () => {
  await withDryRunContextFixture(async ({ context, tempDir }) => {
    await writePlanningToolsConfigBlock(tempDir, context.appContext!, true);
    const rendered = await runDryRunContextPreview(context);

    assertStringIncludes(rendered, "(inactive: provider", "non-native provider must be flagged inactive (GAP-8)");
    assertStringIncludes(rendered, "lacks native tools");
  });
});

Deno.test("[exactl request create --dry-run-context] with the flag on prints a positive worst-case extra token count", async () => {
  await withDryRunContextFixture(async ({ context, tempDir }) => {
    await writePlanningToolsConfigBlock(tempDir, context.appContext!, true);
    const rendered = await runDryRunContextPreview(context);

    const match = rendered.match(/Planning tools worst case: \+(\d+) tokens/);
    assert(match, `expected a worst-case token line, got:\n${rendered}`);
    assert(Number(match[1]) > 0, `worst-case token count must be positive, got ${match[1]}`);
  });
});

Deno.test("[exactl request create --dry-run-context] flag off prints no planning tools line (regression)", async () => {
  await withDryRunContextFixture(async ({ context, tempDir }) => {
    await writePlanningToolsConfigBlock(tempDir, context.appContext!, false);
    const rendered = await runDryRunContextPreview(context);

    assertStringIncludes(rendered, "Projected Prompt Breakdown", "flag-off preview still renders");
    assert(!rendered.includes("Available read-only planning tools:"), "no tools line when planning tools are off");
    assert(!rendered.includes("Planning tools worst case:"), "no worst-case line when planning tools are off");
  });
});
