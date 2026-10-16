/**
 * @module AciDocRenderer
 * @path packages/tool-runtime/src/aci_doc_renderer.ts
 * @description Phase 112 Step 2 — the runtime parse/fail-closed boundary for ACI
 *   (Agent-Computer Interface) tool guidance. `renderAciDocFragments` is pure: it only
 *   accepts caller-supplied `ITool[]`, performs no I/O, logging, remote discovery, or
 *   mutable caching, and re-validates every selected `ITool.aciDoc` with
 *   `AciDocSchema.safeParse` at this production consumer boundary rather than trusting
 *   the in-memory catalog. Every free-text value is JSON-string-encoded and every object
 *   key stably sorted, so delimiter-like content (newlines, backticks, quotes) can never
 *   break the surrounding prompt structure. `calculateAciDocBudgetChars` caps the
 *   aggregate render budget against the model's own prompt budget when one is available.
 * @architectural-layer Services
 * @dependencies ["@exaix/core", "@exaix/schemas"]
 * @related-files ["packages/schemas/src/aci_doc.ts", "packages/core/src/types/i_tool_registry.ts", "packages/execution/src/strategies/react_loop_strategy.ts"]
 */
import type { ITool } from "@exaix/core/types";
import { ACI_DOC_FRAGMENT_MAX_CHARS, TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";
import { type AciDoc, AciDocSchema } from "@exaix/schemas";
import type { IPromptBudget } from "@exaix/schemas";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** Result of one `renderAciDocFragments` call. */
export interface IAciRenderResult {
  /** Concatenated complete fragments, in registry order. `""` when none were included. */
  text: string;
  /** Tool IDs whose fragments were actually included, in registry order. */
  toolIds: string[];
  /** Requested, registry-known tool IDs whose ACI metadata failed validation and were omitted. */
  invalidToolIds: string[];
  fragmentCount: number;
  fragmentChars: number;
  /** True when at least one eligible fragment was dropped for exceeding a bound. */
  truncated: boolean;
}

const ACI_FRAGMENT_SEPARATOR = "\n\n";

/** Recursively JSON-stringifies `value` with object keys in stable (sorted) order. */
function stableStringify(value: JSONValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const sortedKeys = Object.keys(value).sort();
  const entries = sortedKeys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

/** Renders one tool's validated ACI doc as fixed-heading, JSON-encoded prose (no code fences). */
function renderOneFragment(toolName: string, doc: AciDoc, sideEffectScope: string): string {
  return [
    `### ${toolName}`,
    `Summary: ${JSON.stringify(doc.summary)}`,
    `When to use: ${JSON.stringify(doc.when_to_use)}`,
    `When NOT to use: ${JSON.stringify(doc.when_not_to_use)}`,
    `Side effects: ${sideEffectScope}`,
    `Example input: ${stableStringify(doc.example.input)}`,
    `Example output: ${JSON.stringify(doc.example.output)}`,
    `Example rationale: ${JSON.stringify(doc.example.rationale)}`,
    `Anti-example input (do NOT do this): ${stableStringify(doc.anti_example.input)}`,
    `Anti-example why wrong: ${JSON.stringify(doc.anti_example.why_wrong)}`,
  ].join("\n");
}

/** Renders bounded, schema-validated ACI doc fragments for requested tools in order. */
export function renderAciDocFragments(
  tools: ITool[],
  visibleToolIds: string[],
  maxChars: number,
): IAciRenderResult {
  const requestedIds = new Set(visibleToolIds);
  const orderedCandidates = tools.filter((tool) => requestedIds.has(tool.name));

  const includedToolIds: string[] = [];
  const invalidToolIds: string[] = [];
  const fragments: string[] = [];
  let usedChars = 0;
  let truncated = false;

  for (const tool of orderedCandidates) {
    const parsed = AciDocSchema.safeParse(tool.aciDoc);
    if (!parsed.success || !tool.sideEffectScope) {
      invalidToolIds.push(tool.name);
      continue;
    }

    const fragmentText = renderOneFragment(tool.name, parsed.data, tool.sideEffectScope);
    if (fragmentText.length > ACI_DOC_FRAGMENT_MAX_CHARS) {
      truncated = true;
      continue;
    }
    if (usedChars + fragmentText.length > maxChars) {
      truncated = true;
      continue;
    }

    fragments.push(fragmentText);
    includedToolIds.push(tool.name);
    usedChars += fragmentText.length;
  }

  const text = fragments.join(ACI_FRAGMENT_SEPARATOR);
  return {
    text,
    toolIds: includedToolIds,
    invalidToolIds,
    fragmentCount: includedToolIds.length,
    fragmentChars: text.length,
    truncated,
  };
}

/** Calculates aggregate character budget from configured max and prompt allocation. */
export function calculateAciDocBudgetChars(
  configuredMaxChars: number,
  promptBudget?: Opt<IPromptBudget, Reason.ExecutionConfig>,
): number {
  const loopHistoryTokens = promptBudget?.sections.loopHistory ?? 0;
  if (loopHistoryTokens <= 0) {
    return configuredMaxChars;
  }
  const loopHistoryCharBudget = loopHistoryTokens * TOKEN_ESTIMATION_CHARS_PER_TOKEN;
  return Math.min(configuredMaxChars, loopHistoryCharBudget);
}
