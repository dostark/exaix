/**
 * @module NativeToolRoundLiveTest
 * @path tests/integration/native_tool_round_live_test.ts
 * @description Supplemental live qualification. Runs the real GoogleProvider and
 *   PlanningToolLoop against gemini-3-flash with three distinct files (a.txt, b.txt, c.txt) that
 *   each carry a random marker. The follow-up content must contain every marker, which proves the
 *   signed round replayed successfully. Opt-in only: without EXA_TEST_ENABLE_PAID_LLM=1 and
 *   GOOGLE_API_KEY the case is reported as ignored (NOT RUN) and never counts as a pass.
 * @architectural-layer Test
 * @related-files [
 *   "tests/integration/native_tool_round_provider_test.ts",
 *   "packages/ai-google/src/google_provider.ts",
 *   "packages/execution/src/planning_tool_loop.ts"
 * ]
 */

import { assert, assertEquals } from "@std/assert";
import { PlanningToolLoop } from "@exaix/execution";
import { GoogleProvider } from "@exaix/ai-google";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";

const LIVE_MODEL = "gemini-3-flash";
const LIVE_FILES = ["a.txt", "b.txt", "c.txt"] as const;
const PAID_OPT_IN_ENV = "EXA_TEST_ENABLE_PAID_LLM";
const GOOGLE_KEY_ENV = "GOOGLE_API_KEY";

const liveEnabled = Deno.env.get(PAID_OPT_IN_ENV) === "1" && Boolean(Deno.env.get(GOOGLE_KEY_ENV));

const READ_FILE_TOOL: ITool = {
  name: "read_file",
  description: "Read a file inside the portal",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

/** Serves real file bodies from the temporary portal. The marker is reachable only by reading. */
class PortalFileRegistry implements IToolRegistry {
  constructor(private readonly root: string) {}
  getTools(): ITool[] {
    return [READ_FILE_TOOL];
  }
  async execute(_toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    const body = await Deno.readTextFile(`${this.root}/${String(params.path)}`);
    return { success: true, data: { content: body } };
  }
  getBaseDir(): string {
    return this.root;
  }
}

Deno.test({
  name: "[native_tool_round][live] gemini-3-flash replays three signed reads and answers with every marker",
  ignore: !liveEnabled,
  fn: async () => {
    bootstrapProviderRegistry();
    const root = Deno.makeTempDirSync({ prefix: "native-tool-round-live-" });
    const markers = LIVE_FILES.map((file) => {
      const marker = `MARK-${crypto.randomUUID().slice(0, 8)}`;
      Deno.writeTextFileSync(`${root}/${file}`, `secret for ${file}: ${marker}\n`);
      return marker;
    });
    try {
      const provider = new GoogleProvider({ apiKey: Deno.env.get(GOOGLE_KEY_ENV) ?? "", model: LIVE_MODEL });
      const loop = new PlanningToolLoop({
        toolRegistry: new PortalFileRegistry(root),
        tokenizer: {
          countTokens: (t: string) => Promise.resolve(Math.ceil(t.length / 4)),
          countTokensBatch: (ts: string[]) => Promise.resolve(ts.map((t) => Math.ceil(t.length / 4))),
        },
        modelId: LIVE_MODEL,
        providerId: provider.id,
        generate: (prompt: string, options: IModelOptions): Promise<IGenerateResult> =>
          provider.generate(prompt, options),
      });
      const result = await loop.run({
        prompt: `Read files ${LIVE_FILES.join(", ")} with read_file, then reply with the three secret markers.`,
        baseOptions: {},
        nextCallSite: () => ({ scenarioId: "live-native-round", stepId: "replay", callIndex: 0 }),
        portalAlias: "live",
        portalRoot: root,
        allowedTools: new Set(["read_file"]),
        maxRounds: 3,
        maxToolResultTokens: 2000,
        maxToolCallsPerRound: 10,
        traceId: "trace-live-native-round",
      });
      for (const marker of markers) assert(result.final.content.includes(marker), `missing marker ${marker}`);
      assertEquals(result.toolCalls >= LIVE_FILES.length, true);
    } finally {
      ProviderRegistry.clear();
      Deno.removeSync(root, { recursive: true });
    }
  },
});
