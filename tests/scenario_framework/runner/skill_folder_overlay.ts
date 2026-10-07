/**
 * @module ScenarioFrameworkSkillFolderOverlay
 * @path tests/scenario_framework/runner/skill_folder_overlay.ts
 * @description Produces the skill treatment overlay of an evaluation arm. It copies complete, loader-validated
 *   treatment folders into an exclusive isolated root and returns the overlay directory that the eval overlay
 *   environment variable names. A treatment that fails validation removes the staged root. The producer is
 *   evaluation-only and has no production caller. The shipped catalog is never written.
 * @architectural-layer Test
 * @dependencies [tests/scenario_framework/runner/ste100_assets.ts]
 * @related-files [tests/scenario_framework/runner/arm_overlay.ts, packages/core/src/skills/skills.ts]
 */

import { runIsolatedGenerator } from "./ste100_assets.ts";

export interface ISkillFolderOverlayInput {
  /** Isolated root the overlay must stay inside. */
  root: string;
  /** Directory holding one complete skill folder per treatment. */
  sourceDir: string;
  /** Exclusive overlay directory to create under the root. */
  targetDir: string;
  /** Other trees the overlay must not overlap. */
  existingTrees?: string[];
}

export interface ISkillFolderOverlay {
  /** Directory to set as the eval skill overlay. */
  overlayDir: string;
  /** Names of the treated skills copied into the overlay. */
  skills: string[];
}

/** Copies the treatment folders into an exclusive isolated root. Throws and leaves nothing behind when a folder is invalid. */
export async function produceSkillFolderOverlay(input: ISkillFolderOverlayInput): Promise<ISkillFolderOverlay> {
  const result = await runIsolatedGenerator({ kind: "overlay", ...input });
  if (!result.success) {
    await Deno.remove(input.targetDir, { recursive: true }).catch(() => {});
    throw new Error(`Skill treatment overlay refused: ${result.errors.join("; ")}`);
  }
  return { overlayDir: input.targetDir, skills: result.generated.map((path) => path.split("/").pop() ?? path) };
}
