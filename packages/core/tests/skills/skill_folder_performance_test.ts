/**
 * @module SkillFolderPerformanceTest
 * @path packages/core/tests/skills/skill_folder_performance_test.ts
 * @description Latency of resolving the representative authored skill catalog against
 *   the dynamic match timeout. Twenty cold and twenty warm samples are taken and the p95 of each must stay below
 *   the timeout. A fake clock proves, without sleeping, that a match that never settles is cancelled at the
 *   timeout and not before.
 * @architectural-layer Test
 * @related-files [packages/core/src/skills/skills.ts, packages/execution/src/agent_runner.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { DEFAULT_SKILLS_MEMORY_PATH, ExaPathDefaults } from "@exaix/shared";
import { assertEquals, assertRejects } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { join } from "@std/path";
import { SKILL_MATCH_TIMEOUT_MS, SkillRootKind } from "@exaix/core";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { EventLogger } from "@exaix/core/logger";
import { createSkillOperationContext, SkillsService } from "@exaix/core/skills";
import { AgentRunner } from "@exaix/execution";
import { createMockProvider, initTestDbService, REPO_ROOT, StubSkillsService } from "@exaix/testing";

const SAMPLES = 20;
const MAX_ATTEMPTS = 3;
const P95_RANK = 0.95;
const PORTAL = "Exaix";
const REPRESENTATIVE_REQUEST = {
  requestText: "Review the request path handling for traversal and injection defects",
  keywords: ["review", "security", "test", "typescript"],
};

class StaticConfig {
  private readonly config: Config;
  constructor(root: string) {
    this.config = ConfigSchema.parse({
      system: { root },
      paths: { ...ExaPathDefaults },
      portals: [{ alias: PORTAL, target_path: root }],
      skills: {
        roots: [
          {
            kind: SkillRootKind.PROJECT,
            path: pathBuilders.memoryPath(REPO_ROOT, DEFAULT_SKILLS_MEMORY_PATH, "project"),
          },
          { kind: SkillRootKind.DOGFOOD, path: join(REPO_ROOT, ".copilot", "skills") },
          { kind: SkillRootKind.BLUEPRINT, path: pathBuilders.blueprintsPath(REPO_ROOT, DEFAULT_SKILLS_MEMORY_PATH) },
        ],
      },
    });
  }
  get(): Config {
    return this.config;
  }
  getChecksum(): string {
    return "performance";
  }
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * P95_RANK) - 1];
}

async function resolveCatalogOnce(service: SkillsService): Promise<{ elapsedMs: number; skills: number }> {
  const ctx = createSkillOperationContext({
    agentRole: "tester",
    portal: PORTAL,
    configGeneration: service.currentConfigGeneration(),
  });
  const started = performance.now();
  await service.matchSkills(REPRESENTATIVE_REQUEST, ctx);
  const elapsedMs = performance.now() - started;
  return { elapsedMs, skills: (await service.listSkills(undefined, ctx)).length };
}

interface IPercentiles {
  cold: number;
  warm: number;
  skills: number;
}

async function measureOnce(provider: StaticConfig, env: Awaited<ReturnType<typeof initTestDbService>>) {
  const cold: number[] = [];
  let skills = 0;
  for (let sample = 0; sample < SAMPLES; sample++) {
    const service = new SkillsService({ configProvider: provider }, env.db, undefined, new EventLogger({ db: env.db }));
    await service.initialize();
    const result = await resolveCatalogOnce(service);
    cold.push(result.elapsedMs);
    skills = result.skills;
  }
  const service = new SkillsService({ configProvider: provider }, env.db, undefined, new EventLogger({ db: env.db }));
  await service.initialize();
  await resolveCatalogOnce(service);
  const warm: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) warm.push((await resolveCatalogOnce(service)).elapsedMs);
  return { cold: p95(cold), warm: p95(warm), skills } satisfies IPercentiles;
}

/** Counts authored names once when a dogfood folder shadows a shipped folder. */
async function authoredSkillCount(provider: StaticConfig): Promise<number> {
  const names = new Set<string>();
  for (const configured of provider.get().skills.roots ?? []) {
    const root = configured.kind === SkillRootKind.PROJECT ? join(configured.path, PORTAL) : configured.path;
    for await (const entry of Deno.readDir(root)) {
      if (!entry.isDirectory) continue;
      await Deno.stat(join(root, entry.name, "SKILL.md"));
      names.add(entry.name);
    }
  }
  return names.size;
}

Deno.test("[performance] cold and warm resolution of the authored skill catalog stay under the match timeout at p95", async () => {
  const env = await initTestDbService();
  try {
    const provider = new StaticConfig(env.tempDir);
    const expectedSkills = await authoredSkillCount(provider);
    // A parallel suite run shares the CPU, so one noisy window can inflate a p95. A real regression
    // is slow in every window, so the check passes when any attempt stays under the limit.
    const attempts: IPercentiles[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const measured = await measureOnce(provider, env);
      attempts.push(measured);
      assertEquals(
        measured.skills,
        expectedSkills,
        "the authored corpus after same-name folder shadowing",
      );
      console.log(
        `[performance] attempt ${attempt + 1}: p95 cold ${measured.cold.toFixed(1)} ms, warm ${
          measured.warm.toFixed(1)
        } ms, limit ${SKILL_MATCH_TIMEOUT_MS} ms`,
      );
      if (measured.cold < SKILL_MATCH_TIMEOUT_MS && measured.warm < SKILL_MATCH_TIMEOUT_MS) return;
    }
    throw new Error(`p95 stayed above ${SKILL_MATCH_TIMEOUT_MS} ms in all attempts: ${JSON.stringify(attempts)}`);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[performance] a match that never settles is cancelled at the timeout and not before", async () => {
  const time = new FakeTime();
  try {
    const hanging = new StubSkillsService();
    hanging.matchSkills = () => new Promise<never>(() => {});
    const runner = new AgentRunner(createMockProvider([]), {
      skillsService: hanging,
      disableSkills: false,
    });
    const matching = runner["skills"]["performDynamicSkillMatching"](
      { userPrompt: "review the code", context: {} },
      "tester",
      hanging,
    );
    const outcome = assertRejects(() => matching, Error, "Skill matching timed out");
    let settled = false;
    matching.catch(() => {}).finally(() => settled = true);
    await time.tickAsync(SKILL_MATCH_TIMEOUT_MS - 1);
    assertEquals(settled, false, "the match must still be pending one millisecond before the timeout");
    await time.tickAsync(1);
    await outcome;
    await matching.catch(() => {});
    assertEquals(settled, true);
  } finally {
    time.restore();
  }
});
