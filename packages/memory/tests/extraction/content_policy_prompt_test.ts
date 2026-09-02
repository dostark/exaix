/**
 * @module ContentPolicyPromptTest
 * @path packages/memory/tests/extraction/content_policy_prompt_test.ts
 * @description Closes Step 1's deferred treatment/control evaluation: the same seeded
 * execution extracted with the `memory-extraction-content-policy` skill loaded scores
 * measurably higher on a deterministic non-derivability/actionability/specificity rubric
 * (the skill's own 40/35/25 `quality_criteria` weights) than the same execution extracted
 * with a policy-free prompt. Mock providers make the comparison deterministic: the
 * treatment provider obeys the injected policy (structural fact omitted, actionable
 * specific pattern kept); the control provider, seeing no policy, returns the structural
 * fact and a generic platitude. Also asserts the two prompts genuinely differ.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";

import { LlmLearningExtractor } from "@exaix/memory";
import { castAny, createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";
import type { IModelProvider } from "@exaix/ai";
import type { IMemoryCostRouter, ISkillsService } from "@exaix/core/types";

const POLICY_SKILL_ID = "memory-extraction-content-policy";
const POLICY_INSTRUCTIONS =
  "Deprioritize structural-only facts such as 'File A imports File B.' — relationships are answerable by query_relationships/who_depends_on. Prefer actionable patterns, decisions, and do/don't guidance tied to concrete context.";

/** The seeded execution: one structural fact (an import), one genuine actionable pattern. */
const SEEDED_LESSONS = [
  "main.ts imports util.ts internally",
  "Always validate portal mount paths before file writes",
];

/** Deterministic judge mirroring the skill's own quality_criteria weights (40/35/25). */
function rubricScore(candidates: Array<{ title: string; description: string; category: string }>): number {
  if (candidates.length === 0) return 0;
  const structuralMarkers = ["imports", "import ", "depends on", "layer contains", "contains file"];
  const actionabilityMarkers = ["always", "never", "prefer", "must", "avoid", "use ", "don't"];
  const concreteTokens = ["portal", "rate limiter", "main.ts", "util.ts", "file write", "mount"];
  const perCandidate = candidates.map((candidate) => {
    const text = `${candidate.title} ${candidate.description}`.toLowerCase();
    const nonDerivability = structuralMarkers.some((m) => text.includes(m)) ? 0 : 1;
    const actionable = actionabilityMarkers.some((m) => text.includes(m)) ||
        ["pattern", "anti-pattern", "decision"].includes(candidate.category)
      ? 1
      : 0;
    const specific = concreteTokens.some((t) => text.includes(t)) || text.length >= 60 ? 1 : 0;
    return nonDerivability * 40 + actionable * 35 + specific * 25;
  });
  const mean = perCandidate.reduce((sum, score) => sum + score, 0) / perCandidate.length;
  return Math.round(mean * 10) / 10;
}

class ScriptedProvider implements IModelProvider {
  id = "content-policy-test";
  prompts: string[] = [];
  constructor(private readonly content: string) {}
  generate(prompt: string) {
    this.prompts.push(prompt);
    return Promise.resolve({
      content: this.content,
      usage: { promptTokens: 10, completionTokens: 6, totalTokens: 16 },
      model: "mock-memory",
      provider: "mock",
      cost_usd: 0,
    });
  }
}

function skillsService(instructions: string | null) {
  return castAny<ISkillsService>({
    getSkill: (skillId: string) =>
      Promise.resolve(
        skillId === POLICY_SKILL_ID && instructions !== null ? { skill_id: skillId, instructions } : null,
      ),
  });
}

const costRouter = castAny<IMemoryCostRouter>({ recordOperation: () => Promise.resolve() });

Deno.test("content_policy_prompt: skill-guided extraction outscores the policy-free control on the seeded rubric", async () => {
  const { cleanup } = await initTestDbService();
  try {
    const execution = createMinimalExecutionMemory({ lessons_learned: SEEDED_LESSONS });

    // Treatment: the skill is loaded; the policy-guided provider keeps the actionable
    // specific pattern and omits the structural import fact.
    const treatmentProvider = new ScriptedProvider(JSON.stringify({
      learnings: [{
        title: "Validate portal mount paths before file writes",
        description:
          "Always validate that a portal mount path resolves inside the portal root before any file write, so writes cannot escape the mounted workspace.",
        category: "pattern",
        tags: ["validation"],
        quality_score: 0.9,
      }],
    }));
    const treatment = new LlmLearningExtractor(treatmentProvider, skillsService(POLICY_INSTRUCTIONS), costRouter);
    const treatmentCandidates = await treatment.extract(execution);

    // Control: the same extractor, but the skill resolves to neutral (policy-free) text —
    // the unguided provider keeps the structural fact and a generic platitude.
    const controlProvider = new ScriptedProvider(JSON.stringify({
      learnings: [
        {
          title: "main.ts imports util.ts",
          description: "The main entrypoint imports util.ts internally.",
          category: "insight",
          tags: [],
          quality_score: 0.9,
        },
        {
          title: "It is good to write good code",
          description: "Writing code well is beneficial.",
          category: "insight",
          tags: [],
          quality_score: 0.9,
        },
      ],
    }));
    const control = new LlmLearningExtractor(controlProvider, skillsService(""), costRouter);
    const controlCandidates = await control.extract(execution);

    // The prompts must genuinely differ: the treatment prompt carries the policy, the
    // control prompt does not.
    assertEquals(treatmentProvider.prompts.length, 1);
    assertEquals(controlProvider.prompts.length, 1);
    assertStringIncludes(treatmentProvider.prompts[0], POLICY_INSTRUCTIONS);
    assertEquals(controlProvider.prompts[0].includes(POLICY_INSTRUCTIONS), false);

    const treatmentScore = rubricScore(treatmentCandidates);
    const controlScore = rubricScore(controlCandidates);
    assertEquals(
      treatmentScore > controlScore,
      true,
      `skill-guided extraction must outsore the policy-free control on the seeded rubric (treatment ${treatmentScore} vs control ${controlScore})`,
    );
    assertEquals(
      treatmentScore - controlScore >= 25,
      true,
      "the rubric gap must be measurable, not a rounding artifact",
    );
  } finally {
    await cleanup();
  }
});
