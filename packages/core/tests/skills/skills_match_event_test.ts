/**
 * @module SkillsMatchEventTest
 * @path packages/core/tests/skills/skills_match_event_test.ts
 * @description Phase 142 Step 12 — verifies SkillsService.matchSkills journals
 *   DomainEventType.SkillsMatchCompleted. The constant was declared in constants.ts but had ZERO
 *   production emitters, so every skill match was invisible to the Activity Journal and
 *   the entire skills evaluation pack asserted a `skills.match_completed` event that could
 *   never arrive.
 * @architectural-layer Core
 * @dependencies [@exaix/core/skills, @exaix/testing]
 * @related-files [packages/core/src/skills/skills.ts, tests/scenario_framework/scenarios/skill_eval/]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import { SkillsService } from "@exaix/core/skills";
import { initTestDbService, REPO_ROOT } from "@exaix/testing";
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

const REPO_BLUEPRINT_SKILLS = join(REPO_ROOT, "Blueprints", "Skills");

async function withSkillsService(
  fn: (service: SkillsService, captured: ICapturedEvent[]) => Promise<void>,
): Promise<void> {
  const { db, cleanup } = await initTestDbService();
  const captured: ICapturedEvent[] = [];
  const memoryDir = await Deno.makeTempDir({ prefix: "skills-match-event-" });
  try {
    const service = new SkillsService(
      { memoryDir, blueprintSkillsDir: REPO_BLUEPRINT_SKILLS },
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

    const events = captured.filter((e) => e.action === DomainEventType.SkillsMatchCompleted);
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
    const events = captured.filter((e) => e.action === DomainEventType.SkillsMatchCompleted);
    assertEquals(events.length, 1, "a zero-match outcome is still an observable match result");
    const payload = events[0].payload as { matched_count?: number } | undefined;
    assertEquals(payload?.matched_count, 0);
  });
});

async function writeActiveSkill(
  root: string,
  name: string,
  description: string,
  body: string,
  triggers: Record<string, string[]>,
): Promise<void> {
  await Deno.mkdir(join(root, name), { recursive: true });
  await Deno.writeTextFile(
    join(root, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`,
  );
  await Deno.writeTextFile(
    join(root, name, "exaix.yaml"),
    `triggers:\n${
      Object.entries(triggers).map(([k, v]) => `  ${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`).join("\n")
    }\n`,
  );
}

/** A block longer than the default skill context budget, so `formatSkillForPrompt` cannot
 *  fit it. 2500 > DEFAULT_SKILL_CONTEXT_CHAR_BUDGET (2000). */
const OVERSIZED_INSTRUCTIONS = "x".repeat(2_500);

Deno.test("[skills] matchSkills keeps a fitting lower-confidence match when a higher-confidence match overflows the budget", async () => {
  const { db, cleanup } = await initTestDbService();
  const captured: ICapturedEvent[] = [];
  const memoryDir = await Deno.makeTempDir({ prefix: "skills-budget-" });
  const blueprintDir = join(memoryDir, "Blueprints", "Skills");
  try {
    // Confidence is score divided by max over declared dimensions. `oversized-first` declares
    // only the tag, so it scores 1.0. `small-second` adds an unmatched file pattern, so its
    // denominator grows and it ranks below the oversized block.
    await writeActiveSkill(
      blueprintDir,
      "oversized-first",
      "Ranks first but cannot fit the budget",
      OVERSIZED_INSTRUCTIONS,
      {
        tags: ["budget-probe"],
      },
    );
    await writeActiveSkill(
      blueprintDir,
      "small-second",
      "Ranks lower but fits the budget",
      "A short instruction block that fits comfortably.",
      { tags: ["budget-probe"], file_patterns: ["*.no-such-extension"] },
    );
    const service = new SkillsService(
      { memoryDir, blueprintSkillsDir: blueprintDir },
      db,
      undefined,
      createCapturingLogger(captured),
    );
    await service.initialize();

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
