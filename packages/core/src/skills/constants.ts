/**
 * @module SkillFolderConstants
 * @path packages/core/src/skills/constants.ts
 * @description Folder and file names the skill store uses, in one owner module.
 * @architectural-layer Shared
 * @related-files [packages/core/src/skills/skill_folder_loader.ts]
 */

/** Skill state folder name. */
export const STATE_DIR = ".exa-skill-state";
/** Lock file name inside the state folder. */
export const LOCK_FILE = "lock";
/** Skill definition file name. */
export const SKILL_FILE = "SKILL.md";
/** Sidecar metadata file name. */
export const SIDECAR_FILE = "exaix.yaml";
/** References folder name. */
export const REFERENCES_DIR = "references";
