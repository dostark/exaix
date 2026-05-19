/**
 * @module MCPPrompts
 * @path src/mcp/prompts.ts
 * @description Compatibility shim for the package-owned MCP prompt templates.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import {
  generateCommitMessagePrompt as generateCommitMessagePromptBase,
  generateCreateReviewPrompt as generateCreateReviewPromptBase,
  generateExecutePlanPrompt as generateExecutePlanPromptBase,
  generatePrompt as generatePromptBase,
  getPrompt as getPromptBase,
  getPrompts as getPromptsBase,
} from "@exaix/mcp/server";

import type {
  IMCPPrompt as IMCPPromptBase,
  MCPPromptArgument as MCPPromptArgumentBase,
  MCPPromptMessage as MCPPromptMessageBase,
  MCPPromptResult as MCPPromptResultBase,
} from "@exaix/mcp/server";

export type IMCPPrompt = IMCPPromptBase;
export type MCPPromptArgument = MCPPromptArgumentBase;
export type MCPPromptMessage = MCPPromptMessageBase;
export type MCPPromptResult = MCPPromptResultBase;

export function getPrompts(...args: Parameters<typeof getPromptsBase>): ReturnType<typeof getPromptsBase> {
  return getPromptsBase(...args);
}

export function getPrompt(...args: Parameters<typeof getPromptBase>): ReturnType<typeof getPromptBase> {
  return getPromptBase(...args);
}

export function generateExecutePlanPrompt(
  ...args: Parameters<typeof generateExecutePlanPromptBase>
): ReturnType<typeof generateExecutePlanPromptBase> {
  return generateExecutePlanPromptBase(...args);
}

export function generateCreateReviewPrompt(
  ...args: Parameters<typeof generateCreateReviewPromptBase>
): ReturnType<typeof generateCreateReviewPromptBase> {
  return generateCreateReviewPromptBase(...args);
}

export function generatePrompt(...args: Parameters<typeof generatePromptBase>): ReturnType<typeof generatePromptBase> {
  return generatePromptBase(...args);
}

export function generateCommitMessagePrompt(
  ...args: Parameters<typeof generateCommitMessagePromptBase>
): ReturnType<typeof generateCommitMessagePromptBase> {
  return generateCommitMessagePromptBase(...args);
}
