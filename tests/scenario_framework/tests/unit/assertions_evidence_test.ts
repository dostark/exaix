/**
 * @module ScenarioFrameworkAssertionsEvidenceTest
 * @path tests/scenario_framework/tests/unit/assertions_evidence_test.ts
 * @description RED-first tests for Step 5. Verifies criterion
 * evaluation, step outcome classification, and deterministic evidence/manifest
 * writing before the assertion and evidence modules exist.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/runner/evidence_collector.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assert, assertEquals, assertStringIncludes, fail } from "@std/assert";
import { join } from "@std/path";
import { callLlmEndpoint, evaluateCriterion, evaluateStepOutcome } from "../../runner/assertions.ts";
import { copyEvidenceArtifact, writeRunManifest } from "../../runner/evidence_collector.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import { BINARY_VERSION, WORKSPACE_SCHEMA_VERSION } from "@exaix/core";
import { withEnv } from "@exaix/testing";

async function withTempWorkspace(
  fn: (workspaceRoot: string) => Promise<void>,
  prefix = "scenario-framework-",
): Promise<void> {
  const workspaceRoot = await Deno.makeTempDir({ prefix });
  try {
    await fn(workspaceRoot);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
}

Deno.test("[ScenarioFrameworkAssertionsEvidence] criterion evaluator distinguishes input validation, execution failure, and output validation failure", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-framework-assertions-" });

  try {
    const missingInput = await evaluateStepOutcome({
      workspaceRoot,
      step: {
        id: "input-step",
        type: ScenarioStepType.SHELL,
        command: "echo",
        input_criteria: [
          {
            id: "input-file",
            kind: CriterionKind.FILE_EXISTS,
            path: "missing.txt",
          },
        ],
        output_criteria: [],
        continue_on_failure: false,
      },
    });

    assertEquals(missingInput.failureStage, CriterionPhase.INPUT);
    assertEquals(missingInput.criterionResults[0].status, CriterionStatus.FAILED);

    const executionFailure = await evaluateStepOutcome({
      workspaceRoot,
      step: {
        id: "execution-step",
        type: ScenarioStepType.SHELL,
        command: "echo",
        input_criteria: [],
        output_criteria: [],
        continue_on_failure: false,
      },
      executionResult: {
        stepId: "execution-step",
        stepType: ScenarioStepType.SHELL,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1,
        exitCode: 1,
        stdout: "",
        stderr: "command failed",
        combinedOutput: "command failed",
      },
    });

    assertEquals(executionFailure.failureStage, "execution");

    const outputJsonPath = join(workspaceRoot, "result.json");
    await Deno.writeTextFile(outputJsonPath, JSON.stringify({ status: "ok" }));

    const outputFailure = await evaluateStepOutcome({
      workspaceRoot,
      step: {
        id: "output-step",
        type: ScenarioStepType.SHELL,
        command: "echo",
        input_criteria: [],
        output_criteria: [
          {
            id: "json-goal",
            kind: CriterionKind.JSON_PATH_EXISTS,
            path: "$.goal",
            target_file: "result.json",
          },
        ],
        continue_on_failure: false,
      },
      executionResult: {
        stepId: "output-step",
        stepType: ScenarioStepType.SHELL,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        combinedOutput: "ok",
      },
    });

    assertEquals(outputFailure.failureStage, CriterionPhase.OUTPUT);
    assertEquals(outputFailure.criterionResults[0].status, CriterionStatus.FAILED);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] JSON, file, frontmatter, and journal assertions report stable failure payloads", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-framework-assertions-" });

  try {
    await Deno.writeTextFile(join(workspaceRoot, "payload.json"), JSON.stringify({ value: 1 }));
    await Deno.writeTextFile(join(workspaceRoot, "request.md"), "---\nstatus: draft\n---\n\nBody\n");
    await Deno.writeTextFile(join(workspaceRoot, "journal.ndjson"), '{"event_type":"request.created"}\n');

    const jsonResult = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "json-value",
        kind: CriterionKind.JSON_PATH_EQUALS,
        path: "$.value",
        equals: 2,
        target_file: "payload.json",
      },
    });
    const fileResult = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.INPUT,
      criterion: {
        id: "missing-file",
        kind: CriterionKind.FILE_EXISTS,
        path: "missing.txt",
      },
    });
    const frontmatterResult = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "frontmatter-status",
        kind: CriterionKind.FRONTMATTER_FIELD_EQUALS,
        field: "status",
        equals: "published",
        target_file: "request.md",
      },
    });
    const journalResult = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "journal-event",
        kind: CriterionKind.JOURNAL_EVENT_EXISTS,
        event_type: "request.completed",
        journal_file: "journal.ndjson",
      },
    });

    assertEquals(jsonResult.status, CriterionStatus.FAILED);
    assertEquals(jsonResult.expected_value, 2);
    assertEquals(jsonResult.observed_value, 1);

    assertEquals(fileResult.status, CriterionStatus.FAILED);
    assertStringIncludes(fileResult.message, "missing.txt");

    assertEquals(frontmatterResult.status, CriterionStatus.FAILED);
    assertEquals(frontmatterResult.observed_value, "draft");

    assertEquals(journalResult.status, CriterionStatus.FAILED);
    assertStringIncludes(journalResult.message, "request.completed");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] text-matches criterion validates multiple regex patterns in any order", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-framework-text-matches-" });

  try {
    const readmePath = join(workspaceRoot, "README.md");
    await Deno.writeTextFile(
      readmePath,
      "Project Title\n\nFeatures:\n- [x] Task 1\n- [ ] Task 2\n\nTech Stack: Deno 1.40",
    );

    const successResult = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "readme-check-success",
        kind: CriterionKind.TEXT_MATCHES,
        path: "README.md",
        matches: [
          "Project Title",
          "\\[x\\] Task 1",
          "Tech Stack: Deno \\d+\\.\\d+",
        ],
      },
    });

    const outOfOrderResult = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "readme-check-order",
        kind: CriterionKind.TEXT_MATCHES,
        path: "README.md",
        matches: [
          "Tech Stack",
          "Project Title",
        ],
      },
    });

    const failureResult = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "readme-check-fail",
        kind: CriterionKind.TEXT_MATCHES,
        path: "README.md",
        matches: [
          "Project Title",
          "Missing Section",
        ],
      },
    });

    const caseInsensitiveResult = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "readme-check-case",
        kind: CriterionKind.TEXT_MATCHES,
        path: "README.md",
        matches: ["project title"],
        flags: "i",
      },
    });

    assertEquals(successResult.status, CriterionStatus.PASSED);
    assertEquals(outOfOrderResult.status, CriterionStatus.PASSED);
    assertEquals(failureResult.status, CriterionStatus.FAILED);
    assertEquals(caseInsensitiveResult.status, CriterionStatus.PASSED);
    assertStringIncludes(failureResult.message, "Missing: Missing Section");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] evidence collector writes the expected manifest shape for success and failure cases", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-evidence-" });

  try {
    const manifestPath = await writeRunManifest({
      outputDir,
      manifest: {
        scenarioId: "step5-manifest",
        pack: "smoke",
        mode: "auto",
        outcome: "scenario-failure",
        steps: [
          {
            stepId: "step-1",
            stepType: ScenarioStepType.SHELL,
            executionStatus: "failed",
            criterionResults: [
              {
                criterion_id: "missing-file",
                kind: CriterionKind.FILE_EXISTS,
                phase: CriterionPhase.INPUT,
                status: CriterionStatus.FAILED,
                message: "missing file",
                evidence_refs: ["artifacts/log.txt"],
              },
            ],
          },
        ],
      },
    });

    const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as {
      scenarioId: string;
      outcome: string;
      steps: Array<
        { stepId: string; criterionResults: Array<{ criterion_id: string; status: string; evidence_refs: string[] }> }
      >;
    };

    assertEquals(manifest.scenarioId, "step5-manifest");
    assertEquals(manifest.outcome, "scenario-failure");
    assertEquals(manifest.steps[0].criterionResults[0].criterion_id, "missing-file");
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] failure manifests include step id, criterion id, status, and evidence references", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "scenario-framework-evidence-" });
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-framework-workspace-" });

  try {
    const sourceArtifact = join(workspaceRoot, "analysis.json");
    await Deno.writeTextFile(sourceArtifact, JSON.stringify({ status: "draft" }));

    const evidenceRef = await copyEvidenceArtifact({
      outputDir,
      sourcePath: sourceArtifact,
      relativeDestinationPath: "artifacts/analysis.json",
    });

    const manifestPath = await writeRunManifest({
      outputDir,
      manifest: {
        scenarioId: "step5-failure-manifest",
        pack: "smoke",
        mode: "auto",
        outcome: "scenario-failure",
        steps: [
          {
            stepId: "assert-analysis",
            stepType: ScenarioStepType.JSON_ASSERT,
            executionStatus: "failed",
            criterionResults: [
              {
                criterion_id: "goal-missing",
                kind: CriterionKind.JSON_PATH_EXISTS,
                phase: CriterionPhase.OUTPUT,
                status: CriterionStatus.FAILED,
                message: "goal missing",
                evidence_refs: [evidenceRef],
              },
            ],
          },
        ],
      },
    });

    const manifestText = await Deno.readTextFile(manifestPath);
    assertStringIncludes(manifestText, '"stepId": "assert-analysis"');
    assertStringIncludes(manifestText, '"criterion_id": "goal-missing"');
    assertStringIncludes(manifestText, '"status": "failed"');
    assertStringIncludes(manifestText, evidenceRef);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

// -----------------------------------------------------------------------------
// Version Assertion Criteria Tests (Phase 51 Secondary Goal)
// -----------------------------------------------------------------------------

Deno.test("[ScenarioFrameworkAssertionsEvidence] version-equals criterion passes when versions match", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "binary-version-check",
        kind: CriterionKind.VERSION_EQUALS,
        version: BINARY_VERSION,
        source: "binary",
      },
    });

    assertEquals(result.status, CriterionStatus.PASSED);
    assertEquals(result.observed_value, BINARY_VERSION);
    assertEquals(result.expected_value, BINARY_VERSION);
    assertStringIncludes(result.message, "Version matches");
  }, "scenario-framework-version-");
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] version-equals criterion fails when versions differ", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "binary-version-check",
        kind: CriterionKind.VERSION_EQUALS,
        version: "9.9.9",
        source: "binary",
      },
    });

    assertEquals(result.status, CriterionStatus.FAILED);
    assertEquals(result.observed_value, BINARY_VERSION);
    assertEquals(result.expected_value, "9.9.9");
    assertStringIncludes(result.message, `Expected version 9.9.9, got ${BINARY_VERSION}`);
  }, "scenario-framework-version-");
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] version-gte criterion passes when version is greater", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "binary-version-min",
        kind: CriterionKind.VERSION_GTE,
        version: "0.9.0",
        source: "binary",
      },
    });

    assertEquals(result.status, CriterionStatus.PASSED);
    assertStringIncludes(result.message, ">=");
  }, "scenario-framework-version-");
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] version-gte criterion fails when version is lower", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "binary-version-min",
        kind: CriterionKind.VERSION_GTE,
        version: "9.0.0",
        source: "binary",
      },
    });

    assertEquals(result.status, CriterionStatus.FAILED);
    assertStringIncludes(result.message, "is less than required");
  }, "scenario-framework-version-");
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] version-lte criterion passes when version is lower", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "binary-version-max",
        kind: CriterionKind.VERSION_LTE,
        version: "9.0.0",
        source: "binary",
      },
    });

    assertEquals(result.status, CriterionStatus.PASSED);
    assertStringIncludes(result.message, "<=");
  }, "scenario-framework-version-");
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] version-lte criterion fails when version is greater", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "binary-version-max",
        kind: CriterionKind.VERSION_LTE,
        version: "0.9.0",
        source: "binary",
      },
    });

    assertEquals(result.status, CriterionStatus.FAILED);
    assertStringIncludes(result.message, "is greater than maximum");
  }, "scenario-framework-version-");
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] version criteria can check workspace schema version", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "workspace-version-check",
        kind: CriterionKind.VERSION_EQUALS,
        version: WORKSPACE_SCHEMA_VERSION,
        source: "workspace",
      },
    });

    assertEquals(result.status, CriterionStatus.PASSED);
    assertEquals(result.observed_value, WORKSPACE_SCHEMA_VERSION);
  }, "scenario-framework-version-");
});

// ---------------------------------------------------------------------------
// LLM Endpoint Dispatch Tests — via ProviderFactory
// ---------------------------------------------------------------------------

const DISABLED_OPTS = { sanitizeResources: false, sanitizeOps: false };

// Helper: delete all backward-compat API keys so only EXA_LLM_PROVIDER controls routing
const NO_BACKWARD_KEYS: Record<string, null> = {
  ANTHROPIC_API_KEY: null,
  OPENAI_API_KEY: null,
  GOOGLE_API_KEY: null,
  OPENROUTER_API_KEY: null,
};

Deno.test({
  name: "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint uses Mock provider when EXA_LLM_PROVIDER is unset",
  ...DISABLED_OPTS,
  fn: async () => {
    // Must also delete ANTHROPIC_API_KEY to prevent backward compat routing to Anthropic
    await withEnv({ EXA_LLM_PROVIDER: null, ...NO_BACKWARD_KEYS }, async () => {
      const result = await callLlmEndpoint("test prompt");
      assertEquals(typeof result, "string");
    });
  },
});

Deno.test({
  name: "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint uses Ollama when EXA_LLM_PROVIDER=ollama",
  ...DISABLED_OPTS,
  ignore: Deno.env.get("CI") === "true" && Deno.env.get("EXAIX_EDITION") !== "team",
  fn: async () => {
    // Ollama has no API key requirement — connect to an unused port to force a connection error
    await withEnv({
      EXA_LLM_PROVIDER: "ollama",
      EXA_LLM_BASE_URL: "http://127.0.0.1:11999",
      ...NO_BACKWARD_KEYS,
    }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected connection error");
      } catch (err) {
        const msg = (err as Error).message;
        // Accept either the Ollama URL path or a connection error
        assertStringIncludes(msg, "11999");
      }
    });
  },
});

Deno.test({
  name: "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint dispatches to Anthropic when EXA_LLM_PROVIDER=anthropic",
  ...DISABLED_OPTS,
  fn: async () => {
    // Delete ANTHROPIC_API_KEY so getApiKey() throws
    await withEnv({ EXA_LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: null }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected missing API key error");
      } catch (err) {
        assertStringIncludes((err as Error).message, "ANTHROPIC_API_KEY");
      }
    });
  },
});

Deno.test({
  name: "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint dispatches to OpenAI when EXA_LLM_PROVIDER=openai",
  ...DISABLED_OPTS,
  fn: async () => {
    await withEnv({ EXA_LLM_PROVIDER: "openai", OPENAI_API_KEY: null }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected missing API key error");
      } catch (err) {
        assertStringIncludes((err as Error).message, "OPENAI_API_KEY");
      }
    });
  },
});

Deno.test({
  name: "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint dispatches to Google when EXA_LLM_PROVIDER=google",
  ...DISABLED_OPTS,
  fn: async () => {
    await withEnv({ EXA_LLM_PROVIDER: "google", GOOGLE_API_KEY: null }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected missing API key error");
      } catch (err) {
        assertStringIncludes((err as Error).message, "GOOGLE_API_KEY");
      }
    });
  },
});

Deno.test({
  name: "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint resolves with EXA_EVAL_MODEL_SIZE and explicit provider",
  ...DISABLED_OPTS,
  fn: async () => {
    await withEnv({
      EXA_EVAL_MODEL_SIZE: "S",
      EXA_LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: null,
      ...NO_BACKWARD_KEYS,
    }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected API key error from Anthropic resolution");
      } catch (err) {
        assertStringIncludes((err as Error).message, "ANTHROPIC_API_KEY");
      }
    });
  },
});

Deno.test({
  name:
    "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint throws when EXA_EVAL_MODEL_SIZE=S without provider (no provider meets size constraints)",
  ...DISABLED_OPTS,
  fn: async () => {
    await withEnv({ EXA_EVAL_MODEL_SIZE: "S", ...NO_BACKWARD_KEYS }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected resolution error — no provider satisfies S context-window constraint");
      } catch (err) {
        assert((err as Error).message.includes("Model resolution failed"));
      }
    });
  },
});

Deno.test({
  name:
    "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint throws for invalid EXA_EVAL_MODEL_SIZE when EXA_LLM_PROVIDER is set",
  ...DISABLED_OPTS,
  fn: async () => {
    await withEnv({
      EXA_EVAL_MODEL_SIZE: "INVALID",
      EXA_LLM_PROVIDER: "invalid-provider",
      ...NO_BACKWARD_KEYS,
    }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected resolution error for invalid provider+size combo");
      } catch (err) {
        assert((err as Error).message.includes("Model resolution failed"));
      }
    });
  },
});

Deno.test({
  name:
    "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint explicit EXA_LLM_PROVIDER takes priority over EXA_EVAL_MODEL_SIZE",
  ...DISABLED_OPTS,
  fn: async () => {
    await withEnv({
      EXA_EVAL_MODEL_SIZE: "S",
      EXA_LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: null,
      ...NO_BACKWARD_KEYS,
    }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected missing API key error");
      } catch (err) {
        assertStringIncludes((err as Error).message, "ANTHROPIC_API_KEY");
      }
    });
  },
});

Deno.test({
  name:
    "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint dispatches to OpenRouter when EXA_LLM_PROVIDER=openrouter",
  ...DISABLED_OPTS,
  ignore: Deno.env.get("EXAIX_EDITION") !== "team",
  fn: async () => {
    // OpenRouter is only registered in Team/Enterprise editions.
    // In Solo mode the provider falls back to Mock, so this test must skip.
    await withEnv({ EXA_LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: null }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected missing API key error");
      } catch (err) {
        assertStringIncludes((err as Error).message, "OPENROUTER_API_KEY");
      }
    });
  },
});

Deno.test({
  name:
    "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint uses Mock provider when EXA_LLM_PROVIDER is unset (ANTHROPIC_API_KEY alone insufficient)",
  ...DISABLED_OPTS,
  fn: async () => {
    // ANTHROPIC_API_KEY without EXA_LLM_PROVIDER — empty intent resolves to Mock via routing strategy
    await withEnv({
      EXA_LLM_PROVIDER: null,
      ANTHROPIC_API_KEY: "sk-test-key",
      ...NO_BACKWARD_KEYS,
    }, async () => {
      const result = await callLlmEndpoint("test prompt");
      assertEquals(typeof result, "string");
    });
  },
});

Deno.test({
  name: "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint throws for invalid EXA_LLM_PROVIDER",
  ...DISABLED_OPTS,
  fn: async () => {
    await withEnv({ EXA_LLM_PROVIDER: "invalid-provider", ...NO_BACKWARD_KEYS }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected ModelResolver to throw for unknown provider");
      } catch (err) {
        assert((err as Error).message.includes("Model resolution failed"));
      }
    });
  },
});

Deno.test({
  name:
    "[ScenarioFrameworkAssertionsEvidence] callLlmEndpoint uses CLI delegate provider when EXA_LLM_PROVIDER=claude-cli",
  ...DISABLED_OPTS,
  fn: async () => {
    await withEnv({ EXA_LLM_PROVIDER: "claude-cli", ...NO_BACKWARD_KEYS }, async () => {
      try {
        await callLlmEndpoint("test prompt");
        fail("Expected CLI delegate error");
      } catch (err) {
        const msg = (err as Error).message;
        assert(!msg.includes("EXA_LLM_PROVIDER"), "should resolve provider, not complain about missing");
        assert(
          msg.includes("exited with code") || msg.includes("not found") || msg.includes("Permission denied"),
          `expected CLI delegate error, got: ${msg}`,
        );
      }
    });
  },
});

// `expect_failure` was honoured in modes.ts (do not halt the scenario on a non-zero exit)
// but NOT in evaluateStepOutcome, which short-circuited to EXECUTION failure on any
// non-zero exit and skipped output criteria entirely. A scenario deliberately eliciting a
// failure therefore "passed" without any of its assertions ever running — a false green.
Deno.test("[ScenarioFrameworkAssertionsEvidence] expect_failure evaluates output criteria on a non-zero exit", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-framework-expect-failure-" });
  try {
    const outcome = await evaluateStepOutcome({
      workspaceRoot,
      step: {
        id: "negative-step",
        type: ScenarioStepType.SHELL,
        command: "sh",
        expect_failure: true,
        input_criteria: [],
        output_criteria: [
          {
            id: "error-text-present",
            kind: CriterionKind.COMMAND_OUTPUT_CONTAINS,
            contains: ["Tool 'nonexistent_tool' not found"],
          },
        ],
      } as never,
      executionResult: {
        stepId: "negative-step",
        stepType: ScenarioStepType.SHELL,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1,
        exitCode: 1,
        stdout: "Tool 'nonexistent_tool' not found",
        stderr: "",
        combinedOutput: "Tool 'nonexistent_tool' not found",
      } as never,
    });

    assertEquals(outcome.status, CriterionStatus.PASSED);
    assertEquals(outcome.criterionResults.length, 1);
    assertEquals(outcome.criterionResults[0].criterion_id, "error-text-present");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkAssertionsEvidence] expect_failure fails the step when the command unexpectedly succeeds", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-framework-expect-failure-" });
  try {
    const outcome = await evaluateStepOutcome({
      workspaceRoot,
      step: {
        id: "negative-step",
        type: ScenarioStepType.SHELL,
        command: "sh",
        expect_failure: true,
        input_criteria: [],
        output_criteria: [],
      } as never,
      executionResult: {
        stepId: "negative-step",
        stepType: ScenarioStepType.SHELL,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1,
        exitCode: 0,
        stdout: "",
        stderr: "",
        combinedOutput: "",
      } as never,
    });

    assertEquals(outcome.status, CriterionStatus.FAILED);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
