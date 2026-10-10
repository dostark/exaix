/**
 * @module NativeRoundLimits
 * @path packages/ai/src/native_round_limits.ts
 * @description Ceilings applied to one provider response before any tool effect. The compatible
 *   parser and the planning loop share these, so both refuse the same oversized round.
 * @architectural-layer AI
 * @related-files [packages/ai-openai/src/compatible_chat.ts, packages/execution/src/native_tool_turns.ts]
 */

/** Ceilings applied to one provider response before any tool effect. Fixed until the resolved
 *  tools.* configuration supplies them. */
export interface INativeRoundLimits {
  maxResponseCalls: number;
  maxArgumentBytes: number;
  maxRoundReplayBytes: number;
}

const FIXED_MAX_RESPONSE_CALLS = 64;
const FIXED_MAX_ARGUMENT_BYTES = 65536;
const FIXED_MAX_ROUND_REPLAY_BYTES = 1048576;

export const FIXED_NATIVE_ROUND_LIMITS: INativeRoundLimits = {
  maxResponseCalls: FIXED_MAX_RESPONSE_CALLS,
  maxArgumentBytes: FIXED_MAX_ARGUMENT_BYTES,
  maxRoundReplayBytes: FIXED_MAX_ROUND_REPLAY_BYTES,
};
