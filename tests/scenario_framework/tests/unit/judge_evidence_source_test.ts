/**
 * @module ScenarioFrameworkJudgeEvidenceSourceTest
 * @path tests/scenario_framework/tests/unit/judge_evidence_source_test.ts
 * @description The LLM judge scores the file a `prepare-evidence` step copies. In a swe_tasks
 *   scenario whose request names its deliverables on a `Files:` line, that file must be one of
 *   them; judging an unrelated source file scores the wrong artefact.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/swe_tasks/explain-request-flow.yaml]
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

const FRAMEWORK_DIR = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const SWE_TASKS_DIR = join(FRAMEWORK_DIR, "scenarios", "swe_tasks");
const FILES_LINE = /^Files:\s*(.+)$/m;
const PREPARE_EVIDENCE_STEP = "prepare-evidence";

interface IScenarioStep {
  type?: string;
  source?: string;
}

interface IScenarioDoc {
  request_fixture?: string;
  steps?: IScenarioStep[];
}

Deno.test("[judge-evidence] swe_tasks judge evidence is one of the request's declared deliverables", async () => {
  const mismatches: string[] = [];
  for await (const entry of Deno.readDir(SWE_TASKS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".yaml")) continue;
    const doc = parseYaml(await Deno.readTextFile(join(SWE_TASKS_DIR, entry.name))) as IScenarioDoc;
    if (!doc.request_fixture) continue;
    const request = await Deno.readTextFile(join(FRAMEWORK_DIR, doc.request_fixture));
    const deliverables = FILES_LINE.exec(request)?.[1];
    if (!deliverables) continue;
    for (const step of doc.steps ?? []) {
      if (step.type !== PREPARE_EVIDENCE_STEP || !step.source) continue;
      if (!deliverables.includes(step.source)) {
        mismatches.push(`${entry.name}: evidence ${step.source}, deliverables ${deliverables}`);
      }
    }
  }
  assertEquals(mismatches.sort(), [], "the judge must score the requested deliverable");
});
