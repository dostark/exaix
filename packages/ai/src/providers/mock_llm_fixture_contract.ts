/**
 * @module MockLLMFixtureContract
 * @path packages/ai/src/providers/mock_llm_fixture_contract.ts
 * @description The recorded-fixture contract of the mock provider: field validation, input expectations, call site keys and the judge response check.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts, packages/ai/src/providers/fixture_reports.ts]
 */

import type { JSONValue } from "@exaix/core";
import type {
  ICallSite,
  IModelOptions,
  IProviderAssistantReplay,
  IProviderToolRound,
  IProviderTurn,
} from "../types.ts";
import type { IProviderToolCall } from "./common.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { validateJudgeResponse } from "./judge_response_contract.ts";
import { disablesParallelToolUse } from "../provider_common_utils.ts";
import type { IRecordedInputExpectation, IRecordedResponse, IRecordedRoundCall } from "./mock_llm_provider.ts";

const INPUT_EXPECTATION_KEYS: readonly (keyof IRecordedInputExpectation)[] = [
  "promptIncludes",
  "promptExcludes",
  "priorTurnResultIncludes",
  "priorTurnResultExcludes",
  "priorRoundCalls",
  "priorRoundArtifactIds",
  "expectedParallelDisabled",
];

// Custom Error Type

/**
 * Error thrown by MockLLMProvider
 */
export class MockLLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockLLMError";
  }
}

// MockLLMProvider Implementation

/** Stable key of a call site, matched against options.callSite. The flow step id keeps parallel steps apart. */
export function callSiteKey(callSite: ICallSite): string {
  return `${callSite.scenarioId}::${callSite.stepId}::${callSite.flowStepId ?? ""}::${callSite.callIndex}`;
}

/** Human-readable call site, used in error messages and drift warnings. Exported so capture's
 *  own error messages describe a call site identically to replay's. */
export function describeCallSite(callSite: ICallSite): string {
  const flowSegment = callSite.flowStepId ? `/${callSite.flowStepId}` : "";
  return `${callSite.scenarioId}/${callSite.stepId}${flowSegment}#${callSite.callIndex}`;
}

/** True when the value has every field that IRecordedResponse.callSite requires. */
function isValidCallSite(value: Opt<Partial<ICallSite>, Reason.OptionalInput>): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (value.flowStepId !== undefined && typeof value.flowStepId !== "string") return false;
  return typeof value.scenarioId === "string" &&
    typeof value.stepId === "string" &&
    typeof value.callIndex === "number";
}

/** Describes why a recording's toolCalls are malformed, or returns null for well-formed entries. */
function toolCallsValidationError(
  value: Opt<IProviderToolCall[], Reason.OptionalInput>,
): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "toolCalls is present but not an array";
  for (let index = 0; index < value.length; index++) {
    const call = value[index];
    if (
      typeof call !== "object" || call === null || typeof call.id !== "string" ||
      typeof call.name !== "string" || typeof call.input !== "object" || call.input === null
    ) {
      return `toolCalls[${index}] is malformed — expected { id: string, name: string, input: object }`;
    }
  }
  return null;
}

/** Validates a recording's expectedInput field. Returns a failure or null when well formed. */
function expectedInputValidationError(value: Opt<JSONValue, Reason.OptionalInput>): string | null {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "expectedInput is present but not an object";
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!(INPUT_EXPECTATION_KEYS as readonly string[]).includes(key)) {
      return `expectedInput has unknown field "${key}"`;
    }
    const error = expectationFieldError(key, entry);
    if (error) return error;
  }
  return null;
}

/** Validates one expectedInput field by its contract. Returns a failure or null when well formed. */
function expectationFieldError(key: string, entry: JSONValue): string | null {
  if (key === "expectedParallelDisabled") {
    return typeof entry === "boolean" ? null : `expectedInput.${key} must be a boolean`;
  }
  if (key === "priorRoundCalls") return roundCallsFieldError(entry);
  return Array.isArray(entry) && entry.every((item) => typeof item === "string")
    ? null
    : `expectedInput.${key} must be an array of strings`;
}

/** True when a priorRoundCalls entry carries every field a round call needs. */
function isCompleteRoundCall(item: JSONValue): boolean {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
  const { toolUseId, toolName, resultIncludes, index, input } = item;
  return typeof toolUseId === "string" && typeof toolName === "string" && typeof resultIncludes === "string" &&
    typeof index === "number" && Number.isInteger(index) && index >= 0 &&
    typeof input === "object" && input !== null && !Array.isArray(input);
}

/** Validates the priorRoundCalls field: an array of complete round-call objects. */
function roundCallsFieldError(entry: JSONValue): string | null {
  if (!Array.isArray(entry)) return "expectedInput.priorRoundCalls must be an array of round calls";
  const position = entry.findIndex((item) => !isCompleteRoundCall(item));
  return position === -1
    ? null
    : `expectedInput.priorRoundCalls[${position}] needs toolUseId, index, toolName, input and resultIncludes`;
}

/** The prior-turn tool result as text. Rich content blocks are serialized. */
function priorTurnResultText(priorTurn: IProviderTurn): string {
  const content = priorTurn.toolResultContent;
  return typeof content === "string" ? content : JSON.stringify(content);
}

/** Checks one input against its include and exclude substrings. Returns a failure or null. */
function substringMismatch(
  label: string,
  text: string,
  includes: readonly string[] = [],
  excludes: readonly string[] = [],
): string | null {
  const missing = includes.find((needle) => !text.includes(needle));
  if (missing !== undefined) return `${label} does not include "${missing}"`;
  const present = excludes.find((needle) => text.includes(needle));
  return present === undefined ? null : `${label} includes the excluded "${present}"`;
}

/** The text of one tool result, for an include or exclude substring. */
function resultContentText(content: string | readonly object[]): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

/** The joined results of a replayed round, in call order. */
function roundResultsText(round: IProviderToolRound): string {
  return round.calls.map((call) => resultContentText(call.toolResultContent)).join("\n");
}

/** The prior-turn check: a priorTurn result when present, else the replayed round's results. */
function priorResultMismatch(
  expected: IRecordedInputExpectation,
  options: Opt<IModelOptions, Reason.OptionalInput>,
): string | null {
  if (options?.priorTurn) {
    return substringMismatch(
      "priorTurn result",
      priorTurnResultText(options.priorTurn),
      expected.priorTurnResultIncludes,
      expected.priorTurnResultExcludes,
    );
  }
  if (options?.priorRound) {
    return substringMismatch(
      "priorRound result",
      roundResultsText(options.priorRound),
      expected.priorTurnResultIncludes,
      expected.priorTurnResultExcludes,
    );
  }
  return (expected.priorTurnResultIncludes ?? []).length > 0 ? "the call has no priorTurn tool result" : null;
}

/** The replayed round's calls against the expectation: count first, then each call in order. */
function roundCallsMismatch(
  expected: readonly IRecordedRoundCall[],
  round: Opt<IProviderToolRound, Reason.OptionalInput>,
): string | null {
  if (!round) return "the call replays no round";
  if (round.calls.length !== expected.length) {
    return `the replayed round has ${round.calls.length} calls, expected ${expected.length}`;
  }
  for (const [position, want] of expected.entries()) {
    const got = round.calls[position];
    const label = `round call ${position} (${want.toolUseId})`;
    if (got.toolUseId !== want.toolUseId || got.index !== want.index || got.toolName !== want.toolName) {
      return `${label} does not match: got id ${got.toolUseId}, index ${got.index}, tool ${got.toolName}`;
    }
    if (JSON.stringify(got.toolInput) !== JSON.stringify(want.input)) return `${label} carried a different input`;
    const resultError = substringMismatch(`${label} result`, resultContentText(got.toolResultContent), [
      want.resultIncludes,
    ]);
    if (resultError) return resultError;
  }
  return null;
}

/** The tool-use ids an assistant artifact carries, in order. */
function assistantToolUseIds(replay: IProviderAssistantReplay): string[] {
  if (replay.provider === "google") return [];
  if (replay.provider === "anthropic") {
    return replay.blocks.filter((block) => block.type === "tool_use").map((block) => String(block.id));
  }
  return replay.toolCalls.map((call) => String(call.id));
}

/** The artifact check: the replayed assistant artifact carries exactly the expected call ids. */
function artifactIdsMismatch(
  expectedIds: readonly string[],
  round: Opt<IProviderToolRound, Reason.OptionalInput>,
): string | null {
  if (!round) return "the call replays no round, so there is no assistant artifact";
  const actual = assistantToolUseIds(round.assistant);
  return JSON.stringify(actual) === JSON.stringify(expectedIds)
    ? null
    : `the replayed assistant artifact carries ${JSON.stringify(actual)}, expected ${JSON.stringify(expectedIds)}`;
}

/** The assistant artifact a recorded tool round carries, in the OpenAI Chat wire shape. */
export function assistantArtifactOf(toolCalls: IProviderToolCall[]): IProviderAssistantReplay {
  return {
    provider: "openai-chat",
    assistantContent: null,
    toolCalls: toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.input) },
    })),
  };
}

const PARALLEL_DISABLED_REQUIRED = "the request must disable parallel tool calls";
const PARALLEL_DISABLED_FORBIDDEN = "the request must keep parallel tool calls enabled";

/** Enforces a recording's expectedInput against the actual prompt, request options, and replayed
 *  priorTurn or priorRound. */
export function assertExpectedInput(
  recording: IRecordedResponse,
  prompt: string,
  options: Opt<IModelOptions, Reason.OptionalInput>,
  where: string,
): void {
  const expected = recording.expectedInput;
  if (!expected) return;
  const fail = (reason: string): never => {
    throw new MockLLMError(`Fixture input expectation failed at ${where}: ${reason}.`);
  };
  const promptError = substringMismatch("prompt", prompt, expected.promptIncludes, expected.promptExcludes);
  if (promptError) fail(promptError);
  const priorError = priorResultMismatch(expected, options);
  if (priorError) fail(priorError);
  if (expected.priorRoundCalls) {
    const roundError = roundCallsMismatch(expected.priorRoundCalls, options?.priorRound);
    if (roundError) fail(roundError);
  }
  if (expected.priorRoundArtifactIds) {
    const artifactError = artifactIdsMismatch(expected.priorRoundArtifactIds, options?.priorRound);
    if (artifactError) fail(artifactError);
  }
  if (expected.expectedParallelDisabled !== undefined) {
    const disabled = disablesParallelToolUse(options?.toolChoice);
    if (disabled !== expected.expectedParallelDisabled) {
      fail(expected.expectedParallelDisabled ? PARALLEL_DISABLED_REQUIRED : PARALLEL_DISABLED_FORBIDDEN);
    }
  }
}

function recordedErrorValidationError<TError>(error: Opt<TError, Reason.OptionalInput>): string | null {
  if (error === undefined) return null;
  return typeof error === "string" && error.length > 0 ? null : "error must be a non-empty string when present";
}

function recordedCostValidationError(cost: Opt<number, Reason.OptionalInput>): string | null {
  if (cost === undefined) return null;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? null
    : "cost_usd must be a finite non-negative number";
}

const REQUIRED_STRING_FIELDS = ["promptHash", "promptPreview", "response", "recordedAt"] as const;

/** The first missing required field of a recording, or null when all of them are well formed. */
function requiredFieldError(candidate: Partial<IRecordedResponse>): string | null {
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof candidate[field] !== "string") return `missing string field ${field}`;
  }
  if (typeof candidate.model !== "string") return "missing string field model";
  const tokens = candidate.tokens;
  if (
    typeof tokens !== "object" || tokens === null || typeof tokens.input !== "number" ||
    typeof tokens.output !== "number"
  ) {
    return "missing or malformed tokens: { input: number, output: number }";
  }
  if (candidate.callSite !== undefined && !isValidCallSite(candidate.callSite)) {
    return "callSite is present but malformed — expected { scenarioId, stepId, callIndex, flowStepId? }";
  }
  return null;
}

/** Validates a loaded fixture file against the IRecordedResponse contract, naming the file on failure. */
export function validateRecordedResponse(value: JSONValue, filePath: string): IRecordedResponse {
  const fail = (reason: string): never => {
    throw new MockLLMError(`Corrupt fixture file "${filePath}": ${reason}.`);
  };
  if (typeof value !== "object" || value === null) fail("not a JSON object");
  const candidate = value as Partial<IRecordedResponse>;
  const fieldError = requiredFieldError(candidate) ??
    recordedErrorValidationError(candidate.error) ??
    recordedCostValidationError(candidate.cost_usd) ??
    toolCallsValidationError(candidate.toolCalls) ??
    expectedInputValidationError(candidate.expectedInput as Opt<JSONValue, Reason.OptionalInput>);
  if (fieldError) fail(fieldError);
  return candidate as IRecordedResponse;
}

/** Strict replay addresses each call site once, so two recordings for one key are ambiguous. */
export function assertUniqueCallSites(recordings: IRecordedResponse[]): void {
  const seen = new Set<string>();
  for (const recording of recordings) {
    if (!recording.callSite) continue;
    const key = callSiteKey(recording.callSite);
    if (seen.has(key)) {
      throw new MockLLMError(`Duplicate keyed recording for call site ${describeCallSite(recording.callSite)}.`);
    }
    seen.add(key);
  }
}

/** A judge caller receives raw criterion JSON. An agent-dialect recording at its call site is a fixture error. */
export function assertResponseContract(
  recording: IRecordedResponse,
  contract: Opt<IModelOptions["responseContract"], Reason.OptionalInput>,
  callSite: ICallSite,
): void {
  if (contract?.kind !== "judge-json") return;
  const violation = validateJudgeResponse(recording.response, contract.criteria);
  if (violation) {
    throw new MockLLMError(
      `Recording at call site ${describeCallSite(callSite)} violates the judge contract: ${violation}`,
    );
  }
}
