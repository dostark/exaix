/**
 * @module ExaCtlCommandDocs
 * @path apps/exactl/src/command_docs/mod.ts
 * @description The static doc records of every documented exactl noun and leaf, and the lookups the builders use.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_docs/plan_docs.ts, apps/exactl/src/command_docs/daemon_docs.ts]
 */

import type { IExaCtlCommandDoc } from "@exaix/cli";
import type { IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import type { ExaCtlCommandName } from "../exactl_constants.ts";
import { DAEMON_DOCS, DAEMON_NOUN_DOC } from "./daemon_docs.ts";
import { APPROVAL_DOCS, APPROVAL_NOUN_DOC } from "./approval_docs.ts";
import { BLUEPRINT_DOCS, BLUEPRINT_NOUN_DOC } from "./blueprint_docs.ts";
import { FLOW_DOCS, FLOW_NOUN_DOC } from "./flow_docs.ts";
import { CONFIG_DOCS, CONFIG_NOUN_DOC } from "./config_docs.ts";
import { DASHBOARD_DOCS } from "./dashboard_docs.ts";
import { GIT_DOCS, GIT_NOUN_DOC } from "./git_docs.ts";
import { LOG_DOCS, LOG_NOUN_DOC } from "./log_docs.ts";
import { MCP_DOCS, MCP_NOUN_DOC } from "./mcp_docs.ts";
import { MODEL_DOCS, MODEL_NOUN_DOC } from "./model_docs.ts";
import { MEMORY_DOCS, MEMORY_NOUN_DOC } from "./memory_docs.ts";
import { PLAN_DOCS, PLAN_NOUN_DOC } from "./plan_docs.ts";
import { PORTAL_DOCS, PORTAL_NOUN_DOC } from "./portal_docs.ts";
import { REQUEST_DOCS, REQUEST_NOUN_DOC } from "./request_docs.ts";
import { REVIEW_DOCS, REVIEW_NOUN_DOC } from "./review_docs.ts";
import { SKILL_DOCS, SKILL_NOUN_DOC } from "./skill_docs.ts";

export const EXACTL_NOUN_DOCS: readonly IExaCtlNounDoc[] = [
  REQUEST_NOUN_DOC,
  PLAN_NOUN_DOC,
  REVIEW_NOUN_DOC,
  APPROVAL_NOUN_DOC,
  DAEMON_NOUN_DOC,
  FLOW_NOUN_DOC,
  BLUEPRINT_NOUN_DOC,
  SKILL_NOUN_DOC,
  PORTAL_NOUN_DOC,
  MEMORY_NOUN_DOC,
  GIT_NOUN_DOC,
  MCP_NOUN_DOC,
  CONFIG_NOUN_DOC,
  LOG_NOUN_DOC,
  MODEL_NOUN_DOC,
];

export const EXACTL_COMMAND_DOCS: readonly IExaCtlCommandDoc[] = [
  ...REQUEST_DOCS,
  ...PLAN_DOCS,
  ...REVIEW_DOCS,
  ...APPROVAL_DOCS,
  ...DAEMON_DOCS,
  ...FLOW_DOCS,
  ...BLUEPRINT_DOCS,
  ...SKILL_DOCS,
  ...PORTAL_DOCS,
  ...MEMORY_DOCS,
  ...GIT_DOCS,
  ...MCP_DOCS,
  ...DASHBOARD_DOCS,
  ...CONFIG_DOCS,
  ...LOG_DOCS,
  ...MODEL_DOCS,
];

const PATH_SEPARATOR = " ";

/** The record of the leaf at `path`. A builder that asks for a missing record fails at start-up. */
export function commandDocFor(path: readonly string[]): IExaCtlCommandDoc {
  const key = path.join(PATH_SEPARATOR);
  const doc = EXACTL_COMMAND_DOCS.find((candidate) => candidate.path.join(PATH_SEPARATOR) === key);
  if (doc === undefined) throw new Error(`COMMAND_DOC_MISSING: ${key}`);
  return doc;
}

/** The record of a root noun. */
export function nounDocFor(noun: ExaCtlCommandName): IExaCtlNounDoc {
  const doc = EXACTL_NOUN_DOCS.find((candidate) => candidate.noun === noun);
  if (doc === undefined) throw new Error(`NOUN_DOC_MISSING: ${noun}`);
  return doc;
}
