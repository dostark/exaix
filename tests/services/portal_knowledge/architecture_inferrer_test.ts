/**
 * @module ArchitectureInferrerTest
 * @path tests/services/portal_knowledge/architecture_inferrer_test.ts
 * @description Tests for the ArchitectureInferrer (Strategy 5): LLM-based
 * generation of a Markdown architecture overview from combined strategy outputs.
 * Uses mock IModelProvider and MockOutputValidator to avoid real LLM calls.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import type { ZodType, ZodTypeDef } from "zod";
import {
  ArchitectureInferrer,
  type IArchitectureValidator,
} from "../../../src/services/portal_knowledge/architecture_inferrer.ts";
import type { IModelProvider } from "../../../src/ai/types.ts";
import type { IGenerateResult } from "../../../src/ai/providers/common.ts";
import type { IValidationResult } from "../../../src/services/tool/output_validator.ts";
import type { ICodeConvention, IFileSignificance } from "@exaix/schemas/portal_knowledge.ts";
import { ARCHITECTURE_INFERRER_MAX_FILE_TOKENS, ARCHITECTURE_INFERRER_TOKEN_BUDGET } from "@exaix/core";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockProvider(response: string): IModelProvider {
  return {
    id: "mock",
    generate: (_prompt: string): Promise<IGenerateResult> =>
      Promise.resolve({
        content: response,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      }),
  };
}

/** Minimal IArchitectureValidator for tests. */
class MockOutputValidator implements IArchitectureValidator {
  private readonly _success: boolean;
  validateCallCount = 0;

  constructor(success: boolean) {
    this._success = success;
  }
  validate<T>(content: string, _schema: ZodType<T, ZodTypeDef, unknown>): IValidationResult<T> {
    this.validateCallCount++;
    if (this._success) {
      return {
        success: true,
        value: content as T,
        repairAttempted: false,
        repairSucceeded: false,
        raw: content,
      };
    }
    return { success: false, repairAttempted: false, repairSucceeded: false, raw: content };
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const MOCK_OVERVIEW = "## Architecture\n\nThis project uses a service pattern.";

const KEY_FILES: IFileSignificance[] = [
  { path: "src/main.ts", role: "entrypoint", description: "Entry point" },
  { path: "src/services/auth_service.ts", role: "core-service", description: "Auth" },
];

const CONVENTIONS: ICodeConvention[] = [
  {
    name: "Service naming pattern",
    description: "Files follow *_service.ts",
    examples: ["src/services/auth_service.ts"],
    category: "naming",
    evidenceCount: 3,
    confidence: "medium",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[ArchitectureInferrer] generates architecture overview from mock LLM response", async () => {
  const inferrer = new ArchitectureInferrer(
    makeMockProvider(MOCK_OVERVIEW),
    new MockOutputValidator(true),
  );
  const result = await inferrer.infer({
    portalPath: "/portal",
    directoryTree: ["src/", "src/main.ts"],
    keyFiles: KEY_FILES,
    conventions: CONVENTIONS,
    configSummary: "",
    dependencySummary: "",
  });
  assertEquals(result, MOCK_OVERVIEW);
});

Deno.test("[ArchitectureInferrer] passes directory tree in prompt", async () => {
  let capturedPrompt = "";
  const provider: IModelProvider = {
    id: "mock",
    generate: (prompt: string): Promise<IGenerateResult> => {
      capturedPrompt = prompt;
      return Promise.resolve({
        content: MOCK_OVERVIEW,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  const inferrer = new ArchitectureInferrer(provider, new MockOutputValidator(true));
  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: ["src/", "src/main.ts", "src/services/"],
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
  });
  assertStringIncludes(capturedPrompt, "src/main.ts");
});

Deno.test("[ArchitectureInferrer] passes key files and patterns in prompt", async () => {
  let capturedPrompt = "";
  const provider: IModelProvider = {
    id: "mock",
    generate: (prompt: string): Promise<IGenerateResult> => {
      capturedPrompt = prompt;
      return Promise.resolve({
        content: MOCK_OVERVIEW,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  const inferrer = new ArchitectureInferrer(provider, new MockOutputValidator(true));
  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: [],
    keyFiles: KEY_FILES,
    conventions: CONVENTIONS,
    configSummary: "deno.json found",
    dependencySummary: "std@0.203",
  });
  assertStringIncludes(capturedPrompt, "auth_service.ts");
  assertStringIncludes(capturedPrompt, "Service naming pattern");
  assertStringIncludes(capturedPrompt, "deno.json found");
});

Deno.test("[ArchitectureInferrer] handles LLM failure gracefully", async () => {
  const failingProvider: IModelProvider = {
    id: "mock",
    generate: (): Promise<IGenerateResult> => Promise.reject(new Error("network error")),
  };
  const inferrer = new ArchitectureInferrer(failingProvider, new MockOutputValidator(true));
  const result = await inferrer.infer({
    portalPath: "/portal",
    directoryTree: [],
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
  });
  assertEquals(result, "");
});

Deno.test("[ArchitectureInferrer] returns empty overview on invalid LLM output", async () => {
  const inferrer = new ArchitectureInferrer(
    makeMockProvider("garbage output"),
    new MockOutputValidator(false),
  );
  const result = await inferrer.infer({
    portalPath: "/portal",
    directoryTree: [],
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
  });
  assertEquals(result, "");
});

Deno.test("[ArchitectureInferrer] uses OutputValidator for response parsing", async () => {
  const validator = new MockOutputValidator(true);
  const inferrer = new ArchitectureInferrer(makeMockProvider(MOCK_OVERVIEW), validator);
  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: [],
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
  });
  assertEquals(validator.validateCallCount > 0, true);
});
Deno.test("[ArchitectureInferrer] truncates long files to ARCHITECTURE_INFERRER_MAX_FILE_TOKENS lines", async () => {
  let capturedPrompt = "";
  const provider: IModelProvider = {
    id: "mock",
    generate: (prompt: string): Promise<IGenerateResult> => {
      capturedPrompt = prompt;
      return Promise.resolve({
        content: MOCK_OVERVIEW,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  const inferrer = new ArchitectureInferrer(provider, new MockOutputValidator(true));

  // Build file content that is 2× the line limit
  const longContent = Array.from(
    { length: ARCHITECTURE_INFERRER_MAX_FILE_TOKENS * 2 },
    (_v, i) => `line_${i}`,
  ).join("\n");

  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: [],
    keyFiles: KEY_FILES,
    conventions: [],
    configSummary: "",
    dependencySummary: "",
    fileContents: { "src/main.ts": longContent },
  });

  // Prompt must NOT contain a line beyond the limit
  const limitLine = `line_${ARCHITECTURE_INFERRER_MAX_FILE_TOKENS}`;
  assertEquals(
    capturedPrompt.includes(limitLine),
    false,
    `Prompt should not include content beyond line ${ARCHITECTURE_INFERRER_MAX_FILE_TOKENS}`,
  );
  // But should include content up to the limit
  assertStringIncludes(capturedPrompt, "line_0");
});

Deno.test("[ArchitectureInferrer] stays within ARCHITECTURE_INFERRER_TOKEN_BUDGET on large input sets", async () => {
  let capturedPrompt = "";
  const provider: IModelProvider = {
    id: "mock",
    generate: (prompt: string): Promise<IGenerateResult> => {
      capturedPrompt = prompt;
      return Promise.resolve({
        content: MOCK_OVERVIEW,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
  const inferrer = new ArchitectureInferrer(provider, new MockOutputValidator(true));

  // Many files whose combined content far exceeds the budget
  const manyFiles: Record<string, string> = {};
  for (let i = 0; i < 50; i++) {
    manyFiles[`src/service_${i}.ts`] = Array.from(
      { length: 100 },
      (_v, j) => `// line ${j} of service_${i}`,
    ).join("\n");
  }

  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: Object.keys(manyFiles),
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
    fileContents: manyFiles,
  });

  assertExists(capturedPrompt);
  // Rough token estimate: 1 token ≈ 4 chars
  const estimatedTokens = capturedPrompt.length / 4;
  assertEquals(
    estimatedTokens <= ARCHITECTURE_INFERRER_TOKEN_BUDGET * 1.2,
    true,
    `Prompt tokens (${
      Math.round(estimatedTokens)
    }) should not greatly exceed budget (${ARCHITECTURE_INFERRER_TOKEN_BUDGET})`,
  );
});
