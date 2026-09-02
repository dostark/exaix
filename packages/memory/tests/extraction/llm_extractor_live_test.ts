/**
 * @module LlmExtractorLiveTest
 * @path packages/memory/tests/extraction/llm_extractor_live_test.ts
 * @description [live, operator-run] Extraction-quality evaluation against a real Ollama
 *   provider, closing the Reachability Ledger row `phase147-step2-extraction-quality-live`:
 *   runs the real LlmLearningExtractor (skill-guided, scratchpad-informed) against a real
 *   execution fixture, alongside the deterministic heuristic baseline, and writes the measured
 *   quality evidence to `exaix-dev-docs/evidence/phase-147/step-2-extraction-quality.json`.
 *   Not CI-run: uses the established live-provider convention — EXA_TEST_LLM_PROVIDER
 *   (explicitly set to ollama for a local model; keyed cloud providers gate on their own
 *   API key env var) and EXA_TEST_LLM_MODEL for model selection.
 * @architectural-layer Services (test)
 * @related-files ["apps/daemon/tests/phase147_cutover_live_test.ts", "packages/memory/src/extraction/llm_learning_extractor.ts"]
 */

import { assertEquals, assertExists } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { OllamaProvider } from "@exaix/ai-ollama";
import { AnthropicProvider } from "@exaix/ai-anthropic";
import { OpenAIProvider } from "@exaix/ai-openai";
import { GoogleProvider } from "@exaix/ai-google";
import type { IModelProvider } from "@exaix/ai";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { HeuristicExtractionStrategy, LlmLearningExtractor } from "@exaix/memory";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IProposalLearning } from "@exaix/schemas/memory_bank.ts";
import {
  castAny,
  createMinimalExecutionMemory,
  ENV_ANTHROPIC_API_KEY,
  ENV_GOOGLE_API_KEY,
  ENV_OPENAI_API_KEY,
  getTestLlmModel,
  getTestLlmProvider,
  initTestDbService,
} from "@exaix/testing";
import { ProviderType } from "@exaix/core";
import type { IMemoryCostRouter, ISkillsService } from "@exaix/core/types";

const POLICY_SKILL_ID = "memory-extraction-content-policy";

const testProvider = getTestLlmProvider();
const testModel = getTestLlmModel();

/** The env var name carrying the real API key for a given provider's own factory/tests. */
const API_KEY_ENV_BY_PROVIDER: Partial<Record<ProviderType, string>> = {
  [ProviderType.ANTHROPIC]: ENV_ANTHROPIC_API_KEY,
  [ProviderType.OPENAI]: ENV_OPENAI_API_KEY,
  [ProviderType.GOOGLE]: ENV_GOOGLE_API_KEY,
};

function buildTestProvider(provider: string, model: string): IModelProvider {
  if (provider === ProviderType.OLLAMA) return new OllamaProvider({ model, timeoutMs: 300_000 });
  const apiKey = provider === ProviderType.OPENAI
    ? Deno.env.get(ENV_OPENAI_API_KEY)
    : provider === ProviderType.GOOGLE
    ? Deno.env.get(ENV_GOOGLE_API_KEY)
    : Deno.env.get(ENV_ANTHROPIC_API_KEY);
  switch (provider as ProviderType) {
    case ProviderType.OPENAI:
      return new OpenAIProvider({ apiKey: apiKey ?? "", model });
    case ProviderType.GOOGLE:
      return new GoogleProvider({ apiKey: apiKey ?? "", model });
    case ProviderType.ANTHROPIC:
    default:
      return new AnthropicProvider({ apiKey: apiKey ?? "", model });
  }
}

/** Lexical markers of structural portal-knowledge facts the content-curation policy says to
 * deprioritize — used as the mechanical non-derivability proxy for the evidence file. */
const STRUCTURAL_FACT_MARKERS = ["imports", "import ", "depends on", "layer contains", "contains file"];

function loadPolicyInstructions(): string {
  const skillPath = join(
    import.meta.dirname ?? ".",
    "..",
    "..",
    "..",
    "..",
    "Memory",
    "Skills",
    "global",
    "memory-extraction-content-policy.json",
  );
  const skill = JSON.parse(Deno.readTextFileSync(skillPath)) as { instructions?: string };
  assertExists(skill.instructions, "the shipped content-curation skill must carry instructions");
  return skill.instructions;
}

/** Mechanical quality proxies (the skill's own quality criteria, applied deterministically). */
function evaluateCandidates(candidates: IProposalLearning[]) {
  const structural = candidates.filter((c) => {
    const text = `${c.title} ${c.description}`.toLowerCase();
    return STRUCTURAL_FACT_MARKERS.some((marker) => text.includes(marker));
  }).length;
  const avgQuality = candidates.length > 0
    ? candidates.reduce((sum, c) => sum + (c.quality_score ?? 0), 0) / candidates.length
    : 0;
  return {
    candidate_count: candidates.length,
    avg_quality_score: Math.round(avgQuality * 1000) / 1000,
    structural_fact_candidates: structural,
    titles: candidates.map((c) => c.title),
    categories: candidates.map((c) => c.category),
  };
}

function makeExecutionFixture(config: Config, store: ExecutionMemoryStore, traceId: string) {
  const lessons = [
    "Rate limiter resets on full restart, not per request — backoff must be process-lifetime aware",
    "Never hold the file lock across an await point; it deadlocks the flush path",
  ];
  const scratchpadNotes = [
    "Config reload needs an explicit invalidation hook, otherwise stale portals persist",
    "main.ts imports util.ts internally",
  ];
  return { lessons, scratchpadNotes, traceId, config, store };
}

const testApiKeyEnvVar = API_KEY_ENV_BY_PROVIDER[testProvider as ProviderType];

Deno.test({
  name: `[live][phase-147] live LLM extraction quality vs heuristic baseline (${testProvider}:${testModel})`,
  // Live-provider convention: keyed providers require their API key; the local ollama
  // provider requires EXA_TEST_LLM_PROVIDER=ollama explicitly.
  ignore: !(testProvider === ProviderType.OLLAMA || Boolean(testApiKeyEnvVar && Deno.env.get(testApiKeyEnvVar))),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { tempDir, cleanup } = await initTestDbService();
    try {
      const config: Config = ConfigSchema.parse({
        system: { root: tempDir },
        paths: {},
        database: {},
        watcher: {},
        agents: {},
        models: {},
        portals: [],
        mcp: {},
      });
      const provider = buildTestProvider(testProvider, testModel);
      const costRouter = castAny<IMemoryCostRouter>({
        isRemoteAllowed: () => Promise.resolve(true),
        recordOperation: () => Promise.resolve(),
      });
      const realInstructions = loadPolicyInstructions();
      const skillsService = castAny<ISkillsService>({
        getSkill: (skillId: string) =>
          Promise.resolve(skillId === POLICY_SKILL_ID ? { skill_id: skillId, instructions: realInstructions } : null),
      });

      // Real execution fixture: lessons_learned + scratchpad notes (one deliberately structural).
      const store = new ExecutionMemoryStore(config);
      const traceId = crypto.randomUUID();
      const fixture = makeExecutionFixture(config, store, traceId);
      for (const note of fixture.scratchpadNotes) {
        const appended = await store.appendNote(traceId, note);
        assertEquals(appended.success, true);
      }
      const execution = createMinimalExecutionMemory({
        trace_id: traceId,
        summary: "Executed the portal file-write flow with rate limiting and config reload handling in place.",
        lessons_learned: fixture.lessons,
      });

      // (a) Heuristic baseline — the deterministic fallback, same scratchpad input.
      const heuristic = new HeuristicExtractionStrategy(store);
      const baselineStarted = Date.now();
      const baselineCandidates = await heuristic.extract(execution);
      const baseline = {
        ...evaluateCandidates(baselineCandidates),
        duration_ms: Date.now() - baselineStarted,
      };

      // (b) Live treatment — the real skill-guided LLM extractor over the same execution.
      const extractor = new LlmLearningExtractor(provider, skillsService, costRouter, store);
      const liveStarted = Date.now();
      const liveCandidates = await extractor.extract(execution);
      const liveDuration = Date.now() - liveStarted;
      assertEquals(
        liveCandidates.length >= 1,
        true,
        `the live model must produce at least one parseable learning (got ${liveCandidates.length})`,
      );
      assertEquals(
        liveCandidates.every((c) => c.source === "llm" && c.source_id === traceId),
        true,
        "live candidates must carry real provenance",
      );
      const treatment = {
        ...evaluateCandidates(liveCandidates),
        duration_ms: liveDuration,
        model: testModel,
        provider: testProvider,
      };

      // Evidence: treatment/control-style comparison, written where the ledger row says.
      const evidence = {
        generated_at: new Date().toISOString(),
        evaluation: "phase-147 step-2 extraction quality (live vs heuristic baseline)",
        policy_skill: POLICY_SKILL_ID,
        skill_guided: true,
        scratchpad_informed: true,
        input: {
          lessons_learned: fixture.lessons.length,
          scratchpad_notes: fixture.scratchpadNotes.length,
          structural_note_included: true,
        },
        baseline_heuristic: baseline,
        treatment_llm: treatment,
        quality_delta: {
          candidate_count_delta: treatment.candidate_count - baseline.candidate_count,
          avg_quality_score_delta: Math.round(
            (treatment.avg_quality_score - baseline.avg_quality_score) * 1000,
          ) / 1000,
        },
        notes:
          "Mechanical proxies only: avg quality_score is model-reported; structural-fact counts use lexical markers from the policy's Deprioritize list. A real rubric evaluation is out of scope for this evidence run.",
      };

      const evidenceDir = join(
        import.meta.dirname ?? ".",
        "..",
        "..",
        "..",
        "..",
        "exaix-dev-docs",
        "evidence",
        "phase-147",
      );
      await ensureDir(evidenceDir);
      const evidencePath = join(evidenceDir, "step-2-extraction-quality.json");
      await Deno.writeTextFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
      console.log(`evidence written: ${evidencePath}`);
      console.log(
        JSON.stringify({ baseline: baseline.candidate_count, live: treatment.candidate_count, model: testModel }),
      );
    } finally {
      await cleanup();
    }
  },
});
