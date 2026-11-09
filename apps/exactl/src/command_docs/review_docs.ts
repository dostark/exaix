/**
 * @module ReviewCommandDocs
 * @path apps/exactl/src/command_docs/review_docs.ts
 * @description The doc records of the exactl review noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli, @exaix/core]
 * @related-files [apps/exactl/src/command_builders/review_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ReviewStatus } from "@exaix/core/status";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const REVIEW = ExaCtlCommandName.REVIEW;

export const REVIEW_NOUN_DOC: IExaCtlNounDoc = {
  noun: REVIEW,
  group: ExaCtlCommandGroup.WORK,
  summary: "Review the output that agents produce",
  description:
    "A review holds the code change or the artifact an agent produced for a request. You approve it to merge or accept it, or reject it with a reason.",
  lifecycle: [ReviewStatus.PENDING, ReviewStatus.APPROVED],
};

export const REVIEW_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [REVIEW, ExaCtlVerb.LIST],
    summary: "List the pending reviews",
    description: "Lists the reviews of code changes and artifacts. Filter with `--status` and `--type`.",
    examples: [
      { title: "List reviews", command: "exactl review list" },
      {
        title: "List approved code reviews as JSON",
        command: "exactl review list --status approved --type code -o json",
      },
    ],
    seeAlso: [exactlCommand(REVIEW, ExaCtlVerb.SHOW), exactlCommand(REVIEW, ExaCtlVerb.APPROVE)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [REVIEW, ExaCtlVerb.SHOW],
    summary: "Show the details and the diff of a review",
    description:
      "Prints the review summary, the verification state, the lint result, the commits and the diff. With `--diff` it prints only the diff.",
    examples: [
      { title: "Show a review", command: "exactl review show request-123" },
      { title: "Show only the diff", command: "exactl review show request-123 --diff" },
    ],
    seeAlso: [exactlCommand(REVIEW, ExaCtlVerb.APPROVE), exactlCommand(REVIEW, ExaCtlVerb.REJECT)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [REVIEW, ExaCtlVerb.APPROVE],
    summary: "Approve a review and merge its change",
    description: "Merges the branch of a code review into main, or marks an artifact review as approved.",
    examples: [{ title: "Approve a review", command: "exactl review approve request-123" }],
    seeAlso: [exactlCommand(REVIEW, ExaCtlVerb.SHOW), exactlCommand(REVIEW, ExaCtlVerb.REJECT)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [REVIEW, ExaCtlVerb.REJECT],
    summary: "Reject a review with a reason",
    description:
      "Deletes the branch of a code review, or marks an artifact review as rejected. The reason is required.",
    examples: [{ title: "Reject a review", command: 'exactl review reject request-123 --reason "Breaks the build"' }],
    seeAlso: [exactlCommand(REVIEW, ExaCtlVerb.SHOW), exactlCommand(REVIEW, ExaCtlVerb.APPROVE)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
];
