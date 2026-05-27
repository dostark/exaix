/**
 * @module StreamingTest
 * @path packages/ai/tests/streaming_test.ts
 * @description Tests for optional generateStream method on IModelProvider.
 *   Verifies streaming-capable providers can declare and yield chunks,
 *   and non-streaming providers omit the method.
 */
import { assert, assertEquals } from "@std/assert";
import type { IGenerateResult } from "../src/providers/common.ts";
import type { IModelOptions, IModelProvider } from "../src/types.ts";

// ============================================================================
// Test 1: A provider CAN declare the optional generateStream method
// ============================================================================

class StreamingMockProvider implements IModelProvider {
  id = "streaming-mock";

  generate(_prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
    return Promise.resolve({
      content: "non-streamed fallback",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "mock",
      provider: "streaming-mock",
    });
  }

  async *generateStream(
    _prompt: string,
    _options?: IModelOptions,
  ): AsyncGenerator<string> {
    yield "chunk1";
    yield "chunk2";
    yield "chunk3";
  }
}

Deno.test("IModelProvider: optional generateStream exists on streaming provider", () => {
  const provider = new StreamingMockProvider();
  assert(typeof provider.generateStream === "function", "generateStream should be a function");
});

Deno.test("IModelProvider: generateStream yields string chunks", async () => {
  const provider = new StreamingMockProvider();
  const chunks: string[] = [];
  for await (const chunk of provider.generateStream!("test prompt")) {
    chunks.push(chunk);
  }
  assertEquals(chunks, ["chunk1", "chunk2", "chunk3"]);
});

Deno.test("IModelProvider: generateStream result can be collected to IGenerateResult with streamed flag", async () => {
  const provider = new StreamingMockProvider();
  const chunks: string[] = [];
  for await (const chunk of provider.generateStream!("test")) {
    chunks.push(chunk);
  }
  const result: IGenerateResult = {
    content: chunks.join(""),
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    model: "mock",
    provider: "streaming-mock",
    streamed: true,
  };
  assertEquals(result.content, "chunk1chunk2chunk3");
  assertEquals(result.streamed, true);
});

Deno.test("IModelProvider: non-streaming provider does not have generateStream", () => {
  const provider: IModelProvider = {
    id: "basic",
    generate(_prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
      return Promise.resolve({
        content: "basic response",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock",
        provider: "basic",
      });
    },
  };
  assertEquals(provider.generateStream, undefined);
});
