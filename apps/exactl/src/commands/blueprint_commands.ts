/**
 * @module BlueprintCommands
 * @path apps/exactl/src/commands/blueprint_commands.ts
 * @description Provides CLI commands for identity blueprint management, including creation from templates, listing, showing details, and validation.
 * @architectural-layer CLI
 * @related-files ["packages/schemas/src/blueprint.ts", "apps/daemon/main.ts"]
 */

import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { BlueprintStatus, ProviderType } from "@exaix/core";
import { ValidationChain } from "@exaix/cli/validation/validation_chain.ts";
import { DefaultErrorStrategy } from "@exaix/cli/errors/error_strategy.ts";
import { STDIO_INHERIT } from "./constants.ts";
import { CommandUtils } from "@exaix/cli/helpers/command_utils.ts";
import {
  BlueprintFrontmatterSchema,
  type IBlueprintCreateResult,
  type IBlueprintDetails,
  type IBlueprintMetadata,
  type IBlueprintValidationResult,
  isReservedAgentId,
} from "@exaix/schemas/blueprint.ts";
import type { Opt, Reason } from "@exaix/core/types";

// Types and Interfaces

/**
 * Frontmatter data parsed from YAML/TOML
 */
export interface IBlueprintFrontmatterData {
  identity_id: string;
  name?: string;
  model?: string;
  capabilities?: string[];
  deprecated?: boolean | string;
  created?: string;
  created_by?: string;
  version?: string;
  description?: string;
  [key: string]: string | string[] | boolean | undefined;
}

/** Filters for the blueprint list command. */
export interface IBlueprintListOptions {
  /** Only return blueprints whose `capabilities` array contains this identifier. */
  capability?: string;
  /** Only return blueprints in this lifecycle status. */
  status?: BlueprintStatus;
}

export interface IBlueprintCreateOptions {
  name?: string;
  model?: string;
  description?: string;
  capabilities?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  /** Clone an existing identity by id as a prototype (replaces the retired --template). */
  from?: string;
}

export interface IBlueprintRemoveOptions {
  force?: boolean;
}

// Default system prompt used when `create` gets neither an explicit prompt nor a
// `--from` prototype; includes the mandatory contract tags so the blueprint validates.
const DEFAULT_SYSTEM_PROMPT = `# Agent

You are a helpful AI agent. Analyse the request and respond using the required
output contract.

Follow your \`response-contract\` skill for the mandatory \`<thought>\`/\`<content>\` format:

<thought>
Your reasoning.
</thought>

<content>
{ "description": "What you produced" }
</content>
`;

// BlueprintCommands Implementation

export class BlueprintCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  /**
   * Get absolute path to Blueprints/Agents directory
   */
  private getBlueprintsDir(): string {
    return join(this.config.system.root, this.config.paths.blueprints, this.config.paths.agents);
  }

  private blueprintNotFoundError(identityId: string): Error {
    return new Error(
      `Blueprint '${identityId}' not found\nUse 'exactl blueprint list' to see available blueprints`,
    );
  }

  private async getExistingBlueprintPath(identityId: string): Promise<string> {
    const blueprintPath = join(this.getBlueprintsDir(), `${identityId}.md`);
    if (!await exists(blueprintPath)) {
      throw this.blueprintNotFoundError(identityId);
    }
    return blueprintPath;
  }

  /**
   * Parse TOML frontmatter from content
   */
  private parseTomlFrontmatter(content: string): { frontmatter: IBlueprintFrontmatterData | null; body: string } {
    const tomlMatch = content.match(/^\+\+\+\n([\s\S]*?)\n\+\+\+\n?([\s\S]*)$/);
    if (!tomlMatch) return { frontmatter: null, body: content };

    try {
      const frontmatter = parseToml(tomlMatch[1]) as IBlueprintFrontmatterData;
      const body = tomlMatch[2] || "";
      return { frontmatter, body };
    } catch {
      return { frontmatter: null, body: content };
    }
  }

  /**
   * Parse YAML frontmatter from content
   */
  private parseYamlFrontmatter(content: string): { frontmatter: IBlueprintFrontmatterData | null; body: string } {
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!yamlMatch) return { frontmatter: null, body: content };

    try {
      const yamlContent = yamlMatch[1];
      const frontmatter = this.parseYamlContent(yamlContent);
      const body = yamlMatch[2] || "";
      return { frontmatter, body };
    } catch {
      return { frontmatter: null, body: content };
    }
  }

  /**
   * Parse YAML content into frontmatter object
   */
  private parseYamlContent(yamlContent: string): IBlueprintFrontmatterData {
    const frontmatter: IBlueprintFrontmatterData = { identity_id: "" };
    const lines = yamlContent.split("\n");

    const state: { currentKey: string | null; currentArray: string[] } = {
      currentKey: null,
      currentArray: [],
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (this.isSkippableYamlLine(trimmed)) continue;
      if (this.tryConsumeYamlListItem(trimmed, state)) continue;

      this.flushYamlArray(frontmatter, state);

      const kv = this.parseYamlKeyValue(line);
      if (!kv) continue;
      this.applyYamlKeyValue(frontmatter, kv.key, kv.value, state);
    }

    this.flushYamlArray(frontmatter, state);

    return frontmatter;
  }

  private isSkippableYamlLine(trimmed: string): boolean {
    if (!trimmed) return true;
    if (trimmed.startsWith("#")) return true;
    return false;
  }

  private tryConsumeYamlListItem(
    trimmed: string,
    state: { currentKey: string | null; currentArray: string[] },
  ): boolean {
    if (!trimmed.startsWith("- ")) return false;
    if (state.currentKey) {
      state.currentArray.push(trimmed.slice(2).trim());
    }
    return true;
  }

  private flushYamlArray(
    frontmatter: IBlueprintFrontmatterData,
    state: { currentKey: string | null; currentArray: string[] },
  ): void {
    if (state.currentKey && state.currentArray.length > 0) {
      frontmatter[state.currentKey] = state.currentArray;
      state.currentKey = null;
      state.currentArray = [];
    }
  }

  private parseYamlKeyValue(line: string): { key: string; value: string } | null {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) return null;
    return {
      key: line.slice(0, colonIndex).trim(),
      value: line.slice(colonIndex + 1).trim(),
    };
  }

  private applyYamlKeyValue(
    frontmatter: IBlueprintFrontmatterData,
    key: string,
    value: string,
    state: { currentKey: string | null; currentArray: string[] },
  ): void {
    const unquoted = this.tryStripYamlQuotes(value);
    if (unquoted !== null) {
      frontmatter[key] = unquoted;
      return;
    }

    if (this.isInlineYamlArray(value)) {
      frontmatter[key] = this.parseInlineYamlArray(key, value);
      return;
    }

    if (!value) {
      state.currentKey = key;
      state.currentArray = [];
      return;
    }

    frontmatter[key] = value;
  }

  private tryStripYamlQuotes(value: string): string | null {
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
    return null;
  }

  private isInlineYamlArray(value: string): boolean {
    if (!value.startsWith("[")) return false;
    if (!value.endsWith("]")) return false;
    return true;
  }

  private parseInlineYamlArray(key: string, value: string): string[] {
    try {
      return JSON.parse(value.replace(/'/g, '"'));
    } catch {
      console.warn(`Failed to parse inline array for key '${key}': ${value}`);
      return [];
    }
  }

  /** Extract frontmatter, supporting both TOML (+++) and YAML (---) formats. */
  private extractTomlFrontmatter(content: string): {
    frontmatter: IBlueprintFrontmatterData | null;
    body: string;
  } {
    // First try TOML format (+++)
    const tomlResult = this.parseTomlFrontmatter(content);
    if (tomlResult.frontmatter) {
      return tomlResult;
    }

    // Then try YAML format (---) for backwards compatibility
    return this.parseYamlFrontmatter(content);
  }

  private blueprintMetadataFromFrontmatter(frontmatter: IBlueprintFrontmatterData): IBlueprintMetadata | null {
    const identityId = frontmatter.identity_id;
    if (typeof identityId !== "string" || identityId.trim().length === 0) {
      return null;
    }

    return {
      identity_id: identityId,
      name: frontmatter.name as string,
      model: frontmatter.model as string,
      capabilities: frontmatter.capabilities as string[] | undefined,
      status: this.deriveStatus(frontmatter),
      created: frontmatter.created as string,
      created_by: frontmatter.created_by as string,
      version: (frontmatter.version as string) || "1.0.0",
    };
  }

  // Derive lifecycle status from `deprecated`, which may arrive as a real boolean
  // (TOML) or the string "true" (loose YAML parsing).
  private deriveStatus(frontmatter: IBlueprintFrontmatterData): BlueprintStatus {
    const deprecated = frontmatter.deprecated;
    const isDeprecated = deprecated === true || deprecated === "true";
    return isDeprecated ? BlueprintStatus.DEPRECATED : BlueprintStatus.ACTIVE;
  }

  /**
   * Validate blueprint creation inputs
   */
  private validateCreateInputs(identityId: string, options: IBlueprintCreateOptions): void {
    const validation = new ValidationChain()
      .addRule("identityId", ValidationChain.required())
      .addRule(
        "identityId",
        (val) => /^[a-z0-9-]+$/.test(String(val)) ? null : "must be lowercase alphanumeric with hyphens only",
      )
      .addRule("identityId", (val) => isReservedAgentId(String(val)) ? `reserved name: ${val}` : null)
      .addRule("name", (_val) => (!options.name) ? "--name is required" : null)
      .addRule("model", (_val) => (!options.model && !options.from) ? "--model is required" : null)
      .validate({ identityId, ...options });

    if (!validation.isValid) {
      throw new Error(CommandUtils.formatValidationErrors(validation));
    }
  }

  /**
   * Check if blueprint already exists
   */
  private async checkBlueprintExists(identityId: string): Promise<string> {
    const blueprintPath = join(this.getBlueprintsDir(), `${identityId}.md`);
    if (await exists(blueprintPath)) {
      throw new Error(
        `Blueprint '${identityId}' already exists\nUse 'exactl blueprint edit ${identityId}' to modify`,
      );
    }
    return blueprintPath;
  }

  // Loads an existing identity by id as a `--from` creation prototype (a concrete
  // identity, not a separate template library) — returns its model, capabilities,
  // and body, or null if the identity does not exist.
  private loadPrototype(identityId: string): { model: string; capabilities: string[]; systemPrompt: string } | null {
    const filePath = join(this.getBlueprintsDir(), `${identityId}.md`);
    try {
      const content = Deno.readTextFileSync(filePath);
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;

      const frontmatter = parseYaml(match[1]) as { model?: string; capabilities?: string[] };
      const capabilities = Array.isArray(frontmatter.capabilities) ? frontmatter.capabilities.map(String) : [];
      return { model: frontmatter.model ?? "", capabilities, systemPrompt: match[2].trim() };
    } catch {
      return null;
    }
  }

  // Resolves the effective model / capabilities / system prompt for `create`,
  // seeding any unset field from the `--from` prototype identity when given.
  private applyPrototype(
    options: IBlueprintCreateOptions,
  ): { model: string; capabilities: string[]; systemPrompt?: string } {
    let model = options.model;
    let capabilities = options.capabilities?.split(",").map((s) => s.trim()) || [];
    let systemPrompt = options.systemPrompt;

    if (options.from) {
      const proto = this.loadPrototype(options.from);
      if (!proto) {
        throw new Error(`--from identity not found: ${options.from}`);
      }
      model = model || proto.model;
      capabilities = capabilities.length > 0 ? capabilities : proto.capabilities;
      systemPrompt = systemPrompt || proto.systemPrompt;
    }

    if (!model) {
      throw new Error("--model is required (or pass --from <identity-id> to clone one)");
    }

    return { model, capabilities, systemPrompt };
  }

  /**
   * Validate model provider configuration
   */
  private validateModelProvider(model: string): void {
    const [provider] = model.split(":");
    if (this.config.ai && provider !== ProviderType.MOCK) {
      const configuredProvider = this.config.ai.provider;
      if (provider !== configuredProvider) {
        console.warn(
          `⚠️  Warning: Blueprint uses provider '${provider}' but config uses '${configuredProvider}'\n` +
            `   The blueprint will be created but may fail at runtime.\n`,
        );
      }
    }
  }

  /**
   * Load and validate system prompt
   */
  private async loadSystemPrompt(
    options: IBlueprintCreateOptions,
    systemPrompt?: Opt<string, Reason.OptionalInput>,
  ): Promise<string> {
    let finalPrompt = systemPrompt;

    // Load from file if specified
    if (options.systemPromptFile) {
      if (!await exists(options.systemPromptFile)) {
        throw new Error(`System prompt file not found: ${options.systemPromptFile}`);
      }
      finalPrompt = await Deno.readTextFile(options.systemPromptFile);
    }

    // Fall back to a minimal scaffold (with the required contract tags) when no
    // prompt is supplied and no --from prototype provided one.
    if (!finalPrompt) {
      finalPrompt = DEFAULT_SYSTEM_PROMPT;
    }

    // Validate required tags
    if (!finalPrompt.includes("<thought>") || !finalPrompt.includes("<content>")) {
      throw new Error(
        "System prompt must include output format instructions\nRequired: <thought> and <content> tags",
      );
    }

    return finalPrompt;
  }

  /**
   * Create and validate blueprint frontmatter
   */
  private async createFrontmatter(
    identityId: string,
    options: IBlueprintCreateOptions,
    model: string,
    capabilities: string[],
  ): Promise<IBlueprintFrontmatterData> {
    const frontmatter: IBlueprintFrontmatterData = {
      identity_id: identityId,
      name: options.name,
      model: model,
      capabilities: capabilities,
      created: new Date().toISOString(),
      created_by: await this.getUserIdentity(),
      version: "1.0.0",
      ...(options.description && { description: options.description }),
    };

    const validation = BlueprintFrontmatterSchema.safeParse(frontmatter);
    if (!validation.success) {
      throw new Error(`Invalid blueprint: ${validation.error.message}`);
    }

    return frontmatter;
  }

  /**
   * Write blueprint file and log activity
   */
  private async writeBlueprintFile(
    blueprintPath: string,
    frontmatter: IBlueprintFrontmatterData,
    systemPrompt: string,
    identityId: string,
    model: string,
    options: IBlueprintCreateOptions,
  ): Promise<void> {
    // YAML (---) is the canonical frontmatter format; the runtime loader no longer parses +++.
    const content = `---
${stringifyYaml(frontmatter)}---

${systemPrompt}
`;

    await ensureDir(this.getBlueprintsDir());
    await Deno.writeTextFile(blueprintPath, content);

    await this.display.info("blueprint.created", identityId, {
      model,
      from: options.from ?? null,
      via: "cli",
    });
  }

  /**
   * Create a new blueprint
   */
  async create(
    identityId: string,
    options: IBlueprintCreateOptions,
  ): Promise<IBlueprintCreateResult> {
    try {
      // Validate inputs
      this.validateCreateInputs(identityId, options);

      // Check if blueprint already exists
      const blueprintPath = await this.checkBlueprintExists(identityId);

      // Resolve model/capabilities/prompt, seeding from --from prototype if given
      const { model, capabilities, systemPrompt } = this.applyPrototype(options);

      // Validate model provider
      this.validateModelProvider(model);

      // Load and validate system prompt
      const finalSystemPrompt = await this.loadSystemPrompt(options, systemPrompt);

      // Create and validate frontmatter
      const frontmatter = await this.createFrontmatter(identityId, options, model, capabilities);

      // Write blueprint file and log activity
      await this.writeBlueprintFile(blueprintPath, frontmatter, finalSystemPrompt, identityId, model, options);

      return {
        identity_id: identityId,
        name: options.name as string,
        model: model,
        capabilities,
        created: frontmatter.created as string,
        created_by: frontmatter.created_by as string,
        version: "1.0.0",
        path: blueprintPath,
      };
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "BlueprintCommands.create",
        args: { identityId, options },
        error: error as Error | string | object | null | undefined,
      });
      throw error;
    }
  }

  /** List all blueprints, optionally filtered by lifecycle status and/or a declared capability. */
  async list(options: IBlueprintListOptions = {}): Promise<IBlueprintMetadata[]> {
    const blueprintsDir = this.getBlueprintsDir();
    const results: IBlueprintMetadata[] = [];

    try {
      for await (const entry of Deno.readDir(blueprintsDir)) {
        if (entry.isFile && entry.name.endsWith(".md") && entry.name !== ".gitkeep") {
          const filePath = join(blueprintsDir, entry.name);
          const content = await Deno.readTextFile(filePath);
          const { frontmatter } = this.extractTomlFrontmatter(content);

          if (frontmatter) {
            const metadata = this.blueprintMetadataFromFrontmatter(frontmatter);
            if (!metadata) {
              // Skip malformed blueprint files rather than crashing list output.
              continue;
            }
            if (!this.matchesListFilters(metadata, options)) {
              continue;
            }
            results.push(metadata);
          }
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }

    return results.sort((a, b) => (a.identity_id ?? "").localeCompare(b.identity_id ?? ""));
  }

  private matchesListFilters(metadata: IBlueprintMetadata, options: IBlueprintListOptions): boolean {
    if (options.status && metadata.status !== options.status) {
      return false;
    }
    if (options.capability && !(metadata.capabilities ?? []).includes(options.capability)) {
      return false;
    }
    return true;
  }

  // Sets the `deprecated` frontmatter flag, which capability_matcher.ts reads to exclude
  // a blueprint from selection. Rewrites the flag in place via an atomic write, preserving
  // format, field order, and comments; the file itself is not deleted.
  async deprecate(identityId: string): Promise<void> {
    try {
      const blueprintPath = await this.getExistingBlueprintPath(identityId);
      const content = await Deno.readTextFile(blueprintPath);
      const updated = this.setFrontmatterDeprecated(content, identityId);

      // Atomic write: temp file + rename, to avoid partial-write corruption.
      const tmpPath = `${blueprintPath}.${crypto.randomUUID()}.tmp`;
      await Deno.writeTextFile(tmpPath, updated);
      await Deno.rename(tmpPath, blueprintPath);

      await this.display.info("blueprint.deprecated", identityId, { via: "cli" });
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "BlueprintCommands.deprecate",
        args: { identityId },
        error: error as Error | string | object | null | undefined,
      });
      throw error;
    }
  }

  // Sets `deprecated = true` inside a blueprint's frontmatter block, preserving the
  // original delimiter style (TOML `+++` or YAML `---`) and all other lines.
  private setFrontmatterDeprecated(content: string, identityId: string): string {
    const isToml = /^\+\+\+\n/.test(content);
    const isYaml = /^---\n/.test(content);
    if (!isToml && !isYaml) {
      throw new Error(`Invalid blueprint format: ${identityId}`);
    }

    const fmPattern = isToml ? /^(\+\+\+\n)([\s\S]*?)(\n\+\+\+\n?)/ : /^(---\n)([\s\S]*?)(\n---\n?)/;
    const match = content.match(fmPattern);
    if (!match) {
      throw new Error(`Invalid blueprint format: ${identityId}`);
    }

    const deprecatedLine = isToml ? "deprecated = true" : "deprecated: true";
    const deprecatedRegex = isToml ? /^deprecated\s*=.*$/m : /^deprecated\s*:.*$/m;

    const [, open, fmBody, close] = match;
    const newFmBody = deprecatedRegex.test(fmBody)
      ? fmBody.replace(deprecatedRegex, deprecatedLine)
      : `${fmBody}\n${deprecatedLine}`;

    // Function replacer avoids `$`-pattern interpretation in the replacement.
    return content.replace(fmPattern, () => `${open}${newFmBody}${close}`);
  }

  /**
   * Show blueprint details
   */
  async show(identityId: string): Promise<IBlueprintDetails> {
    const blueprintPath = await this.getExistingBlueprintPath(identityId);

    const content = await Deno.readTextFile(blueprintPath);
    const { frontmatter } = this.extractTomlFrontmatter(content);

    if (!frontmatter) {
      throw new Error(`Invalid blueprint format: ${identityId}`);
    }

    const metadata = this.blueprintMetadataFromFrontmatter(frontmatter);
    if (!metadata) {
      throw new Error(`Invalid blueprint format: ${identityId}`);
    }

    return {
      ...metadata,
      content,
    };
  }

  /**
   * Validate blueprint format
   */
  async validate(identityId: string): Promise<IBlueprintValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const blueprintPath = join(this.getBlueprintsDir(), `${identityId}.md`);

      if (!await exists(blueprintPath)) {
        throw new Error(`Blueprint file not found: ${identityId}.md`);
      }

      const content = await Deno.readTextFile(blueprintPath);
      const { frontmatter, body } = this.extractTomlFrontmatter(content);

      if (!frontmatter) {
        errors.push("Missing or invalid TOML frontmatter");
        return { valid: false, errors, warnings };
      }

      // Validate frontmatter against schema
      const validation = BlueprintFrontmatterSchema.safeParse(frontmatter);
      if (!validation.success) {
        for (const issue of validation.error.issues) {
          errors.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      }

      // Check system prompt has required tags
      if (!body.includes("<thought>")) {
        errors.push("System prompt must include <thought> tag for reasoning");
      }
      if (!body.includes("<content>")) {
        errors.push("System prompt must include <content> tag for responses");
      }

      // Warnings
      if (body.length < 50) {
        warnings.push("System prompt is very short (< 50 characters)");
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return { valid: false, errors, warnings };
    }
  }

  /** Validate a blueprint file at an arbitrary path (unlike validate(), no directory lookup). */
  async validateFile(filePath: string): Promise<IBlueprintValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      if (!await exists(filePath)) {
        throw new Error(`Blueprint file not found: ${filePath}`);
      }

      const content = await Deno.readTextFile(filePath);
      const { frontmatter, body } = this.extractTomlFrontmatter(content);

      if (!frontmatter) {
        errors.push("Missing or invalid TOML frontmatter");
        return { valid: false, errors, warnings };
      }

      // Validate frontmatter against schema
      const validation = BlueprintFrontmatterSchema.safeParse(frontmatter);
      if (!validation.success) {
        for (const issue of validation.error.issues) {
          errors.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      }

      // Check system prompt has required tags
      if (!body.includes("<thought>")) {
        errors.push("System prompt must include <thought> tag for reasoning");
      }
      if (!body.includes("<content>")) {
        errors.push("System prompt must include <content> tag for responses");
      }

      // Warnings
      if (body.length < 50) {
        warnings.push("System prompt is very short (< 50 characters)");
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return { valid: false, errors, warnings };
    }
  }

  /**
   * Edit a blueprint in user's $EDITOR
   */
  async edit(identityId: string): Promise<void> {
    try {
      const blueprintPath = await this.getExistingBlueprintPath(identityId);

      // Get editor from environment or use default
      const editor = Deno.env.get("EDITOR") || Deno.env.get("VISUAL") || "vi";

      // Open file in editor
      const command = new Deno.Command(editor, {
        args: [blueprintPath],
        stdin: STDIO_INHERIT,
        stdout: STDIO_INHERIT,
        stderr: STDIO_INHERIT,
      });

      const { code } = await command.output();

      if (code !== 0) {
        throw new Error(`Editor exited with code ${code}`);
      }

      // Validate after editing
      const validation = await this.validate(identityId);
      if (validation.errors.length > 0) {
        const msg = `Blueprint has validation errors after editing:\n${
          validation.errors.map((e: string) => `  - ${e}`).join("\n")
        }`;
        throw new Error(msg);
      }

      // Display warnings if any (but allow save to proceed)
      if (validation.warnings && validation.warnings.length > 0) {
        for (const warning of validation.warnings) {
          await this.display.warn("blueprint.edit.warning", identityId, { warning });
        }
      }

      // Log activity
      await this.display.info("blueprint.edited", identityId, {
        via: "cli",
        editor,
        valid: validation.valid,
      });
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "BlueprintCommands.edit",
        args: { identityId },
        error: error as Error | string | object | null | undefined,
      });
    }
  }

  /**
   * Remove a blueprint
   */
  async remove(identityId: string, options: IBlueprintRemoveOptions = {}): Promise<void> {
    try {
      const blueprintPath = await this.getExistingBlueprintPath(identityId);

      // Remove the file
      await Deno.remove(blueprintPath);

      // Log activity
      await this.display.info("blueprint.removed", identityId, {
        via: "cli",
        forced: options.force || false,
      });
    } catch (error) {
      await DefaultErrorStrategy.handle({
        commandName: "BlueprintCommands.remove",
        args: { identityId, options },
        error: error as Error | string | object | null | undefined,
      });
    }
  }
}
