/**
 * @module PromptContext
 * @path packages/core/src/func/prompt_context.ts
 * @description Utility for building structured prompt context blocks,
 * including portal information and required actions.
 * @architectural-layer Services
 * @related-files ["packages/core/src/func/request_router.ts", "packages/core/src/func/agent_runner.ts"]
 */
import {
  PORTAL_CONTEXT_ALIAS_LABEL,
  PORTAL_CONTEXT_REPOSITORY_LABEL,
  PORTAL_CONTEXT_REQUIRED_ACTIONS,
  PORTAL_CONTEXT_REQUIRED_ACTIONS_TITLE,
  PORTAL_CONTEXT_ROOT_LABEL,
  PORTAL_CONTEXT_SECTION_TITLE,
} from "@exaix/core";

export interface IPortalContextArgs {
  portalAlias: string;
  portalRoot: string;
  repositoryRoot?: string;
  fileList?: string;
}

export function buildPortalContextBlock(args: IPortalContextArgs): string {
  const repositoryRoot = args.repositoryRoot ?? args.portalRoot;
  const requiredActions = PORTAL_CONTEXT_REQUIRED_ACTIONS
    .map((action) => `- ${action}`)
    .join("\n");

  const lines = [
    `## ${PORTAL_CONTEXT_SECTION_TITLE}`,
    `${PORTAL_CONTEXT_ALIAS_LABEL}: ${args.portalAlias}`,
    `${PORTAL_CONTEXT_ROOT_LABEL}: ${args.portalRoot}`,
    `${PORTAL_CONTEXT_REPOSITORY_LABEL}: ${repositoryRoot}`,
  ];

  if (args.fileList) {
    lines.push("", "### File List:", args.fileList);
  }

  lines.push(
    "",
    `${PORTAL_CONTEXT_REQUIRED_ACTIONS_TITLE}:`,
    requiredActions,
  );

  return lines.join("\n");
}
