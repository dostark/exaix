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
import { ANTHROPIC_CACHE_CONTROL_EPHEMERAL, ANTHROPIC_CONTENT_TYPE_TEXT } from "./constants.ts";

const AnthropicCacheControlSchema = z.object({
  type: z.literal(ANTHROPIC_CACHE_CONTROL_EPHEMERAL),
});

const AnthropicTextContentBlockSchema = z.object({
  type: z.literal(ANTHROPIC_CONTENT_TYPE_TEXT),
  text: z.string().min(1),
  cache_control: AnthropicCacheControlSchema.optional(),
});

const AnthropicMessageSchema = z.object({
  role: z.literal("user"),
  content: z.union([z.string().min(1), z.array(AnthropicTextContentBlockSchema).min(1)]),
});

/** The subset of the Messages API request body AnthropicProvider.attemptGenerate constructs. */
export const AnthropicMessagesRequestSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  messages: z.array(AnthropicMessageSchema).min(1),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string()).optional(),
});

export type AnthropicMessagesRequest = z.infer<typeof AnthropicMessagesRequestSchema>;
