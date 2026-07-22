/**
 * @module AnthropicRequestSchema
 * @path packages/ai-anthropic/src/anthropic_request_schema.ts
 * @description Zod schema for the subset of Anthropic's Messages API request contract
 *   (docs.anthropic.com/en/api/messages) that AnthropicProvider actually sends, used to
 *   validate the outbound request body before it is sent — surfacing a malformed request
 *   as a debug-level log entry instead of an opaque 4xx from the API.
 * @architectural-layer AI
 * @related-files [packages/ai-anthropic/src/anthropic_provider.ts]
 */

import { z } from "zod";
import {
  ANTHROPIC_CACHE_CONTROL_EPHEMERAL,
  ANTHROPIC_CONTENT_TYPE_TEXT,
  ANTHROPIC_CONTENT_TYPE_TOOL_RESULT,
  ANTHROPIC_CONTENT_TYPE_TOOL_USE,
  ANTHROPIC_MESSAGE_ROLE_ASSISTANT,
  ANTHROPIC_MESSAGE_ROLE_USER,
  ANTHROPIC_THINKING_DISABLED,
  ANTHROPIC_TOOL_CHOICE_ANY,
  ANTHROPIC_TOOL_CHOICE_AUTO,
  ANTHROPIC_TOOL_CHOICE_NONE,
  ANTHROPIC_TOOL_CHOICE_TOOL,
} from "./constants.ts";

const AnthropicCacheControlSchema = z.object({
  type: z.literal(ANTHROPIC_CACHE_CONTROL_EPHEMERAL),
});

const AnthropicTextContentBlockSchema = z.object({
  type: z.literal(ANTHROPIC_CONTENT_TYPE_TEXT),
  text: z.string().min(1),
  cache_control: AnthropicCacheControlSchema.optional(),
});

const AnthropicToolUseContentBlockSchema = z.object({
  type: z.literal(ANTHROPIC_CONTENT_TYPE_TOOL_USE),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.unknown()),
});

const AnthropicToolResultContentBlockSchema = z.object({
  type: z.literal(ANTHROPIC_CONTENT_TYPE_TOOL_RESULT),
  tool_use_id: z.string().min(1),
  content: z.union([z.string(), z.array(z.record(z.unknown())).min(1)]),
  is_error: z.boolean().optional(),
});

const AnthropicContentBlockSchema = z.union([
  AnthropicTextContentBlockSchema,
  AnthropicToolUseContentBlockSchema,
  AnthropicToolResultContentBlockSchema,
]);

const AnthropicMessageSchema = z.object({
  role: z.union([z.literal(ANTHROPIC_MESSAGE_ROLE_USER), z.literal(ANTHROPIC_MESSAGE_ROLE_ASSISTANT)]),
  content: z.union([z.string().min(1), z.array(AnthropicContentBlockSchema).min(1)]),
});

/** The subset of the Messages API request body AnthropicProvider.attemptGenerate constructs. */
export const AnthropicMessagesRequestSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  messages: z.array(AnthropicMessageSchema).min(1),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string()).optional(),
  thinking: z.object({ type: z.literal(ANTHROPIC_THINKING_DISABLED) }).optional(),
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    input_schema: z.record(z.unknown()),
    type: z.string().optional(),
    strict: z.boolean().optional(),
    cache_control: AnthropicCacheControlSchema.optional(),
    input_examples: z.array(z.record(z.unknown())).optional(),
  })).optional(),
  tool_choice: z.union([
    z.object({ type: z.literal(ANTHROPIC_TOOL_CHOICE_AUTO), disable_parallel_tool_use: z.boolean().optional() }),
    z.object({ type: z.literal(ANTHROPIC_TOOL_CHOICE_ANY), disable_parallel_tool_use: z.boolean().optional() }),
    z.object({
      type: z.literal(ANTHROPIC_TOOL_CHOICE_TOOL),
      name: z.string().min(1),
      disable_parallel_tool_use: z.boolean().optional(),
    }),
    z.object({ type: z.literal(ANTHROPIC_TOOL_CHOICE_NONE) }),
  ]).optional(),
});

export type AnthropicMessagesRequest = z.infer<typeof AnthropicMessagesRequestSchema>;
