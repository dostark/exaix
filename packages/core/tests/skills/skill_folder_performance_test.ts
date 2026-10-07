/**
 * @module SkillFolderPerformanceTest
 * @path packages/core/tests/skills/skill_folder_performance_test.ts
 * @description Latency of resolving the representative catalog of 27 shipped and 28 dogfood skill folders against
 *   the dynamic match timeout. Twenty cold and twenty warm samples are taken and the p95 of each must stay below
 *   the timeout. A fake clock proves, without sleeping, that a match that never settles is cancelled at the
 *   timeout and not before.
 * @architectural-layer Test
 * @related-files [packages/core/src/skills/skills.ts, packages/execution/src/agent_runner.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { join } from "@std/path";
import { ExaPathDefaults, SKILL_MATCH_TIMEOUT_MS, SkillRootKind } from "@exaix/core";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { EventLogger } from "@exaix/core/logger";
import { createSkillOperationContext, SkillsService } from "@exaix/core/skills";
import { AgentRunner } from "@exaix/execution";
import { initTestDbService, REPO_ROOT } from "@exaix/testing";

/** The private match entry point the timeout guard lives in. */
interface IMatchingRunner {
  performDynamicSkillMatching(
    request: { userPrompt: string },
    role: string,
    skills: { matchSkills: () => Promise<never> },
  ): Promise<{ matches: never[] }>;
}

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
          { kind: SkillRootKind.PROJECT, path: join(REPO_ROOT, "Memory", "Skills", "project") },
          { kind: SkillRootKind.DOGFOOD, path: join(REPO_ROOT, ".copilot", "skills") },
          { kind: SkillRootKind.BLUEPRINT, path: join(REPO_ROOT, "Blueprints", "Skills") },
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

Deno.test("[performance] cold and warm resolution of the 27 plus 28 skill catalog stay under the match timeout at p95", async () => {
  const env = await initTestDbService();
  try {
    const provider = new StaticConfig(env.tempDir);
    // A parallel suite run shares the CPU, so one noisy window can inflate a p95. A real regression
    // is slow in every window, so the check passes when any attempt stays under the limit.
    const attempts: IPercentiles[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const measured = await measureOnce(provider, env);
      attempts.push(measured);
      assertEquals(
        measured.skills,
        27 + 28 - 1,
        "the tracked corpus, where the dogfood fix-bug shadows the shipped one",
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
    const hanging = {
      initialize: () => Promise.resolve(),
      matchSkills: () => new Promise<never>(() => {}),
    };
    const runner = new AgentRunner({ generate: () => Promise.reject(new Error("unused")) } as never, {
      skillsService: hanging as never,
      disableSkills: false,
    } as never);
    const matching = (runner as never as IMatchingRunner).performDynamicSkillMatching(
      { userPrompt: "review the code" },
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
