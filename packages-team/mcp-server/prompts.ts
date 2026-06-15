/**
 * @module MCPPrompts
 * @path packages-team/mcp-server/prompts.ts
 * @description Provides prompt templates for common Exaix operations, guiding agents through structured workflows.
 * @architectural-layer MCP
 * @related-files ["packages/storage-sqlite/src/database_service.ts"]
 */

import type { Config } from "@exaix/schemas/config.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { MessageRole } from "@exaix/core";
import { PORTAL_LABEL } from "@exaix/core";

// ============================================================================
// Types
// ============================================================================

export interface IMCPPrompt {
  name: string;
  description: string;
  arguments?: MCPPromptArgument[];
}

export interface MCPPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface MCPPromptMessage {
  role: MessageRole;
  content: {
    type: "text";
    text: string;
  };
}

export interface MCPPromptResult {
  description?: string;
  messages: MCPPromptMessage[];
}

// ============================================================================
// Prompt Definitions
// ============================================================================

/**
 * Get all available prompts
 */
export function getPrompts(): IMCPPrompt[] {
  return [
    {
      name: "execute_plan",
      description: "Execute an approved Exaix plan with guided steps",
      arguments: [
        {
          name: "plan_id",
          description: "UUID of the approved plan to execute",
          required: true,
        },
        {
          name: PORTAL_LABEL,
          description: "Target portal name where plan will be executed",
          required: true,
        },
      ],
    },
    {
      name: "create_review",
      description: "Create a review for code changes with git integration",
      arguments: [
        {
          name: PORTAL_LABEL,
          description: "Portal name where changes will be made",
          required: true,
        },
        {
          name: "description",
          description: "Description of the review purpose",
          required: true,
        },
        {
          name: "trace_id",
          description: "Request trace ID for tracking",
          required: true,
        },
      ],
    },
    {
      name: "commit_message",
      description: "Generate a structured commit message for changes in a portal",
      arguments: [
        {
          name: PORTAL_LABEL,
          description: "Portal name whose changes will be summarized",
          required: true,
        },
      ],
    },
  ];
}

/**
 * Get a specific prompt definition
 */
export function getPrompt(name: string): IMCPPrompt | null {
  const prompts = getPrompts();
  return prompts.find((p) => p.name === name) || null;
}

/**
 * Generate prompt messages for execute_plan
 */
export function generateExecutePlanPrompt(
  args: { plan_id: string; portal: string },
  logger?: IEventLogger,
): MCPPromptResult {
  const { plan_id, portal } = args;

  // Log prompt generation
  if (logger) {
    logger.info(DomainEventType.McpPromptsExecutePlan, plan_id, {
      portal,
    });
  }

  const messages: MCPPromptMessage[] = [
    {
      role: MessageRole.USER,
      content: {
        type: "text",
        text: `You are executing an Exaix plan in portal "${portal}".

**Plan ID:** ${plan_id}

**Your Task:**
1. Read the plan from the Memory Banks system
2. Verify the plan is approved and not already executed
3. Execute each action in the plan sequentially:
   - Use read_file to understand current code
   - Use write_file to make changes
   - Use git_status to verify changes
   - Use git_commit to commit each logical unit
4. Update the plan execution log as you progress
5. Handle errors gracefully and report failures

**Available Tools:**
- read_file(portal, path) - Read files from portal
- write_file(portal, path, content) - Write files to portal
- list_directory(portal, path) - List directory contents
- git_status(portal) - Check git status
- git_create_branch(portal, branch) - Create feature branch
- git_commit(portal, message, files?) - Commit changes

**Guidelines:**
- Always read files before modifying them
- Commit frequently with descriptive messages
- Include trace_id in commit messages: "feat: description [${plan_id}]"
- Verify changes with git_status before committing
- Report progress and any issues encountered

Begin executing the plan.`,
      },
    },
  ];

  return {
    description: `Execute plan ${plan_id} in portal ${portal}`,
    messages,
  };
}

/**
 * Generate prompt messages for create_review
 */
export function generateCreateReviewPrompt(
  args: { portal: string; description: string; trace_id: string },
  logger?: IEventLogger,
): MCPPromptResult {
  const { portal, description, trace_id } = args;

  // Log prompt generation
  if (logger) {
    logger.info(DomainEventType.McpPromptsCreateReview, trace_id, {
      portal,
      description,
    });
  }

  const messages: MCPPromptMessage[] = [
    {
      role: MessageRole.USER,
      content: {
        type: "text",
        text: `You are creating a review in portal "${portal}".

**Review Description:** ${description}

**Trace ID:** ${trace_id}

**Your Task:**
1. Create a feature branch for this review:
   - Use git_create_branch(portal, "feat/${trace_id}")
2. Make the necessary code changes:
   - Read existing files to understand context
   - Write modified files with your changes
3. Verify your changes:
   - Use git_status to see what changed
   - Review the diff mentally
4. Commit the review:
   - Use git_commit with a descriptive message
   - Include trace_id in message: "feat: ${description} [${trace_id}]"

**Available Tools:**
- read_file(portal, path) - Read files from portal
- write_file(portal, path, content) - Write files to portal
- list_directory(portal, path) - List directory contents
- git_status(portal) - Check git status
- git_create_branch(portal, branch) - Create feature branch
- git_commit(portal, message, files?) - Commit changes

**Guidelines:**
- Always create a feature branch before making changes
- Read files first to understand existing code
- Make focused, atomic changes
- Write clear commit messages explaining the change
- Include the trace_id in all commit messages
- Test your changes mentally before committing

Begin creating the review.`,
      },
    },
  ];

  return {
    description: `Create review: ${description}`,
    messages,
  };
}

/**
 * Prompt arguments
 */
interface PromptArgs {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Generate prompt messages based on prompt name and arguments
 */
export function generatePrompt(
  name: string,
  args: PromptArgs,
  _config: Config,
  logger?: IEventLogger,
): MCPPromptResult | null {
  switch (name) {
    case "execute_plan":
      return generateExecutePlanPrompt(
        args as { plan_id: string; portal: string },
        logger,
      );
    case "create_review":
      return generateCreateReviewPrompt(
        args as { portal: string; description: string; trace_id: string },
        logger,
      );
    case "commit_message":
      return generateCommitMessagePrompt(
        args as { portal: string },
        logger,
      );
    default:
      return null;
  }
}

/**
 * Generate prompt messages for commit_message
 */
export function generateCommitMessagePrompt(
  args: { portal: string },
  logger?: IEventLogger,
): MCPPromptResult {
  const { portal } = args;

  // Log prompt generation
  if (logger) {
    logger.info(DomainEventType.McpPromptsCommitMessage, null, {
      portal,
    });
  }

  const messages: MCPPromptMessage[] = [
    {
      role: MessageRole.USER,
      content: {
        type: "text",
        text: `You are a commit message assistant for Exaix in portal "${portal}".

**Your Task:**
1. Check the git status in the portal
2. Review the staged and unstaged changes
3. Generate a structured commit message following Exaix conventions

**Available Tools:**
- git_status(portal) - Check git status
- read_file(portal, path) - Read changes
- list_directory(portal, path) - Understand context

**Exaix Commit Message Schema:**
[type]: [subject]

what: <detailed explanation>
rationale: <why>
tests: <status of tests>
who: <your name>
impact: <component>: <details>

Available types: feat, fix, docs, style, refactor, perf, test, build, ci, chore.

Begin by analyzing the changes.`,
      },
    },
  ];

  return {
    description: `Generate commit message for portal ${portal}`,
    messages,
  };
}
