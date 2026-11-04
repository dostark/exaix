/**
 * @module MockLLMProvider
 * @path packages/ai/src/providers/mock_llm_provider.ts
 * @description Deterministic LLM provider for testing, supporting multiple strategies:
 * - "recorded": Replay real LLM responses.
 * - "scripted": Fixed sequence of responses.
 * - "pattern": Dynamic responses based on prompt.
 * - "failing": Simulate API failures.
 * - "slow": Simulate network latency.
 * @architectural-layer AI
 * @related-files [packages/ai/src/factories/mock_factory.ts, packages/ai/tests/providers/mock_llm_provider_test.ts]
 */

import { assertNoNativeConversation } from "../provider_registry.ts";
import { MockStrategy } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import type { ICallSite, IModelOptions, IModelProvider } from "../types.ts";
import type { IGenerateResult, IProviderToolCall } from "./common.ts";
import {
  DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD,
  MOCK_DELAY_MS,
  MOCK_INPUT_TOKENS,
  MOCK_OUTPUT_TOKENS,
} from "@exaix/ai";
import { ToolName } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

import {
  assertExpectedInput,
  assertResponseContract,
  assertUniqueCallSites,
  assistantArtifactOf,
  callSiteKey,
  describeCallSite,
  MockLLMError,
  validateRecordedResponse,
} from "./mock_llm_fixture_contract.ts";
import { defaultMockPatterns } from "./mock_llm_patterns.ts";

// Types and Interfaces

/**
 * Recorded response from a real LLM call
 */
export interface IRecordedResponse {
  /** Hash of the prompt for lookup */
  promptHash: string;
  /** Preview of the prompt for debugging */
  promptPreview: string;
  /** The actual response from the LLM */
  response: string;
  /** Model that generated the response */
  model: string;
  /** Token counts */
  tokens: { input: number; output: number };
  /** Explicit recorded price, including zero. Omitted recordings retain registry-based costing. */
  cost_usd?: number;
  /** When this was recorded */
  recordedAt: string;
  /** Where this recording was captured. When present, lookup addresses by call site instead
   *  of prompt hash; the hash is still compared on replay to detect drift. */
  callSite?: ICallSite;
  /** Native tool calls the recorded model made. Surfaced on IGenerateResult.toolCalls only
   *  when the caller requested tools via IModelOptions.tools; otherwise ignored (matches the
   *  IGenerateResult.toolCalls contract). */
  toolCalls?: IProviderToolCall[];
  /** A recorded provider failure. Replay throws it after the input expectation check. */
  error?: string;
  /** Retry metadata from capture: how many attempts it took to get a contract-satisfying
   *  response, and why the earlier ones were refused. The rate this represents across a
   *  fixture set is a product finding, not noise to smooth away. */
  capture?: { attempts: number; failures: string[] };
  /** Assertions on the actual provider input, checked before this recording replays. */
  expectedInput?: IRecordedInputExpectation;
}

/** One call of a replayed round: its id, position, tool and exact input.
 *  Its result must include a substring. */
export interface IRecordedRoundCall {
  toolUseId: string;
  index: number;
  toolName: string;
  input: Record<string, JSONValue>;
  resultIncludes: string;
}

/** Substrings the incoming prompt and prior-turn tool result must include or exclude.
 *  A prior-turn substring is checked against the priorTurn result. A replayed round checks its joined results.
 *  A required substring fails when neither is present. */
export interface IRecordedInputExpectation {
  promptIncludes?: string[];
  promptExcludes?: string[];
  priorTurnResultIncludes?: string[];
  priorTurnResultExcludes?: string[];
  /** The replayed round's calls, exactly and in order: count, ids, positions, tools, inputs and results. */
  priorRoundCalls?: IRecordedRoundCall[];
  /** The tool-use ids of the assistant artifact the round replays, exactly and in order. */
  priorRoundArtifactIds?: string[];
  /** Whether the request must disable parallel tool calls (true) or must not (false). */
  expectedParallelDisabled?: boolean;
}

/** A replayed recording: the recorded text response plus any native tool calls it carried. */
interface IRecordedReplay {
  response: string;
  cost_usd?: number;
  toolCalls?: IProviderToolCall[];
}

/** A call-site hit whose current prompt hash no longer matches the recorded fixture. It still
 *  replays, but the mismatch is reported so a human can decide whether to re-capture. */
interface IFixtureDriftReport {
  callSite: ICallSite;
  expectedHash: string;
  actualHash: string;
}

/** Aggregated drift, reported per run. `totalCallSiteLookups` counts only call-site lookups
 *  that found a recording — a miss is a coverage gap, not drift, so it can't dilute the rate. */
interface IDriftSummary {
  totalCallSiteLookups: number;
  driftedCalls: number;
  driftRate: number;
  overThreshold: boolean;
  fixtures: string[];
}

/**
 * Pattern matcher for dynamic responses
 */
export interface IPatternMatcher {
  /** Regex pattern to match against prompts */
  pattern: RegExp;
  /** Response string or function that generates response */
  response: string | ((match: RegExpMatchArray, prompt: string) => string);
}

/**
 * Token tracking
 */
interface ITokenCount {
  input: number;
  output: number;
}

/**
 * Record of a call made to the provider
 */
interface ICallRecord {
  /** The prompt that was sent */
  prompt: string;
  /** Options passed with the call */
  options?: IModelOptions;
  /** Response returned */
  response: string;
  /** When the call was made */
  timestamp: Date;
}

/**
 * Options for configuring MockLLMProvider
 */
interface IMockLLMProviderOptions {
  /** Custom provider ID */
  id?: string;
  /** Responses for scripted/slow strategies */
  responses?: string[];
  /** Recorded responses for recorded strategy */
  recordings?: IRecordedResponse[];
  /** Directory to load recordings from */
  fixtureDir?: string;
  /** Refuse to answer a prompt that has no recording, instead of falling back to patterns. */
  strictRecordings?: boolean;
  /** Pattern matchers for pattern strategy */
  patterns?: IPatternMatcher[];
  /** Error message for failing strategy */
  errorMessage?: string;
  /** Delay in ms for slow strategy */
  delayMs?: number;
  /** Token counts per response */
  tokensPerResponse?: ITokenCount;
}

/** Hash a prompt for recording lookup. Exported so capture writes the exact same hash a later
 *  replay will compute — the algorithm drift detection compares against. */
export function hashPrompt(prompt: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(prompt);

  // Use synchronous hash computation
  const hashBuffer = new Uint8Array(32);
  const view = new DataView(hashBuffer.buffer);

  // Simple hash for testing (not cryptographically secure, but deterministic)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data[i]) | 0;
  }
  view.setInt32(0, hash);

  // Add more entropy from the string
  let hash2 = 5381;
  for (let i = 0; i < data.length; i++) {
    hash2 = (hash2 * 33) ^ data[i];
  }
  view.setInt32(4, hash2);

  // Convert to hex string (first 8 chars)
  return Array.from(hashBuffer.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class MockLLMProvider implements IModelProvider {
  public readonly id: string;

  private readonly strategy: MockStrategy;
  private readonly responses: string[];
  private readonly recordings: IRecordedResponse[];
  private readonly patterns: IPatternMatcher[];
  private readonly errorMessage: string;
  private readonly delayMs: number;
  private readonly tokensPerResponse: ITokenCount;

  private responseIndex: number = 0;
  private _callCount: number = 0;
  private _callHistory: ICallRecord[] = [];
  private _totalTokens: ITokenCount = { input: 0, output: 0 };
  private _driftReports: IFixtureDriftReport[] = [];
  /** Call-site lookups that found a recording (whether current or drifted) — the denominator
   *  reportDrift() rates against. A miss is a coverage gap, not drift, so it is excluded. */
  private _callSiteHitCount: number = 0;

  constructor(strategy: MockStrategy, options: IMockLLMProviderOptions = {}) {
    this.id = options.id ?? "mock-llm-provider";
    this.strategy = strategy;
    this.responses = options.responses ?? ["Default mock response"];
    this.recordings = options.recordings ?? [];
    this.patterns = options.patterns ?? [];
    this.errorMessage = options.errorMessage ?? "MockLLMProvider error (failing strategy)";
    this.delayMs = options.delayMs ?? MOCK_DELAY_MS; // Default 500ms delay for slow strategy
    this.tokensPerResponse = options.tokensPerResponse ?? { input: MOCK_INPUT_TOKENS, output: MOCK_OUTPUT_TOKENS };

    // Load recordings from fixture directory if specified
    this.strictRecordings = options.strictRecordings ?? false;

    if (options.fixtureDir) {
      this.loadRecordingsFromDir(options.fixtureDir);
    }
    if (this.strictRecordings) assertUniqueCallSites(this.recordings);

    // Add default patterns for recorded and pattern strategy. A miss then falls back to a
    // pattern match. Only an explicit `patterns` option skips this step. A loaded fixture
    // directory never suppresses the fallback.
    if (
      (strategy === MockStrategy.RECORDED || strategy === MockStrategy.PATTERN) &&
      this.patterns.length === 0 &&
      !("patterns" in options)
    ) {
      // Silently add default patterns - this provider is initialized before config
      // is available, so we can't respect log_level settings. The fallback is
      // expected behavior for development/testing environments.
      this.patterns = defaultMockPatterns();
    }
  }

  // IModelProvider Implementation

  async generate(prompt: string, options?: Opt<IModelOptions, Reason.OptionalInput>): Promise<IGenerateResult> {
    assertNoNativeConversation(this.id, options);
    if (this.strategy === "failing") {
      this._callCount++;
      this._callHistory.push({
        prompt,
        options,
        response: "[ERROR]",
        timestamp: new Date(),
      });
      throw new MockLLMError(this.errorMessage);
    }

    const timestamp = new Date();
    let response: string;
    let recordedCost: number | undefined;
    let toolCalls: IProviderToolCall[] | undefined;
    switch (this.strategy) {
      case MockStrategy.RECORDED: {
        const replay = this.generateRecorded(prompt, options);
        response = replay.response;
        recordedCost = replay.cost_usd;
        // IGenerateResult.toolCalls is produced only when the caller requested tools.
        toolCalls = options?.tools && replay.toolCalls && replay.toolCalls.length > 0 ? replay.toolCalls : undefined;
        break;
      }
      case MockStrategy.SCRIPTED:
        response = await this.generateScripted();
        break;
      case MockStrategy.PATTERN:
        response = await this.generatePattern(prompt);
        break;
      case MockStrategy.SLOW:
        response = await this.generateSlow();
        break;
      default:
        throw new MockLLMError(`Unknown strategy: ${this.strategy}`);
    }

    this._callCount++;
    this._callHistory.push({
      prompt,
      options,
      response,
      timestamp,
    });
    this._totalTokens.input += this.tokensPerResponse.input;
    this._totalTokens.output += this.tokensPerResponse.output;
    return {
      content: response,
      usage: {
        promptTokens: this.tokensPerResponse.input,
        completionTokens: this.tokensPerResponse.output,
        totalTokens: this.tokensPerResponse.input + this.tokensPerResponse.output,
      },
      model: "mock-model",
      provider: this.id,
      ...(toolCalls !== undefined ? { toolCalls, nativeAssistantReplay: assistantArtifactOf(toolCalls) } : {}),
      ...(recordedCost !== undefined ? { cost_usd: recordedCost } : {}),
    };
  }

  // Strategy Implementations

  /** Recorded strategy: look up a response (and any native tool calls) by call site when the
   *  caller supplies one, falling back to the whole-prompt-hash lookup otherwise — unchanged
   *  for calls without options.callSite. */
  private generateRecorded(prompt: string, options: Opt<IModelOptions, Reason.OptionalInput>): IRecordedReplay {
    if (options?.callSite) {
      return this.generateRecordedByCallSite(prompt, options.callSite, options, options.responseContract);
    }

    const hash = this.hashPrompt(prompt);

    // Try exact hash match first
    const recording = this.recordings.find((r) => r.promptHash === hash);
    if (recording) {
      assertExpectedInput(recording, prompt, options, `prompt hash ${hash}`);
      return { response: recording.response, toolCalls: recording.toolCalls, cost_usd: recording.cost_usd };
    }

    // Try matching by prompt preview (partial match)
    const previewMatch = this.recordings.find((r) =>
      prompt.startsWith(r.promptPreview) || r.promptPreview.startsWith(prompt)
    );
    if (previewMatch) {
      assertExpectedInput(previewMatch, prompt, options, `prompt preview "${previewMatch.promptPreview}"`);
      return { response: previewMatch.response, toolCalls: previewMatch.toolCalls, cost_usd: previewMatch.cost_usd };
    }

    // A miss under `recorded` is a hole in the fixture set, and silently answering it from a
    // regex is how the tier comes to lie about what it replayed. Strict mode refuses instead,
    // naming the hash so the missing recording can be captured.
    if (this.strictRecordings) {
      throw new MockLLMError(
        `No recording for prompt hash ${hash} and strict recordings are enabled.\n` +
          `Preview: "${prompt.substring(0, 120)}..."\n` +
          `Capture this response or run without strict mode to fall back to patterns.`,
      );
    }

    // Fall back to pattern matching if available
    if (this.patterns.length > 0) {
      console.warn(
        `No exact recording found for prompt, falling back to pattern matching:\n` +
          `Hash: ${hash}\n` +
          `Preview: "${prompt.substring(0, 50)}..."`,
      );
      return { response: this.generatePattern(prompt) };
    }

    throw new MockLLMError(
      `No recorded response found for prompt hash: ${hash}\n` +
        `Prompt preview: "${prompt.substring(0, 50)}..."\n` +
        `Available recordings: ${this.recordings.length}\n` +
        `Hint: Add recordings or use 'pattern' strategy instead`,
    );
  }

  /** Look up a recording by call site. A hit whose prompt hash no longer matches still replays
   *  but is reported as drift. A miss is fatal under strictRecordings, naming the call site so
   *  the missing fixture can be captured; otherwise it falls back to pattern matching. */
  private generateRecordedByCallSite(
    prompt: string,
    callSite: ICallSite,
    options: Opt<IModelOptions, Reason.OptionalInput>,
    responseContract: Opt<IModelOptions["responseContract"], Reason.OptionalInput>,
  ): IRecordedReplay {
    const key = callSiteKey(callSite);
    const recording = this.recordings.find((r) => r.callSite && callSiteKey(r.callSite) === key);

    if (recording) {
      this._callSiteHitCount++;
      const actualHash = this.hashPrompt(prompt);
      if (recording.promptHash !== actualHash) {
        this._driftReports.push({ callSite, expectedHash: recording.promptHash, actualHash });
        console.warn(
          `Fixture drift at call site ${describeCallSite(callSite)}: the prompt hash changed from ` +
            `${recording.promptHash} to ${actualHash}. Replaying the recorded response — review whether ` +
            `it still represents the current prompt.`,
        );
      }
      assertExpectedInput(recording, prompt, options, `call site ${describeCallSite(callSite)}`);
      if (recording.error) {
        throw new MockLLMError(
          `Recorded provider failure at call site ${describeCallSite(callSite)}: ${recording.error}`,
        );
      }
      assertResponseContract(recording, responseContract, callSite);
      return { response: recording.response, toolCalls: recording.toolCalls, cost_usd: recording.cost_usd };
    }

    if (this.strictRecordings) {
      throw new MockLLMError(
        `No recording for call site ${describeCallSite(callSite)} and strict recordings are enabled.\n` +
          `Preview: "${prompt.substring(0, 120)}..."\n` +
          `Capture this response or run without strict mode to fall back to patterns.`,
      );
    }

    if (this.patterns.length > 0) {
      console.warn(
        `No recording for call site ${describeCallSite(callSite)}, falling back to pattern matching.`,
      );
      return { response: this.generatePattern(prompt) };
    }

    throw new MockLLMError(
      `No recorded response found for call site: ${describeCallSite(callSite)}\n` +
        `Prompt preview: "${prompt.substring(0, 50)}..."\n` +
        `Available recordings: ${this.recordings.length}\n` +
        `Hint: Add recordings or use 'pattern' strategy instead`,
    );
  }

  /**
   * Scripted strategy: Return responses in sequence
   */
  private generateScripted(): string {
    const response = this.responses[this.responseIndex];
    this.responseIndex = (this.responseIndex + 1) % this.responses.length;
    return response;
  }

  /**
   * Pattern strategy: Match prompt against patterns
   */
  private generatePattern(prompt: string): string {
    for (const matcher of this.patterns) {
      const match = prompt.match(matcher.pattern);
      if (match) {
        if (typeof matcher.response === "function") {
          return matcher.response(match, prompt);
        }
        return matcher.response;
      }
    }

    throw new MockLLMError(
      `No pattern matched for prompt: "${prompt.substring(0, 100)}..."\n` +
        `Available patterns: ${this.patterns.length}`,
    );
  }

  /**
   * Slow strategy: Add delay before returning response
   */
  private async generateSlow(): Promise<string> {
    await this.delay(this.delayMs);
    return this.responses[this.responseIndex++ % this.responses.length];
  }

  // Public Utilities

  /**
   * Get the number of calls made to this provider
   */
  get callCount(): number {
    return this._callCount;
  }

  /**
   * Get the history of all calls made
   */
  get callHistory(): ICallRecord[] {
    return [...this._callHistory];
  }

  /**
   * Get total token usage
   */
  get totalTokens(): ITokenCount {
    return { ...this._totalTokens };
  }

  /** Call-site hits whose prompt hash no longer matched the recorded fixture. Empty when no
   *  call-site-keyed generation has drifted. */
  get driftReports(): IFixtureDriftReport[] {
    return [...this._driftReports];
  }

  /** Aggregate drift totals for this run, rated against DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD
   *  unless a caller supplies its own. A miss is excluded from the denominator — it's a coverage
   *  gap, not drift. */
  reportDrift(threshold: number = DEFAULT_FIXTURE_DRIFT_RECAPTURE_THRESHOLD): IDriftSummary {
    const driftedCalls = this._driftReports.length;
    const driftRate = this._callSiteHitCount > 0 ? driftedCalls / this._callSiteHitCount : 0;
    return {
      totalCallSiteLookups: this._callSiteHitCount,
      driftedCalls,
      driftRate,
      overThreshold: driftRate > threshold,
      fixtures: this._driftReports.map((r) => describeCallSite(r.callSite)),
    };
  }

  /**
   * Get the most recent call made
   */
  getLastCall(): ICallRecord | undefined {
    if (this._callHistory.length === 0) {
      return undefined;
    }
    return this._callHistory[this._callHistory.length - 1];
  }

  /**
   * Reset provider state (call count, history, token tracking)
   */
  reset(): void {
    this._callCount = 0;
    this._callHistory = [];
    this._totalTokens = { input: 0, output: 0 };
    this.responseIndex = 0;
  }

  /**
   * Hash a prompt for recording lookup
   */
  hashPrompt(prompt: string): string {
    return hashPrompt(prompt);
  }

  // Private Helpers

  /**
   * Load recordings from a fixture directory
   */
  private loadRecordingsFromDir(dir: string): void {
    try {
      for (const entry of Deno.readDirSync(dir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const path = `${dir}/${entry.name}`;
          const content = Deno.readTextFileSync(path);
          let parsed: JSONValue;
          try {
            parsed = JSON.parse(content);
          } catch (parseError) {
            throw new MockLLMError(
              `Corrupt fixture file "${path}": invalid JSON (${
                parseError instanceof Error ? parseError.message : String(parseError)
              }).`,
            );
          }
          this.recordings.push(validateRecordedResponse(parsed, path));
        }
      }
    } catch (error) {
      // Directory might not exist yet, that's OK
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** True when this provider replayed nothing and is really pattern-matching. `recorded` is the
   *  default strategy, and the constructor silently substitutes default patterns when no fixtures
   *  are configured — so a run labelled `mock-recorded-<model>` may have replayed nothing at all. */
  private readonly strictRecordings: boolean;

  get isPatternFallback(): boolean {
    return this.strategy === MockStrategy.RECORDED && this.recordings.length === 0;
  }
}

// Helper Functions

/** Creates a MockLLMProvider with common plan generation responses. A pattern-based mock for plan, bugfix and execution flows. */
export function createPlanGeneratorMock(): MockLLMProvider {
  return new MockLLMProvider(MockStrategy.PATTERN, {
    patterns: [
      {
        pattern: /implement|add|create/i,
        response: (_match, _prompt) => {
          return `<content>
${
            JSON.stringify({
              subject: "Implementation Plan",
              description: "Based on the request, I will implement the required functionality.",
              steps: [
                {
                  step: 1,
                  title: "Analyze Requirements",
                  description: "Review the request and identify key requirements for the implementation.",
                },
                {
                  step: 2,
                  title: "Design Solution",
                  description:
                    "Create a technical design for the implementation, considering architecture and patterns.",
                },
                {
                  step: 3,
                  title: "Implement Code",
                  description: "Write the necessary code changes to implement the feature.",
                  tools: [ToolName.WRITE_FILE],
                },
                {
                  step: 4,
                  title: "Write Tests",
                  description: "Add unit tests to verify the implementation works correctly.",
                  tools: [ToolName.WRITE_FILE],
                  dependencies: [3],
                },
                {
                  step: 5,
                  title: "Review",
                  description: "Self-review the changes for quality and ensure all requirements are met.",
                },
              ],
              estimatedDuration: "2-4 hours",
            })
          }
</content>`;
        },
      },
      {
        pattern: /fix|bug|error/i,
        response: (_match, _prompt) => {
          return `<content>
${
            JSON.stringify({
              subject: "Bug Fix Plan",
              description: "I will investigate and fix the reported issue.",
              steps: [
                {
                  step: 1,
                  title: "Reproduce Issue",
                  description: "Verify the bug exists and understand the exact conditions that trigger it.",
                },
                {
                  step: 2,
                  title: "Root Cause Analysis",
                  description: "Identify why the bug occurs by analyzing the relevant code paths.",
                  tools: ["read_file"],
                },
                {
                  step: 3,
                  title: "Implement Fix",
                  description: "Apply the necessary correction to resolve the issue.",
                  tools: [ToolName.WRITE_FILE],
                  dependencies: [2],
                },
                {
                  step: 4,
                  title: "Test Fix",
                  description: "Verify the bug is resolved and the fix works as expected.",
                  dependencies: [3],
                },
                {
                  step: 5,
                  title: "Regression Test",
                  description: "Ensure no new issues are introduced by the fix.",
                  dependencies: [4],
                },
              ],
              estimatedDuration: "1-2 hours",
            })
          }
</content>`;
        },
      },
      {
        pattern: /.*/,
        response: (_match, _prompt) => {
          return `<content>
${
            JSON.stringify({
              subject: "Execution Plan",
              description: "I will address the user's request with a structured approach.",
              steps: [
                {
                  step: 1,
                  title: "Analyze",
                  description: "Review the request details and understand what needs to be done.",
                },
                {
                  step: 2,
                  title: "Plan",
                  description: "Design the approach and identify files that need to be modified.",
                },
                {
                  step: 3,
                  title: "Implement",
                  description: "Execute the changes according to the plan.",
                  tools: [ToolName.WRITE_FILE],
                },
              ],
            })
          }
</content>`;
        },
      },
    ],
  });
}

/** Creates a MockLLMProvider that simulates API failures. `errorMessage` is optional. */
export function createFailingMock(errorMessage?: Opt<string, Reason.OptionalInput>): MockLLMProvider {
  return new MockLLMProvider(MockStrategy.FAILING, {
    errorMessage: errorMessage ?? "Simulated API failure",
  });
}

/** Creates a MockLLMProvider that simulates slow responses. `delayMs` defaults to 5000. */
export function createSlowMock(delayMs: number = 5000): MockLLMProvider {
  return new MockLLMProvider(MockStrategy.SLOW, {
    delayMs,
    responses: ["Delayed response"],
  });
}
