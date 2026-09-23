/**
 * @module PlanningToolLoopSecurityTest
 * @path packages/execution/tests/planning_tool_loop_security_test.ts
 * @description Security tests for PlanningToolLoop's confinement guard (Phase 199 GAP-5):
 *   every tool call path/repo_path/from/file param must resolve inside the request portal
 *   before ToolRegistry.execute() is reached — absolute paths, cross-alias `@other/` paths,
 *   `../` escapes, and symlinks pointing outside the portal are all rejected. Also covers
 *   the guardrail-blocked-result path (GAP-6).
 * @architectural-layer Test
 * @related-files [packages/execution/src/planning_tool_loop.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { PlanningToolLoop } from "../src/planning_tool_loop.ts";
import type { IPlanningToolLoopDeps, IPlanningToolLoopOptions } from "../src/planning_tool_loop.ts";
import type { ICallSite, IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import { makeGenerateResult } from "@exaix/testing";
import type { GuardrailIncident } from "@exaix/schemas";
import type { IGuardrailRunner } from "../src/guardrail_runner.ts";

class StubToolRegistry implements IToolRegistry {
  public calls: Array<{ name: string; params: Record<string, JSONValue> }> = [];
  constructor(
    private readonly tools: ITool[] = [],
    private readonly defaultResult: IToolResult = { success: true, data: {} },
  ) {}
  getTools(): ITool[] {
    return this.tools;
  }
  execute(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    this.calls.push({ name: toolName, params });
    return Promise.resolve(this.defaultResult);
  }
  getBaseDir(): string {
    return "/tmp/stub-tool-registry";
  }
}

function fixtureTool(name: string): ITool {
  return { name, description: `${name} description`, parameters: { type: "object", properties: {} } };
}

const stubTokenizer = {
  countTokens: (text: string) => Promise.resolve(Math.ceil(text.length / 4)),
  countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((t) => Math.ceil(t.length / 4))),
};

class ScriptedGenerate {
  public calls: Array<{ prompt: string; options: IModelOptions }> = [];
  private index = 0;
  constructor(private readonly responses: IGenerateResult[]) {}
  generate = (prompt: string, options: IModelOptions): Promise<IGenerateResult> => {
    this.calls.push({ prompt, options });
    const response = this.responses[this.index];
    this.index++;
    if (!response) throw new Error(`ScriptedGenerate: no scripted response for call #${this.index}`);
    return Promise.resolve(response);
  };
}

function makeDeps(overrides: Partial<IPlanningToolLoopDeps> = {}): IPlanningToolLoopDeps {
  return {
    toolRegistry: new StubToolRegistry(),
    tokenizer: stubTokenizer,
    modelId: "gpt-4",
    generate: () => {
      throw new Error("generate() not stubbed for this test");
    },
    ...overrides,
  };
}

function nextCallSiteFrom(scenarioId: string, stepId: string): () => ICallSite {
  let callIndex = 0;
  return () => ({ scenarioId, stepId, callIndex: callIndex++ });
}

function makeOptions(portalRoot: string, overrides: Partial<IPlanningToolLoopOptions> = {}): IPlanningToolLoopOptions {
  return {
    prompt: "Plan the change.",
    baseOptions: {},
    nextCallSite: nextCallSiteFrom("scenario-1", "step-1"),
    portalAlias: "myportal",
    portalRoot,
    allowedTools: new Set(["read_file", "git_info"]),
    maxRounds: 2,
    maxToolResultTokens: 2000,
    maxToolCallsPerRound: 10,
    traceId: "trace-1",
    ...overrides,
  };
}

/** Real portal fixture: portalRoot/src/a.ts (real file), and an outside sibling dir with a
 *  secret file, for the escape/traversal tests. */
function makePortalFixture(): { portalRoot: string; outsideRoot: string; cleanup: () => void } {
  const base = Deno.makeTempDirSync({ prefix: "planning-tool-loop-security-" });
  const portalRoot = join(base, "portal");
  const outsideRoot = join(base, "outside");
  Deno.mkdirSync(join(portalRoot, "src"), { recursive: true });
  Deno.mkdirSync(outsideRoot, { recursive: true });
  Deno.writeTextFileSync(join(portalRoot, "src", "a.ts"), "export const a = 1;");
  Deno.writeTextFileSync(join(outsideRoot, "secret.txt"), "top secret");
  return { portalRoot, outsideRoot, cleanup: () => Deno.removeSync(base, { recursive: true }) };
}

async function runOneToolRound(
  deps: IPlanningToolLoopDeps,
  options: IPlanningToolLoopOptions,
  toolName: string,
  input: Record<string, JSONValue>,
): Promise<{ turnContent: string; turnIsError: boolean; executed: boolean }> {
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: toolName, input }] });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop({ ...deps, generate: generate.generate });

  await loop.run(options);

  const priorTurn = generate.calls[1].options.priorTurn;
  const registry = deps.toolRegistry as StubToolRegistry;
  return {
    turnContent: String(priorTurn?.toolResultContent ?? ""),
    turnIsError: priorTurn?.toolResultIsError ?? false,
    executed: registry.calls.length > 0,
  };
}

// Confinement guard

Deno.test("[planning_tool_loop][security] a path prefixed with another portal's alias is rejected before execute", async () => {
  const fixture = makePortalFixture();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")]);
    const deps = makeDeps({ toolRegistry: registry });
    const options = makeOptions(fixture.portalRoot);

    const { turnContent, turnIsError, executed } = await runOneToolRound(deps, options, "read_file", {
      path: "@other-portal/src/a.ts",
    });

    assertEquals(executed, false, "ToolRegistry.execute must never be reached");
    assertEquals(turnIsError, true);
    assert(turnContent.includes("Access denied"));
  } finally {
    fixture.cleanup();
  }
});

Deno.test("[planning_tool_loop][security] a ../ escape from the portal root is rejected before execute", async () => {
  const fixture = makePortalFixture();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")]);
    const deps = makeDeps({ toolRegistry: registry });
    const options = makeOptions(fixture.portalRoot);

    const { turnIsError, executed } = await runOneToolRound(deps, options, "read_file", {
      path: "../outside/secret.txt",
    });

    assertEquals(executed, false);
    assertEquals(turnIsError, true);
  } finally {
    fixture.cleanup();
  }
});

Deno.test("[planning_tool_loop][security] an absolute path is rejected before execute", async () => {
  const fixture = makePortalFixture();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")]);
    const deps = makeDeps({ toolRegistry: registry });
    const options = makeOptions(fixture.portalRoot);

    const { turnIsError, executed } = await runOneToolRound(deps, options, "read_file", {
      path: "/etc/passwd",
    });

    assertEquals(executed, false);
    assertEquals(turnIsError, true);
  } finally {
    fixture.cleanup();
  }
});

Deno.test("[planning_tool_loop][security] a symlink inside the portal pointing outside it is rejected", async () => {
  const fixture = makePortalFixture();
  try {
    Deno.symlinkSync(
      join(fixture.outsideRoot, "secret.txt"),
      join(fixture.portalRoot, "src", "escape-link.ts"),
    );
    const registry = new StubToolRegistry([fixtureTool("read_file")]);
    const deps = makeDeps({ toolRegistry: registry });
    const options = makeOptions(fixture.portalRoot);

    const { turnIsError, executed } = await runOneToolRound(deps, options, "read_file", {
      path: "src/escape-link.ts",
    });

    assertEquals(executed, false, "a symlink resolving outside the portal must be rejected before execute");
    assertEquals(turnIsError, true);
  } finally {
    fixture.cleanup();
  }
});

Deno.test("[planning_tool_loop][security] git_info with repo_path outside the portal is rejected", async () => {
  const fixture = makePortalFixture();
  try {
    const registry = new StubToolRegistry([fixtureTool("git_info")]);
    const deps = makeDeps({ toolRegistry: registry });
    const options = makeOptions(fixture.portalRoot, { allowedTools: new Set(["git_info"]) });

    const { turnIsError, executed } = await runOneToolRound(deps, options, "git_info", {
      repo_path: "../outside",
      scope: "status",
    });

    assertEquals(executed, false);
    assertEquals(turnIsError, true);
  } finally {
    fixture.cleanup();
  }
});

Deno.test("[planning_tool_loop][security] a legitimate portal-relative path is accepted and reaches execute", async () => {
  const fixture = makePortalFixture();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], { success: true, data: { content: "ok" } });
    const deps = makeDeps({ toolRegistry: registry });
    const options = makeOptions(fixture.portalRoot);

    const { executed, turnIsError } = await runOneToolRound(deps, options, "read_file", { path: "src/a.ts" });

    assertEquals(executed, true);
    assertEquals(turnIsError, false);
  } finally {
    fixture.cleanup();
  }
});

// Guardrail screening

class StubGuardrailRunner implements IGuardrailRunner {
  public screened: string[] = [];
  constructor(private readonly blockAfter: number) {}
  private callCount = 0;
  screen(agentOutput: string, _traceId: string, _iteration: number): Promise<GuardrailIncident[]> {
    this.callCount++;
    this.screened.push(agentOutput);
    return Promise.resolve([]);
  }
  hasBlockingViolation(_traceId: string): boolean {
    return this.callCount >= this.blockAfter;
  }
}

Deno.test("[planning_tool_loop][security] a guardrail blocking violation on a tool result replaces it with an error result and forces the final round", async () => {
  const fixture = makePortalFixture();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], { success: true, data: { content: "ok" } });
    const guardrailRunner = new StubGuardrailRunner(1); // blocks starting from the very first screen() call
    const deps = makeDeps({ toolRegistry: registry, guardrailRunner });
    const options = makeOptions(fixture.portalRoot, { maxRounds: 5 }); // would run 5 rounds absent the guardrail

    const round1 = makeGenerateResult("", {
      toolCalls: [{ id: "t1", name: "read_file", input: { path: "src/a.ts" } }],
    });
    const round2Final = makeGenerateResult("<thought>t</thought><content>plan</content>");
    const generate = new ScriptedGenerate([round1, round2Final]);
    const loop = new PlanningToolLoop({ ...deps, generate: generate.generate });

    const result = await loop.run(options);

    assertEquals(generate.calls.length, 2, "the guardrail must force round 2 to be the final round, not run all 5");
    assertEquals(generate.calls[1].options.toolChoice?.type, "none");
    assertEquals(generate.calls[1].options.priorTurn?.toolResultIsError, true);
    assert(String(generate.calls[1].options.priorTurn?.toolResultContent).includes("blocked by guardrail"));
    assertEquals(result.stopReason, "guardrail_blocked");
  } finally {
    fixture.cleanup();
  }
});
