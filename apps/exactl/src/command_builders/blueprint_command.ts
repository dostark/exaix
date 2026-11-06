/**
 * @module ExaCtlBlueprintCommand
 * @path apps/exactl/src/command_builders/blueprint_command.ts
 * @description Builds the exactl blueprint command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { type BlueprintStatus, DEFAULT_UNKNOWN_ERROR_MESSAGE, RequestOperation } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IBlueprintMetadata, IBlueprintValidationResult } from "@exaix/schemas/blueprint.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import {
  BLUEPRINT_CLI_LABELS,
  DEFAULT_CAPABILITIES_LABEL,
  DISPLAY_CATEGORY_BLUEPRINTS,
  type IBlueprintCliLabels,
} from "../exactl_constants.ts";

function blueprintSummary(blueprint: IBlueprintMetadata) {
  return {
    model: blueprint.model,
    capabilities: blueprint.capabilities?.join(", ") || DEFAULT_CAPABILITIES_LABEL,
  };
}

function createBlueprintCommand(runtime: IExaCtlRuntime) {
  const { display, blueprintCommands } = runtime;
  function reportValidation(label: string, result: IBlueprintValidationResult): void {
    if (result.valid) {
      display.info("blueprint.valid", label, { status: "Valid ✓", warnings: result.warnings?.length || 0 });
    } else {
      display.error("blueprint.invalid", label, { status: "Invalid ✗", errors: result.errors });
      Deno.exit(1);
    }
  }
  function blueprintCreateCommand(labels: IBlueprintCliLabels) {
    return new Command()
      .description(labels.createDescription)
      .option("-n, --name <name:string>", labels.nameOption)
      .option("-m, --model <model:string>", "Model in provider:model format (required)")
      .option("-d, --description <description:string>", "Brief description")
      .option("-c, --capabilities <capabilities:string>", "Comma-separated capabilities")
      .option("-p, --system-prompt <prompt:string>", "Inline system prompt")
      .option("-f, --system-prompt-file <file:string>", "Load system prompt from file")
      .option(
        "--from <agent-role-id:string>",
        "Clone an existing agent role as a prototype (seeds model, capabilities, and body)",
      )
      .action(async (options, ...args: string[]) => {
        const agentRole = args[0];
        try {
          const result = await blueprintCommands.create(agentRole, {
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
        } catch (error) {
          display.error("cli.error", "blueprint create", {
            message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
          });
          Deno.exit(1);
        }
      });
  }

  function blueprintListCommand(labels: IBlueprintCliLabels) {
    return new Command()
      .description(labels.listDescription)
      .option("--capability <capability:string>", "Only show blueprints that declare this capability")
      .option("--status <status:string>", "Only show blueprints in this lifecycle status (active|deprecated)")
      .action(
        async (
          options: { capability?: Opt<string, Reason.OptionalInput>; status?: Opt<string, Reason.OptionalInput> },
        ) => {
          try {
            const blueprints = await blueprintCommands.list({
              capability: options.capability,
              status: options.status as BlueprintStatus | undefined,
            });
            if (blueprints.length === 0) {
              display.info("blueprint.list", DISPLAY_CATEGORY_BLUEPRINTS, {
                count: 0,
                hint: labels.listHint,
              });
              return;
            }
            display.info("blueprint.list", DISPLAY_CATEGORY_BLUEPRINTS, { count: blueprints.length });
            for (const blueprint of blueprints) {
              display.info(blueprint.agent_role, blueprint.name, {
                ...blueprintSummary(blueprint),
                status: blueprint.status,
                created: blueprint.created,
              });
            }
          } catch (error) {
            display.error("cli.error", "blueprint list", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        },
      );
  }

  function blueprintShowCommand(labels: IBlueprintCliLabels) {
    return new Command()
      .description(labels.showDescription)
      .action(async (_options, ...args: string[]) => {
        const agentRole = args[0];
        try {
          const blueprint = await blueprintCommands.show(agentRole);
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
          display.error("cli.error", "blueprint show", {
            message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
          });
          Deno.exit(1);
        }
      });
  }

  function blueprintEditCommand(labels: IBlueprintCliLabels) {
    return new Command()
      .description(labels.editDescription)
      .action(async (_options, ...args: string[]) => {
        const agentRole = args[0];
        try {
          await blueprintCommands.edit(agentRole);
        } catch (error) {
          display.error("cli.error", "blueprint edit", {
            message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
          });
          Deno.exit(1);
        }
      });
  }

  function blueprintRemoveCommand(labels: IBlueprintCliLabels) {
    return new Command()
      .description(labels.removeDescription)
      .option("--force", "Skip confirmation")
      .action(async (options, ...args: string[]) => {
        const agentRole = args[0];
        try {
          await blueprintCommands.remove(agentRole, { force: options.force });
          display.info("blueprint.removed", agentRole, { status: "Removed ✓" });
        } catch (error) {
          display.error("cli.error", "blueprint remove", {
            message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
          });
          Deno.exit(1);
        }
      });
  }

  function blueprintDeprecateCommand(labels: IBlueprintCliLabels) {
    return new Command()
      .description(labels.deprecateDescription)
      .action(async (_options, ...args: string[]) => {
        const agentRole = args[0];
        try {
          await blueprintCommands.deprecate(agentRole);
          display.info("blueprint.deprecated", agentRole, { status: "Deprecated ✓" });
        } catch (error) {
          display.error("cli.error", "blueprint deprecate", {
            message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
          });
          Deno.exit(1);
        }
      });
  }
  return new Command()
    .description("Manage agent blueprints")
    .command("create <agent-id>", blueprintCreateCommand(BLUEPRINT_CLI_LABELS))
    .command(RequestOperation.LIST, blueprintListCommand(BLUEPRINT_CLI_LABELS))
    .command("show <agent-id>", blueprintShowCommand(BLUEPRINT_CLI_LABELS))
    .command(
      "validate [agent-id]",
      new Command()
        .description("Validate blueprint format")
        .option("--file <path:string>", "Validate a blueprint file by path")
        .action(async (options: { file?: Opt<string, Reason.OptionalInput> }, ...args: string[]) => {
          try {
            if (options.file) {
              const result = await blueprintCommands.validateFile(options.file);
              const label = options.file;
              reportValidation(label, result);
            } else {
              const agentRole = args[0];
              if (!agentRole) {
                throw new Error("Either <agent-id> or --file <path> is required");
              }
              const result = await blueprintCommands.validate(agentRole);
              reportValidation(agentRole, result);
            }
          } catch (error) {
            display.error("cli.error", "blueprint validate", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command("edit <agent-id>", blueprintEditCommand(BLUEPRINT_CLI_LABELS))
    .command("remove <agent-id>", blueprintRemoveCommand(BLUEPRINT_CLI_LABELS))
    .command("deprecate <agent-id>", blueprintDeprecateCommand(BLUEPRINT_CLI_LABELS));
}

export function buildBlueprintCommand(runtime: IExaCtlRuntime): ReturnType<typeof createBlueprintCommand> {
  return createBlueprintCommand(runtime);
}
