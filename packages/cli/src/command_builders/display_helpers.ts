/**
 * @module DisplayHelpers
 * @path packages/cli/src/command_builders/display_helpers.ts
 * @related-files []
 * @description Shared display helper utilities for plan and request CLI action builders.
 * @architectural-layer CLI
 * @ungrounded
 */

import type { JSONObject } from "@exaix/core/types";

interface WithTokenFields {
  input_tokens?: string | number;
  output_tokens?: string | number;
  total_tokens?: string | number;
  token_provider?: string;
  token_model?: string;
  token_cost_usd?: string | number;
}

export function addTokenFields(displayData: JSONObject, metadata: WithTokenFields): void {
  if (metadata.input_tokens !== undefined) displayData.input_tokens = metadata.input_tokens;
  if (metadata.output_tokens !== undefined) displayData.output_tokens = metadata.output_tokens;
  if (metadata.total_tokens !== undefined) displayData.total_tokens = metadata.total_tokens;
  if (metadata.token_provider !== undefined) displayData.token_provider = metadata.token_provider;
  if (metadata.token_model !== undefined) displayData.token_model = metadata.token_model;
  if (metadata.token_cost_usd !== undefined) displayData.token_cost_usd = metadata.token_cost_usd;
}
