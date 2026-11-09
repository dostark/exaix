/**
 * @module ApprovalCommandDocs
 * @path apps/exactl/src/command_docs/approval_docs.ts
 * @description The doc records of the exactl approval noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/approval_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const APPROVAL = ExaCtlCommandName.APPROVAL;
const DECISION_EXIT_CODES = [ExaCtlExitCode.USAGE, ExaCtlExitCode.NOT_FOUND, ExaCtlExitCode.FAILURE];

export const APPROVAL_NOUN_DOC: IExaCtlNounDoc = {
  noun: APPROVAL,
  group: ExaCtlCommandGroup.WORK,
  summary: "Decide what waits for a human",
  description:
    "An approval is any item that waits for a human decision: a plan, a review, a clarification, a wait state or a tool confirmation. Name one by its reference, such as `wait:<resume-token>` or `tool:<confirmation-id>`.",
  lifecycle: [],
};

export const APPROVAL_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [APPROVAL, ExaCtlVerb.LIST],
    summary: "List every pending human decision",
    description:
      "Lists the pending items from every source with the command that decides each. Draft skills show only for the portal of `EXA_PORTAL`. Use `exactl skill list --portal <alias>` for another portal.",
    examples: [
      { title: "List what waits for you", command: "exactl approval list" },
      { title: "List only tool confirmations", command: "exactl approval list --kind tool -o json" },
    ],
    seeAlso: [exactlCommand(APPROVAL, ExaCtlVerb.SHOW), exactlCommand(APPROVAL, ExaCtlVerb.APPROVE)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [APPROVAL, ExaCtlVerb.SHOW],
    summary: "Show one pending approval",
    description:
      "Prints the kind of the item and its fields. Name it as `wait:<resume-token>` or `tool:<confirmation-id>`.",
    examples: [{
      title: "Show a wait state",
      command: "exactl approval show wait:550e8400-e29b-41d4-a716-446655440001",
    }],
    seeAlso: [exactlCommand(APPROVAL, ExaCtlVerb.LIST), exactlCommand(APPROVAL, ExaCtlVerb.APPROVE)],
    exitCodes: DECISION_EXIT_CODES,
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [APPROVAL, ExaCtlVerb.APPROVE],
    summary: "Approve a wait state or a tool confirmation",
    description: "Records your approval. Add a note with `--message`, or the actor that decides with `--resolved-by`.",
    examples: [{
      title: "Approve a tool confirmation",
      command: "exactl approval approve tool:123e4567-e89b-42d3-a456-426614174000",
    }],
    seeAlso: [exactlCommand(APPROVAL, ExaCtlVerb.REJECT), exactlCommand(APPROVAL, ExaCtlVerb.SHOW)],
    exitCodes: DECISION_EXIT_CODES,
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [APPROVAL, ExaCtlVerb.REJECT],
    summary: "Reject a wait state or deny a tool confirmation",
    description: "Records your refusal. A tool denial defaults to the reason `User declined`.",
    examples: [{
      title: "Deny a tool confirmation",
      command: 'exactl approval reject tool:123e4567-e89b-42d3-a456-426614174000 --reason "Not now"',
    }],
    seeAlso: [exactlCommand(APPROVAL, ExaCtlVerb.APPROVE), exactlCommand(APPROVAL, ExaCtlVerb.SHOW)],
    exitCodes: DECISION_EXIT_CODES,
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [APPROVAL, ExaCtlVerb.AMEND],
    summary: "Mark a wait state as amended",
    description: "Records that you changed what the wait state asked for. Add a note with `--message`.",
    examples: [{
      title: "Mark a wait state as amended",
      command: 'exactl approval amend wait:550e8400-e29b-41d4-a716-446655440001 --message "Scope reduced"',
    }],
    seeAlso: [exactlCommand(APPROVAL, ExaCtlVerb.APPROVE), exactlCommand(APPROVAL, ExaCtlVerb.SHOW)],
    exitCodes: DECISION_EXIT_CODES,
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [APPROVAL, ExaCtlVerb.EXPIRE],
    summary: "Expire a pending wait state",
    description: "Ends a wait state that nobody answered in time.",
    examples: [{
      title: "Expire a wait state",
      command: "exactl approval expire wait:550e8400-e29b-41d4-a716-446655440001",
    }],
    seeAlso: [exactlCommand(APPROVAL, ExaCtlVerb.CANCEL), exactlCommand(APPROVAL, ExaCtlVerb.SHOW)],
    exitCodes: DECISION_EXIT_CODES,
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [APPROVAL, ExaCtlVerb.CANCEL],
    summary: "Cancel a pending wait state",
    description: "Withdraws a wait state without a decision.",
    examples: [{
      title: "Cancel a wait state",
      command: "exactl approval cancel wait:550e8400-e29b-41d4-a716-446655440001",
    }],
    seeAlso: [exactlCommand(APPROVAL, ExaCtlVerb.EXPIRE), exactlCommand(APPROVAL, ExaCtlVerb.SHOW)],
    exitCodes: DECISION_EXIT_CODES,
    output: ExaCtlOutputKind.MUTATION,
  },
];
