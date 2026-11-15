/**
 * @module SkillCommandDocs
 * @path apps/exactl/src/command_docs/skill_docs.ts
 * @description The doc records of the exactl skill noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/skill_commands.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const SKILL = ExaCtlCommandName.SKILL;
const USAGE_FAILURES = [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.NOT_FOUND];

export const SKILL_NOUN_DOC: IExaCtlNounDoc = {
  noun: SKILL,
  group: ExaCtlCommandGroup.DEFINITIONS,
  summary: "Manage procedural skills",
  description:
    "A skill is a folder of instructions that a request can load. A new skill starts as a draft. Review it, then approve its revision to activate it.",
  lifecycle: [],
};

export const SKILL_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [SKILL, ExaCtlVerb.LIST],
    summary: "List skills",
    description: "Lists the skills of the current roots. `--all` also reports the folders that did not load.",
    examples: [
      { title: "List skills", command: "exactl skill list" },
      { title: "List learned skills as JSON", command: "exactl skill list --category learned -o json" },
    ],
    seeAlso: [exactlCommand(SKILL, ExaCtlVerb.SHOW), exactlCommand(SKILL, ExaCtlVerb.VALIDATE)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [SKILL, ExaCtlVerb.SHOW],
    summary: "Show a skill",
    description: "Shows the current skill and its usage. `--revision` shows one stored revision instead.",
    examples: [
      { title: "Show a skill", command: "exactl skill show code-review" },
      { title: "Show a stored revision", command: "exactl skill show code-review --revision <revision-uuid>" },
    ],
    seeAlso: [exactlCommand(SKILL, ExaCtlVerb.REVISIONS), exactlCommand(SKILL, ExaCtlVerb.LIST)],
    exitCodes: USAGE_FAILURES,
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [SKILL, ExaCtlVerb.MATCH],
    summary: "Match skills for a request",
    description: "Ranks the skills whose triggers match the request text. Narrow it with a task type or tags.",
    examples: [{ title: "Match a request", command: 'exactl skill match "review the pull request"' }],
    seeAlso: [exactlCommand(SKILL, ExaCtlVerb.SHOW), exactlCommand(SKILL, ExaCtlVerb.LIST)],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [SKILL, ExaCtlVerb.DERIVE],
    summary: "Derive a draft skill from learnings",
    description: "Writes a draft skill from the listed learning ids. Review the draft, then approve its revision.",
    examples: [{
      title: "Derive a skill",
      command: 'exactl skill derive --learning-ids l1,l2 --name "Retry Handling"',
    }],
    seeAlso: [exactlCommand(SKILL, ExaCtlVerb.APPROVE), exactlCommand(SKILL, ExaCtlVerb.SHOW)],
    exitCodes: USAGE_FAILURES,
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [SKILL, ExaCtlVerb.CREATE],
    summary: "Create a draft skill",
    description: "Writes a draft skill. It is not active until you approve the revision you reviewed.",
    examples: [{
      title: "Create a skill",
      command: 'exactl skill create "Retry Handling" -i "Retry with backoff." -k retry,backoff',
    }],
    seeAlso: [exactlCommand(SKILL, ExaCtlVerb.APPROVE), exactlCommand(SKILL, ExaCtlVerb.SHOW)],
    exitCodes: USAGE_FAILURES,
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [SKILL, ExaCtlVerb.APPROVE],
    summary: "Approve a reviewed skill revision",
    description: "Activates the draft. The revision must be the one that was reviewed, or the command fails.",
    examples: [{
      title: "Approve a revision",
      command: "exactl skill approve retry-handling --revision <revision-uuid>",
    }],
    seeAlso: [exactlCommand(SKILL, ExaCtlVerb.SHOW), exactlCommand(SKILL, ExaCtlVerb.DEPRECATE)],
    exitCodes: USAGE_FAILURES,
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [SKILL, ExaCtlVerb.DEPRECATE],
    summary: "Take a skill out of matching",
    description: "Stops the skill from matching. Approve a reviewed revision to bring it back.",
    examples: [{ title: "Deprecate a skill", command: "exactl skill deprecate retry-handling" }],
    seeAlso: [exactlCommand(SKILL, ExaCtlVerb.APPROVE), exactlCommand(SKILL, ExaCtlVerb.REVISIONS)],
    exitCodes: USAGE_FAILURES,
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [SKILL, ExaCtlVerb.REVISIONS],
    summary: "List the stored revisions of a skill",
    description: "Lists every stored revision with its hash, first sighting and use counts.",
    examples: [{ title: "List revisions", command: "exactl skill revisions retry-handling" }],
    seeAlso: [exactlCommand(SKILL, ExaCtlVerb.SHOW), exactlCommand(SKILL, ExaCtlVerb.APPROVE)],
    exitCodes: USAGE_FAILURES,
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [SKILL, ExaCtlVerb.USAGE],
    summary: "Show the skill usage of one trace",
    description: "Lists every model call of the trace that carried a skill, joined to the revision it used.",
    examples: [{ title: "Show usage", command: "exactl skill usage --trace 0b1c2d3e" }],
    seeAlso: [exactlCommand(SKILL, ExaCtlVerb.REVISIONS), exactlCommand(SKILL, ExaCtlVerb.SHOW)],
    exitCodes: USAGE_FAILURES,
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [SKILL, ExaCtlVerb.VALIDATE],
    summary: "Validate the skill roots",
    description:
      "Reports the typed validation reasons for the current skill roots. It exits with a failure when a skill is invalid.",
    examples: [
      { title: "Validate every skill", command: "exactl skill validate" },
      { title: "Validate one skill", command: "exactl skill validate retry-handling" },
    ],
    seeAlso: [exactlCommand(SKILL, ExaCtlVerb.LIST), exactlCommand(SKILL, ExaCtlVerb.SHOW)],
    exitCodes: [...USAGE_FAILURES, ExaCtlExitCode.INVALID],
    output: ExaCtlOutputKind.ITEM,
  },
];
