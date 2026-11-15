/**
 * @module PlanCommandDocs
 * @path apps/exactl/src/command_docs/plan_docs.ts
 * @description The doc records of the exactl plan noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli, @exaix/core]
 * @related-files [apps/exactl/src/command_builders/plan_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { PlanStatus } from "@exaix/core/status";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { exactlCommand } from "./doc_helpers.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";

const PLAN = ExaCtlCommandName.PLAN;

export const PLAN_NOUN_DOC: IExaCtlNounDoc = {
  noun: PLAN,
  group: ExaCtlCommandGroup.WORK,
  summary: "Review and decide AI-generated plans",
  description:
    "A plan is the step-by-step proposal an agent writes for a request. It waits in review until a human approves, rejects or revises it.\n\nApproving a plan moves it to the active workspace, where the daemon executes it.",
  lifecycle: [PlanStatus.REVIEW, PlanStatus.APPROVED, PlanStatus.ACTIVE, PlanStatus.COMPLETED],
};

/** The summary of the `plan amendment` sub-noun. */
export const PLAN_AMENDMENT_SUMMARY = "Manage plan amendments for paused executions";

export const PLAN_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [PLAN, ExaCtlVerb.LIST],
    summary: "List plans awaiting review",
    description: "Lists the plans in review and the plans that need revision. Filter with `--status`.",
    examples: [
      { title: "List every plan", command: "exactl plan list" },
      { title: "List plans in review as JSON", command: "exactl plan list --status review -o json" },
    ],
    seeAlso: [exactlCommand(PLAN, ExaCtlVerb.SHOW), exactlCommand(PLAN, ExaCtlVerb.APPROVE)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [PLAN, ExaCtlVerb.SHOW],
    summary: "Show the details of one plan",
    description: "Prints the plan metadata, its token usage and its content.",
    examples: [{ title: "Show a plan", command: "exactl plan show plan-123" }],
    seeAlso: [exactlCommand(PLAN, ExaCtlVerb.LIST), exactlCommand(PLAN, ExaCtlVerb.APPROVE)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [PLAN, ExaCtlVerb.APPROVE],
    summary: "Approve plans and move them to the active workspace",
    description:
      "Approves each plan you name. With `--all` it approves every plan in review. `--all` asks for confirmation first. Pass `--yes` to confirm without a prompt, as scripts must.",
    examples: [
      { title: "Approve one plan", command: "exactl plan approve plan-123" },
      { title: "Approve every plan in review", command: "exactl plan approve --all" },
      { title: "Approve every plan without a prompt", command: "exactl plan approve --all --yes" },
    ],
    seeAlso: [exactlCommand(PLAN, ExaCtlVerb.SHOW), exactlCommand(PLAN, ExaCtlVerb.REJECT)],
    exitCodes: [
      ExaCtlExitCode.FAILURE,
      ExaCtlExitCode.USAGE,
      ExaCtlExitCode.NOT_FOUND,
      ExaCtlExitCode.STATE_CONFLICT,
      ExaCtlExitCode.CANCELLED,
    ],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [PLAN, ExaCtlVerb.REJECT],
    summary: "Reject a plan with a reason",
    description: "Rejects the plan and records why. The reason is required.",
    examples: [{ title: "Reject a plan", command: 'exactl plan reject plan-123 --reason "Scope is too wide"' }],
    seeAlso: [exactlCommand(PLAN, ExaCtlVerb.REVISE), exactlCommand(PLAN, ExaCtlVerb.SHOW)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [PLAN, ExaCtlVerb.REVISE],
    summary: "Request a revision with review comments",
    description: "Sends the plan back to the agent with your comments. Repeat `--comment` for several comments.",
    examples: [{ title: "Request a revision", command: 'exactl plan revise plan-123 --comment "Add a rollback step"' }],
    seeAlso: [exactlCommand(PLAN, ExaCtlVerb.REJECT), exactlCommand(PLAN, ExaCtlVerb.SHOW)],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.LIST],
    summary: "List plans awaiting amendment approval",
    description: "Lists the plans whose execution paused with a proposed amendment.",
    examples: [{ title: "List pending amendments", command: "exactl plan amendment list" }],
    seeAlso: [
      exactlCommand(PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.SHOW),
      exactlCommand(PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.APPROVE),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.SHOW],
    summary: "Show the details of proposed amendments",
    description:
      "Prints the added, updated and removed steps of each amendment. With `--all` it shows every proposed amendment.",
    examples: [
      { title: "Show one amendment", command: "exactl plan amendment show plan-123" },
      { title: "Show every amendment", command: "exactl plan amendment show --all" },
    ],
    seeAlso: [
      exactlCommand(PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.LIST),
      exactlCommand(PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.APPROVE),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.APPROVE],
    summary: "Approve plan amendments",
    description:
      "Approves each amendment you name and lets the paused execution continue. With `--all` it approves every proposed amendment. `--all` asks for confirmation first. Pass `--yes` to confirm without a prompt, as scripts must.",
    examples: [
      { title: "Approve one amendment", command: "exactl plan amendment approve plan-123" },
      { title: "Approve every amendment", command: "exactl plan amendment approve --all" },
      { title: "Approve every amendment without a prompt", command: "exactl plan amendment approve --all --yes" },
    ],
    seeAlso: [
      exactlCommand(PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.SHOW),
      exactlCommand(PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.REJECT),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.NOT_FOUND, ExaCtlExitCode.CANCELLED],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.REJECT],
    summary: "Reject a plan amendment with a reason",
    description: "Rejects the amendment and records why. The reason is required.",
    examples: [{
      title: "Reject an amendment",
      command: 'exactl plan amendment reject plan-123 --reason "Out of scope"',
    }],
    seeAlso: [
      exactlCommand(PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.SHOW),
      exactlCommand(PLAN, ExaCtlSubNoun.AMENDMENT, ExaCtlVerb.APPROVE),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.NOT_FOUND],
    output: ExaCtlOutputKind.MUTATION,
  },
];
