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
import type { JSONValue } from "@exaix/core";
import {
  DEFAULT_AI_MODEL,
  DEFAULT_BLUEPRINT_VERSION,
  DEFAULT_IDENTITIES_PATH,
  McpToolName,
  ToolName,
} from "@exaix/core";

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

/** Legacy interface kept for backward compatibility — used by agent_runner.ts. */
export interface IBlueprint {
  systemPrompt: string;
  identityId?: string;
  /** Default skills to apply for all requests, sourced from frontmatter.default_skills. */
  defaultSkills?: string[];
}

export interface IBlueprintLoaderOptions {
  /** Path to blueprints directory */
  blueprintsPath: string;

  /** Default model if not specified in blueprint */
  defaultModel?: string;
}

/** A single unknown-frontmatter-field warning. */
export interface IUnknownFieldWarning {
  field: string;
}

/** Result of {@link validateRuntimeFrontmatter}: parsed data + non-fatal warnings. */
export interface IRuntimeFrontmatterValidation {
  ok: boolean;
  data: RuntimeBlueprintFrontmatter | null;
  warnings: IUnknownFieldWarning[];
  errors: string[];
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

/** Inline session-delegate schema (mirrors the HITL inlining above); passthrough preserves
 * unknown sub-keys since the CLI `BlueprintFrontmatterSchema` validates strictly at create
 * time, avoiding a runtime cross-package import from @exaix/schemas. */
const SessionDelegateConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tool: z.string().min(1),
  model: z.string().min(1).optional(),
  gates: z.array(z.string()).optional(),
  launch_mode: z.string().optional(),
}).passthrough();

/** Runtime blueprint schema; more permissive than the creation schema to allow older blueprints. */
export const RuntimeBlueprintFrontmatterSchema = z.object({
  /** Agent identifier - required */
  identity_id: z.string().min(1).optional(),

  /** Human-readable name */
  name: z.string().min(1).optional(),

  /** Model in provider:model format. Empty string means "resolve via ModelResolver". */
  model: z.string().optional(),

  /** Provider name (legacy field, prefer model with provider prefix) */
  provider: z.string().optional(),

  // === Declarative model preferences (W5/W20) ===

  /** Preferred provider hint (resolved by resolveIdentityModel; `model` overrides). */
  preferred_provider: z.string().min(1).optional(),

  /** Size tier mapped onto task complexity for provider selection. */
  model_size: z.enum(["S", "M", "L", "XL"]).optional(),

  /** Extended-thinking hint; ignored by providers that do not support it. */
  thinking: z.boolean().optional(),

  /** Reasoning-effort hint; ignored by providers that do not support it. */
  effort: z.string().min(1).optional(),

  /** Soft ranking hints: cheapest, fastest. */
  characteristics: z.array(z.string()).optional(),

  /** Agent capabilities */
  capabilities: z.array(z.string()).default([]),

  /** Semantic version */
  version: z.string().default(DEFAULT_BLUEPRINT_VERSION),

  /** Description */
  description: z.string().optional(),

  /** Routing hint for NL task matching. */
  routing_hint: z.string().optional(),

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

  /** Enable reflexive self-critique */
  reflexive: z.boolean().default(false),

  /** Max iterations for reflexive critique */
  max_reflexion_iterations: z.number().min(1).max(10).default(3),

  /** Minimum confidence required (0-100) */
  confidence_required: z.number().min(0).max(100).optional(),

  /** Enable session memory */
  memory_enabled: z.boolean().default(false),

  /** Default skills to apply */
  default_skills: z.array(z.string()).optional(),

  /** Tools this identity is permitted to use (from McpToolName or ToolName). */
  permitted_tools: z.array(z.union([z.nativeEnum(McpToolName), z.nativeEnum(ToolName)])).optional(),

  /** Deprecation flag for outdated blueprints; consumed by routing/capability matching */
  deprecated: z.boolean().default(false),

  /** Prefer this agent locally for routing fallback */
  routing_prefer_local: z.boolean().optional(),

  /** Per-action HITL governance rules for this blueprint. */
  hitl: HitlPolicySchema.optional(),

  /** Session delegation configuration; preserved on load so the daemon can act on it. */
  session_delegate: SessionDelegateConfigSchema.optional(),
});

/** Frontmatter keys the runtime schema recognizes; used by {@link validateRuntimeFrontmatter}
 * to warn (not reject) on unknown keys. */
const KNOWN_FRONTMATTER_KEYS: ReadonlySet<string> = new Set(
  Object.keys((RuntimeBlueprintFrontmatterSchema as z.ZodObject<z.ZodRawShape>).shape),
);

/** Validates frontmatter against the runtime schema, surfacing unknown top-level keys as
 * warnings (not rejections); legacy runtime-only fields are part of the schema and not flagged. */
export function validateRuntimeFrontmatter(
  frontmatter: Record<string, JSONValue>,
): IRuntimeFrontmatterValidation {
  const warnings: IUnknownFieldWarning[] = [];
  for (const key of Object.keys(frontmatter)) {
    if (!KNOWN_FRONTMATTER_KEYS.has(key)) warnings.push({ field: key });
  }
  const parsed = RuntimeBlueprintFrontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) {
    return {
      ok: false,
      data: null,
      warnings,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { ok: true, data: parsed.data, warnings, errors: [] };
}

export type RuntimeBlueprintFrontmatter = z.infer<typeof RuntimeBlueprintFrontmatterSchema>;

// ============================================================================
// Loaded Blueprint Type
// ============================================================================

// ============================================================================
// IBlueprintLoader Service
// ============================================================================

/** Loads blueprints with YAML frontmatter parsing, Zod schema validation, and backward
 * compatibility for frontmatter-less (plain markdown) blueprints. */
export class IBlueprintLoader {
  private cache = new Map<string, ILoadedBlueprint>();

  constructor(private options: IBlueprintLoaderOptions) {}

  /** Loads a blueprint; `identityId` is the filename without the `.md` extension. */
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

  /** Parses blueprint content: YAML (---) or TOML (+++) frontmatter, or plain markdown treated as the system prompt. */
  parse(content: string, identityId: string, path: string): ILoadedBlueprint {
    // Try YAML frontmatter first (most common)
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (yamlMatch) {
      return this.parseWithFrontmatter(
        yamlMatch[1],
        content.slice(yamlMatch[0].length),
        identityId,
        path,
      );
    }

    // TOML frontmatter (+++) is retired; YAML (---) is now canonical. A legacy +++ file is
    // reported as an explicit error rather than silently treated as a frontmatter-less prompt.
    if (content.startsWith("+++\n")) {
      throw new BlueprintLoadError(
        `Blueprint '${identityId}' uses retired TOML (+++) frontmatter; convert it to YAML (--- ... ---).`,
        identityId,
        path,
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
  ): ILoadedBlueprint {
    let parsed: Record<string, JSONValue>;

    try {
      parsed = parseYaml(frontmatterRaw) as Record<string, JSONValue>;
    } catch (error) {
      throw new BlueprintLoadError(
        `Invalid YAML frontmatter in blueprint '${identityId}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        identityId,
        path,
      );
    }

    // Validate frontmatter with the unified schema; unknown top-level keys are surfaced as
    // warnings rather than rejected.
    const validation = validateRuntimeFrontmatter(parsed);
    for (const w of validation.warnings) {
      console.warn(`Unknown frontmatter field '${w.field}' in blueprint '${identityId}' (ignored)`);
    }
    if (!validation.ok || validation.data === null) {
      throw new BlueprintLoadError(
        `Invalid frontmatter in blueprint '${identityId}': ${validation.errors.join(", ")}`,
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
      model: frontmatter.model || this.options.defaultModel || DEFAULT_AI_MODEL,
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

  /** Builds a minimal blueprint from frontmatter-less content (backward compatible with simple blueprint files). */
  private createMinimalBlueprint(
    content: string,
    identityId: string,
    path: string,
  ): ILoadedBlueprint {
    const frontmatter = RuntimeBlueprintFrontmatterSchema.parse({});

    return {
      identityId,
      name: this.deriveNameFromId(identityId),
      model: this.options.defaultModel || DEFAULT_AI_MODEL,
      capabilities: [],
      systemPrompt: content.trim(),
      version: "1.0.0",
      frontmatter,
      path,
    };
  }

  /** Converts a kebab-case agent ID into a human-readable name, e.g. "code-reviewer" → "Code Reviewer". */
  private deriveNameFromId(identityId: string): string {
    return identityId
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /** Resolves an agent ID to its blueprint file path: only Blueprints/Identities/{identityId}.md
   * (canonical) is checked; the legacy path is no longer supported. */
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
      defaultSkills: loaded.frontmatter.default_skills,
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
 * Create a IBlueprintLoader with default configuration
 */
export function createBlueprintLoader(blueprintsPath: string): IBlueprintLoader {
  return new IBlueprintLoader({ blueprintsPath });
}

/** Standalone drop-in replacement for request_common.loadBlueprint. */
export async function loadBlueprint(
  blueprintsPath: string,
  identityId: string,
): Promise<IBlueprint | null> {
  const loader = new IBlueprintLoader({ blueprintsPath });
  const loaded = await loader.load(identityId);

  if (!loaded) {
    return null;
  }

  return loader.toLegacyBlueprint(loaded);
}
