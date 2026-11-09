/**
 * @module SkillOracleHelpers
 * @path tests/scenario_framework/runner/skill_oracle_helpers.ts
 * @description Shares text checks and the existing legacy oracle CLI behavior.
 * @architectural-layer Test
 * @dependencies [@exaix/portal, @exaix/testing]
 * @related-files [tests/scenario_framework/runner/runtime_verification_oracle.ts]
 */
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import { readRequirementsArtifact } from "./requirements_artifact.ts";

interface ITextOracleResult {
  ok: boolean;
  reasons: string[];
}

type TextOracle = (caseId: string, text: string) => ITextOracleResult;

export function normalizeOracleText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function requireAll(plan: string, checks: Array<[RegExp, string]>): ITextOracleResult {
  const reasons = checks.filter(([pattern]) => !pattern.test(plan)).map(([, reason]) => `missing: ${reason}`);
  return { ok: reasons.length === 0, reasons };
}

async function newestPlan(root: string): Promise<string> {
  const resolver = new PathResolver(createMockConfig(root));
  const directory = await resolver.resolve("@Workspace/Plans");
  let newest: { path: string; mtime: number } | null = null;
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile || !entry.name.endsWith("_plan.md")) continue;
    const path = await resolver.resolve(`@Workspace/Plans/${entry.name}`);
    const mtime = (await Deno.stat(path)).mtime?.getTime() ?? 0;
    if (!newest || mtime > newest.mtime) newest = { path, mtime };
  }
  if (!newest) throw new Error(`No plan file found under ${directory}`);
  return newest.path;
}

/** Retains the legacy CLI contract while newer cases use explicit request binding. */
export async function runTextOracle(evaluate: TextOracle, scriptName: string): Promise<void> {
  const [caseId, workspaceRoot, requestId, mode] = Deno.args;
  if (!caseId || !workspaceRoot) {
    console.error(`Usage: ${scriptName} <case-id> <workspace-root>`);
    Deno.exit(2);
  }
  try {
    if (mode === "diagnostic" && !requestId) throw new Error("Diagnostic requires a request identity");
    const planPath = requestId ? `Workspace/Plans/${requestId}_plan.md` : await newestPlan(workspaceRoot);
    const artifact = requestId
      ? await readRequirementsArtifact(workspaceRoot, requestId)
      : await Deno.readTextFile(planPath);
    const result = evaluate(caseId, artifact);
    console.log(JSON.stringify(
      mode === "diagnostic" ? { caseId, planPath, legacyDiagnostic: result } : {
        caseId,
        planPath,
        ...result,
      },
    ));
    Deno.exit(mode === "diagnostic" || result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(2);
  }
}
