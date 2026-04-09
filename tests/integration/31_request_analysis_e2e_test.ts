/**
 * @module RequestAnalysisE2ETest
 * @path tests/integration/31_request_analysis_e2e_test.ts
 * @description End-to-end integration tests verifying the full request →
 * analysis → _analysis.json → plan pipeline. Covers heuristic mode injection,
 * default analysis via MockLLMProvider, _analysis.json persistence and schema
 * round-trip, plan frontmatter annotations, and flow request analysis.
 * @related-files [src/services/request_processor.ts,
 *   src/services/request_analysis/request_analyzer.ts,
 *   src/services/request_analysis/analysis_persistence.ts,
 *   src/shared/schemas/request_analysis.ts]
 */

import { assert, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { RequestProcessor } from "../../src/services/request/request_processor.ts";
import { RequestAnalyzer } from "../../src/services/request_analysis/request_analyzer.ts";
import { loadAnalysis } from "../../src/services/request_analysis/mod.ts";
import type { IApplicationContext } from "../../src/shared/interfaces/i_application_context.ts";
import { RequestAnalysisSchema } from "../../src/shared/schemas/request_analysis.ts";
import { AnalysisMode } from "../../src/shared/types/request.ts";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { createStubConfig, createStubDisplay, createStubGit } from "../helpers/test_helpers.ts";

// ---------------------------------------------------------------------------
// Test 1: Heuristic-only analysis path
// ---------------------------------------------------------------------------

Deno.test(
  "Integration: request analysis – heuristic-only analyzer",
  async (t) => {
    const env = await TestEnvironment.create();

    try {
      await env.createBlueprint("senior-coder");

      // Build a processor that uses a heuristic-only analyzer (no LLM calls).
      // The mock provider is still provided so plan generation can succeed.
      const { provider } = env.createRequestProcessor();
      const heuristicAnalyzer = new RequestAnalyzer({
        mode: AnalysisMode.HEURISTIC,
      });
      const context: IApplicationContext = {
        config: createStubConfig(env.config),
        db: env.db,
        provider,
        git: createStubGit(),
        display: createStubDisplay(env.db),
      };

      const processor = new RequestProcessor({
        workspacePath: join(env.tempDir, "Workspace"),
        requestsDir: join(env.tempDir, "Workspace", "Requests"),
        blueprintsPath: join(env.tempDir, "Blueprints", "Identities"),
        includeReasoning: true,
        context,
        testProvider: provider,
        testAnalyzer: heuristicAnalyzer,
      });

      const { filePath } = await env.createRequest(
        "Implement user authentication with JWT tokens and refresh token support",
        { identityId: "senior-coder" },
      );

      // Analysis is written before plan generation, so it succeeds regardless
      // of whether the plan pipeline completes.
      await processor.process(filePath);

      await t.step(
        "[E2E] heuristic analysis produces _analysis.json",
        async () => {
          const analysisPath = filePath.replace(/\.md$/, "_analysis.json");
          const stat = await Deno.stat(analysisPath).catch(() => null);
          assertExists(
            stat,
            "_analysis.json should be created alongside request file",
          );
        },
      );

      await t.step(
        "[E2E] _analysis.json passes RequestAnalysisSchema round-trip",
        async () => {
          const loaded = await loadAnalysis(filePath);
          assertExists(loaded, "loadAnalysis should return a parsed IRequestAnalysis");
          const result = RequestAnalysisSchema.safeParse(loaded);
          assert(result.success, "Loaded analysis must satisfy RequestAnalysisSchema");
        },
      );

      await t.step(
        "[E2E] analysis metadata.mode is heuristic",
        async () => {
          const loaded = await loadAnalysis(filePath);
          assertExists(loaded);
          assert(
            loaded!.metadata.mode === AnalysisMode.HEURISTIC,
            `Expected mode=${AnalysisMode.HEURISTIC}, got ${loaded!.metadata.mode}`,
          );
        },
      );
    } finally {
      await env.cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 2: Default (hybrid) analysis path – plan frontmatter and flow request
// ---------------------------------------------------------------------------

Deno.test(
  "Integration: request analysis – plan annotation and flow request",
  async (t) => {
    const env = await TestEnvironment.create();

    try {
      await env.createBlueprint("senior-coder");
      const { processor } = env.createRequestProcessor();

      let planPath: string | null;

      await t.step(
        "[E2E] analysis runs for agent request and produces _analysis.json",
        async () => {
          const { filePath } = await env.createRequest(
            "Implement an OAuth2 login flow with Google and GitHub providers",
            { identityId: "senior-coder" },
          );
          planPath = await processor.process(filePath);

          const analysisPath = filePath.replace(/\.md$/, "_analysis.json");
          const stat = await Deno.stat(analysisPath).catch(() => null);
          assertExists(stat, "_analysis.json should be created for agent request");
        },
      );

      await t.step(
        "[E2E] generated plan frontmatter includes request_analysis",
        async () => {
          assertExists(planPath, "Plan file should have been generated");
          const planContent = await Deno.readTextFile(planPath!);
          assertStringIncludes(
            planContent,
            "request_analysis",
            "Plan frontmatter should include the request_analysis field",
          );
        },
      );

      await t.step(
        "[E2E] flow request analysis runs and produces _analysis.json",
        async () => {
          const { filePath: flowFilePath } = await env.createFlowRequest(
            "Review the recent code changes and flag potential regressions",
            "code_review",
          );

          // Analysis is written before the flow pipeline, so even if flow
          // processing does not complete successfully the file must exist.
          await processor.process(flowFilePath).catch(() => {
            // Flow execution may fail against mock provider – that is expected.
          });

          const analysisPath = flowFilePath.replace(/\.md$/, "_analysis.json");
          const stat = await Deno.stat(analysisPath).catch(() => null);
          assertExists(stat, "_analysis.json should be created for flow request");
        },
      );
    } finally {
      await env.cleanup();
    }
  },
);
