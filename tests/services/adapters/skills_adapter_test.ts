/**
 * @module SkillsAdapterTest
 * @path tests/services/adapters/skills_adapter_test.ts
 * @description Unit tests for SkillsAdapter, verifying delegation to SkillsService
 * and filter normalization logic.
 */

import { assertEquals } from "@std/assert";
import { spy } from "@std/testing/mock";

import { SkillsAdapter } from "../../../src/services/adapters/skills_adapter.ts";
import type { SkillsService } from "../../../src/services/skills/skills.ts";
import { MemoryBankSource, MemoryScope, SkillStatus } from "../../../src/shared/enums.ts";
import type { ISkill, SkillDefinition } from "../../../src/shared/schemas/memory_bank.ts";

interface SpyLike {
  calls: { readonly length: number };
}

function getSpyCallCount(fn: unknown): number {
  const s = fn as SpyLike;
  return s?.calls?.length ?? 0;
}

Deno.test("SkillsAdapter: delegates simple methods to SkillsService", async () => {
  const mockInner = {} as SkillsService;

  // Setup spies/stubs
  mockInner.initialize = spy(() => Promise.resolve());
  mockInner.matchSkills = spy(() => Promise.resolve({ matches: [], totalAvailable: 0 }));
  mockInner.buildSkillContext = spy(() => Promise.resolve("context"));
  mockInner.recordSkillUsage = spy(() => Promise.resolve());
  mockInner.rebuildIndex = spy(() => Promise.resolve());
  mockInner.getSkill = spy(() => Promise.resolve(null));
  mockInner.deleteSkill = spy(() => Promise.resolve(true));

  const adapter = new SkillsAdapter(mockInner);

  await adapter.initialize();
  assertEquals(getSpyCallCount(mockInner.initialize), 1);

  await adapter.matchSkills({ requestText: "test" });
  assertEquals(getSpyCallCount(mockInner.matchSkills), 1);

  await adapter.buildSkillContext(["s1"]);
  assertEquals(getSpyCallCount(mockInner.buildSkillContext), 1);

  await adapter.recordSkillUsage("s1");
  assertEquals(getSpyCallCount(mockInner.recordSkillUsage), 1);

  await adapter.rebuildIndex();
  assertEquals(getSpyCallCount(mockInner.rebuildIndex), 1);

  await adapter.getSkill("s1");
  assertEquals(getSpyCallCount(mockInner.getSkill), 1);

  await adapter.deleteSkill("s1");
  assertEquals(getSpyCallCount(mockInner.deleteSkill), 1);
});

Deno.test("SkillsAdapter: listSkills normalizes filters", async () => {
  const mockInner = {} as SkillsService;
  type ListSkillsFilter = { status?: SkillStatus; source?: MemoryBankSource };
  const listSkillsSpy = spy((_filter?: ListSkillsFilter) => Promise.resolve([]));
  mockInner.listSkills = listSkillsSpy;

  const adapter = new SkillsAdapter(mockInner);

  // 1. No filter
  await adapter.listSkills();
  assertEquals(listSkillsSpy.calls[0].args[0], {});

  // 2. Valid status and source
  await adapter.listSkills({ status: SkillStatus.ACTIVE, source: MemoryBankSource.PROJECT });
  assertEquals(listSkillsSpy.calls[1].args[0], {
    status: SkillStatus.ACTIVE,
    source: MemoryBankSource.PROJECT,
  });

  // 3. Invalid values (should be filtered out by normalization)
  await adapter.listSkills({ status: "INVALID" as never, source: "UNKNOWN" as never });
  assertEquals(listSkillsSpy.calls[2].args[0], {});

  // 4. Mixed valid/invalid
  await adapter.listSkills({ status: SkillStatus.DEPRECATED, source: "UNKNOWN" as never });
  assertEquals(listSkillsSpy.calls[3].args[0], {
    status: SkillStatus.DEPRECATED,
  });
});

Deno.test("SkillsAdapter: complex methods delegation", async () => {
  const mockInner = {} as SkillsService;

  const skill: ISkill = {
    id: "s1",
    skill_id: "skill-1",
    name: "Skill 1",
    description: "Desc",
    instructions: "Do things",
    source: MemoryBankSource.PROJECT,
    scope: MemoryScope.PROJECT,
    status: SkillStatus.ACTIVE,
    usage_count: 0,
    version: "1.0.0",
    created_at: new Date().toISOString(),
    triggers: { keywords: ["test"] },
  };

  mockInner.deriveSkillFromLearnings = spy(() => Promise.resolve(skill));
  mockInner.createSkill = spy(() => Promise.resolve(skill));

  const adapter = new SkillsAdapter(mockInner);
  const skillDef: SkillDefinition = {
    skill_id: "skill-1",
    name: "Skill 1",
    description: "Desc",
    instructions: "Do things",
    version: "1.0.0",
    source: MemoryBankSource.PROJECT,
    scope: MemoryScope.PROJECT,
    status: SkillStatus.ACTIVE,
    triggers: { keywords: ["test"] },
  };

  const derived = await adapter.deriveSkillFromLearnings(["l1"], skillDef);
  assertEquals(derived, skill);
  assertEquals(getSpyCallCount(mockInner.deriveSkillFromLearnings), 1);

  const created = await adapter.createSkill(skillDef);
  assertEquals(created, skill);
  assertEquals(getSpyCallCount(mockInner.createSkill), 1);
});
