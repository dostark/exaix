#!/usr/bin/env -S deno run -A
/**
 * @module Phase234RequirementsDelegateFixture
 * @path tests/scenario_framework/fixtures/cli/phase234_requirements_delegate.ts
 * @description Captures and verifies requirements instructions and durable usage while replaying the existing CLI recording.
 * @architectural-layer Test
 * @related-files [packages/flow/src/flow_skill_pins.ts, packages/execution/src/strategies/cli_delegate_strategy.ts]
 */
import "./flow_blueprint_delegate.ts";
import { Database } from "@db/sqlite";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { PathResolver } from "@exaix/portal";
import { MemoryBankSource, MemoryScope, SkillRootKind } from "@exaix/core";
import { parseSkillSnapshot } from "@exaix/core/skills";

interface IRecordedUsage {
  skill_name: string;
  revision_id: string;
  content_sha256: string;
  root_kind: string;
  source_path: string;
  flow_id: string;
  flow_step_id: string;
  agent_role: string;
  trace_id: string;
  request_id: string;
  skill_md: string;
  exaix_yaml: string | null;
  revision_references: string;
}

const selectedModel = Deno.args[Deno.args.indexOf("--model") + 1];
if (selectedModel?.endsWith("__analyze-requirements__0")) {
  const rootIndex = Deno.args.indexOf("--evidence-root");
  const root = rootIndex < 0 ? undefined : Deno.args[rootIndex + 1];
  if (!root) throw new Error("Replay capture requires the isolated workspace root argument");
  const resolver = new PathResolver(ConfigSchema.parse({ system: { root }, paths: {} }));
  const db = new Database(await resolver.resolve("@Runtime/journal.db"), { readonly: true });
  let usage: IRecordedUsage[];
  try {
    usage = db.prepare(
      'SELECT u.*, r.content_sha256, r.skill_md, r.exaix_yaml, r."references" AS revision_references FROM skill_usage u JOIN skill_revisions r ON r.revision_id = u.revision_id WHERE u.flow_id = ? AND u.flow_step_id = ? ORDER BY u.skill_name',
    )
      .all<IRecordedUsage>("feature-development", "analyze-requirements");
  } finally {
    db.close();
  }
  assertEquals(usage.map((row) => row.skill_name), [
    "requirements-analysis",
    "response-contract",
    "typescript-patterns",
  ]);
  const objective = Deno.args[Deno.args.indexOf("-p") + 1];
  for (const row of usage) {
    assertEquals(row.root_kind, SkillRootKind.BLUEPRINT);
    assertEquals(row.source_path, row.skill_name);
    assertEquals(row.agent_role, "product-manager");
    const skill = await parseSkillSnapshot({
      skill_md: row.skill_md,
      exaix_yaml: row.exaix_yaml,
      references: JSON.parse(row.revision_references),
    }, {
      rootKind: SkillRootKind.BLUEPRINT,
      name: row.skill_name,
      path: row.source_path,
      project: null,
      source: MemoryBankSource.CORE,
      scope: MemoryScope.GLOBAL,
    });
    assertEquals(skill.id, row.revision_id);
    assertEquals(skill.content_sha256, row.content_sha256);
    assertStringIncludes(objective, skill.instructions);
  }
  const output = await resolver.resolve("@Runtime/phase234-requirements-evidence.json");
  await Deno.writeTextFile(output, JSON.stringify({ verified: true, objective, usage }, null, 2));
}
