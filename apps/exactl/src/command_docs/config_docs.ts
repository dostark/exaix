/**
 * @module ConfigCommandDocs
 * @path apps/exactl/src/command_docs/config_docs.ts
 * @description The doc records of the exactl config noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/config_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const CONFIG = ExaCtlCommandName.CONFIG;

export const CONFIG_NOUN_DOC: IExaCtlNounDoc = {
  noun: CONFIG,
  group: ExaCtlCommandGroup.OPERATIONS,
  summary: "View and change the Exaix configuration",
  description:
    "A key has a default, and an override replaces it. Every change goes through validation and is kept in an append-only history, so you can roll a key back. A lock stops all writes to a key, and the blocklist stops MCP writes only.",
  lifecycle: [],
};

export const CONFIG_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [CONFIG, ExaCtlVerb.GET],
    summary: "Print the effective value of a key",
    description: "Prints the value that the daemon uses for the key. `--profile` reads the value of a named profile.",
    examples: [
      { title: "Read a key", command: "exactl config get ai.timeout_ms" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlVerb.SET]),
      exactlCommand(...[CONFIG, ExaCtlVerb.SHOW]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [CONFIG, ExaCtlVerb.SET],
    summary: "Set a key",
    description:
      "Validates the value, writes it as an override and reloads the configuration. `--profile` writes it to a named profile.",
    examples: [
      { title: "Set a key", command: "exactl config set ai.timeout_ms 60000" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlVerb.GET]),
      exactlCommand(...[CONFIG, ExaCtlVerb.ROLLBACK]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [CONFIG, ExaCtlVerb.UNSET],
    summary: "Reset a key to its default",
    description: "Removes the override of the key, so the default applies again.",
    examples: [
      { title: "Reset a key", command: "exactl config unset ai.timeout_ms" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlVerb.SET]),
      exactlCommand(...[CONFIG, ExaCtlVerb.DIFF]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [CONFIG, ExaCtlVerb.HISTORY],
    summary: "Show the override history of a key",
    description: "Lists every override of the key, newest first. The history is append-only.",
    examples: [
      { title: "Show the history", command: "exactl config history ai.timeout_ms" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlVerb.ROLLBACK]),
      exactlCommand(...[CONFIG, ExaCtlVerb.SET]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [CONFIG, ExaCtlVerb.ROLLBACK],
    summary: "Revert a key to an earlier value",
    description:
      "Sets the key back to the value of a history id and appends a rollback row. Asks for confirmation first. Pass `--yes` to confirm without a prompt, as scripts must.",
    examples: [
      { title: "Roll a key back", command: "exactl config rollback ai.timeout_ms 3" },
      { title: "Roll back without a prompt", command: "exactl config rollback ai.timeout_ms 3 --yes" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlVerb.HISTORY]),
      exactlCommand(...[CONFIG, ExaCtlVerb.SET]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.CANCELLED],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [CONFIG, ExaCtlVerb.EDIT],
    summary: "Edit the overrides in your editor",
    description:
      "Opens the overrides in `$EDITOR`. It validates every change and applies them together when you close the editor. It needs a terminal and refuses under `--no-input`.",
    examples: [
      { title: "Edit the overrides", command: "exactl config edit" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlVerb.DIFF]),
      exactlCommand(...[CONFIG, ExaCtlVerb.VALIDATE]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [CONFIG, ExaCtlSubNoun.BLOCK, ExaCtlVerb.ADD],
    summary: "Block a key pattern from MCP writes",
    description: "Adds a glob pattern to the blocklist. MCP clients can then not write a key that matches it.",
    examples: [
      { title: "Block a pattern", command: "exactl config block add 'system.*' --reason \"Fixed by the admin\"" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlSubNoun.BLOCK, ExaCtlVerb.LIST]),
      exactlCommand(...[CONFIG, ExaCtlSubNoun.LOCK, ExaCtlVerb.ADD]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [CONFIG, ExaCtlSubNoun.BLOCK, ExaCtlVerb.REMOVE],
    summary: "Remove a blocklist pattern",
    description: "Removes the pattern from the blocklist.",
    examples: [
      { title: "Remove a pattern", command: "exactl config block remove 'system.*'" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlSubNoun.BLOCK, ExaCtlVerb.LIST]),
      exactlCommand(...[CONFIG, ExaCtlSubNoun.BLOCK, ExaCtlVerb.ADD]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [CONFIG, ExaCtlSubNoun.BLOCK, ExaCtlVerb.LIST],
    summary: "List the blocklist patterns",
    description: "Lists every pattern that MCP clients cannot write.",
    examples: [
      { title: "List the patterns", command: "exactl config block list" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlSubNoun.BLOCK, ExaCtlVerb.ADD]),
      exactlCommand(...[CONFIG, ExaCtlSubNoun.LOCK, ExaCtlVerb.LIST]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [CONFIG, ExaCtlVerb.COMPACT],
    summary: "Compact the override history",
    description:
      "Keeps one row per key in the override history. It recovers database space and loses the older rows. Asks for confirmation first. Pass `--yes` to confirm without a prompt, as scripts must.",
    examples: [
      { title: "Compact the history", command: "exactl config compact" },
      { title: "Compact without a prompt", command: "exactl config compact --yes" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlVerb.HISTORY]),
      exactlCommand(...[CONFIG, ExaCtlVerb.DIFF]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.USAGE, ExaCtlExitCode.CANCELLED],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [CONFIG, ExaCtlVerb.VALIDATE],
    summary: "Validate the configuration",
    description: "Validates the whole configuration, or one key. Without a path it checks every key.",
    examples: [
      { title: "Validate everything", command: "exactl config validate" },
      { title: "Validate one key", command: "exactl config validate ai.timeout_ms" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlVerb.SHOW]),
      exactlCommand(...[CONFIG, ExaCtlVerb.DIFF]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE, ExaCtlExitCode.INVALID],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [CONFIG, ExaCtlVerb.SHOW],
    summary: "Show the effective configuration",
    description:
      "Shows every setting with the value that applies. `--sources` lists the overridden keys with the source of each.",
    examples: [
      { title: "Show the configuration", command: "exactl config show" },
      { title: "Show the sources", command: "exactl config show --sources -o json" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlVerb.GET]),
      exactlCommand(...[CONFIG, ExaCtlVerb.DIFF]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [CONFIG, ExaCtlVerb.DIFF],
    summary: "Show the keys that differ from the defaults",
    description: "Lists every key whose value is not the default, with the default and the current value.",
    examples: [
      { title: "Show the differences", command: "exactl config diff" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlVerb.SHOW]),
      exactlCommand(...[CONFIG, ExaCtlVerb.UNSET]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [CONFIG, ExaCtlSubNoun.LOCK, ExaCtlVerb.ADD],
    summary: "Lock a key against writes",
    description: "Locks the key, so the CLI, MCP clients and the daemon cannot change it.",
    examples: [
      { title: "Lock a key", command: 'exactl config lock add ai.timeout_ms --reason "Tuned for the CI"' },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlSubNoun.LOCK, ExaCtlVerb.LIST]),
      exactlCommand(...[CONFIG, ExaCtlSubNoun.LOCK, ExaCtlVerb.REMOVE]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [CONFIG, ExaCtlSubNoun.LOCK, ExaCtlVerb.REMOVE],
    summary: "Unlock a key",
    description: "Removes the lock of the key.",
    examples: [
      { title: "Unlock a key", command: "exactl config lock remove ai.timeout_ms" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlSubNoun.LOCK, ExaCtlVerb.LIST]),
      exactlCommand(...[CONFIG, ExaCtlSubNoun.LOCK, ExaCtlVerb.ADD]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [CONFIG, ExaCtlSubNoun.LOCK, ExaCtlVerb.LIST],
    summary: "List the locked keys",
    description: "Lists every locked key with the name that locked it and the reason.",
    examples: [
      { title: "List the locks", command: "exactl config lock list" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlSubNoun.LOCK, ExaCtlVerb.ADD]),
      exactlCommand(...[CONFIG, ExaCtlSubNoun.BLOCK, ExaCtlVerb.LIST]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [CONFIG, ExaCtlSubNoun.PROFILE, ExaCtlVerb.USE],
    summary: "Set the active profile",
    description: "Makes the named profile the active one.",
    examples: [
      { title: "Use a profile", command: "exactl config profile use fast" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlSubNoun.PROFILE, ExaCtlVerb.LIST]),
      exactlCommand(...[CONFIG, ExaCtlVerb.SHOW]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.MUTATION,
  },
  {
    path: [CONFIG, ExaCtlSubNoun.PROFILE, ExaCtlVerb.LIST],
    summary: "List the profiles",
    description: "Lists every profile that has at least one override.",
    examples: [
      { title: "List the profiles", command: "exactl config profile list" },
    ],
    seeAlso: [
      exactlCommand(...[CONFIG, ExaCtlSubNoun.PROFILE, ExaCtlVerb.USE]),
      exactlCommand(...[CONFIG, ExaCtlVerb.SHOW]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
];
