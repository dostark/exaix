/**
 * @module BlueprintCommands
 * @path src/cli/commands/blueprint_commands.ts
 * @description Provides CLI commands for identity blueprint management, including creation from templates, listing, showing details, and validation.
 * @architectural-layer CLI
 * @related-files ["packages/schemas/src/blueprint.ts", "src/main.ts"]
 */

import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import { parse as parseToml, stringify as stringifyToml } from "@std/toml";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { ProviderType } from "@exaix/core";
import { ValidationChain } from "@exaix/cli/validation/validation_chain.ts";
import { DefaultErrorStrategy } from "@exaix/cli/errors/error_strategy.ts";
import { CommandUtils } from "@exaix/cli/helpers/command_utils.ts";
import {
  BlueprintFrontmatterSchema,
  type IBlueprintCreateResult,
  type IBlueprintDetails,
  type IBlueprintMetadata,
  type IBlueprintValidationResult,
  isReservedAgentId,
} from "@exaix/schemas/blueprint.ts";

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Frontmatter data parsed from YAML/TOML
 */
export interface IBlueprintFrontmatterData {
  identity_id: string;
  name?: string;
  model?: string;
  capabilities?: string[];
  created?: string;
  created_by?: string;
  version?: string;
  description?: string;
  [key: string]: string | string[] | undefined;
}

export interface BlueprintCreateOptions {
  name?: string;
  model?: string;
  description?: string;
  capabilities?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  template?: string;
}

export interface BlueprintRemoveOptions {
  force?: boolean;
}

// ============================================================================
// Template Definitions
// ============================================================================

interface BlueprintTemplate {
  model: string;
  capabilities: string[];
  systemPrompt: string;
}

const TEMPLATES: Record<string, BlueprintTemplate> = {
  default: {
    model: "ollama:codellama:13b",
    capabilities: ["general"],
    systemPrompt: `# Default Agent

You are a helpful assistant that follows instructions carefully.

## Output Format

Always structure your response as:

\`\`\`xml
<thought>
Your reasoning and approach
</thought>

<content>
Your response or solution
</content>
\`\`\`
`,
  },
  coder: {
    model: "anthropic:claude-sonnet",
    capabilities: ["code_generation", "debugging", "testing"],
    systemPrompt: `# Software Development Agent

You are a senior software engineer with expertise in multiple programming languages.

## Capabilities

- Code generation following best practices
- Debugging complex issues
- Test-driven development
- Code refactoring

## Guidelines

1. Always write tests before implementation
2. Follow language-specific style guides
3. Prioritize readability and maintainability
4. Explain reasoning in <thought> tags
5. Provide code in <content> tags

## Output Format

\`\`\`xml
<thought>
Your reasoning about the problem and approach
</thought>

<content>
The code, tests, or solution
</content>
\`\`\`
`,
  },
  reviewer: {
    model: "openai:gpt-5",
    capabilities: ["code_review", "security_analysis"],
    systemPrompt: `# Code Review Agent

You are a code review specialist focusing on quality, security, and best practices.

## Capabilities

- Code review and quality assessment
- Security vulnerability detection
- Performance analysis
- Best practice recommendations

## Guidelines

1. Check for security vulnerabilities
2. Assess code maintainability
3. Verify test coverage
4. Review error handling
5. Suggest improvements

## Output Format

\`\`\`xml
<thought>
Your analysis of the code
</thought>

<content>
Review feedback and recommendations
</content>
\`\`\`
`,
  },
  architect: {
    model: "anthropic:claude-opus",
    capabilities: ["system_design", "documentation"],
    systemPrompt: `# System Architecture Agent

You are a system architect with expertise in designing scalable, maintainable systems.

## Capabilities

- System design and architecture
- Technical documentation
- Performance optimization
- Technology selection

## Guidelines

1. Consider scalability and maintainability
2. Document architectural decisions
3. Analyze trade-offs
4. Provide clear diagrams and explanations

## Output Format

\`\`\`xml
<thought>
Your architectural analysis and reasoning
</thought>

<content>
Design proposals and documentation
</content>
\`\`\`
`,
  },
  researcher: {
    model: "openai:gpt-5",
    capabilities: ["research", "analysis", "summarization"],
    systemPrompt: `# Research and Analysis Agent

You are a research specialist who analyzes information and provides comprehensive insights.

## Capabilities

- Research and information gathering
- Data analysis
- Summarization
- Insight extraction

## Guidelines

1. Provide thorough analysis
2. Cite sources when possible
3. Summarize key findings
4. Identify patterns and trends

## Output Format

\`\`\`xml
<thought>
Your research approach and analysis
</thought>

<content>
Research findings and insights
</content>
\`\`\`
`,
  },
  gemini: {
    model: "google:gemini-3-flash",
    capabilities: ["general", "multimodal", "reasoning"],
    systemPrompt: `# Google Gemini Agent

You are powered by Google's Gemini 2.0, a multimodal AI with strong reasoning capabilities.

## Capabilities

- General-purpose assistance
- Multimodal understanding (text, images, code)
- Advanced reasoning
- Fast response generation

## Guidelines

1. Leverage multimodal understanding when applicable
2. Provide clear, reasoned responses
3. Balance speed with quality
4. Explain complex concepts clearly

## Output Format

\`\`\`xml
<thought>
Your reasoning and approach
</thought>

<content>
Your response or solution
</content>
\`\`\`
`,
  },
  mock: {
    model: "mock:test-model",
    capabilities: ["testing", "development"],
    systemPrompt: `# Mock Agent (Testing Only)

You are a mock agent used for testing and development. This blueprint uses the MockLLMProvider
which returns deterministic responses without making actual API calls.

## Purpose

- Enable fast, deterministic unit and integration tests
- Avoid API costs during development
- Test error handling and edge cases
- Validate request → plan → execution flow without real LLM

## Mock Provider Strategies

This agent can use different mock strategies (configured in test setup):

1. **recorded** - Replay pre-recorded LLM responses
2. **scripted** - Return specific responses based on test scenarios
3. **pattern** - Match request patterns and return templated responses
4. **failing** - Simulate LLM failures for error handling tests
5. **slow** - Simulate slow responses for timeout tests

## Output Format

\`\`\`xml
<thought>
Mock reasoning based on test scenario
</thought>

<content>
Mock content based on test scenario
</content>
\`\`\`

## Usage

\`\`\`text
# Create test request using mock identity
exactl request "Test request" --identity mock
\`\`\`

## Notes

- **Do not use in production** - This agent does not perform real AI reasoning
- Responses are deterministic and controlled by test fixtures
- Useful for CI/CD pipelines where real LLM calls are not desired
`,
  },
};

// ============================================================================
// BlueprintCommands Implementation
// ============================================================================

export class BlueprintCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  /**
   * Get absolute path to Blueprints/Identities directory
   */
  private getBlueprintsDir(): string {
    return join(this.config.system.root, this.config.paths.blueprints, this.config.paths.identities);
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

  /**
   * Extract frontmatter from blueprint content.
   * Supports both TOML (+++) and YAML (---) formats for backwards compatibility.
   */
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
      created: frontmatter.created as string,
      created_by: frontmatter.created_by as string,
      version: (frontmatter.version as string) || "1.0.0",
    };
  }

  /**
   * Validate blueprint creation inputs
   */
  private validateCreateInputs(identityId: string, options: BlueprintCreateOptions): void {
    const validation = new ValidationChain()
      .addRule("identityId", ValidationChain.required())
      .addRule(
        "identityId",
        (val) => /^[a-z0-9-]+$/.test(String(val)) ? null : "must be lowercase alphanumeric with hyphens only",
      )
      .addRule("identityId", (val) => isReservedAgentId(String(val)) ? `reserved name: ${val}` : null)
      .addRule("name", (_val) => (!options.name) ? "--name is required" : null)
      .addRule("model", (_val) => (!options.model && !options.template) ? "--model is required" : null)
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

  /**
   * Apply template settings to options
   */
  private applyTemplate(
    options: BlueprintCreateOptions,
  ): { model: string; capabilities: string[]; systemPrompt?: string } {
    let model = options.model;
    let capabilities = options.capabilities?.split(",").map((s) => s.trim()) || [];
    let systemPrompt = options.systemPrompt;

    if (options.template && TEMPLATES[options.template]) {
      const template = TEMPLATES[options.template];
      model = model || template.model;
      capabilities = capabilities.length > 0 ? capabilities : template.capabilities;
      systemPrompt = systemPrompt || template.systemPrompt;
    }

    if (!model) {
      throw new Error("--model is required");
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
  private async loadSystemPrompt(options: BlueprintCreateOptions, systemPrompt?: string): Promise<string> {
    let finalPrompt = systemPrompt;

    // Load from file if specified
    if (options.systemPromptFile) {
      if (!await exists(options.systemPromptFile)) {
        throw new Error(`System prompt file not found: ${options.systemPromptFile}`);
      }
      finalPrompt = await Deno.readTextFile(options.systemPromptFile);
    }

    // Use default if no prompt provided
    if (!finalPrompt) {
      finalPrompt = TEMPLATES.default.systemPrompt;
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
    options: BlueprintCreateOptions,
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
    options: BlueprintCreateOptions,
  ): Promise<void> {
    const content = `+++
${stringifyToml(frontmatter)}+++

${systemPrompt}
`;

    await ensureDir(this.getBlueprintsDir());
    await Deno.writeTextFile(blueprintPath, content);

    await this.display.info("blueprint.created", identityId, {
      model,
      template: options.template ?? null,
      via: "cli",
    });
  }

  /**
   * Create a new blueprint
   */
  async create(
    identityId: string,
    options: BlueprintCreateOptions,
  ): Promise<IBlueprintCreateResult> {
    try {
      // Validate inputs
      this.validateCreateInputs(identityId, options);

      // Check if blueprint already exists
      const blueprintPath = await this.checkBlueprintExists(identityId);

      // Apply template settings
      const { model, capabilities, systemPrompt } = this.applyTemplate(options);

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

  /**
   * List all blueprints
   */
  async list(): Promise<IBlueprintMetadata[]> {
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
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });

      const { code } = await command.output();

      if (code !== 0) {
        throw new Error(`Editor exited with code ${code}`);
      }

      // Validate after editing
      const validation = await this.validate(identityId);
      if (!validation.valid) {
        console.warn(`\n⚠️  Warning: Blueprint has validation errors after editing:`);
        validation.errors?.forEach((error: string) => console.warn(`   - ${error}`));
        console.warn(`\nFix these issues or the blueprint may not work correctly.\n`);
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
  async remove(identityId: string, options: BlueprintRemoveOptions = {}): Promise<void> {
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
