/**
 * @module PortalKnowledgeSchema
 * @path packages/schemas/src/portal_knowledge.ts
 * @description Zod validation schemas and inferred TypeScript types for the
 * IPortalKnowledge structure produced by PortalKnowledgeService (Phase 119).
 * Captures architecture, layers, key files, conventions, dependencies, and
 * symbol maps extracted from deep codebase analysis of mounted portals.
 * @architectural-layer Shared
 * @related-files [packages/portal/knowledge/directory_analyzer.ts, packages/schemas/src/mod.ts]
 */

import { z } from "zod";
import { SystemCommand } from "@exaix/core";

// Sub-schemas

/**
 * Significant file within a portal codebase, annotated with its role.
 */
export const FileSignificanceSchema = z.object({
  /** File path relative to portal root */
  path: z.string().min(1),
  /** Why this file is significant */
  role: z.enum([
    "entrypoint",
    "config",
    "schema",
    "test-helper",
    "core-service",
    "routing",
    "types",
    "migration",
    "build",
  ]),
  /** Brief description of what this file does */
  description: z.string().min(1),
  /** Approximate lines of code */
  lineCount: z.number().int().min(1).optional(),
});

export type IFileSignificance = z.infer<typeof FileSignificanceSchema>;

/**
 * An identified architectural layer within the codebase.
 */
export const ArchitectureLayerSchema = z.object({
  /** Layer name (e.g., "services", "controllers", "models") */
  name: z.string().min(1),
  /** Directory path(s) for this layer */
  paths: z.array(z.string()),
  /** Description of the layer's responsibility */
  responsibility: z.string().min(1),
  /** Key files in this layer */
  keyFiles: z.array(z.string()),
});

export type IArchitectureLayer = z.infer<typeof ArchitectureLayerSchema>;

/**
 * A detected code convention or pattern across the codebase.
 */
export const CodeConventionSchema = z.object({
  /** Convention name */
  name: z.string().min(1),
  /** Description of the convention */
  description: z.string().min(1),
  /** Example file paths demonstrating this convention */
  examples: z.array(z.string()),
  /** Category */
  category: z.enum([
    "naming",
    "structure",
    "testing",
    "imports",
    "error-handling",
    "typing",
    "other",
  ]),
  /** Number of files or patterns that provide evidence for this convention */
  evidenceCount: z.number().int().min(1),
  /** Confidence level based on evidence strength: low = 1–2, medium = 3–9, high = 10+ */
  confidence: z.enum(["low", "medium", "high"]),
});

export type ICodeConvention = z.infer<typeof CodeConventionSchema>;

/**
 * Dependency information extracted from a config file.
 */
export const DependencyInfoSchema = z.object({
  /** Package manager used */
  packageManager: z.enum(["npm", SystemCommand.DENO, "pip", "cargo", "go", "maven", "other"]),
  /** Config file path (package.json, deno.json, etc.) */
  configFile: z.string().min(1),
  /** Key dependencies (frameworks, major libraries) */
  keyDependencies: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().optional(),
      purpose: z.string().optional(),
    }),
  ),
});

export type IDependencyInfo = z.infer<typeof DependencyInfoSchema>;

/**
 * An exported symbol extracted from the codebase's symbol catalogue.
 */
export const SymbolEntrySchema = z.object({
  /** Symbol name (function, class, interface, const, type) */
  name: z.string().min(1),
  /** Symbol kind */
  kind: z.enum(["function", "class", "interface", "const", "type", "enum"]),
  /** File path relative to portal root */
  file: z.string().min(1),
  /** Full TypeScript/language signature (no body) */
  signature: z.string().min(1),
  /** JSDoc summary line, if present */
  doc: z.string().optional(),
  /** PageRank-like connectivity score — higher = referenced by more files */
  pageRankScore: z.number().min(0).optional(),
});

export type ISymbolEntry = z.infer<typeof SymbolEntrySchema>;

/**
 * Per-package breakdown for monorepos.
 */
export const MonorepoPackageSchema = z.object({
  /** Package name (from package.json "name" field or directory name) */
  name: z.string().min(1),
  /** Package path relative to portal root */
  path: z.string().min(1),
  /** Primary language for this package */
  primaryLanguage: z.string().min(1),
  /** Detected framework for this package */
  framework: z.string().optional(),
  /** Architecture layers local to this package */
  layers: z.array(ArchitectureLayerSchema),
  /** Conventions specific to this package */
  conventions: z.array(CodeConventionSchema),
});

export type IMonorepoPackage = z.infer<typeof MonorepoPackageSchema>;

/** A directed edge between two portal files. `layer_contains_file` edges are computed
 *  on demand instead (see `deriveLayerContainsFileEdges`), never persisted here. */
export const PortalKnowledgeRelationshipSchema = z.object({
  /** Source file path, relative to the portal root */
  from: z.string().min(1),
  /** Target file path, relative to the portal root */
  to: z.string().min(1),
  /** Edge kind — a single, persisted kind today; see the module doc above. */
  kind: z.literal("file_imports_file_internal"),
});

export type IPortalKnowledgeRelationship = z.infer<typeof PortalKnowledgeRelationshipSchema>;

// Root schema

/**
 * Complete knowledge gathered about a mounted portal codebase.
 */
export const PortalKnowledgeSchema = z.object({
  /** Portal alias */
  portal: z.string().min(1),
  /** When this knowledge was gathered — ISO 8601 datetime string */
  gatheredAt: z.string().datetime(),
  /** Knowledge version (incremented on re-analysis) */
  version: z.number().int().min(1),
  /** Commit SHA of the portal at the time of analysis */
  headCommitSha: z.string().length(40).optional(),
  /** Whether this snapshot includes a full 6-strategy analysis */
  fullAnalysis: z.boolean().optional(),

  /** High-level architecture overview (Markdown) */
  architectureOverview: z.string(),
  /** Detected architecture layers */
  layers: z.array(ArchitectureLayerSchema),
  /** Significant files with roles */
  keyFiles: z.array(FileSignificanceSchema),
  /** Detected code conventions */
  conventions: z.array(CodeConventionSchema),
  /** Dependency information */
  dependencies: z.array(DependencyInfoSchema),

  /** Per-package breakdown for monorepos; omit or pass [] for single-project portals */
  packages: z.array(MonorepoPackageSchema).optional(),

  /** Language/framework detected */
  techStack: z.object({
    primaryLanguage: z.string().min(1),
    framework: z.string().optional(),
    testFramework: z.string().optional(),
    buildTool: z.string().optional(),
  }),

  /** Top-N exported symbols ranked by connectivity; empty in "quick" mode, populated in "standard"/"deep". */
  symbolMap: z.array(SymbolEntrySchema).default([]),

  /** Project statistics */
  stats: z.object({
    totalFiles: z.number().int().min(0),
    totalDirectories: z.number().int().min(0),
    totalLinesOfCode: z.number().int().min(0).optional(),
    /** File extension distribution (e.g., { ".ts": 120, ".md": 15 }) */
    extensionDistribution: z.record(z.string(), z.number().int().min(0)),
  }),

  /** Analysis metadata */
  metadata: z.object({
    /** Duration of analysis in milliseconds */
    durationMs: z.number().int().min(0),
    /** Analysis mode used */
    mode: z.enum(["quick", "standard", "deep"]),
    /** Files scanned */
    filesScanned: z.number().int().min(0),
    /** Files read (content analyzed) */
    filesRead: z.number().int().min(0),
    /** Whether architecture inference failed and fallback was used */
    architectureInferenceFailed: z.boolean().optional(),
    /** Number of source files scanned for symbol extraction */
    symbolSourceFilesScanned: z.number().int().min(0).optional(),
  }),

  /** AST-level diagnostics from deno check (Strategy 7) */
  astDiagnostics: z.object({
    totalModules: z.number().int().min(0),
    totalImports: z.number().int().min(0),
    diagnostics: z.array(z.object({
      file: z.string(),
      message: z.string(),
    })),
    importGraph: z.record(z.string(), z.array(z.string())),
    errorCount: z.number().int().min(0),
  }).optional(),

  /** Test execution analysis (Strategy 8) */
  testInfo: z.object({
    testFiles: z.array(z.string()),
    testCount: z.number().int().min(0),
    testFramework: z.string().optional(),
    detected: z.enum(["executed", "inferred", "none"]),
  }).optional(),

  /** License detection (Strategy 9) */
  licenses: z.array(z.object({
    type: z.string().min(1),
    source: z.enum(["file", "package", "spdx"]),
    filePath: z.string().optional(),
    confidence: z.enum(["high", "medium", "low"]),
  })).optional(),

  /** Dependency vulnerability scan (Strategy 10) */
  vulnerabilities: z.object({
    totalVulnerabilities: z.number().int().min(0),
    bySeverity: z.object({
      critical: z.number().int().min(0),
      high: z.number().int().min(0),
      medium: z.number().int().min(0),
      low: z.number().int().min(0),
    }),
    scannerUsed: z.enum(["deno_audit", "npm_audit", "none"]),
    skipReason: z.string().optional(),
  }).optional(),

  /** Git history analysis (Strategy 11) */
  gitHistory: z.object({
    totalCommits: z.number().int().min(0),
    totalAuthors: z.number().int().min(0),
    hasSufficientHistory: z.boolean(),
    topChangedFiles: z.array(z.object({
      file: z.string(),
      commitCount: z.number().int().min(0),
    })).optional(),
    topAuthors: z.array(z.object({
      name: z.string(),
      commitCount: z.number().int().min(0),
      percentage: z.number().min(0).max(100),
    })).optional(),
    hotspots: z.array(z.object({
      file: z.string(),
      commitCount: z.number().int().min(0),
    })).optional(),
  }).optional(),

  /** Internal (relative-import) file-to-file edges, derived via `deno info`. */
  relationships: z.array(PortalKnowledgeRelationshipSchema).optional(),
});

export type IPortalKnowledge = z.infer<typeof PortalKnowledgeSchema>;
