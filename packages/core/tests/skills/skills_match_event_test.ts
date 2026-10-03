/**
 * @module SkillsMatchEventTest
 * @path packages/core/tests/skills/skills_match_event_test.ts
 * @description Phase 142 Step 12 — verifies SkillsService.matchSkills journals
 *   SKILL_EVENT_MATCH_COMPLETED. The constant was declared in constants.ts but had ZERO
 *   production emitters, so every skill match was invisible to the Activity Journal and
 *   the entire skills evaluation pack asserted a `skills.match_completed` event that could
 *   never arrive.
 * @architectural-layer Core
 * @dependencies [@exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/skills/skills.ts, tests/scenario_framework/scenarios/skill_eval/]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { copy } from "@std/fs";
import { SkillsService } from "@exaix/core/skills";
import { MemoryBankSource, MemoryScope, SKILL_EVENT_MATCH_COMPLETED, SkillStatus } from "@exaix/core";
import { DEFAULT_GLOBAL_MEMORY_VERSION } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";

interface ICapturedEvent {
  action: string;
  target: string | null;
  payload?: LogMetadata;
}

/** In-memory IEventLogger recording every emitted event for assertion. */
function createCapturingLogger(captured: ICapturedEvent[]): IEventLogger {
  const record = (action: string, target: string | null, payload?: LogMetadata): Promise<void> => {
    captured.push({ action, target, payload });
    return Promise.resolve();
  };
  const logger: IEventLogger = {
    log: (event) => record(event.action ?? "", event.target ?? null, event.payload),
    info: record,
    warn: record,
    error: record,
    fatal: record,
    debug: record,
    child: () => logger,
  };
  return logger;
}

const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..", "..");

async function withSkillsService(
  fn: (service: SkillsService, captured: ICapturedEvent[]) => Promise<void>,
): Promise<void> {
  const { db, cleanup } = await initTestDbService();
  const captured: ICapturedEvent[] = [];
  // Copy the shipped skill catalog into a temp dir rather than pointing at the repo's own:
  // SkillsService.initialize() rebuilds Skills/index.json, which the repo tree deliberately omits.
  const memoryDir = await Deno.makeTempDir({ prefix: "skills-match-event-" });
  try {
    await copy(join(REPO_ROOT, "Memory", "Skills"), join(memoryDir, "Skills"), { overwrite: true });
    const service = new SkillsService(
      { memoryDir },
      db,
      undefined,
      createCapturingLogger(captured),
    );
    await service.initialize();
    await fn(service, captured);
  } finally {
    await Deno.remove(memoryDir, { recursive: true }).catch(() => {});
    await cleanup();
  }
}

Deno.test("[skills] matchSkills journals skills.match_completed with the matched ids", async () => {
  await withSkillsService(async (service, captured) => {
    const { matches } = await service.matchSkills({
      tags: ["tdd", "testing"],
      requestText: "write tests first then implement the feature",
    });

    const events = captured.filter((e) => e.action === SKILL_EVENT_MATCH_COMPLETED);
    assertEquals(events.length, 1, "exactly one match_completed event per matchSkills call");

    const payload = events[0].payload as { matched_skill_ids?: string[]; matched_count?: number } | undefined;
    assertEquals(payload?.matched_count, matches.length);
    assertEquals(payload?.matched_skill_ids, matches.map((m) => m.skillId));
  });
});

Deno.test("[skills] matchSkills journals the event even when nothing matches", async () => {
  await withSkillsService(async (service, captured) => {
    const { matches } = await service.matchSkills({
      tags: ["zzz-no-such-tag-anywhere"],
      requestText: "zzzqqq unmatched gibberish",
    });

    assertEquals(matches.length, 0);
    const events = captured.filter((e) => e.action === SKILL_EVENT_MATCH_COMPLETED);
    assertEquals(events.length, 1, "a zero-match outcome is still an observable match result");
    const payload = events[0].payload as { matched_count?: number } | undefined;
    assertEquals(payload?.matched_count, 0);
  });
});

/** A block longer than the default skill context budget, so `formatSkillForPrompt` cannot
 *  fit it. 2500 > DEFAULT_SKILL_CONTEXT_CHAR_BUDGET (2000). */
const OVERSIZED_INSTRUCTIONS = "x".repeat(2_500);

Deno.test("[skills] matchSkills keeps a fitting lower-confidence match when a higher-confidence match overflows the budget", async () => {
  const { db, cleanup } = await initTestDbService();
  const captured: ICapturedEvent[] = [];
  const memoryDir = await Deno.makeTempDir({ prefix: "skills-budget-" });
  try {
    const service = new SkillsService(
      { memoryDir },
      db,
      undefined,
      createCapturingLogger(captured),
    );
    await service.initialize();

    // Confidence is score divided by max over declared dimensions. `oversized-first` declares
    // only the tag, so it scores 1.0. `small-second` adds an unmatched file pattern, so its
    // denominator grows and it ranks below the oversized block.
    await service.createSkill({
      skill_id: "oversized-first",
      name: "Oversized First",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "Ranks first but cannot fit the budget",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { tags: ["budget-probe"] },
      instructions: OVERSIZED_INSTRUCTIONS,
    });
    await service.createSkill({
      skill_id: "small-second",
      name: "Small Second",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      description: "Ranks lower but fits the budget",
      scope: MemoryScope.GLOBAL,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.USER,
      triggers: { tags: ["budget-probe"], file_patterns: ["*.no-such-extension"] },
      instructions: "A short instruction block that fits comfortably.",
    });

    const { matches } = await service.matchSkills({
      tags: ["budget-probe"],
      requestText: "budgetprobe",
      contextBudgetChars: 2_000,
    });

    const ids = matches.map((m) => m.skillId);
    assertEquals(ids.includes("small-second"), true, `fitting match dropped: ${ids.join(",")}`);
    assertEquals(ids.includes("oversized-first"), false, "an over-budget match must not be injected");
  } finally {
    await Deno.remove(memoryDir, { recursive: true }).catch(() => {});
    await cleanup();
  }
});
