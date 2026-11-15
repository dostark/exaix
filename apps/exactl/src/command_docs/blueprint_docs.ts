/**
 * @module BlueprintCommandDocs
 * @path apps/exactl/src/command_docs/blueprint_docs.ts
 * @description The doc records of the exactl blueprint noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/blueprint_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const BLUEPRINT = ExaCtlCommandName.BLUEPRINT;

export const BLUEPRINT_NOUN_DOC: IExaCtlNounDoc = {
  noun: BLUEPRINT,
  group: ExaCtlCommandGroup.DEFINITIONS,
  summary: "Manage the blueprints of agent roles",
  description:
    "A blueprint is the file that defines an agent role: its model, its capabilities and its system prompt. A deprecated blueprint stays on disk but no new request uses it.",
  lifecycle: [],
};

export const BLUEPRINT_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [BLUEPRINT, ExaCtlVerb.CREATE],
    summary: "Create a new agent blueprint",
    description:
      "Writes the blueprint file of a new agent role. Seed it from an existing role with `--from`, or give the prompt inline or from a file.",
    examples: [
      {
        title: "Create a blueprint",
        command: 'exactl blueprint create code-reviewer --name "Code Reviewer" --model anthropic:claude-sonnet-5-5',
      },
      { title: "Clone a blueprint", command: "exactl blueprint create reviewer-2 --from code-reviewer" },
    ],
    seeAlso: [exactlCommand(BLUEPRINT, ExaCtlVerb.VALIDATE), exactlCommand(BLUEPRINT, ExaCtlVerb.LIST)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [BLUEPRINT, ExaCtlVerb.LIST],
    summary: "List the agent blueprints",
    description:
      'Lists every blueprint with its model, capabilities and status. Filter with `--capability` and `--status`. Create the first one with `exactl blueprint create <agent-id> --name "Name" --model "provider:model"`.',
    examples: [
      { title: "List blueprints", command: "exactl blueprint list" },
      { title: "List active blueprints as JSON", command: "exactl blueprint list --status active -o json" },
    ],
    seeAlso: [exactlCommand(BLUEPRINT, ExaCtlVerb.SHOW), exactlCommand(BLUEPRINT, ExaCtlVerb.CREATE)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [BLUEPRINT, ExaCtlVerb.SHOW],
    summary: "Show the details of one blueprint",
    description: "Prints the name, the model, the capabilities, the version and a preview of the blueprint body.",
    examples: [{ title: "Show a blueprint", command: "exactl blueprint show code-reviewer" }],
    seeAlso: [exactlCommand(BLUEPRINT, ExaCtlVerb.EDIT), exactlCommand(BLUEPRINT, ExaCtlVerb.VALIDATE)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [BLUEPRINT, ExaCtlVerb.VALIDATE],
    summary: "Validate a blueprint file",
    description:
      "Checks a blueprint by agent id, or any blueprint file with `--file`. It exits with a failure when the blueprint is invalid.",
    examples: [
      { title: "Validate a blueprint", command: "exactl blueprint validate code-reviewer" },
      { title: "Validate a file", command: "exactl blueprint validate --file agents/code-reviewer.md" },
    ],
    seeAlso: [exactlCommand(BLUEPRINT, ExaCtlVerb.SHOW), exactlCommand(BLUEPRINT, ExaCtlVerb.EDIT)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.INVALID],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [BLUEPRINT, ExaCtlVerb.EDIT],
    summary: "Edit a blueprint in your editor",
    description:
      "Opens the blueprint file in `$EDITOR` and validates it when you close the editor. It needs a terminal and refuses under `--no-input`.",
    examples: [{ title: "Edit a blueprint", command: "exactl blueprint edit code-reviewer" }],
    seeAlso: [exactlCommand(BLUEPRINT, ExaCtlVerb.VALIDATE), exactlCommand(BLUEPRINT, ExaCtlVerb.SHOW)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND, ExaCtlExitCode.USAGE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [BLUEPRINT, ExaCtlVerb.REMOVE],
    summary: "Remove a blueprint",
    description:
      "Deletes the blueprint file. Asks for confirmation first. Pass `--yes` to confirm without a prompt, as scripts must.",
    examples: [{ title: "Remove a blueprint", command: "exactl blueprint remove old-reviewer" }, {
      title: "Remove without a prompt",
      command: "exactl blueprint remove old-reviewer --yes",
    }],
    seeAlso: [exactlCommand(BLUEPRINT, ExaCtlVerb.DEPRECATE), exactlCommand(BLUEPRINT, ExaCtlVerb.LIST)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND, ExaCtlExitCode.USAGE, ExaCtlExitCode.CANCELLED],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [BLUEPRINT, ExaCtlVerb.DEPRECATE],
    summary: "Retire a blueprint without deleting it",
    description: "Marks the blueprint as deprecated. The file stays on disk, and no new request uses the role.",
    examples: [{ title: "Deprecate a blueprint", command: "exactl blueprint deprecate old-reviewer" }],
    seeAlso: [exactlCommand(BLUEPRINT, ExaCtlVerb.REMOVE), exactlCommand(BLUEPRINT, ExaCtlVerb.LIST)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.MUTATION,
  },
];
