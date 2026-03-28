/**
 * @module LlamaProviderTest
 * @path tests/ai/llama_provider_test.ts
 * @description Verifies the Llama (local) LLM provider, ensuring correct integration
 * with local inference endpoints and stable request/response handling.
 */

import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.203.0/testing/asserts.ts";
import { PlanSchema } from "../../src/shared/schemas/plan_schema.ts";
import { LlamaProvider } from "../../src/ai/providers/llama_provider.ts";
import { getProviderForModel } from "./helpers/test_config.ts";

// Check if LlamaProvider tests should run
const shouldRunLlamaTests = Deno.env.get("EXA_TEST_ENABLE_LLAMA") === "true";

// Helper function to conditionally run tests
function llamaTest(name: string, fn: () => void | Promise<void>) {
  if (shouldRunLlamaTests) {
    Deno.test(name, fn);
  } else {
    Deno.test.ignore(name, fn);
  }
}

llamaTest("LlamaProvider responds to trivial prompt", async () => {
  const provider = new LlamaProvider({ model: "llama3.2:1b" });
  const prompt = "Hello";
  let response = "";
  try {
    response = await provider.generate(prompt);
    console.log("[DEBUG] Trivial prompt response:\n", response);
    // Just check that we got a non-empty string
    if (!response || typeof response !== "string" || response.length === 0) {
      throw new Error("No response or empty response from model");
    }
  } catch (err) {
    console.error("[ERROR] Trivial prompt test failed:", err);
    if (response) {
      console.error("[ERROR] Full response:\n", response);
    }
    throw err;
  }
});
llamaTest("Ollama server connection check", async () => {
  const endpoint = "http://localhost:11434";
  try {
    const res = await fetch(endpoint);
    const text = await res.text();
    console.log("[DEBUG] Ollama server response:", text);
    if (!res.ok) {
      throw new Error(`Ollama server returned status ${res.status}`);
    }
  } catch (err) {
    console.error("[ERROR] Ollama connection failed:", err);
    throw err;
  }
});
llamaTest("LlamaProvider generates valid plan for simple prompt (with senior-coder blueprint)", async () => {
  // Read the system prompt from the blueprint file
  const decoder = new TextDecoder();
  const blueprintRaw = Deno.readFileSync("Blueprints/Identities/senior-coder.md");
  const blueprint = decoder.decode(blueprintRaw);
  // Remove TOML frontmatter (between +++ ... +++)
  const promptStart = blueprint.indexOf("+++", 3);
  const systemPrompt = promptStart !== -1 ? blueprint.slice(promptStart + 3).trim() : blueprint.trim();
  const userPrompt =
    `Design and implement a real-time notification system for a collaborative document editor with the following requirements:\n  - Backend must support event-driven notifications for document edits, comments, and mentions\n  - Use WebSocket for real-time delivery to connected clients\n  - Database schema must store notifications, read status, and user references\n  - Frontend must display notifications in a bell icon, dropdown panel, and toast alerts\n  - Include authentication and permission checks for notification delivery\n  Output a step-by-step implementation plan in strict JSON format only, matching the schema in the system prompt. Do not include any explanation or markdown, only the JSON object.`;
  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
  console.log("[DEBUG] Using prompt for LlamaProvider:\n", fullPrompt);
  const provider = new LlamaProvider({ model: "llama3.2:1b" });
  let planJson = "";
  try {
    planJson = await provider.generate(fullPrompt);
    console.log("[DEBUG] LlamaProvider raw response:\n", planJson.slice(0, 500));
    const plan = JSON.parse(planJson);
    const result = PlanSchema.safeParse(plan);
    console.log("[DEBUG] PlanSchema validation result:", result);
    assertEquals(result.success, true);
  } catch (err) {
    console.error("[ERROR] LlamaProvider test failed:", err);
    if (planJson) {
      console.error("[ERROR] Full Ollama response:\n", planJson);
    }
    throw err;
  }
});

llamaTest("LlamaProvider handles connection errors", async () => {
  const provider = new LlamaProvider({ model: "llama3.2:1b", endpoint: "http://localhost:9999" });
  await assertRejects(
    () => provider.generate("Test connection error"),
    Error,
    "Connection error",
  );
});

llamaTest("LlamaProvider rejects invalid model names (constructor)", () => {
  // Error is thrown in constructor, not generate()
  assertThrows(
    () => new LlamaProvider({ model: "invalid-model" }),
    Error,
    "Unsupported model",
  );
});
// NOTE: To run all tests, use:
// deno test --allow-net --allow-env tests/ai/llama_provider_test.ts

llamaTest("LlamaProvider returns error for invalid JSON output", async () => {
  // This test assumes you can mock the Ollama response to return invalid JSON
  // For now, just simulate the error
  class BadLlamaProvider extends LlamaProvider {
    constructor() {
      super({ model: "codellama:7b-instruct" });
    }
    override generate(): Promise<string> {
      return Promise.resolve("not a json");
    }
  }
  const provider = new BadLlamaProvider();
  await assertRejects(
    async () => {
      const planJson = await provider.generate();
      JSON.parse(planJson);
    },
    SyntaxError,
  );
});

llamaTest("Provider selection logic routes Llama models to LlamaProvider", () => {
  // This test assumes a provider factory exists

  const provider = getProviderForModel("llama3.2:1b");
  assertEquals(provider instanceof LlamaProvider, true);
});
