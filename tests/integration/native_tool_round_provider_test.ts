/**
 * @module NativeToolRoundProviderTest
 * @path tests/integration/native_tool_round_provider_test.ts
 * @description Drives the registered Google provider through the real
 *   PlanningToolLoop. A stubbed transport returns a two-call Gemini response with signed parts,
 *   then records the follow-up request. The next request must replay every original model part
 *   and one functionResponse per call, in order. The boot metadata flag is read from
 *   bootstrapProviderRegistry(), not from a hand-built fixture.
 * @architectural-layer Test
 * @related-files [
 *   "packages/execution/src/planning_tool_loop.ts",
 *   "packages/ai-google/src/google_provider.ts",
 *   "apps/common/registry_bootstrap.ts"
 * ]
 */

import { assertEquals } from "@std/assert";
import { PlanningToolLoop } from "@exaix/execution";
import { GoogleProvider } from "@exaix/ai-google";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import { PROVIDER_GOOGLE } from "@exaix/ai-google";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";

const FIXTURE_PORTAL_ROOT = Deno.makeTempDirSync({ prefix: "native-tool-round-provider-" });

const READ_FILE_TOOL: ITool = {
  name: "read_file",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } } },
};

const SIGNED_ROUND_PARTS: Array<Record<string, JSONValue>> = [
  { functionCall: { name: "read_file", args: { path: "a.ts" } }, thoughtSignature: "sig-a" },
  { functionCall: { name: "read_file", args: { path: "b.ts" } } },
];

class RecordingToolRegistry implements IToolRegistry {
  public calls: string[] = [];
  getTools(): ITool[] {
    return [READ_FILE_TOOL];
  }
  execute(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    this.calls.push(`${toolName}:${String(params.path)}`);
    return Promise.resolve({ success: true, data: { content: `BODY-${String(params.path)}` } });
  }
  getBaseDir(): string {
    return FIXTURE_PORTAL_ROOT;
  }
}

type GeminiBody = Record<string, JSONValue>;

interface IGeminiContent {
  role: string;
  parts: Array<Record<string, JSONValue>>;
}

interface IGeminiRequest {
  contents: IGeminiContent[];
}

/** Serves scripted Gemini bodies in order and records each request body. */
function scriptedGeminiFetch(bodies: GeminiBody[]): { requests: IGeminiRequest[]; restore: () => void } {
  const captured: IGeminiRequest[] = [];
  const original = globalThis.fetch;
  let index = 0;
  globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
    captured.push(JSON.parse((init?.body as string) ?? "{}") as IGeminiRequest);
    const body = bodies[index++];
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return { requests: captured, restore: () => void (globalThis.fetch = original) };
}

Deno.test("[native_tool_round][google] the registered Google provider replays a signed two-call planning round in order", async () => {
  bootstrapProviderRegistry();
  const scripted = scriptedGeminiFetch([
    {
      candidates: [{ content: { parts: SIGNED_ROUND_PARTS } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    },
    {
      candidates: [{ content: { parts: [{ text: "plan" }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    },
  ]);
  try {
    assertEquals(
      ProviderRegistry.getMetadataForInstance(PROVIDER_GOOGLE)?.supportsParallelToolReplay,
      true,
      "boot registration must declare grouped replay for google",
    );
    const provider = new GoogleProvider({ apiKey: "test-key" });
    const registry = new RecordingToolRegistry();
    const loop = new PlanningToolLoop({
      toolRegistry: registry,
      tokenizer: {
        countTokens: (t: string) => Promise.resolve(Math.ceil(t.length / 4)),
        countTokensBatch: (ts: string[]) => Promise.resolve(ts.map((t) => Math.ceil(t.length / 4))),
      },
      modelId: "gemini-test",
      providerId: PROVIDER_GOOGLE,
      generate: (prompt: string, options: IModelOptions): Promise<IGenerateResult> =>
        provider.generate(prompt, options),
    });

    const result = await loop.run({
      prompt: "Plan the change.",
      baseOptions: {},
      nextCallSite: () => ({ scenarioId: "s", stepId: "t", callIndex: 0 }),
      portalAlias: "fixture",
      portalRoot: FIXTURE_PORTAL_ROOT,
      allowedTools: new Set(["read_file"]),
      maxRounds: 2,
      maxToolResultTokens: 2000,
      maxToolCallsPerRound: 10,
      traceId: "trace-native-round-google",
    });

    assertEquals(registry.calls, ["read_file:@fixture/a.ts", "read_file:@fixture/b.ts"]);
    assertEquals(scripted.requests.length, 2);
    const contents = scripted.requests[1].contents;
    assertEquals(contents[1].parts, SIGNED_ROUND_PARTS, "every original model part must replay verbatim");
    const responses = contents[2].parts.filter((part) => part.functionResponse !== undefined);
    assertEquals(responses.length, 2, "one functionResponse per call, grouped in one user message");
    assertEquals(result.final.content, "plan");
  } finally {
    scripted.restore();
    ProviderRegistry.clear();
  }
});
