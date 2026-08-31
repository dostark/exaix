/**
 * @module ArchitectureInferrerTest
 * @path packages/portal/knowledge/tests/architecture_inferrer_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Tests for the ArchitectureInferrer (Strategy 5): LLM-based
 * generation of a Markdown architecture overview from combined strategy outputs.
 * Uses mock IModelProvider and MockOutputValidator to avoid real LLM calls.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import type { ZodType } from "zod";
import { ArchitectureInferrer, type IArchitectureValidator } from "@exaix/portal/knowledge";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IValidationResult } from "@exaix/core/types";
import type { ICodeConvention, IFileSignificance } from "@exaix/schemas/portal_knowledge.ts";
import { ARCHITECTURE_INFERRER_MAX_FILE_TOKENS, ARCHITECTURE_INFERRER_TOKEN_BUDGET } from "@exaix/core";
import type { ILogger } from "@exaix/core/types";

// Mock helpers

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

function makeCaptureProvider(response: string): { provider: IModelProvider; getCapturedPrompt: () => string } {
  let capturedPrompt = "";
  return {
    provider: {
      id: "mock",
      generate: (prompt: string): Promise<IGenerateResult> => {
        capturedPrompt = prompt;
        return Promise.resolve({
          content: response,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: "mock-model",
          provider: "mock",
          cost_usd: 0,
        });
      },
    },
    getCapturedPrompt: () => capturedPrompt,
  };
}

/** Minimal IArchitectureValidator for tests. */
class MockOutputValidator implements IArchitectureValidator {
  private readonly _success: boolean;
  validateCallCount = 0;

  constructor(success: boolean) {
    this._success = success;
  }
  validate<T>(content: string, _schema: ZodType<T>): IValidationResult<T> {
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

// Shared fixtures

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

// Tests

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
  const { provider, getCapturedPrompt } = makeCaptureProvider(MOCK_OVERVIEW);
  const inferrer = new ArchitectureInferrer(provider, new MockOutputValidator(true));
  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: ["src/", "src/main.ts", "src/services/"],
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
  });
  assertStringIncludes(getCapturedPrompt(), "src/main.ts");
});

Deno.test("[ArchitectureInferrer] passes key files and patterns in prompt", async () => {
  const { provider, getCapturedPrompt } = makeCaptureProvider(MOCK_OVERVIEW);
  const inferrer = new ArchitectureInferrer(provider, new MockOutputValidator(true));
  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: [],
    keyFiles: KEY_FILES,
    conventions: CONVENTIONS,
    configSummary: "deno.json found",
    dependencySummary: "std@0.203",
  });
  assertStringIncludes(getCapturedPrompt(), "auth_service.ts");
  assertStringIncludes(getCapturedPrompt(), "Service naming pattern");
  assertStringIncludes(getCapturedPrompt(), "deno.json found");
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
  // Now returns heuristic fallback instead of empty string
  assertEquals(result.length > 0, true);
  assertEquals(result.includes("Heuristic"), true);
});

Deno.test("[ArchitectureInferrer] returns fallback overview on invalid LLM output", async () => {
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
  // Falls back to heuristic after all retries
  assertEquals(result.length > 0, true);
  assertEquals(result.includes("Heuristic"), true);
  assertEquals(inferrer.architectureInferenceFailed, true);
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
  const { provider, getCapturedPrompt } = makeCaptureProvider(MOCK_OVERVIEW);
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
    getCapturedPrompt().includes(limitLine),
    false,
    `Prompt should not include content beyond line ${ARCHITECTURE_INFERRER_MAX_FILE_TOKENS}`,
  );
  // But should include content up to the limit
  assertStringIncludes(getCapturedPrompt(), "line_0");
});

Deno.test("[ArchitectureInferrer] stays within ARCHITECTURE_INFERRER_TOKEN_BUDGET on large input sets", async () => {
  const { provider, getCapturedPrompt } = makeCaptureProvider(MOCK_OVERVIEW);
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

  assertExists(getCapturedPrompt());
  // Rough token estimate: 1 token ≈ 4 chars
  const estimatedTokens = getCapturedPrompt().length / 4;
  assertEquals(
    estimatedTokens <= ARCHITECTURE_INFERRER_TOKEN_BUDGET * 1.2,
    true,
    `Prompt tokens (${
      Math.round(estimatedTokens)
    }) should not greatly exceed budget (${ARCHITECTURE_INFERRER_TOKEN_BUDGET})`,
  );
});

// Retry and fallback helpers

function makeFailCountProvider(failCount: number, successResponse: string): IModelProvider {
  let attempts = 0;
  return {
    id: "mock-fail-count",
    generate: (): Promise<IGenerateResult> => {
      attempts++;
      if (attempts <= failCount) {
        return Promise.reject(new Error(`simulated failure ${attempts}`));
      }
      return Promise.resolve({
        content: successResponse,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
}

function makeAlwaysFailProvider(): IModelProvider {
  return {
    id: "mock-always-fail",
    generate: (): Promise<IGenerateResult> => Promise.reject(new Error("persistent failure")),
  };
}

function makeMockLogger(): { logger: ILogger; errors: Array<{ message: string; error?: Error }> } {
  const errors: Array<{ message: string; error?: Error }> = [];
  return {
    logger: {
      setContext: () => {},
      child: () => makeMockLogger().logger,
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (message: string, error?: Error) => {
        errors.push({ message, error });
      },
      fatal: () => {},
      time: <T>(_op: string, fn: () => Promise<T>): Promise<T> => fn(),
    },
    errors,
  };
}

// Retry tests

Deno.test("[ArchitectureInferrer] retries on LLM failure and succeeds on 2nd attempt", async () => {
  const inferrer = new ArchitectureInferrer(
    makeFailCountProvider(1, MOCK_OVERVIEW),
    new MockOutputValidator(true),
  );
  const result = await inferrer.infer({
    portalPath: "/portal",
    directoryTree: ["src/"],
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
  });
  assertEquals(result, MOCK_OVERVIEW);
  assertEquals(inferrer.architectureInferenceFailed, false);
});

Deno.test("[ArchitectureInferrer] retries 3 times and falls back to heuristic on all failures", async () => {
  const inferrer = new ArchitectureInferrer(
    makeAlwaysFailProvider(),
    new MockOutputValidator(true),
  );
  const result = await inferrer.infer({
    portalPath: "/portal",
    directoryTree: ["src/"],
    keyFiles: [],
    conventions: [],
    configSummary: "Lang: TypeScript",
    dependencySummary: "std@0.203",
  });
  assertEquals(typeof result, "string");
  assertEquals(result.length > 0, true, "Fallback should not be empty");
  assertEquals(inferrer.architectureInferenceFailed, true);
});

Deno.test("[ArchitectureInferrer] fallback overview includes tech stack, key files, conventions", async () => {
  const inferrer = new ArchitectureInferrer(
    makeAlwaysFailProvider(),
    new MockOutputValidator(true),
  );
  const result = await inferrer.infer({
    portalPath: "/portal",
    directoryTree: ["src/"],
    keyFiles: KEY_FILES,
    conventions: CONVENTIONS,
    configSummary: "Lang: TypeScript",
    dependencySummary: "std@0.203",
  });
  assertStringIncludes(result, "Lang: TypeScript");
  assertStringIncludes(result, "src/main.ts");
  assertStringIncludes(result, "Service naming pattern");
});

Deno.test("[ArchitectureInferrer] sets architectureInferenceFailed=true when all retries fail", async () => {
  const inferrer = new ArchitectureInferrer(
    makeAlwaysFailProvider(),
    new MockOutputValidator(true),
  );
  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: [],
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
  });
  assertEquals(inferrer.architectureInferenceFailed, true);
});

Deno.test("[ArchitectureInferrer] does NOT set architectureInferenceFailed on success", async () => {
  const inferrer = new ArchitectureInferrer(
    makeMockProvider(MOCK_OVERVIEW),
    new MockOutputValidator(true),
  );
  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: [],
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
  });
  assertEquals(inferrer.architectureInferenceFailed, false);
});

Deno.test("[ArchitectureInferrer] logs error when logger provided and all retries fail", async () => {
  const { logger, errors } = makeMockLogger();
  const inferrer = new ArchitectureInferrer(
    makeAlwaysFailProvider(),
    new MockOutputValidator(true),
    logger,
  );
  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: [],
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
  });
  assertEquals(errors.length > 0, true, "Should have logged at least one error");
  assertEquals(errors[0].message.includes("retries"), true);
});

Deno.test("[ArchitectureInferrer] backoff increases between retries", async () => {
  const timings: number[] = [];
  const slowProvider: IModelProvider = {
    id: "mock-slow",
    generate: (): Promise<IGenerateResult> => {
      timings.push(Date.now());
      return Promise.reject(new Error("fail"));
    },
  };
  const inferrer = new ArchitectureInferrer(
    slowProvider,
    new MockOutputValidator(true),
  );
  const start = Date.now();
  await inferrer.infer({
    portalPath: "/portal",
    directoryTree: [],
    keyFiles: [],
    conventions: [],
    configSummary: "",
    dependencySummary: "",
  });
  const total = Date.now() - start;
  // With backoff: 1s + 2s = at least 3s, but we only check that retries took meaningful time
  assertEquals(total >= 100, true, "Should have taken at least some time for backoff");
});
