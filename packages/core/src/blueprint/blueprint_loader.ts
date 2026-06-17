/**
 * @module CoreBlueprintLoader
 * @path packages/core/src/blueprint/blueprint_loader.ts
 * @description Unified service for loading and validating agent blueprints.
 * Handles YAML frontmatter parsing, schema validation, and blueprint resolution.
 * @architectural-layer Core
 * @related-files ["packages/execution/src/agent_runner.ts", "packages/request/src/processor.ts"]
 */

import { basename, join } from "@std/path";
import { exists } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";
import { z } from "zod";
import { DataFormat } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { DEFAULT_BLUEPRINT_VERSION, DEFAULT_IDENTITIES_PATH, McpToolName } from "@exaix/core";

/**
 * Fully loaded and validated blueprint
 */
export interface ILoadedBlueprint {
  /** Agent identifier (from frontmatter or filename) */
  identityId: string;

  /** Human-readable name (from frontmatter or derived from identityId) */
  name: string;

  /** Model specification (provider:model format) */
  model: string;

  /** Legacy provider field (for backward compatibility) */
  provider?: string;

  /** Agent capabilities */
  capabilities: string[];

  /** System prompt (markdown body after frontmatter) */
  systemPrompt: string;

  /** Version */
  version: string;

  /** Full raw frontmatter for extensions */
  frontmatter: RuntimeBlueprintFrontmatter;

  /** Path to blueprint file */
  path: string;
}

/**
 * Legacy Blueprint interface for backward compatibility
 * Used by agent_runner.ts
 */
export interface IBlueprint {
  systemPrompt: string;
  identityId?: string;
}

export interface IBlueprintLoaderOptions {
  /** Path to blueprints directory */
  blueprintsPath: string;

  /** Default model if not specified in blueprint */
  defaultModel?: string;
}

// ============================================================================
// Blueprint Schema (Extended for Runtime)
// ============================================================================

/** Inline HITL policy schema — avoids runtime cross-package import from @exaix/schemas. */
const HitlRuleSchema = z.object({
  command_pattern: z.string().optional(),
  path_pattern: z.string().optional(),
  branch_pattern: z.string().optional(),
  tables: z.array(z.string()).optional(),
  reason: z.string().min(1),
});
const HitlPolicySchema = z.object({
  require_secondary_approval: z.array(HitlRuleSchema).default([]),
});

/**
 * Extended schema for runtime blueprint usage
 * More permissive than creation schema - allows older blueprints
 */
export const RuntimeBlueprintFrontmatterSchema = z.object({
  /** Agent identifier - required */
  identity_id: z.string().min(1).optional(),

  /** Human-readable name */
  name: z.string().min(1).optional(),

  /** Model in provider:model format */
  model: z.string().min(1).optional(),

  /** Provider name (legacy field, prefer model with provider prefix) */
  provider: z.string().optional(),

  /** Agent capabilities */
  capabilities: z.array(z.string()).default([]),

  /** Semantic version */
  version: z.string().default(DEFAULT_BLUEPRINT_VERSION),

  /** Description */
  description: z.string().optional(),

  /** Language or locale this agent primarily supports */
  language: z.string().min(1).optional(),

  /** Primary task type for this agent */
  task_type: z.string().min(1).optional(),

  /** Portal type or scope for this agent */
  portal_type: z.string().min(1).optional(),

  /** Created timestamp (ISO 8601) */
  created: z.string().optional(),

  /** Creator */
  created_by: z.string().optional(),

  // === Phase 16.4+ Extensions ===

  /** Enable reflexive self-critique */
  reflexive: z.boolean().default(false),

  /** Max iterations for reflexive critique */
  max_reflexion_iterations: z.number().min(1).max(10).default(3),

  /** Minimum confidence required (0-100) */
  confidence_required: z.number().min(0).max(100).optional(),

  /** Enable session memory */
  memory_enabled: z.boolean().default(false),

  // === Phase 17 Skills Extension ===

  /** Default skills to apply */
  default_skills: z.array(z.string()).optional(),

  // === Phase 58 Dynamic Execution Extension ===

  /** Tools the agent is permitted to use in DYNAMIC execution mode */
  permitted_tools: z.array(z.nativeEnum(McpToolName)).optional(),

  /** Deprecation flag for outdated blueprints; consumed by routing/capability matching */
  deprecated: z.boolean().default(false),

  /** Prefer this agent locally for routing fallback */
  routing_prefer_local: z.boolean().optional(),

  // === Phase 118 Per-Action HITL Governance Extension ===

  /** Per-action HITL governance rules for this blueprint. */
  hitl: HitlPolicySchema.optional(),
});

export type RuntimeBlueprintFrontmatter = z.infer<typeof RuntimeBlueprintFrontmatterSchema>;

// ============================================================================
// Loaded Blueprint Type
// ============================================================================

// ============================================================================
// BlueprintLoader Service
// ============================================================================

/**
 * Unified blueprint loader service
 *
 * Provides consistent blueprint loading with:
 * - YAML frontmatter parsing
 * - Schema validation with Zod
 * - Backward compatibility with simple blueprints
 * - Extension fields for Phase 16.4+ features
 */
export class BlueprintLoader {
  private cache = new Map<string, ILoadedBlueprint>();

  constructor(private options: IBlueprintLoaderOptions) {}

  /**
   * Load a blueprint by agent ID
   *
   * @param identityId - The agent identifier (filename without .md)
   * @returns ILoadedBlueprint or null if not found
   */
  async load(identityId: string): Promise<ILoadedBlueprint | null> {
    // Check cache first
    if (this.cache.has(identityId)) {
      return this.cache.get(identityId)!;
    }

    const blueprintPath = this.resolvePath(identityId);

    if (!await exists(blueprintPath)) {
      return null;
    }

    try {
      const content = await Deno.readTextFile(blueprintPath);
      const blueprint = this.parse(content, identityId, blueprintPath);

      // Cache for subsequent lookups
      this.cache.set(identityId, blueprint);

      return blueprint;
    } catch (error) {
      if (error instanceof BlueprintLoadError) {
        throw error;
      }
      throw new BlueprintLoadError(
        `Failed to load blueprint '${identityId}': ${error instanceof Error ? error.message : String(error)}`,
        identityId,
        blueprintPath,
      );
    }
  }

  /**
   * Load blueprint or throw if not found
   */
  async loadOrThrow(identityId: string): Promise<ILoadedBlueprint> {
    const blueprint = await this.load(identityId);
    if (!blueprint) {
      const path = this.resolvePath(identityId);
      throw new BlueprintLoadError(
        `Identity '${identityId}' not found in Blueprints/Identities/. If you are migrating from a pre-Phase-53 workspace, move your blueprints from Blueprints/Identities/ to Blueprints/Identities/.`,
        identityId,
        path,
      );
    }
    return blueprint;
  }

  /**
   * Parse blueprint content
   *
   * Handles three formats:
   * 1. YAML frontmatter (--- delimited)
   * 2. TOML frontmatter (+++ delimited)
   * 3. Plain markdown (no frontmatter, entire content is system prompt)
   */
  parse(content: string, identityId: string, path: string): ILoadedBlueprint {
    // Try YAML frontmatter first (most common)
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (yamlMatch) {
      return this.parseWithFrontmatter(
        yamlMatch[1],
        content.slice(yamlMatch[0].length),
        identityId,
        path,
        DataFormat.YAML,
      );
    }

    // Try TOML frontmatter
    const tomlMatch = content.match(/^\+\+\+\n([\s\S]*?)\n\+\+\+\n?/);
    if (tomlMatch) {
      return this.parseWithFrontmatter(
        tomlMatch[1],
        content.slice(tomlMatch[0].length),
        identityId,
        path,
        DataFormat.TOML,
      );
    }

    // No frontmatter - treat entire content as system prompt (backward compatible)
    return this.createMinimalBlueprint(content, identityId, path);
  }

  /**
   * Parse blueprint with frontmatter
   */
  private parseWithFrontmatter(
    frontmatterRaw: string,
    body: string,
    identityId: string,
    path: string,
    format: DataFormat.YAML | DataFormat.TOML,
  ): ILoadedBlueprint {
    let parsed: Record<string, JSONValue>;

    try {
      if (format === DataFormat.YAML) {
        parsed = parseYaml(frontmatterRaw) as Record<string, JSONValue>;
      } else {
        // TOML parsing - use dynamic import to avoid bundling if not needed
        throw new Error("TOML frontmatter not yet implemented");
      }
    } catch (error) {
      throw new BlueprintLoadError(
        `Invalid ${String(format).toUpperCase()} frontmatter in blueprint '${identityId}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        identityId,
        path,
      );
    }

    // Validate frontmatter with Zod
    const validation = RuntimeBlueprintFrontmatterSchema.safeParse(parsed);
    if (!validation.success) {
      const errors = validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      throw new BlueprintLoadError(
        `Invalid frontmatter in blueprint '${identityId}': ${errors}`,
        identityId,
        path,
      );
    }

    const frontmatter = validation.data;
    const rawSystemPrompt = body.trim();

    // Resolve inclusions recursively
    const systemPrompt = this.resolveFragments(rawSystemPrompt, new Set());

    return {
      identityId: frontmatter.identity_id || identityId,
      name: frontmatter.name || this.deriveNameFromId(identityId),
      model: frontmatter.model || this.options.defaultModel || "anthropic:claude-sonnet-4-20250514",
      provider: frontmatter.provider,
      capabilities: frontmatter.capabilities,
      systemPrompt,
      version: frontmatter.version,
      frontmatter,
      path,
    };
  }

  /**
   * Resolve {{include:fragments}} recursively
   */
  private resolveFragments(content: string, seen: Set<string>): string {
    const includeRegex = /{{include:([^}]+)}}/g;

    return content.replace(includeRegex, (match, fragmentName) => {
      fragmentName = fragmentName.trim();

      if (seen.has(fragmentName)) {
        console.warn(`Circular inclusion detected for fragment: ${fragmentName}`);
        return match;
      }

      // Fragments are stored in Blueprints/Fragments/ relative to blueprintsPath
      const fragmentsDir = this.options.blueprintsPath.endsWith(DEFAULT_IDENTITIES_PATH)
        ? join(this.options.blueprintsPath, "..", "Fragments")
        : join(this.options.blueprintsPath, "Fragments");

      const fragmentPath = join(fragmentsDir, `${fragmentName}.md`);

      try {
        // We use a sync read here for simplicity within replace,
        // but since loader is async, we could optimize this later if needed.
        // For now, these are small files read during startup.
        const fragmentContent = Deno.readTextFileSync(fragmentPath);

        const nextSeen = new Set(seen);
        nextSeen.add(fragmentName);

        return this.resolveFragments(fragmentContent, nextSeen);
      } catch (error) {
        console.warn(
          `Failed to include fragment '${fragmentName}': ${error instanceof Error ? error.message : String(error)}`,
        );
        return match;
      }
    });
  }

  /**
   * Create minimal blueprint from content without frontmatter
   * Backward compatible with simple blueprint files
   */
  private createMinimalBlueprint(
    content: string,
    identityId: string,
    path: string,
  ): ILoadedBlueprint {
    const frontmatter = RuntimeBlueprintFrontmatterSchema.parse({});

    return {
      identityId,
      name: this.deriveNameFromId(identityId),
      model: this.options.defaultModel || "anthropic:claude-sonnet-4-20250514",
      capabilities: [],
      systemPrompt: content.trim(),
      version: "1.0.0",
      frontmatter,
      path,
    };
  }

  /**
   * Derive human-readable name from agent ID
   * "code-reviewer" → "Code Reviewer"
   */
  private deriveNameFromId(identityId: string): string {
    return identityId
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Resolve agent ID to file path
   *
   * Phase 54: Only checks Blueprints/Identities/{identityId}.md (canonical path).
   * Legacy Blueprints/Identities/ path is no longer supported.
   *
   * @param identityId - The agent identifier
   * @returns Full path to the identity blueprint
   */
  private resolvePath(identityId: string): string {
    // If blueprintsPath already ends with 'Identities', use it directly
    if (this.options.blueprintsPath.endsWith(DEFAULT_IDENTITIES_PATH)) {
      return join(this.options.blueprintsPath, `${identityId}.md`);
    }

    // Otherwise, assume it's the Blueprints root and use Identities subdirectory
    return join(this.options.blueprintsPath, DEFAULT_IDENTITIES_PATH, `${identityId}.md`);
  }

  /**
   * Check if a blueprint exists
   */
  async exists(identityId: string): Promise<boolean> {
    const path = this.resolvePath(identityId);
    return await exists(path);
  }

  /**
   * List all blueprint files under Blueprints/Identities.
   */
  async listAll(): Promise<ILoadedBlueprint[]> {
    const identitiesDir = this.options.blueprintsPath.endsWith(DEFAULT_IDENTITIES_PATH)
      ? this.options.blueprintsPath
      : join(this.options.blueprintsPath, DEFAULT_IDENTITIES_PATH);

    try {
      const stat = await Deno.stat(identitiesDir);
      if (!stat.isDirectory) {
        return [];
      }
    } catch {
      return [];
    }

    const blueprints: ILoadedBlueprint[] = [];

    for await (const entry of Deno.readDir(identitiesDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const identityId = basename(entry.name, ".md");
      const blueprint = await this.load(identityId);
      if (blueprint) {
        blueprints.push(blueprint);
      }
    }

    return blueprints;
  }

  /**
   * Clear the blueprint cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Remove a specific blueprint from cache
   */
  invalidate(identityId: string): void {
    this.cache.delete(identityId);
  }

  /**
   * Convert to legacy Blueprint interface for backward compatibility
   */
  toLegacyBlueprint(loaded: ILoadedBlueprint): IBlueprint {
    return {
      systemPrompt: loaded.systemPrompt,
      identityId: loaded.identityId,
    };
  }
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown when blueprint loading fails
 */
export class BlueprintLoadError extends Error {
  constructor(
    message: string,
    public readonly identityId: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = "BlueprintLoadError";
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a BlueprintLoader with default configuration
 */
export function createBlueprintLoader(blueprintsPath: string): BlueprintLoader {
  return new BlueprintLoader({ blueprintsPath });
}

/**
 * Standalone function for simple usage (backward compatible)
 * Drop-in replacement for request_common.loadBlueprint
 */
export async function loadBlueprint(
  blueprintsPath: string,
  identityId: string,
): Promise<IBlueprint | null> {
  const loader = new BlueprintLoader({ blueprintsPath });
  const loaded = await loader.load(identityId);

  if (!loaded) {
    return null;
  }

  return loader.toLegacyBlueprint(loaded);
}
