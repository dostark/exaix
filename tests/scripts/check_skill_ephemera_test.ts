/**
 * @module CheckSkillEphemeraTest
 * @path tests/scripts/check_skill_ephemera_test.ts
 * @description Phase 167 self-improvement-retro finding — guards against "leaked
 *   ephemeral detail" in generic skill guidance: a dated incident-recounting sentence
 *   (`YYYY-MM-DD` + a process verb like "found"/"audit") must not live in a general skill
 *   every phase re-reads. Phase/domain-specific narrative belongs in the owning domain doc
 *   or the phase doc's Retrospective. This is the regression test for
 *   `scripts/check_skill_ephemera.ts`; the pure `skillProseLines`/`isEphemeralNarrative`
 *   helpers are asserted directly, and `scanSkills` is exercised against a fixture.
 * @architectural-layer Test
 * @related-files [scripts/check_skill_ephemera.ts, .copilot/skills/self-improvement/SKILL.md]
 */

import { assert, assertEquals } from "@std/assert";
import { isEphemeralNarrative, skillProseLines } from "../../scripts/check_skill_ephemera.ts";

Deno.test("[skill-ephemera] a dated incident-recounting sentence is flagged", () => {
  assert(isEphemeralNarrative("phase-158's 2026-08-04 post-gap analysis found six ✅ rows"));
  assert(isEphemeralNarrative("2026-08-15 audit (`phase-142...`) despite prior recorded lessons"));
  assert(isEphemeralNarrative("landed by Phase 168 on 2026-08-20"));
});

Deno.test("[skill-ephemera] a date alone, or a verb without a date, is not flagged", () => {
  assert(!isEphemeralNarrative("This skill is maintained by the next-phase skill."));
  assert(!isEphemeralNarrative("2026-08-15")); // bare date, no incident verb
  assert(!isEphemeralNarrative("The audit found ten stale headers.")); // verb, no date
});

Deno.test("[skill-ephemera] skillProseLines treats the text-fenced body as prose", () => {
  const md = [
    "---",
    "name: test",
    "---",
    "",
    "```text",
    "A dated incident recount: 2026-08-04 audit found six rows.",
    "```",
  ].join("\n");
  const prose = skillProseLines(md);
  assert(
    prose.some((l) => l.includes("dated incident recount")),
    "the text-fenced body is the guidance narrative and must be scanned",
  );
});

Deno.test("[skill-ephemera] skillProseLines exempts inner code fences and frontmatter", () => {
  const md = [
    "---",
    "version: 1.0.0",
    "---",
    "",
    "Rule text with no date.",
    "",
    "```bash",
    "# 2026-08-04 is inside a code fence and must be exempt",
    "exactl journal wait --event x",
    "```",
  ].join("\n");
  const prose = skillProseLines(md);
  assertEquals(prose.includes("Rule text with no date."), true);
  assertEquals(
    prose.some((l) => l.includes("2026-08-04 is inside a code fence")),
    false,
    "code-fence content must be exempt from the scan",
  );
});
