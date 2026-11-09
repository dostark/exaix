#!/usr/bin/env -S deno run -A
/**
 * @module SkillRootCollision
 * @path tests/scenario_framework/runner/skill_root_collision.ts
 * @description Checks real Blueprint and dogfood skill revisions under ordered isolated roots.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/skill_root_collision_test.ts]
 * Usage: deno run -A tests/scenario_framework/runner/skill_root_collision.ts
 */
import { copy } from "@std/fs";
import { join } from "@std/path";
import { SkillRootKind } from "@exaix/core";
import type { ILoadedSkill, IResolvedSkillRoot } from "@exaix/core/skills";
import { createSkillLoaderFor, REPO_ROOT, testSkillContext, withTempDir } from "@exaix/testing";

function acceptsBlueprint(actual: ILoadedSkill | null, expected: ILoadedSkill): boolean {
  return actual?.rootKind === SkillRootKind.BLUEPRINT && actual.sourcePath === expected.sourcePath &&
    actual.revisionId === expected.revisionId && actual.contentSha256 === expected.contentSha256;
}

interface IRootCollisionResult {
  blueprintAccepted: boolean;
  shadowAccepted: boolean;
  blueprintRevision: string;
  shadowRevision: string;
}

/** Checks the canonical Blueprint revision against both possible ordered winners. */
export async function inspectFixBugRoots(): Promise<IRootCollisionResult> {
  let result: IRootCollisionResult | null = null;
  await withTempDir(async (root) => {
    const blueprintPath = join(root, "blueprint");
    const dogfoodPath = join(root, "dogfood");
    await copy(join(REPO_ROOT, "Blueprints/Skills/fix-bug"), join(blueprintPath, "fix-bug"));
    await copy(join(REPO_ROOT, ".copilot/skills/fix-bug"), join(dogfoodPath, "fix-bug"));
    const blueprint: IResolvedSkillRoot = {
      path: blueprintPath,
      kind: SkillRootKind.BLUEPRINT,
      writable: false,
      project: null,
    };
    const dogfood: IResolvedSkillRoot = {
      path: dogfoodPath,
      kind: SkillRootKind.DOGFOOD,
      writable: false,
      project: null,
    };
    const ctx = testSkillContext();
    const expected = await createSkillLoaderFor([blueprint]).get("fix-bug", ctx);
    const selected = await createSkillLoaderFor([blueprint, dogfood]).get("fix-bug", ctx);
    const shadow = await createSkillLoaderFor([dogfood, blueprint]).get("fix-bug", ctx);
    if (!expected || !selected || !shadow) throw new Error("Both fix-bug roots must load");
    result = {
      blueprintAccepted: acceptsBlueprint(selected, expected),
      shadowAccepted: acceptsBlueprint(shadow, expected),
      blueprintRevision: expected.revisionId,
      shadowRevision: shadow.revisionId,
    };
  });
  if (!result) throw new Error("Root comparison did not complete");
  return result;
}

if (import.meta.main) {
  const result = await inspectFixBugRoots();
  console.log(JSON.stringify(result));
  if (!result.blueprintAccepted || result.shadowAccepted || result.blueprintRevision === result.shadowRevision) {
    Deno.exit(1);
  }
}
