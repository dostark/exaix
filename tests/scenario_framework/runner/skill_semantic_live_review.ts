#!/usr/bin/env -S deno run -A
/**
 * @module SkillSemanticLiveReview
 * @path tests/scenario_framework/runner/skill_semantic_live_review.ts
 * @description Applies the calibrated Phase 234 judge to request-bound live artifacts.
 * @architectural-layer Test
 * @related-files [
 *   "tests/scenario_framework/runner/skill_semantic_calibration.ts",
 *   "tests/scenario_framework/fixtures/skill_eval/phase234/calibration/calibration_result.json"
 * ]
 */
import { CliDelegateModelProvider } from "@exaix/ai-clidelegate";
import { REPO_ROOT } from "@exaix/testing";
import { readRequirementsArtifact } from "./requirements_artifact.ts";
import {
  buildPrompt,
  parseVerdict,
  readAnswer,
  readApprovedCase,
  readRequest,
  rubricRows,
} from "./skill_semantic_calibration.ts";

export interface ILiveReviewCase {
  caseId: string;
  sandboxId: string;
  requestId: string;
  priorRequestId?: string;
}

interface ILiveReviewResult {
  caseId: string;
  sandboxId: string;
  requestId: string;
  priorRequestId: string | null;
  artifactSha256: string;
  evaluator: string;
  tool: string;
  model: string;
  verdict: "pass" | "fail" | "error";
  rationale: string;
  reviewedAt: string;
  reviewStatus: string;
}

const RUBRIC_MAP = `${REPO_ROOT}/exaix-dev-docs/planning/phase-234-case-rubric-mapping.md`;
const DEFAULT_TOOL = "opencode";
const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";

function sha256(text: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

export async function reviewLiveCases(
  cases: ILiveReviewCase[],
  outputPath: string,
  tool = DEFAULT_TOOL,
  model = DEFAULT_MODEL,
): Promise<ILiveReviewResult[]> {
  const rubric = rubricRows(await Deno.readTextFile(RUBRIC_MAP));
  const provider = new CliDelegateModelProvider({
    tool: tool as "claude-code" | "codex" | "opencode",
    bin: tool === "codex" ? "codex" : tool === "opencode" ? "opencode" : "claude",
    model,
    cwd: REPO_ROOT,
  });
  const results: ILiveReviewResult[] = [];
  for (const item of cases) {
    const row = rubric.get(item.caseId);
    if (!row) throw new Error(`No rubric row for ${item.caseId}`);
    const root = `/home/dkasymov/git/exaix-sandboxes/${item.sandboxId}`;
    const artifact = await readRequirementsArtifact(root, item.requestId);
    const prior = item.priorRequestId ? await readRequirementsArtifact(root, item.priorRequestId) : undefined;
    const turn = item.priorRequestId ? "answered" : "initial";
    const prompt = buildPrompt(
      { caseId: item.caseId, turn, artifact },
      row,
      await readRequest(item.caseId),
      await readAnswer(item.caseId, turn),
      await readApprovedCase(item.caseId),
      prior,
    );
    const response = await provider.generate(prompt);
    const verdict = parseVerdict(response.content);
    const result: ILiveReviewResult = {
      caseId: item.caseId,
      sandboxId: item.sandboxId,
      requestId: item.requestId,
      priorRequestId: item.priorRequestId ?? null,
      artifactSha256: await sha256(artifact),
      evaluator: "phase234-semantic-calibration-v1",
      tool,
      model,
      verdict: verdict.predicted,
      rationale: verdict.rationale,
      reviewedAt: "2026-11-10",
      reviewStatus: "calibrated-user-delegated",
    };
    results.push(result);
    await Deno.writeTextFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`${item.caseId}: ${verdict.predicted}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return results;
}

async function main(): Promise<void> {
  const batchArg = Deno.args.indexOf("--batch");
  const outArg = Deno.args.indexOf("--out");
  const toolArg = Deno.args.indexOf("--tool");
  const modelArg = Deno.args.indexOf("--model");
  if (batchArg < 0 || outArg < 0) {
    throw new Error("Usage: skill_semantic_live_review.ts --batch <json> --out <json> [--tool <name>] [--model <id>]");
  }
  const batch = JSON.parse(await Deno.readTextFile(Deno.args[batchArg + 1])) as ILiveReviewCase[];
  const results = await reviewLiveCases(
    batch,
    Deno.args[outArg + 1],
    toolArg >= 0 ? Deno.args[toolArg + 1] : DEFAULT_TOOL,
    modelArg >= 0 ? Deno.args[modelArg + 1] : DEFAULT_MODEL,
  );
  console.log(`Reviewed ${results.length} live artifacts`);
}

if (import.meta.main) await main();
