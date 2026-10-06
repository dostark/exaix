/**
 * @module SkillCatalogTestHelper
 * @path packages/testing/src/helpers/skill_catalog.ts
 * @description Loads the repository's authored skill folders through the production
 *   SkillFolderLoader, so tests read the real catalog instead of a compiled copy.
 * @architectural-layer Testing
 * @dependencies [@exaix/core, @exaix/core/skills, @exaix/schemas, @exaix/tool-runtime]
 * @related-files [packages/core/src/skills/skill_folder_loader.ts]
 */

import { join } from "@std/path";
import { stringify as stringifyYaml } from "@std/yaml";
import {
  DEFAULT_BLUEPRINTS_PATH,
  DEFAULT_MEMORY_PATH,
  DEFAULT_SKILLS_MEMORY_PATH,
  MemoryBankSource,
  MemoryScope,
  SkillMatchSource,
  SkillRootKind,
  SkillStatus,
} from "@exaix/core";
import type { ISkillsContext } from "@exaix/core/types";
import type { ISkill } from "@exaix/schemas/memory_bank.ts";
import type { ISkillSidecar } from "@exaix/schemas/skill_folder.ts";
import { EventRegistry } from "@exaix/core/events";
import { createNoopEventLogger } from "@exaix/core/logger";
import {
  type ILoadedSkill,
  type IResolvedSkillRoot,
  type ISkillOperationContext,
  SkillFolderLoader,
} from "@exaix/core/skills";
import { createPathSecurity } from "@exaix/tool-runtime";
import { REPO_ROOT } from "./repo_root.ts";

/** One skill folder to write into a test root. `sidecar` becomes `exaix.yaml` when present. */
export interface ISkillFolderSeed {
  name: string;
  description?: string;
  instructions: string;
  sidecar?: ISkillSidecar;
}

/** Portal that owns the repository's project-scoped skill folder. */
export const REPO_SKILL_PROJECT = "Exaix";

const PROJECT_SKILLS_DIR = "project";
const TEST_AGENT_ROLE = "test";
const TEST_TRACE_ID = "00000000-0000-4000-8000-000000000206";

/** Operation context for tests that read the catalog directly. */
export function testSkillContext(): ISkillOperationContext {
  return {
    portal: null,
    traceId: TEST_TRACE_ID,
    requestId: null,
    flowId: null,
    flowStepId: null,
    agentRole: TEST_AGENT_ROLE,
    configGeneration: TEST_AGENT_ROLE,
  };
}

/** The repository's default skill roots: the Exaix project root, then the Blueprint root. */
export function repoSkillRoots(repoRoot: string = REPO_ROOT): IResolvedSkillRoot[] {
  return [
    {
      path: join(repoRoot, DEFAULT_MEMORY_PATH, DEFAULT_SKILLS_MEMORY_PATH, PROJECT_SKILLS_DIR, REPO_SKILL_PROJECT),
      kind: SkillRootKind.PROJECT,
      writable: false,
      project: REPO_SKILL_PROJECT,
    },
    {
      path: join(repoRoot, DEFAULT_BLUEPRINTS_PATH, DEFAULT_SKILLS_MEMORY_PATH),
      kind: SkillRootKind.BLUEPRINT,
      writable: false,
      project: null,
    },
  ];
}

/** A production SkillFolderLoader over the given roots with a no-op journal. */
export function createSkillLoaderFor(roots: readonly IResolvedSkillRoot[]): SkillFolderLoader {
  const logger = createNoopEventLogger();
  return new SkillFolderLoader({
    roots,
    pathSecurity: createPathSecurity(),
    logger,
    eventRegistry: new EventRegistry(logger),
  });
}

/** Every active skill of the repository catalog, keyed by slug. */
export async function loadRepoSkillCatalog(repoRoot: string = REPO_ROOT): Promise<Map<string, ILoadedSkill>> {
  const loaded = await createSkillLoaderFor(repoSkillRoots(repoRoot)).list(testSkillContext());
  return new Map(loaded.map((entry) => [entry.skill.name, entry]));
}

const FIXTURE_REVISION_ID = "123e4567-e89b-52d3-a456-426614174000";
const FIXTURE_SHA256 = "0".repeat(64);

/** A valid runtime skill view for test doubles. Override only the fields a test asserts on. */
export function runtimeSkillFixture(overrides: Partial<ISkill> = {}): ISkill {
  const slug = overrides.skill_id ?? overrides.name ?? "fixture-skill";
  return {
    id: FIXTURE_REVISION_ID,
    skill_id: slug,
    name: slug,
    title: "Fixture Skill",
    description: "A fixture skill",
    status: SkillStatus.ACTIVE,
    source: MemoryBankSource.USER,
    scope: MemoryScope.GLOBAL,
    root_kind: SkillRootKind.BLUEPRINT,
    path: slug,
    content_sha256: FIXTURE_SHA256,
    triggers: { keywords: [] },
    triggers_source: "authored",
    instructions: "Do things.",
    references: [],
    ...overrides,
  };
}

/** A valid prompt-context skill match for formatter and runner tests. */
export function skillMatchFixture(
  overrides: Partial<ISkillsContext["matched"][number]> = {},
): ISkillsContext["matched"][number] {
  return {
    skillId: "fixture-skill",
    revisionId: FIXTURE_REVISION_ID,
    contentSha256: FIXTURE_SHA256,
    rootKind: SkillRootKind.BLUEPRINT,
    sourcePath: "fixture-skill",
    name: "Fixture Skill",
    description: "A fixture skill",
    content: "Do things.",
    confidence: 1,
    matchedTriggers: {},
    source: SkillMatchSource.MATCHED,
    tags: [],
    critical: false,
    references: [],
    ...overrides,
  };
}

/** Writes `<root>/<name>/SKILL.md` and, when a sidecar is given, `<root>/<name>/exaix.yaml`. */
export async function writeSkillFolder(root: string, seed: ISkillFolderSeed): Promise<void> {
  const dir = join(root, seed.name);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "SKILL.md"),
    `---\nname: ${seed.name}\ndescription: ${
      JSON.stringify(seed.description ?? `${seed.name} skill`)
    }\n---\n${seed.instructions}\n`,
  );
  if (seed.sidecar) await Deno.writeTextFile(join(dir, "exaix.yaml"), stringifyYaml(seed.sidecar));
}
