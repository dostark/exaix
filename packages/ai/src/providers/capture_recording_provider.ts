/**
 * @module CaptureRecordingProvider
 * @path packages/ai/src/providers/capture_recording_provider.ts
 * @description A recording wrapper around a live IModelProvider (Phase 157 Step 2). Every
 *   `generate()` call is validated against its call site's response-shape contract and, once
 *   satisfied, written to disk as a replayable IRecordedResponse fixture — one file per call
 *   site, overwritten on re-capture. Observes the provider boundary directly; it has no
 *   logger/journal dependency, because the journal is a trace, not a capture channel.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts, packages/ai/src/provider_factory.ts]
 */

import type { ICallSite, IModelOptions, IModelProvider } from "../types.ts";
import type { IGenerateResult } from "./common.ts";
import {
  describeCallSite,
  hashPrompt,
  type IRecordedResponse,
  isFlowStepPrompt,
  isReActLoopPrompt,
  responseForPromptDialect,
} from "./mock_llm_provider.ts";
import { DEFAULT_CAPTURE_MAX_ATTEMPTS } from "../constants.ts";
import type { Opt, Reason } from "@exaix/core/types";

export interface ICaptureRecordingProviderOptions {
  /** Directory fixtures are written into. Created if it does not exist. */
  dir: string;
  /** Max attempts per logical call before refusing to write a fixture. */
  maxAttempts?: number;
}

/** Error thrown when capture cannot produce a contract-satisfying response, or is refused. */
export class CaptureRecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureRecordingError";
  }
}

/** describeCallSite requires a call site; capture calls may have none. */
function describeOptionalCallSite(callSite: Opt<ICallSite, Reason.OptionalContext>): string {
  return callSite ? describeCallSite(callSite) : "an unkeyed call";
}

/** Deterministic filename for a call site (or, absent one, for a prompt hash) — the
 *  addressing that makes re-capture overwrite rather than accumulate variants. */
function fixtureFilename(callSite: Opt<ICallSite, Reason.OptionalContext>, promptHash: string): string {
  if (callSite) return `${callSite.scenarioId}__${callSite.stepId}__${callSite.callIndex}.json`;
  return `${promptHash}.json`;
}

const CONTENT_TAG = "<content>";
const THOUGHT_TAG = "<thought>";

/** The markers a call site's shape contract requires, derived from the exemplar response the
 *  matching mock dialect would itself return — so the contract capture verifies against is
 *  the same shape replay trusts, not a hand-duplicated regex set. */
function requiredMarkersFor(prompt: string): string[] {
  const exemplar = responseForPromptDialect(prompt);
  if (exemplar === null) {
    // Legacy plan/execution dialect: neither flow-step nor ReAct-loop.
    return [THOUGHT_TAG, CONTENT_TAG];
  }
  if (isFlowStepPrompt(prompt)) return [CONTENT_TAG];
  if (isReActLoopPrompt(prompt)) return []; // checked separately below (STATUS: COMPLETE OR a toml block)
  return [];
}

/**
 * Shape-only validation (never quality): returns a violation reason, or null when the
 * response satisfies its call site's contract.
 */
function validateCaptureContract(prompt: string, response: string): string | null {
  if (isReActLoopPrompt(prompt)) {
    const hasCompletion = /STATUS:\s*COMPLETE/i.test(response);
    const hasActionBlock = /```toml/.test(response);
    if (!hasCompletion && !hasActionBlock) {
      return "ReAct-loop prompt requires STATUS: COMPLETE or a ```toml action block";
    }
    return null;
  }

  const requiredMarkers = requiredMarkersFor(prompt);
  const missing = requiredMarkers.filter((marker) => !response.includes(marker));
  if (missing.length > 0) {
    return `response is missing required marker(s) for this call site's shape: ${missing.join(", ")}`;
  }

  if (requiredMarkers.includes(CONTENT_TAG)) {
    const match = response.match(/<content>([\s\S]*?)<\/content>/);
    if (match) {
      try {
        JSON.parse(match[1].trim());
      } catch {
        return "the <content> block must contain valid JSON";
      }
    }
  }
  return null;
}

export class CaptureRecordingProvider implements IModelProvider {
  public readonly id: string;

  constructor(
    private readonly inner: IModelProvider,
    private readonly options: ICaptureRecordingProviderOptions,
  ) {
    this.id = inner.id;
  }

  async generate(prompt: string, options?: Opt<IModelOptions, Reason.OptionalInput>): Promise<IGenerateResult> {
    const maxAttempts = this.options.maxAttempts ?? DEFAULT_CAPTURE_MAX_ATTEMPTS;
    const failures: string[] = [];
    let accepted: IGenerateResult | undefined;
    let attempts = 0;

    for (attempts = 1; attempts <= maxAttempts; attempts++) {
      const result = await this.inner.generate(prompt, options);
      const violation = validateCaptureContract(prompt, result.content);
      if (!violation) {
        accepted = result;
        break;
      }
      failures.push(`attempt ${attempts}: ${violation}`);
    }

    if (!accepted) {
      throw new CaptureRecordingError(
        `Capture refused for ${describeOptionalCallSite(options?.callSite)} after ${maxAttempts} attempt(s):\n` +
          failures.join("\n"),
      );
    }

    await this.writeFixture(prompt, accepted, options?.callSite, attempts, failures);
    return accepted;
  }

  private async writeFixture(
    prompt: string,
    result: IGenerateResult,
    callSite: Opt<ICallSite, Reason.OptionalContext>,
    attempts: number,
    failures: string[],
  ): Promise<void> {
    await Deno.mkdir(this.options.dir, { recursive: true });

    const recording: IRecordedResponse = {
      promptHash: hashPrompt(prompt),
      promptPreview: prompt.substring(0, 100),
      response: result.content,
      model: result.model,
      tokens: { input: result.usage?.promptTokens ?? 0, output: result.usage?.completionTokens ?? 0 },
      recordedAt: new Date().toISOString(),
      ...(callSite ? { callSite } : {}),
      ...(attempts > 1 || failures.length > 0 ? { capture: { attempts, failures } } : {}),
    };

    const filename = fixtureFilename(callSite, recording.promptHash);
    await Deno.writeTextFile(`${this.options.dir}/${filename}`, JSON.stringify(recording, null, 2));
  }
}
