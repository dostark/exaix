#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL0Reference
 * @path scripts/go_port/core_l0_reference.ts
 * @description Generates deterministic JSON reference fixtures from the pinned a956e0c8a packages/core Layer 0 exports for Go differential tests.
 * Usage: deno run -A scripts/go_port/core_l0_reference.ts [--target=<dir>]
 */
import { join, resolve } from "@std/path";
import { argValue } from "./cli_args.ts";
import { buildVocabularySymbols } from "./core_l0_vocabulary_symbols.ts";
import {
  CAP_EXTENDED_LANG_EXTRACTION,
  CAP_GUARDRAIL_ADVANCED,
  CAP_HITL_GOVERNANCE,
  CAP_MODEL_REGISTRY_GOVERNANCE,
  CAP_MODEL_REGISTRY_LIVE,
  CAP_MODEL_ROUTING_RIGOR,
  CAP_OTEL_EXPORT,
  CAP_SYMBOL_LEVEL_DEPENDENCY_GRAPH,
  CAP_VOTING,
  CAPABILITY_EDITION,
  isCapabilityAvailable,
  isCapabilityEligible,
} from "@exaix/core/composer";
import {
  RequestCancelNotAllowedError,
  RequestIdError,
  RequestNotFoundError,
  RequestStatusInvalidError,
} from "@exaix/core/errors";
import {
  renderCriticalSkillsSection,
  renderSkillEntry,
  renderSkillsSection,
  SKILL_EXAMPLES_HEADING,
  splitInstructionsAndExamples,
  stripExamplesSection,
  TokenCounter,
} from "@exaix/core/func";
import { FrontmatterParser } from "@exaix/core/parsing";
import { MIN_REQUEST_ID_PREFIX_CHARS } from "@exaix/core/request";
import { RequestStatus } from "@exaix/core/status";
import {
  COST_RATE_ANTHROPIC,
  COST_RATE_GOOGLE,
  COST_RATE_GOOGLE_INPUT,
  COST_RATE_LLAMACPP,
  COST_RATE_MOCK,
  COST_RATE_OLLAMA,
  COST_RATE_OPENAI,
  COST_RATE_OPENROUTER,
  COST_RATE_VERTEX,
  EDITION_ENTERPRISE,
  EDITION_SOLO,
  EDITION_TEAM,
  type ISkillsContext,
  PERCENT_SCALE,
  ProviderType,
  SkillMatchSource,
  SkillRootKind,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
  TOKENS_PER_COST_UNIT,
  TOKENS_PER_MTOK,
} from "@exaix/core/types";

export const CORE_L0_REFERENCE_GROUPS: readonly string[] = [
  "vocabulary",
  "errors",
  "prompts",
  "parsing",
  "cost",
  "capabilities",
  "request",
];

const REFERENCE_PARENT = "a956e0c8a413919cd0be3099eaec83e2b100b9fc";
const DEFAULT_TARGET = join("exaix-go", "internal", "core", "l0", "testdata", "reference");
const REPO_ROOT = resolve(join(import.meta.dirname ?? ".", "..", ".."));

async function sha256Hex(content: string): Promise<string> {
  const buf = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildVocabularyFixture(root: string): Promise<object> {
  return {
    editions: {
      solo: EDITION_SOLO,
      team: EDITION_TEAM,
      enterprise: EDITION_ENTERPRISE,
    },
    cost_constants: {
      tokens_per_cost_unit: TOKENS_PER_COST_UNIT,
      tokens_per_mtok: TOKENS_PER_MTOK,
      percent_scale: PERCENT_SCALE,
      token_estimation_chars_per_token: TOKEN_ESTIMATION_CHARS_PER_TOKEN,
      min_request_id_prefix_chars: MIN_REQUEST_ID_PREFIX_CHARS,
      skill_examples_heading: SKILL_EXAMPLES_HEADING,
    },
    default_rates: {
      anthropic: COST_RATE_ANTHROPIC,
      openai: COST_RATE_OPENAI,
      google: COST_RATE_GOOGLE,
      google_input: COST_RATE_GOOGLE_INPUT,
      ollama: COST_RATE_OLLAMA,
      llamacpp: COST_RATE_LLAMACPP,
      openrouter: COST_RATE_OPENROUTER,
      vertex: COST_RATE_VERTEX,
      mock: COST_RATE_MOCK,
    },
    provider_types: {
      anthropic: ProviderType.ANTHROPIC,
      openai: ProviderType.OPENAI,
      google: ProviderType.GOOGLE,
      ollama: ProviderType.OLLAMA,
      llamacpp: ProviderType.LLAMACPP,
      openrouter: ProviderType.OPENROUTER,
      vertex: ProviderType.VERTEX,
      mock: ProviderType.MOCK,
    },
    symbols: await buildVocabularySymbols(root),
  };
}

function buildErrorsFixture(): object {
  const cancelCases = [
    { request_id: "req-1", status: RequestStatus.PLANNED },
    { request_id: "req-2", status: RequestStatus.ANALYZING },
    { request_id: "req-3", status: RequestStatus.IN_PROGRESS },
    { request_id: "req-4", status: RequestStatus.COMPLETED },
  ].map((tc) => {
    const err = new RequestCancelNotAllowedError(tc.request_id, tc.status);
    return { ...tc, name: err.name, message: err.message };
  });

  const notFound = new RequestNotFoundError("req-missing");
  const invalidStatus = new RequestStatusInvalidError("req-bad");
  const idErr = new RequestIdError("Ambiguous prefix", ["req-a1", "req-a2"]);

  return {
    cancel_not_allowed: cancelCases,
    not_found: { request_id: notFound.requestId, name: notFound.name, message: notFound.message },
    status_invalid: { request_id: invalidStatus.requestId, name: invalidStatus.name, message: invalidStatus.message },
    id_error: { name: idErr.name, message: idErr.message, matches: idErr.matches },
  };
}

function buildPromptsFixture(): object {
  const bodyWithExamples = "Follow rule A.\n\n## Examples\nExample 1\n\n## Constraints\nKeep it pure.";
  const bodyTrailingExamples = "Follow rule B.\n\n## Examples\nOnly example.";
  const bodyNoExamples = "Plain body without examples.";

  const skillsContext: ISkillsContext = {
    totalAvailable: 4,
    retrievalLatencyMs: 12,
    matched: [
      {
        skillId: "go-tdd",
        revisionId: "11111111-2222-4333-8444-555555555555",
        contentSha256: "a".repeat(64),
        rootKind: SkillRootKind.PROJECT,
        sourcePath: "skills/go-tdd",
        name: "go-tdd",
        description: "Test-driven Go workflow",
        content: bodyWithExamples,
        confidence: 0.9,
        matchedTriggers: {},
        source: SkillMatchSource.MATCHED,
        tags: ["go", "tdd"],
        critical: false,
        references: [
          { path: "refs/b.md", content: "B ref", linked: true },
          { path: "refs/a.md", content: "A ref", linked: true },
          { path: "refs/unlinked.md", content: "Hidden", linked: false },
        ],
      },
      {
        skillId: "sec-hard",
        revisionId: "22222222-3333-4444-8555-666666666666",
        contentSha256: "b".repeat(64),
        rootKind: SkillRootKind.BLUEPRINT,
        sourcePath: "skills/sec-hard",
        name: "sec-hard",
        description: "Hard security contract",
        content: bodyTrailingExamples,
        confidence: 1.0,
        matchedTriggers: {},
        source: SkillMatchSource.PINNED,
        tags: ["security"],
        critical: true,
        references: [],
      },
    ],
  };

  const counter = new TokenCounter();
  return {
    split_and_strip: [bodyWithExamples, bodyTrailingExamples, bodyNoExamples].map((body) => ({
      body,
      split: splitInstructionsAndExamples(body),
      stripped: stripExamplesSection(body),
    })),
    render_skill_entry_full: renderSkillEntry(skillsContext.matched[0], true),
    render_skill_entry_trimmed: renderSkillEntry(skillsContext.matched[0], false),
    render_skills_section_full: renderSkillsSection(skillsContext, false),
    render_skills_section_trimmed: renderSkillsSection(skillsContext, true),
    render_critical_skills_section: renderCriticalSkillsSection(skillsContext),
    token_counts: ["", "a", "abcd", "abcde", "hello world 12345"].map((text) => ({
      text,
      tokens: counter.countTokens(text),
    })),
  };
}

function buildParsingFixture(): object {
  const parser = new FrontmatterParser();
  const validMd =
    `---\ntitle: "Test Request"\ntrace_id: "11111111-2222-4333-8444-555555555555"\nagent_role: "senior-coder"\nstatus: "pending"\n---\n\n# Body\nDo the work.\n`;
  const parsed = parser.parse(validMd);

  const invalidCases = [
    { name: "no_frontmatter", input: "# Just markdown\nNo frontmatter here." },
    { name: "non_object_yaml", input: "---\n- a\n- b\n---\nbody" },
  ].map((tc) => {
    let error = "";
    try {
      parser.parse(tc.input);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return { name: tc.name, input: tc.input, error };
  });

  return {
    valid: {
      input: validMd,
      body: parsed.body,
      trace_id: parsed.request.trace_id,
      agent_role: parsed.request.agent_role,
      status: parsed.request.status,
    },
    invalid: invalidCases,
  };
}

function buildCostFixture(): object {
  const defaultRates: Record<string, number> = {
    [ProviderType.ANTHROPIC]: COST_RATE_ANTHROPIC,
    [ProviderType.OPENAI]: COST_RATE_OPENAI,
    [ProviderType.GOOGLE]: COST_RATE_GOOGLE,
    [ProviderType.OLLAMA]: COST_RATE_OLLAMA,
    [ProviderType.LLAMACPP]: COST_RATE_LLAMACPP,
    [ProviderType.OPENROUTER]: COST_RATE_OPENROUTER,
    [ProviderType.VERTEX]: COST_RATE_VERTEX,
    [ProviderType.MOCK]: COST_RATE_MOCK,
  };
  const estimateCases = [
    { provider: ProviderType.ANTHROPIC, tokens: 1000, prompt_tokens: 400 },
    { provider: ProviderType.OPENAI, tokens: 2500, prompt_tokens: 1000 },
    { provider: ProviderType.GOOGLE, tokens: 1000, prompt_tokens: 600 },
    { provider: ProviderType.GOOGLE, tokens: 500, prompt_tokens: 800 },
    { provider: ProviderType.OLLAMA, tokens: 10000, prompt_tokens: 5000 },
  ].map((tc) => {
    const rate = defaultRates[tc.provider] ?? 0;
    const cost = tc.provider === ProviderType.GOOGLE
      ? (Math.min(tc.prompt_tokens, tc.tokens) * COST_RATE_GOOGLE_INPUT +
        (tc.tokens - Math.min(tc.prompt_tokens, tc.tokens)) * rate) / TOKENS_PER_COST_UNIT
      : rate * (tc.tokens / TOKENS_PER_COST_UNIT);
    return { ...tc, cost_usd: cost };
  });

  const splitCases = [
    { input_per_mtok: 3.0, output_per_mtok: 15.0, prompt_tokens: 100000, completion_tokens: 50000 },
    { input_per_mtok: 0.15, output_per_mtok: 0.6, prompt_tokens: 12345, completion_tokens: 6789 },
  ].map((tc) => ({
    ...tc,
    cost_usd: (tc.input_per_mtok * tc.prompt_tokens) / TOKENS_PER_MTOK +
      (tc.output_per_mtok * tc.completion_tokens) / TOKENS_PER_MTOK,
  }));

  const divergenceCases = [
    { reported: 1.2, computed: 1.0, tolerance_pct: 15 },
    { reported: 1.05, computed: 1.0, tolerance_pct: 15 },
  ].map((tc) => {
    const deltaPct = (Math.abs(tc.reported - tc.computed) / tc.computed) * PERCENT_SCALE;
    return { ...tc, delta_pct: deltaPct, exceeds: deltaPct > tc.tolerance_pct };
  });

  return {
    estimate_cases: estimateCases,
    split_price_cases: splitCases,
    divergence_cases: divergenceCases,
  };
}

function buildCapabilitiesFixture(): object {
  const caps = [
    CAP_VOTING,
    CAP_HITL_GOVERNANCE,
    CAP_GUARDRAIL_ADVANCED,
    CAP_EXTENDED_LANG_EXTRACTION,
    CAP_MODEL_REGISTRY_LIVE,
    CAP_MODEL_ROUTING_RIGOR,
    CAP_MODEL_REGISTRY_GOVERNANCE,
    CAP_OTEL_EXPORT,
    CAP_SYMBOL_LEVEL_DEPENDENCY_GRAPH,
    "unknown_capability",
  ];
  const editions = [EDITION_SOLO, EDITION_TEAM, EDITION_ENTERPRISE, "unknown", ""];
  const matrix = caps.flatMap((capability) =>
    editions.map((edition) => ({
      capability,
      edition,
      eligible: isCapabilityEligible(capability, edition || undefined),
      available_when_installed: isCapabilityAvailable(capability, edition || undefined, new Set([capability])),
      available_when_not_installed: isCapabilityAvailable(capability, edition || undefined, new Set()),
    }))
  );
  return {
    capability_edition: CAPABILITY_EDITION,
    matrix,
  };
}

function buildRequestFixture(): object {
  const backoffCases = [
    { base_ms: 1000, max_ms: 30000, multiplier: 2, jitter_factor: 0.25, attempt: 0, jitter_sample: 0.5 },
    { base_ms: 1000, max_ms: 30000, multiplier: 2, jitter_factor: 0.25, attempt: 3, jitter_sample: 0.0 },
    { base_ms: 1000, max_ms: 30000, multiplier: 2, jitter_factor: 0.25, attempt: 6, jitter_sample: 1.0 },
  ].map((tc) => {
    const raw = tc.base_ms * Math.pow(tc.multiplier, tc.attempt);
    const capped = Math.min(raw, tc.max_ms);
    const delay = capped + capped * tc.jitter_factor * tc.jitter_sample;
    return { ...tc, delay_ms: delay };
  });
  return {
    min_request_id_prefix_chars: MIN_REQUEST_ID_PREFIX_CHARS,
    backoff_cases: backoffCases,
  };
}

export async function writeCoreL0Reference(root: string, targetDir: string): Promise<void> {
  await Deno.mkdir(targetDir, { recursive: true });
  const generators: Record<string, () => object | Promise<object>> = {
    vocabulary: () => buildVocabularyFixture(root),
    errors: buildErrorsFixture,
    prompts: buildPromptsFixture,
    parsing: buildParsingFixture,
    cost: buildCostFixture,
    capabilities: buildCapabilitiesFixture,
    request: buildRequestFixture,
  };
  const files: Record<string, string> = {};
  for (const group of CORE_L0_REFERENCE_GROUPS) {
    const filename = `${group}.json`;
    const body = `${JSON.stringify(await generators[group](), null, 2)}\n`;
    await Deno.writeTextFile(join(targetDir, filename), body);
    files[filename] = await sha256Hex(body);
  }
  const manifest = {
    schema_version: 1,
    reference_parent: REFERENCE_PARENT,
    files,
  };
  await Deno.writeTextFile(join(targetDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main(args: readonly string[]): Promise<number> {
  const target = resolve(argValue(args, "target") ?? join(REPO_ROOT, DEFAULT_TARGET));
  await writeCoreL0Reference(REPO_ROOT, target);
  console.log(`✅ ${target}`);
  return 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
