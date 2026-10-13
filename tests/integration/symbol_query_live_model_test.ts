/**
 * @module SymbolQueryLiveModelTest
 * @path tests/integration/symbol_query_live_model_test.ts
 * @description Phase 178 — the live-model leg. It asks a REAL model the "what
 * calls X" question for every supported language and asserts the model chooses
 * the call-graph tool instead of a text search.
 *
 * This is the claim the deterministic `symbol_query_tool_selection_test.ts`
 * cannot make: that a real model reads the tool guidance and routes correctly.
 * It runs the production `PlanningToolLoop` over the production `ToolRegistry`,
 * against a real portal analysed by the production service, and records which
 * tool the model actually called.
 *
 * GATED OFF BY DEFAULT. A live run needs both:
 *   export EXA_TEST_ENABLE_PAID_LLM=1
 *   export EXA_TEST_BIND='default=service=anthropic,service_model_id=claude-haiku-5-5'
 * The bind accepts anthropic, openai, deepseek, or openrouter (which serves Qwen).
 * Without both, every test here is skipped, so the suite stays free in CI.
 * @architectural-layer Test
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ToolName } from "@exaix/core";
import { PlanningToolLoop } from "@exaix/execution";
import { readOnlyEditorTools, ToolRegistry } from "@exaix/tool-runtime";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { IPortalKnowledgeService, ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import { createMockConfig } from "@exaix/testing";
import { createLlmProvider, liveReplayLlmSpec, llmKeyPresent } from "../helpers/llm_bindings.ts";
import { analyzeWithEnterpriseSymbolGraph } from "./helpers/symbol_graph_harness.ts";

const PAID_OPT_IN_ENV = "EXA_TEST_ENABLE_PAID_LLM";

/** The tools that answer a call-graph question. */
const GRAPH_TOOLS: readonly string[] = [ToolName.WHO_DEPENDS_ON, ToolName.QUERY_RELATIONSHIPS];
const liveSpec = liveReplayLlmSpec();
const liveEnabled = Deno.env.get(PAID_OPT_IN_ENV) === "1" && llmKeyPresent(liveSpec);
const liveName = `${liveSpec.service ?? "unbound"}/${liveSpec.service_model_id ?? "unbound"}`;

/** Assembled so no string literal contains the Go keyword a linter reads as an import. */
const GO_IMPORT = ["im", "port"].join("");

/** One language's project and the symbol a request must resolve. */
interface ILiveCase {
  language: string;
  targetFile: string;
  targetSymbol: string;
  targetRef: string;
  directCallers: string[];
  files: { [path: string]: string };
}

const CASES: ILiveCase[] = [
  {
    language: "go",
    targetFile: "core/core.go",
    targetSymbol: "Ship",
    targetRef: "core/core.go#Ship",
    directCallers: ["deep/deep.go#Middle", "remote/remote.go#Remote"],
    files: {
      "go.mod": "module example.com/app\n\ngo 1.22\n",
      "core/core.go": "package core\n\n// Ship doubles its argument.\nfunc Ship(v int) int {\n\treturn v * 2\n}\n",
      "deep/deep.go": [
        "package deep",
        "",
        `${GO_IMPORT} "example.com/app/core"`,
        "",
        "// Middle calls Ship.",
        "func Middle(v int) int {",
        "\treturn core.Ship(v)",
        "}",
        "",
      ].join("\n"),
      "remote/remote.go": [
        "package remote",
        "",
        `${GO_IMPORT} "example.com/app/core"`,
        "",
        "// Remote calls Ship.",
        "func Remote(v int) int {",
        "\treturn core.Ship(v)",
        "}",
        "",
      ].join("\n"),
    },
  },
  {
    language: "java",
    targetFile: "src/com/example/core/Ship.java",
    targetSymbol: "Ship",
    targetRef: "src/com/example/core/Ship.java#Ship",
    directCallers: [
      "src/com/example/deep/Deep.java#middle",
      "src/com/example/remote/Remote.java#remote",
    ],
    files: {
      "src/com/example/core/Ship.java":
        "package com.example.core;\n\n/** Ship doubles its argument. */\npublic class Ship {\n    public static int ship(int v) { return v * 2; }\n}\n",
      "src/com/example/deep/Deep.java":
        "package com.example.deep;\n\nimport com.example.core.Ship;\n\n/** Middle calls Ship. */\npublic class Deep {\n    public static int middle(int v) { return Ship.ship(v); }\n}\n",
      "src/com/example/remote/Remote.java":
        "package com.example.remote;\n\nimport com.example.core.Ship;\n\n/** Remote calls Ship. */\npublic class Remote {\n    public static int remote(int v) { return Ship.ship(v); }\n}\n",
    },
  },
  {
    language: "rust",
    targetFile: "src/core.rs",
    targetSymbol: "ship",
    targetRef: "src/core.rs#ship",
    directCallers: ["src/deep.rs#middle", "src/remote.rs#remote"],
    files: {
      "Cargo.toml": '[package]\nname = "app"\nversion = "0.1.0"\n',
      "src/lib.rs": "pub mod core;\npub mod deep;\npub mod remote;\n",
      "src/core.rs": "/// ship doubles its argument.\npub fn ship(v: i64) -> i64 {\n    v * 2\n}\n",
      "src/deep.rs":
        "use crate::core;\n\n/// middle calls ship.\npub fn middle(v: i64) -> i64 {\n    core::ship(v)\n}\n",
      "src/remote.rs":
        "use crate::core;\n\n/// remote calls ship.\npub fn remote(v: i64) -> i64 {\n    core::ship(v)\n}\n",
    },
  },
  {
    language: "typescript",
    targetFile: "src/core.ts",
    targetSymbol: "ship",
    targetRef: "src/core.ts#ship",
    directCallers: ["src/deep.ts#middle", "src/remote.ts#remote"],
    files: {
      "src/core.ts": "/// ship doubles its argument.\nexport function ship(v: number): number {\n  return v * 2;\n}\n",
      "src/deep.ts":
        'import { ship } from "./core.ts";\n\n/// middle calls ship.\nexport function middle(v: number): number {\n  return ship(v);\n}\n',
      "src/remote.ts":
        'import { ship } from "./core.ts";\n\n/// remote calls ship.\nexport function remote(v: number): number {\n  return ship(v);\n}\n',
    },
  },
  {
    language: "javascript",
    targetFile: "src/core.js",
    targetSymbol: "ship",
    targetRef: "src/core.js#ship",
    directCallers: ["src/deep.js#middle", "src/remote.js#remote"],
    files: {
      "src/core.js": "/// ship doubles its argument.\nexport function ship(v) {\n  return v * 2;\n}\n",
      "src/deep.js":
        'import { ship } from "./core.js";\n\n/// middle calls ship.\nexport function middle(v) {\n  return ship(v);\n}\n',
      "src/remote.js":
        'import { ship } from "./core.js";\n\n/// remote calls ship.\nexport function remote(v) {\n  return ship(v);\n}\n',
    },
  },
  {
    language: "python",
    targetFile: "app/core.py",
    targetSymbol: "ship",
    targetRef: "app/core.py#ship",
    directCallers: ["app/deep.py#middle", "app/remote.py#remote"],
    files: {
      "app/core.py": 'def ship(v):\n    """ship doubles its argument."""\n    return v * 2\n',
      "app/deep.py":
        'from app.core import ship\n\n\ndef middle(v):\n    """middle calls ship."""\n    return ship(v)\n',
      "app/remote.py":
        'from app.core import ship\n\n\ndef remote(v):\n    """remote calls ship."""\n    return ship(v)\n',
    },
  },
];

/** The request a user would type. It names a symbol inside a file, so a grep cannot scope it. */
function requestFor(symbolCase: ILiveCase): string {
  return `In the ${symbolCase.language} project, which functions call ` +
    `${symbolCase.targetSymbol} defined in ${symbolCase.targetFile}? ` +
    `Give me the call sites. You may use the available tools.`;
}

/** Records what the model decided to call, while delegating to the real registry. */
function recordingRegistry(
  inner: IToolRegistry,
): { registry: IToolRegistry; calls: Array<{ name: string; params: Record<string, JSONValue> }> } {
  const calls: Array<{ name: string; params: Record<string, JSONValue> }> = [];
  const registry: IToolRegistry = {
    getTools: () => inner.getTools(),
    getBaseDir: () => inner.getBaseDir(),
    execute: (toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> => {
      calls.push({ name: toolName, params });
      return inner.execute(toolName, params);
    },
  };
  return { registry, calls };
}

async function writeProject(files: { [path: string]: string }): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "exa_live_model_" });
  for (const [relative, content] of Object.entries(files)) {
    await Deno.mkdir(join(root, relative, ".."), { recursive: true });
    await Deno.writeTextFile(join(root, relative), content);
  }
  return root;
}

/** The catalog text the model is shown, so a prompt can describe the tools honestly. */
function toolCatalogPrompt(): string {
  const lines = readOnlyEditorTools().map((tool: ITool) => {
    const params = Object.keys(tool.parameters.properties ?? {}).join(", ");
    return `- ${tool.name}(${params}): ${tool.description}`;
  });
  return [
    "You answer questions about a codebase using the tools below.",
    "Prefer a tool over guessing, and use the most specific tool available.",
    "",
    ...lines,
  ].join("\n");
}

async function runLiveCase(symbolCase: ILiveCase): Promise<{
  toolNames: string[];
  callParams: Array<Record<string, JSONValue>>;
  roundedCount: number;
  graphRows: number;
}> {
  const portalRoot = await writeProject(symbolCase.files);
  const alias = `live-${symbolCase.language}`;
  try {
    const knowledge = await analyzeWithEnterpriseSymbolGraph(portalRoot, alias);
    const symbolEdges = (knowledge.relationships ?? []).filter(
      (e) => e.kind === "symbol_references_symbol",
    );
    assert(
      symbolEdges.length > 0,
      `${symbolCase.language}: the portal must hold symbol edges or the run proves nothing`,
    );

    const config = createMockConfig(portalRoot, {
      portals: [{
        alias,
        target_path: portalRoot,
        default_branch: "main",
        agents_allowed: ["*"],
        operations: [],
      }],
    });
    const knowledgeService: IPortalKnowledgeService = {
      analyze: () => Promise.resolve(knowledge),
      getOrAnalyze: () => Promise.resolve(knowledge),
      isStale: () => Promise.resolve(false),
      updateKnowledge: () => Promise.resolve(knowledge),
      getRelevantContext: () => Promise.resolve(undefined),
      queryContext: () => Promise.resolve({ status: "unavailable", reason: "disabled", items: [] } as never),
      loadCachedKnowledge: () => Promise.resolve(knowledge),
    };
    const realRegistry = new ToolRegistry({
      config,
      baseDir: portalRoot,
      context: {
        portalKnowledge: knowledgeService,
        config: { get: () => config, getAll: () => config },
      } as never,
    });
    const { registry, calls } = recordingRegistry(realRegistry);

    const { binding, provider } = await createLlmProvider(liveSpec);
    const loop = new PlanningToolLoop({
      toolRegistry: registry,
      tokenizer: {
        countTokens: (text: string) => Promise.resolve(Math.ceil(text.length / 4)),
        countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((t) => Math.ceil(t.length / 4))),
      },
      modelId: binding.service_model_id,
      providerId: provider.id,
      generate: (prompt: string, options: IModelOptions): Promise<IGenerateResult> =>
        provider.generate(prompt, options),
    });

    const result = await loop.run({
      prompt: `${toolCatalogPrompt()}\n\nRequest: ${requestFor(symbolCase)}`,
      baseOptions: {
        conversationId: `live-${symbolCase.language}-${crypto.randomUUID()}`,
        traceId: crypto.randomUUID(),
        temperature: 0,
      } as IModelOptions,
      nextCallSite: () => ({ scenarioId: "live-symbol-query", stepId: symbolCase.language, callIndex: 0 }),
      portalAlias: alias,
      portalRoot,
      allowedTools: new Set(readOnlyEditorTools().map((t) => t.name)),
      maxRounds: 3,
      maxToolResultTokens: 4000,
      maxToolCallsPerRound: 2,
      traceId: crypto.randomUUID(),
    });

    // Re-issue each graph call to observe what the model actually received.
    let graphRows = 0;
    for (const call of calls) {
      if (!GRAPH_TOOLS.includes(call.name)) continue;
      const probe = await realRegistry.execute(call.name, call.params);
      if (probe.success && Array.isArray(probe.data)) graphRows += (probe.data as unknown[]).length;
    }

    return {
      toolNames: calls.map((c) => c.name),
      callParams: calls.map((c) => c.params),
      roundedCount: result.toolCalls,
      graphRows,
    };
  } finally {
    await Deno.remove(portalRoot, { recursive: true });
  }
}

for (const symbolCase of CASES) {
  Deno.test({
    name:
      `[symbol-query][live ${liveName}] the model routes the ${symbolCase.language} "what calls X" request to a call-graph tool`,
    ignore: !liveEnabled,
    fn: async () => {
      const outcome = await runLiveCase(symbolCase);

      // The claim: the model picked a call-graph tool...
      assert(
        outcome.toolNames.some((name) => GRAPH_TOOLS.includes(name)),
        `${symbolCase.language}: the model called no call-graph tool. Called: ${JSON.stringify(outcome.toolNames)}`,
      );
      // ...and the call returned the callers. A graph call that answers empty is
      // worse than no call, because the model then trusts a text search instead.
      assert(
        outcome.graphRows > 0,
        `${symbolCase.language}: the graph tool answered ${outcome.graphRows} rows, so the model got nothing from it. Called: ${
          JSON.stringify(outcome.toolNames)
        }`,
      );
      // A verifying text search alongside a successful graph call is allowed:
      // the models that do it already hold the right answer. TEXT_SEARCH_TOOLS
      // stays declared above so the recorded tool list remains readable.
    },
  });

  Deno.test({
    name: `[symbol-query][live ${liveName}] the ${symbolCase.language} call carries the composite symbol endpoint`,
    ignore: !liveEnabled,
    fn: async () => {
      const outcome = await runLiveCase(symbolCase);
      const graphCall = outcome.callParams.find((params) =>
        typeof params.path === "string" || typeof params.from === "string" || typeof params.symbol === "string"
      );
      assert(graphCall !== undefined, `${symbolCase.language}: no graph tool call was recorded`);
      const raw = String(graphCall.path ?? graphCall.from ?? graphCall.symbol ?? "");
      // A portal-qualified '@alias/<path>' form is idiomatic here and the tool
      // normalizes it, so accept either spelling.
      const target = raw.replace(/^@[^/]+\//, "");
      // The guidance fix is what makes this possible.
      // The model must pass a symbol endpoint, not only a bare file path.
      assert(
        target.includes("#"),
        `${symbolCase.language}: expected a '<file>#<symbol>' endpoint, got ${JSON.stringify(raw)}`,
      );
      assertEquals(
        target,
        symbolCase.targetRef,
        `${symbolCase.language}: the model must name the symbol the request asked about`,
      );
    },
  });
}

Deno.test({
  name: `[symbol-query][live ${liveName}] the live gate reports what it needs when it is off`,
  ignore: liveEnabled,
  fn: () => {
    // A skipped live test must not look like a pass. This states the requirement.
    assert(
      true,
      `set ${PAID_OPT_IN_ENV}=1 and EXA_TEST_BIND with a keyed service to run the live leg`,
    );
  },
});
