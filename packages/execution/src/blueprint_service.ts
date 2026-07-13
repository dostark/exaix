/**
 * @module BlueprintService
 * @path packages/execution/src/blueprint_service.ts
 * @description Loads, validates, and resolves agent blueprints. Extracted from
 *   AgentExecutor to reduce its scope and encapsulate blueprint lifecycle.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_executor.ts]
 */

import { isAbsolute, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { z } from "zod";
import type { Config } from "@exaix/schemas/config.ts";
import type { IModelCallOptions, IModelIntent } from "@exaix/schemas";
import type { IEventLogger } from "@exaix/core/logger";
import { SafeError } from "@exaix/core/errors";
import type { ModelResolver } from "@exaix/ai";
import type { JSONValue } from "@exaix/core";
import { DEFAULT_IDENTITIES_PATH, MAX_NAME_LENGTH, MAX_PROMPT_LENGTH } from "@exaix/core";
import { DEFAULT_MCP_IDENTITY_ID } from "@exaix/mcp";
import type { IAgentExecutorOptions, IAgentFileBlueprint } from "./agent_executor.ts";
import { InputValidator } from "@exaix/schemas/input_validation.ts";
import { deriveTaskType } from "./task_type_derivation.ts";
import type { Opt, Reason } from "@exaix/core/types";

/** Result of loadBlueprint: the parsed blueprint plus optional resolved call options. */
export interface IBlueprintLoadResult {
  blueprint: IAgentFileBlueprint;
  resolvedCallOptions?: IModelCallOptions;
}

/** All model-related fields from blueprint YAML frontmatter. */
interface BlueprintInput {
  model: string;
  provider?: string;
  model_size?: IModelIntent["model_size"];
  characteristics?: string[];
  preferred_provider?: string;
  thinking?: boolean;
  effort?: IModelIntent["effort"];
  task_type?: IModelIntent["task_type"];
}

/**
 * Zod schema for blueprint frontmatter validation
 * Prevents YAML deserialization attacks by using strict validation
 */
export const BlueprintSchema = z.object({
  identity_id: z.string().optional(),
  name: z.string().max(100).optional(),
  model: z.string().max(100),
  provider: z.string().max(100).optional(),
  capabilities: z.array(z.string().max(MAX_NAME_LENGTH)).max(20).default([]),
  permitted_tools: z.array(z.string().max(MAX_NAME_LENGTH)).max(100).optional(),
  allowed_paths: z.array(z.string().max(255)).max(100).optional(),
  created: z.string().optional(),
  created_by: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  default_skills: z.array(z.string()).optional(),
}).passthrough();

/**
 * Loads, validates, and resolves agent blueprints from the filesystem.
 * Encapsulates YAML parsing, Zod schema validation, model resolution,
 * and prompt sanitization.
 */
export class BlueprintService {
  constructor(
    private config: Config,
    private logger: IEventLogger,
    private modelResolver?: Opt<ModelResolver, Reason.OptionalDependency>,
    private options?: Opt<IAgentExecutorOptions, Reason.OptionalContext>,
  ) {}

  /**
   * Load agent blueprint from file with security validation.
   * Returns the parsed blueprint and any resolved call options from ModelResolver.
   */
  async loadBlueprint(rawAgentName: string): Promise<IBlueprintLoadResult> {
    const agentName = InputValidator.validateBlueprintName(rawAgentName);
    const blueprintPath = this.resolveBlueprintPath(agentName);

    try {
      const content = await Deno.readTextFile(blueprintPath);
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      if (!frontmatterMatch) {
        throw new SafeError(
          "Blueprint file is not properly formatted",
          "INVALID_BLUEPRINT_FORMAT",
          undefined,
          this.logger,
        );
      }

      const rawFrontmatter = parseYaml(frontmatterMatch[1], { schema: "failsafe" }) as Record<string, JSONValue>;
      const validatedFrontmatter = BlueprintSchema.parse(rawFrontmatter);

      const systemPrompt = content.slice(frontmatterMatch[0].length).trim();
      const sanitizedPrompt = BlueprintService.sanitizePrompt(systemPrompt);

      const { model, provider, resolvedCallOptions } = await this.resolveModelFromBlueprint(validatedFrontmatter);

      return {
        blueprint: {
          name: validatedFrontmatter.name || validatedFrontmatter.identity_id || agentName,
          model,
          provider,
          capabilities: validatedFrontmatter.capabilities,
          permitted_tools: validatedFrontmatter.permitted_tools,
          allowed_paths: validatedFrontmatter.allowed_paths,
          systemPrompt: sanitizedPrompt,
        },
        resolvedCallOptions,
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new SafeError("Blueprint not found", "BLUEPRINT_NOT_FOUND", error, this.logger);
      }
      if (error instanceof z.ZodError) {
        throw new SafeError("Blueprint contains invalid configuration", "INVALID_BLUEPRINT_SCHEMA", error, this.logger);
      }
      if (error instanceof Error && (error.message.includes("YAML") || error.message.includes("tag"))) {
        throw new SafeError("Blueprint file contains invalid YAML syntax", "YAML_PARSE_ERROR", error, this.logger);
      }
      if (error instanceof Deno.errors.PermissionDenied) {
        throw new SafeError("Access denied to blueprint file", "BLUEPRINT_ACCESS_DENIED", error, this.logger);
      }
      if (error instanceof SafeError) throw error;
      throw new SafeError("Failed to load blueprint", "BLUEPRINT_LOAD_ERROR", error as Error, this.logger);
    }
  }

  /** Resolve model and provider via ModelResolver or fall back to inline colon split. */
  private async resolveModelFromBlueprint(
    validatedFrontmatter: z.infer<typeof BlueprintSchema>,
  ): Promise<{ model: string; provider: string; resolvedCallOptions?: IModelCallOptions }> {
    let model = validatedFrontmatter.model;
    let provider = validatedFrontmatter.provider;
    let resolvedCallOptions: IModelCallOptions | undefined;

    if (this.modelResolver) {
      const extras = validatedFrontmatter as BlueprintInput;
      const requestIntent = this.options?.requestIntent;
      const derivedTaskType = deriveTaskType({
        frontmatterTaskType: requestIntent?.task_type,
        identityTaskType: extras.task_type,
        topSkillTaskTypes: this.options?.topSkillTaskTypes,
        identityId: validatedFrontmatter.identity_id,
        taskTypeMap: this.config.model_registry?.task_type_map,
      });
      const intent: IModelIntent = {
        model: validatedFrontmatter.model,
        model_size: extras.model_size ?? requestIntent?.model_size,
        characteristics: extras.characteristics ?? requestIntent?.characteristics,
        preferred_provider: extras.preferred_provider ?? requestIntent?.preferred_provider,
        thinking: extras.thinking ?? requestIntent?.thinking,
        effort: extras.effort ?? requestIntent?.effort,
        task_type: derivedTaskType.taskType,
        task_type_source: derivedTaskType.source,
      };
      const resolved = await this.modelResolver.resolve(intent);
      provider = resolved.provider;
      model = resolved.model;
      if (resolved.options) {
        resolvedCallOptions = resolved.options as IModelCallOptions;
      }
    } else if (!provider) {
      const colonIdx = model.indexOf(":");
      if (colonIdx !== -1) {
        provider = model.substring(0, colonIdx);
        model = model.substring(colonIdx + 1);
      }
    }
    if (!provider) {
      provider = DEFAULT_MCP_IDENTITY_ID;
    }
    return { model, provider, resolvedCallOptions };
  }

  /** Resolve the absolute filesystem path for a blueprint file. */
  private resolveBlueprintPath(agentName: string): string {
    const blueprintsBase = isAbsolute(this.config.paths.blueprints)
      ? this.config.paths.blueprints
      : join(this.config.system.root, this.config.paths.blueprints);
    return join(blueprintsBase, DEFAULT_IDENTITIES_PATH, `${agentName}.md`);
  }

  /**
   * Resolve model ID string from blueprint.
   * If model already contains ":", return as-is. Otherwise, composite "provider:model".
   */
  resolveModelId(blueprint: IAgentFileBlueprint): string {
    return blueprint.model.includes(":") ? blueprint.model : `${blueprint.provider}:${blueprint.model}`;
  }

  /**
   * Sanitize system prompt to prevent XSS and injection attacks.
   */
  static sanitizePrompt(prompt: string): string {
    if (!prompt) return "";
    return prompt
      .replace(/<script[^>]*>.*?<\/script>/gis, "[REMOVED SCRIPT]")
      .replace(/javascript:/gi, "[REMOVED JAVASCRIPT]")
      .replace(/<iframe[^>]*>.*?<\/iframe>/gis, "[REMOVED IFRAME]")
      .replace(/<object[^>]*>.*?<\/object>/gis, "[REMOVED OBJECT]")
      .replace(/<embed[^>]*>.*?<\/embed>/gis, "[REMOVED EMBED]")
      .slice(0, MAX_PROMPT_LENGTH);
  }
}
