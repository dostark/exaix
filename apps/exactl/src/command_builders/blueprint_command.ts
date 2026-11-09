/**
 * @module ExaCtlBlueprintCommand
 * @path apps/exactl/src/command_builders/blueprint_command.ts
 * @description Builds the exactl blueprint command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import type { BlueprintStatus } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IBlueprintValidationResult } from "@exaix/schemas/blueprint.ts";
import { ExaCtlOutputFormat, type IExaCtlColumn } from "@exaix/cli";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import {
  CLI_OPTION_MODEL,
  DEFAULT_CAPABILITIES_LABEL,
  ExaCtlCommandName,
  ExaCtlVerb,
  MutationStatus,
} from "../exactl_constants.ts";
import {
  actionOutput,
  cellText,
  ColumnHeader,
  type ExaCtlOutputRenderer,
  type IJsonRow,
  toRow,
} from "../output/exactl_output.ts";
import { failCommand } from "./command_failure.ts";
import { documentLeaves } from "./documented_children.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";

const AGENT_ID_ARGUMENT = "<agent-id>";
const LIST_HINT = 'Create a blueprint with: exactl blueprint create <agent-id> --name "Name" --model "provider:model"';

const BLUEPRINT_COLUMNS: readonly IExaCtlColumn<IJsonRow>[] = [
  { header: "Agent", value: (blueprint) => cellText(blueprint.agent_role) },
  { header: ColumnHeader.SUBJECT, value: (blueprint) => cellText(blueprint.name) },
  { header: "Model", value: (blueprint) => cellText(blueprint.model) },
  {
    header: "Capabilities",
    value: (blueprint) =>
      Array.isArray(blueprint.capabilities) && blueprint.capabilities.length > 0
        ? blueprint.capabilities.join(", ")
        : DEFAULT_CAPABILITIES_LABEL,
  },
  { header: ColumnHeader.STATUS, value: (blueprint) => cellText(blueprint.status) },
  { header: ColumnHeader.CREATED, value: (blueprint) => cellText(blueprint.created) },
];

function createBlueprintCommand(runtime: IExaCtlRuntime) {
  const { blueprintCommands } = runtime;
  const failed = (action: string, error: Error): never => failCommand(runtime.display, action, error);
  async function reportValidation(
    label: string,
    result: IBlueprintValidationResult,
    renderer: ExaCtlOutputRenderer,
    display: IExaCtlRuntime["display"],
  ): Promise<void> {
    if (renderer.machine) {
      await renderer.item(
        toRow({ valid: result.valid, errors: result.errors ?? [], warnings: result.warnings ?? [] }),
        [],
      );
    } else if (result.valid) {
      display.info("blueprint.valid", label, { status: "Valid ✓", warnings: result.warnings?.length || 0 });
    } else {
      display.error("blueprint.invalid", label, { status: "Invalid ✗", errors: result.errors });
    }
    if (!result.valid) Deno.exit(1);
  }
  function blueprintCreateCommand() {
    return new Command()
      .option("--name <name:string>", "Agent name (required)")
      .option(CLI_OPTION_MODEL, "Model in provider:model format (required)")
      .option("--description <description:string>", "Brief description")
      .option("--capabilities <capabilities:string>", "Comma-separated capabilities")
      .option("--system-prompt <prompt:string>", "Inline system prompt")
      .option("--system-prompt-file <file:string>", "Load system prompt from file")
      .option(
        "--from <agent-role-id:string>",
        "Clone an existing agent role as a prototype (seeds model, capabilities, and body)",
      )
      .action(async (options, ...args: string[]) => {
        const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
        try {
          const result = await blueprintCommands.create(args[0], {
            name: options.name,
            model: options.model,
            description: options.description,
            capabilities: options.capabilities,
            systemPrompt: options.systemPrompt,
            systemPromptFile: options.systemPromptFile,
            from: options.from,
          });
          display.info("blueprint.created", result.agent_role, {
            name: result.name,
            model: result.model,
            path: result.path,
          });
          await renderer.mutation(
            [{ id: result.agent_role, action: ExaCtlVerb.CREATE, status: MutationStatus.CREATED, path: result.path }],
            false,
          );
        } catch (error) {
          failed("blueprint create", error as Error);
        }
      });
  }

  function blueprintListCommand() {
    return new Command()
      .option("--capability <capability:string>", "Only show blueprints that declare this capability")
      .option("--status <status:string>", "Only show blueprints in this lifecycle status (active|deprecated)")
      .action(
        async (
          options: { capability?: Opt<string, Reason.OptionalInput>; status?: Opt<string, Reason.OptionalInput> },
        ) => {
          const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TABLE);
          try {
            const blueprints = await blueprintCommands.list({
              capability: options.capability,
              status: options.status as BlueprintStatus | undefined,
            });
            if (blueprints.length === 0 && !renderer.machine) {
              runtime.display.info("blueprint.list", "blueprints", { count: 0, hint: LIST_HINT });
              return;
            }
            await renderer.list(
              blueprints.map(toRow),
              BLUEPRINT_COLUMNS,
              (blueprint) => cellText(blueprint.agent_role),
            );
          } catch (error) {
            failed("blueprint list", error as Error);
          }
        },
      );
  }

  function blueprintShowCommand() {
    return new Command().action(async (options, ...args: string[]) => {
      const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      try {
        const blueprint = await blueprintCommands.show(args[0]);
        if (renderer.machine) {
          await renderer.item(toRow(blueprint), []);
          return;
        }
        display.info("blueprint.show", blueprint.agent_role, {
          name: blueprint.name,
          model: blueprint.model,
          capabilities: blueprint.capabilities?.join(", ") || DEFAULT_CAPABILITIES_LABEL,
          version: blueprint.version,
          created: blueprint.created,
          created_by: blueprint.created_by,
          content_preview: blueprint.content.substring(0, 200) + "...",
        });
      } catch (error) {
        failed("blueprint show", error as Error);
      }
    });
  }

  function blueprintEditCommand() {
    return new Command().action(async (options, ...args: string[]) => {
      const { renderer } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      try {
        await blueprintCommands.edit(args[0]);
        await renderer.mutation([{ id: args[0], action: ExaCtlVerb.EDIT, status: MutationStatus.EDITED }], false);
      } catch (error) {
        failed("blueprint edit", error as Error);
      }
    });
  }

  function blueprintRemoveCommand() {
    return new Command()
      .option("--force", "Skip confirmation")
      .action(async (options, ...args: string[]) => {
        const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
        try {
          await blueprintCommands.remove(args[0], { force: options.force });
          display.info("blueprint.removed", args[0], { status: "Removed ✓" });
          await renderer.mutation([{ id: args[0], action: ExaCtlVerb.REMOVE, status: MutationStatus.REMOVED }], false);
        } catch (error) {
          failed("blueprint remove", error as Error);
        }
      });
  }

  function blueprintDeprecateCommand() {
    return new Command().action(async (options, ...args: string[]) => {
      const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
      try {
        await blueprintCommands.deprecate(args[0]);
        display.info("blueprint.deprecated", args[0], { status: "Deprecated ✓" });
        await renderer.mutation(
          [{ id: args[0], action: ExaCtlVerb.DEPRECATE, status: MutationStatus.DEPRECATED }],
          false,
        );
      } catch (error) {
        failed("blueprint deprecate", error as Error);
      }
    });
  }

  function blueprintValidateCommand() {
    return new Command()
      .option("--file <path:string>", "Validate a blueprint file by path")
      .action(async (options: { file?: Opt<string, Reason.OptionalInput> }, ...args: string[]) => {
        const { renderer, display } = actionOutput(runtime, options, ExaCtlOutputFormat.TEXT);
        try {
          if (options.file) {
            await reportValidation(options.file, await blueprintCommands.validateFile(options.file), renderer, display);
            return;
          }
          if (!args[0]) throw new Error("Either <agent-id> or --file <path> is required");
          await reportValidation(args[0], await blueprintCommands.validate(args[0]), renderer, display);
        } catch (error) {
          failed("blueprint validate", error as Error);
        }
      });
  }

  const noun = nounDocFor(ExaCtlCommandName.BLUEPRINT);
  const command = documentedNoun(new Command(), noun)
    .command(`${ExaCtlVerb.CREATE} ${AGENT_ID_ARGUMENT}`, blueprintCreateCommand())
    .command(ExaCtlVerb.LIST, blueprintListCommand())
    .command(`${ExaCtlVerb.SHOW} ${AGENT_ID_ARGUMENT}`, blueprintShowCommand())
    .command(`${ExaCtlVerb.VALIDATE} [agent-id]`, blueprintValidateCommand())
    .command(`${ExaCtlVerb.EDIT} ${AGENT_ID_ARGUMENT}`, blueprintEditCommand())
    .command(`${ExaCtlVerb.REMOVE} ${AGENT_ID_ARGUMENT}`, blueprintRemoveCommand())
    .command(`${ExaCtlVerb.DEPRECATE} ${AGENT_ID_ARGUMENT}`, blueprintDeprecateCommand());
  documentLeaves(command, [ExaCtlCommandName.BLUEPRINT], noun.lifecycle);
  return command;
}

export function buildBlueprintCommand(runtime: IExaCtlRuntime): ReturnType<typeof createBlueprintCommand> {
  return createBlueprintCommand(runtime);
}
