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

import { MockStrategy, ProviderType } from "@exaix/core";
import type { IModelOptions, IModelProvider } from "../types.ts";
import type { IGenerateResult } from "./common.ts";
import { MOCK_DELAY_MS, MOCK_INPUT_TOKENS, MOCK_OUTPUT_TOKENS } from "@exaix/ai";
import { ToolName } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

// ============================================================================
// Types and Interfaces
// ============================================================================

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
  /** When this was recorded */
  recordedAt: string;
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
export interface ITokenCount {
  input: number;
  output: number;
}

/**
 * Record of a call made to the provider
 */
export interface ICallRecord {
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
export interface IMockLLMProviderOptions {
  /** Custom provider ID */
  id?: string;
  /** Responses for scripted/slow strategies */
  responses?: string[];
  /** Recorded responses for recorded strategy */
  recordings?: IRecordedResponse[];
  /** Directory to load recordings from */
  fixtureDir?: string;
  /** Pattern matchers for pattern strategy */
  patterns?: IPatternMatcher[];
  /** Error message for failing strategy */
  errorMessage?: string;
  /** Delay in ms for slow strategy */
  delayMs?: number;
  /** Token counts per response */
  tokensPerResponse?: ITokenCount;
}

// ============================================================================
// Custom Error Type
// ============================================================================

/**
 * Error thrown by MockLLMProvider
 */
export class MockLLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockLLMError";
  }
}

// ============================================================================
// MockLLMProvider Implementation
// ============================================================================

/**
 * Mock LLM provider for deterministic testing.
 * Implements IModelProvider for use in tests.
 */
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

  /**
   * @param strategy Mock strategy to use
   * @param options Configuration options for the mock provider
   */
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
    if (options.fixtureDir) {
      this.loadRecordingsFromDir(options.fixtureDir);
    }

    // For recorded or pattern strategy without recordings/patterns, add default patterns as fallback
    // Only if patterns were not explicitly provided (even if empty)
    if (
      (strategy === MockStrategy.RECORDED || strategy === MockStrategy.PATTERN) &&
      this.recordings.length === 0 &&
      this.patterns.length === 0 &&
      !("patterns" in options)
    ) {
      // Silently add default patterns - this provider is initialized before config
      // is available, so we can't respect log_level settings. The fallback is
      // expected behavior for development/testing environments.
      this.patterns = this.getDefaultPatterns();
    }
  }

  // ============================================================================
  // IModelProvider Implementation
  // ============================================================================

  /**
   * Generate a response based on the configured strategy.
   * @param prompt The prompt to generate a response for
   * @param options Optional model options
   */
  async generate(prompt: string, options?: Opt<IModelOptions, Reason.OptionalInput>): Promise<IGenerateResult> {
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
    switch (this.strategy) {
      case MockStrategy.RECORDED:
        response = await this.generateRecorded(prompt);
        break;
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
    };
  }

  // ============================================================================
  // Strategy Implementations
  // ============================================================================

  /**
   * Recorded strategy: Look up response by prompt hash
   */
  private generateRecorded(prompt: string): string {
    const hash = this.hashPrompt(prompt);

    // Try exact hash match first
    const recording = this.recordings.find((r) => r.promptHash === hash);
    if (recording) {
      return recording.response;
    }

    // Try matching by prompt preview (partial match)
    const previewMatch = this.recordings.find((r) =>
      prompt.startsWith(r.promptPreview) || r.promptPreview.startsWith(prompt)
    );
    if (previewMatch) {
      return previewMatch.response;
    }

    // Fall back to pattern matching if available
    if (this.patterns.length > 0) {
      console.warn(
        `No exact recording found for prompt, falling back to pattern matching:\n` +
          `Hash: ${hash}\n` +
          `Preview: "${prompt.substring(0, 50)}..."`,
      );
      return this.generatePattern(prompt);
    }

    throw new MockLLMError(
      `No recorded response found for prompt hash: ${hash}\n` +
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
   * Failing strategy: Always throw error
   */
  private generateFailing(): Promise<never> {
    throw new MockLLMError(this.errorMessage);
  }

  /**
   * Slow strategy: Add delay before returning response
   */
  private async generateSlow(): Promise<string> {
    await this.delay(this.delayMs);
    return this.responses[this.responseIndex++ % this.responses.length];
  }

  // ============================================================================
  // Public Utilities
  // ============================================================================

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

  /**
   * Record a response for later playback
   */
  recordResponse(prompt: string, response: string, model: string = ProviderType.MOCK): IRecordedResponse {
    const recording: IRecordedResponse = {
      promptHash: this.hashPrompt(prompt),
      promptPreview: prompt.substring(0, 100),
      response,
      model,
      tokens: { ...this.tokensPerResponse },
      recordedAt: new Date().toISOString(),
    };

    this.recordings.push(recording);
    return recording;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Load recordings from a fixture directory
   */
  private loadRecordingsFromDir(dir: string): void {
    try {
      for (const entry of Deno.readDirSync(dir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const path = `${dir}/${entry.name}`;
          const content = Deno.readTextFileSync(path);
          const recording = JSON.parse(content) as IRecordedResponse;
          this.recordings.push(recording);
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

  /**
   * Get default patterns for fallback when no recordings available
   *
   * Updated for Step 6.7: Plans now use JSON format validated by PlanSchema.
   * JSON is output within <content> tags and gets validated/converted to markdown by PlanAdapter.
   */
  /**
   * Detect if a prompt is for execution (vs planning)
   * Execution prompts contain specific markers indicating step execution
   */
  private isExecutionPrompt(prompt: string): boolean {
    return (
      prompt.includes("executing a plan") ||
      prompt.includes("autonomous coding agent") ||
      /Step \d+/i.test(prompt) ||
      prompt.includes("execute") && prompt.includes("step")
    );
  }

  /**
   * Get default pattern matchers for common request types
   * Returns different patterns for planning vs execution prompts
   */
  private getDefaultPatterns(): IPatternMatcher[] {
    return [
      // Specialist patterns (hit first)
      {
        pattern: /Plan Amendment specialist/i,
        response: `{
  "summary": "Adjust remaining steps due to detected environmental drift.",
  "affectedRemainingStepIds": ["1", "2"],
  "adds": [
    { "number": 3, "title": "Verification", "content": "Verify the fix." }
  ],
  "updates": [
    { "number": 1, "title": "Analyze Requirements", "content": "Review the request and identify key requirements (amended)." },
    { "number": 2, "title": "Corrected Refactor", "content": "Perform the refactor with corrected paths." }
  ],
  "removes": []
}`,
      },
      {
        // Each amendment-scenario step's own prompt only carries that ONE step's own
        // title/content (context.request/context.plan = step.content), not the whole plan
        // body — so a RESUMED step (rewritten by PlanAmendmentService.applyApprovedAmendment)
        // may carry none of the SIMULATE_DRIFT_TRIGGER marker text at all. "(amended)" is
        // step 1's own rewritten content; "Corrected Refactor" / "Verify the fix" are step
        // 2/3's own (updated or added) title/content — kept specific (not the bare word
        // "Verification", which collides with an unrelated fixture's request text) to avoid
        // hijacking other scenarios' mock responses. Without matching on ALL of these here
        // too, a resumed step's prompt falls through to a later, unrelated pattern (e.g. the
        // generic "Step \d+" executing-a-plan handler) that returns the legacy
        // <thought>/<actions> JSON envelope instead of this handler's ReAct-aware response,
        // which breaks ReActLoopStrategy parsing.
        pattern: /SIMULATE_DRIFT_TRIGGER|\(amended\)|Corrected Refactor|Verify the fix/i,
        response: (_match, prompt) => {
          // 1. Intent Analysis Phase
          if (prompt.includes("request intent analyzer") || prompt.includes("intent analysis")) {
            return `<thought>
I see the drift instructions in the analysis phase.
</thought>

<content>
{
  "goals": [
    {
      "description": "Implementation with SIMULATE_DRIFT_TRIGGER",
      "explicit": true,
      "priority": 1
    }
  ],
  "requirements": [],
  "constraints": [],
  "acceptanceCriteria": [],
  "ambiguities": [],
  "actionabilityScore": 100,
  "complexity": "medium",
  "taskType": "refactor",
  "tags": ["drift"],
  "referencedFiles": ["src/main.ts"]
}
</content>`;
          }

          // 2. Execution Phase — identities with capabilities:["react"] (e.g. "default")
          // dispatch to ReActLoopStrategy, whose own prompt template (buildPrompt) is
          // "IDENTITY: ...\n...\nAVAILABLE TOOLS:...", NOT the legacy PromptBuilder's
          // "## Execution Context (SYSTEM CONTROLLED)" template — and its parseResponse()
          // looks for the literal "THOUGHT: " prefix and "STATUS: COMPLETE" text, not the
          // <thought>/<content> JSON envelope the legacy strategy expects. A response with
          // neither STATUS: COMPLETE nor a ```toml action block throws "Agent provided no
          // actions and did not signal completion", which itself becomes a NEW
          // (tool_error-sourced) amendment trigger, looping forever regardless of content.
          const isReActPrompt = prompt.includes("IDENTITY: ") && prompt.includes("AVAILABLE TOOLS:");
          if (prompt.includes("## Execution Context (SYSTEM CONTROLLED)") || isReActPrompt) {
            // Each step's prompt only carries that step's own content (context.request /
            // context.plan = step.content), not the whole plan body — so a later step's
            // title/content ("Corrected Refactor", "Verify the fix") never appears in an
            // EARLIER amended step's own prompt. "(amended)" is the marker the amendment
            // patch above actually writes into step 1's updated content, so it is what a
            // resumed step 1 execution sees.
            const isAmendedStep = prompt.includes("Corrected Refactor") || prompt.includes("Verify the fix") ||
              prompt.includes("(amended)");

            if (isReActPrompt) {
              return isAmendedStep
                ? `THOUGHT: Executed the amended step with absolute certainty and high confidence. Everything is perfectly fine.
STATUS: COMPLETE
SUMMARY: Executed the amended step with absolute certainty and high confidence. Everything is perfectly fine.`
                : `THOUGHT: I see some drift in the environment. I am not sure perhaps uncertain maybe. SIMULATE_DRIFT_TRIGGER
STATUS: COMPLETE
SUMMARY: I encountered some drift. I am not sure perhaps uncertain maybe. SIMULATE_DRIFT_TRIGGER`;
            }

            if (isAmendedStep) {
              return `<thought>
Executing the amended step successfully.
</thought>

<content>
{
  "branch": "feat/drift-fix",
  "commit_sha": "0000000000000000000000000000000000000000",
  "description": "Executed the amended step with absolute certainty and high confidence. Everything is perfectly fine.",
  "status": "completed",
  "files_changed": ["src/main.ts"],
  "tool_calls": 1,
  "execution_time_ms": 100
}
</content>`;
            }

            return `<thought>
I see some drift in the environment. I am not sure perhaps uncertain maybe. SIMULATE_DRIFT_TRIGGER
</thought>

<content>
{
  "branch": "feat/drift-fix",
  "commit_sha": "0000000000000000000000000000000000000000",
  "description": "I encountered some drift. I am not sure perhaps uncertain maybe. SIMULATE_DRIFT_TRIGGER",
  "status": "completed",
  "files_changed": [],
  "tool_calls": 0,
  "execution_time_ms": 100
}
</content>`;
          }

          // 3. Planning Phase (Fallback)
          return `<thought>
I see the drift instructions in the planning phase. I will pass them to the execution phase.
</thought>

<content>
{
  "subject": "Implementation Plan",
  "description": "Based on the request, I will implement the required functionality with a structured approach. SIMULATE_DRIFT_TRIGGER",
  "steps": [
    {
      "step": 1,
      "title": "Analyze Requirements",
      "description": "Review the request and identify key requirements. SIMULATE_DRIFT_TRIGGER"
    },
    {
      "step": 2,
      "title": "Implement Code",
      "description": "Write the necessary code changes. SIMULATE_DRIFT_TRIGGER",
      "tools": ["write_file"]
    }
  ],
  "estimatedDuration": "2-4 hours",
  "risks": []
}
</content>`;
        },
      },

      // Planning patterns (for plan generation requests)
      {
        pattern: /intent analyzer/i,
        response: `<thought>
I will analyze the request and provide a detailed architectural assessment.
</thought>

<content>
{
  "goals": [
    {
      "description": "Analyze the core architecture of the Exaix Scenario Framework",
      "explicit": true,
      "priority": 1
    }
  ],
  "requirements": [],
  "constraints": [],
  "acceptanceCriteria": [],
  "ambiguities": [],
  "actionabilityScore": 100,
  "complexity": "medium",
  "taskType": "analysis",
  "tags": ["smoke", "framework"],
  "referencedFiles": [],
  "metadata": {
    "analyzedAt": "2026-03-20T18:00:00Z",
    "durationMs": 100,
    "mode": "llm",
    "analyzerVersion": "1.0.0"
  }
}
</content>`,
      },

      // Execution patterns (specific triggers) — must come BEFORE planning patterns
      // so that "Step N" prompts are caught before generic "implement" patterns
      {
        // A flow step's prompt is its predecessor's output run through the step's transform, and
        // `mergeAsContext` prefixes each section with a `## Step N` markdown header. That header
        // matched the execution pattern below, so every flow step past the first was answered
        // with <actions> and no <content>: the step reported success with outputLength 0, the
        // flow aggregated nothing, and plan validation failed on empty input. Anchored to the
        // shape mergeAsContext actually emits — an optional lifted `# Title` then `## Step 1` —
        // so it cannot capture a genuine execution turn, which announces itself with
        // "Execution Context" or "Action required:" instead.
        pattern: /^##\s+Step \d+/m,
        response: `<thought>
I will address this step and produce output the next step can consume.
</thought>

<content>
{
  "subject": "Flow Step Output",
  "description": "Structured output for this flow step, suitable as input to the next step.",
  "steps": [
    {
      "step": 1,
      "title": "Address the step's objective",
      "description": "Work through what this step was asked to produce, using the prior step's output as context."
    },
    {
      "step": 2,
      "title": "Hand off",
      "description": "Summarise the result so the next step in the flow can build on it."
    }
  ]
}
</content>`,
      },
      {
        pattern: /executing a plan|Performing step|Action required:|Step \d+|Execution Context/i,
        response: (_match, prompt) => {
          // Check what kind of action is being requested
          const needsFileWrite = /write|create|add|implement|modify|update/i.test(prompt);
          const needsFileRead = /read|analyze|review|check/i.test(prompt);
          if (needsFileWrite) {
            return `<thought>
I will implement this step by creating or modifying the necessary files.
</thought>

<actions>
[
  {
    "tool": "write_file",
    "params": {
      "path": "src/utils.ts",
      "content": "// Mock implementation\\nexport function helloWorld(): string {\\n  return 'Hello, World!';\\n}\\n"
    }
  }
]
</actions>`;
          } else if (needsFileRead) {
            return `<thought>
I will read the relevant files to understand the current implementation.
</thought>

<actions>
[
  {
    "tool": "read_file",
    "params": {
      "path": "src/index.ts"
    }
  }
]
</actions>`;
          } else {
            // Generic execution response
            return `<thought>
I will execute this step according to the plan.
</thought>

<actions>
[
  {
    "tool": "write_file",
    "params": {
      "path": "src/output.txt",
      "content": "Step completed successfully"
    }
  }
]
</actions>`;
          }
        },
      },

      // Planning patterns
      {
        pattern: /implement|add|create/i,
        response: (_match, prompt) => {
          const includeDrift = /SIMULATE_DRIFT_TRIGGER/i.test(prompt);
          const step1Content = includeDrift
            ? "Review the request and identify key requirements. SIMULATE_DRIFT_TRIGGER"
            : "Review the request and identify key requirements for the implementation.";

          return `<thought>
I need to analyze the request and create a plan for implementation.
</thought>

<content>
{
  "subject": "Implementation Plan",
  "description": "Based on the request, I will implement the required functionality with a structured approach.",
  "steps": [
    {
      "step": 1,
      "title": "Analyze Requirements",
      "description": "${step1Content}"
    },
    {
      "step": 2,
      "title": "Design Solution",
      "description": "Create a technical design for the implementation, considering architecture and patterns."
    },
    {
      "step": 3,
      "title": "Implement Code",
      "description": "Write the necessary code changes to implement the feature.",
      "tools": ["write_file"]
    },
    {
      "step": 4,
      "title": "Write Tests",
      "description": "Add unit tests to verify the implementation works correctly.",
      "tools": ["write_file"],
      "dependencies": [3]
    },
    {
      "step": 5,
      "title": "Review",
      "description": "Self-review the changes for quality and ensure all requirements are met."
    }
  ],
  "estimatedDuration": "2-4 hours"
}
</content>`;
        },
      },
      {
        pattern: /fix|bug|error|issue/i,
        response: `<thought>
I need to investigate and fix the reported issue.
</thought>

<content>
{
  "subject": "Bug Fix Plan",
  "description": "I will investigate and fix the reported issue systematically.",
  "steps": [
    {
      "step": 1,
      "title": "Reproduce Issue",
      "description": "Verify the bug exists and understand the exact conditions that trigger it."
    },
    {
      "step": 2,
      "title": "Root Cause Analysis",
      "description": "Identify why the bug occurs by analyzing the relevant code paths.",
      "tools": ["read_file"]
    },
    {
      "step": 3,
      "title": "Implement Fix",
      "description": "Apply the necessary correction to resolve the issue.",
      "tools": ["write_file"],
      "dependencies": [2]
    },
    {
      "step": 4,
      "title": "Test Fix",
      "description": "Verify the bug is resolved and the fix works as expected.",
      "tools": ["write_file"],
      "dependencies": [3]
    },
    {
      "step": 5,
      "title": "Regression Test",
      "description": "Ensure no new issues are introduced by the fix.",
      "dependencies": [4]
    }
  ],
  "estimatedDuration": "1-2 hours",
  "risks": ["Fix may have unintended side effects on related functionality"]
}
</content>`,
      },

      // Fallback pattern
      {
        pattern: /.*/,
        response: `<thought>
I will create a plan to address this request.
</thought>

<content>
{
  "subject": "Execution Plan",
  "description": "I will address the user's request with a structured approach.",
  "steps": [
    {
      "step": 1,
      "title": "Analyze",
      "description": "Review the request details and understand what needs to be done."
    },
    {
      "step": 2,
      "title": "Plan",
      "description": "Design the approach and identify files that need to be modified."
    },
    {
      "step": 3,
      "title": "Implement",
      "description": "Execute the changes according to the plan.",
      "tools": ["write_file"]
    },
    {
      "step": 4,
      "title": "Test",
      "description": "Verify the solution works correctly.",
      "dependencies": [3]
    }
  ]
}
</content>`,
      },
    ];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a MockLLMProvider with common plan generation responses.
 * Pattern-based mock for plan/bugfix/execution flows.
 */
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

/**
 * Create a MockLLMProvider that simulates API failures.
 * @param errorMessage Optional custom error message
 */
export function createFailingMock(errorMessage?: Opt<string, Reason.OptionalInput>): MockLLMProvider {
  return new MockLLMProvider(MockStrategy.FAILING, {
    errorMessage: errorMessage ?? "Simulated API failure",
  });
}

/**
 * Create a MockLLMProvider that simulates slow responses.
 * @param delayMs Delay in milliseconds (default: 5000)
 */
export function createSlowMock(delayMs: number = 5000): MockLLMProvider {
  return new MockLLMProvider(MockStrategy.SLOW, {
    delayMs,
    responses: ["Delayed response"],
  });
}
