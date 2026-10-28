/**
 * @module SkillSourcesTestHelper
 * @path tests/helpers/skill_sources.ts
 * @description Counts the skill folders of a skills source directory, so a test derives the generated count from the source.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [tests/scripts/skill_transform_test.ts, tests/scenario_framework/tests/unit/ste100_assets_test.ts]
 */

/** Counts the directories directly below `sourceDir`, one per skill. */
export async function countSkillFolders(sourceDir: string): Promise<number> {
  let count = 0;
  for await (const entry of Deno.readDir(sourceDir)) {
    if (entry.isDirectory) count++;
  }
  return count;
}
