/**
 * @module KeyFileIdentifier
 * @path src/services/portal_knowledge/key_file_identifier.ts
 * @description Strategy 3 of PortalKnowledgeService: identifies significant
 * files by name and path heuristics, assigns roles (entrypoint, config, schema,
 * test-helper, routing, types, migration, build), and returns them sorted by
 * significance. Pure function module — zero LLM / network dependencies.
 * @architectural-layer Services
 * * @related-files [src/services/portal_knowledge/config_parser.ts, src/services/portal_knowledge/pattern_detector.ts]
 */

import { PORTAL_ENTRYPOINT_NAMES, PORTAL_KNOWLEDGE_CONFIG_EXTENSIONS } from "../../shared/constants.ts";
import type { IFileSignificance } from "@exaix/schemas/portal_knowledge.ts";

// ---------------------------------------------------------------------------
// Role priority order (lower index = higher significance)
// ---------------------------------------------------------------------------

const FILE_ROLE_CONFIG = "config" as const;

const ROLE_PRIORITY: IFileSignificance["role"][] = [
  "entrypoint",
  FILE_ROLE_CONFIG,
  "schema",
  "types",
  "routing",
  "core-service",
  "test-helper",
  "migration",
  "build",
];

// ---------------------------------------------------------------------------
// Rule matchers
// ---------------------------------------------------------------------------

type RoleRule = {
  role: IFileSignificance["role"];
  description: string;
  match: (filename: string, relPath: string) => boolean;
};

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function dirnames(relPath: string): string[] {
  return relPath.replace(/\\/g, "/").split("/").slice(0, -1);
}

const RULES: RoleRule[] = [
  // Entrypoints
  {
    role: "entrypoint",
    description: "Application entry point",
    match: (name) => PORTAL_ENTRYPOINT_NAMES.includes(name),
  },
  // Config files
  {
    role: "config",
    description: "Project configuration file",
    match: (name) => {
      const configNames = [
        "package.json",
        "deno.json",
        "deno.jsonc",
        "tsconfig.json",
        "jsconfig.json",
        "Cargo.toml",
        "pyproject.toml",
        "go.mod",
        ".eslintrc.json",
        ".eslintrc.js",
        ".babelrc",
        ".babelrc.json",
        "babel.config.js",
        "babel.config.json",
        "jest.config.ts",
        "jest.config.js",
        "vitest.config.ts",
        "vitest.config.js",
        "vite.config.ts",
        "vite.config.js",
        "webpack.config.js",
        "rollup.config.js",
        ".prettierrc",
        ".prettierrc.json",
        ".dockerignore",
      ];
      if (configNames.includes(name)) return true;
      // *.config.* pattern
      if (/\.(config|rc)\.[a-z]+$/.test(name)) return true;
      // bare extension config files (.json, .toml, .yaml, .yml at well-known names)
      if (PORTAL_KNOWLEDGE_CONFIG_EXTENSIONS.includes(`.${name.split(".").pop()}`)) {
        if (name.endsWith(".json") || name.endsWith(".toml") || name.endsWith(".yaml") || name.endsWith(".yml")) {
          // Only if in root or named well
          return name.includes("config") || name.includes("settings");
        }
      }
      return false;
    },
  },
  // Schema files
  {
    role: "schema",
    description: "Validation schema definitions",
    match: (name, relPath) => {
      if (/^schema[s]?\.(ts|js|py)$/.test(name)) return true;
      if (/^.*schema\.(ts|js|py)$/.test(name)) return true;
      if (/^.*schemas?\.(ts|js|py)$/.test(name)) return true;
      const dirs = dirnames(relPath);
      if (dirs.includes("schemas") || dirs.includes("schema")) return true;
      return false;
    },
  },
  // Type definition files
  {
    role: "types",
    description: "Shared type definitions and interfaces",
    match: (name, relPath) => {
      if (/^types?\.(ts|js)$/.test(name)) return true;
      if (/^interfaces?\.(ts|js)$/.test(name)) return true;
      if (/^.*\.types?\.(ts|js)$/.test(name)) return true;
      if (/^.*\.d\.ts$/.test(name)) return true;
      const dirs = dirnames(relPath);
      if (dirs.includes("types") || dirs.includes("interfaces")) return true;
      return false;
    },
  },
  // Routing files
  {
    role: "routing",
    description: "URL routing and API route definitions",
    match: (name, relPath) => {
      if (/^routes?\.(ts|js|py)$/.test(name)) return true;
      if (/^router\.(ts|js)$/.test(name)) return true;
      if (/^.*\.(routes|router)\.(ts|js)$/.test(name)) return true;
      const dirs = dirnames(relPath);
      if (dirs.includes("routes") || dirs.includes("routing")) return true;
      return false;
    },
  },
  // Test helpers
  {
    role: "test-helper",
    description: "Test utilities, fixtures, and helpers",
    match: (name) => {
      if (/test_helper[s]?\.(ts|js|py)$/.test(name)) return true;
      if (/fixtures?\.(ts|js|py)$/.test(name)) return true;
      if (/conftest\.py$/.test(name)) return true;
      if (/setup\.(ts|js)$/.test(name)) return true;
      if (/test_utils?\.(ts|js)$/.test(name)) return true;
      return false;
    },
  },
  // Migration files (directory-based)
  {
    role: "migration",
    description: "Database migration script",
    match: (_name, relPath) => {
      const dirs = dirnames(relPath);
      return dirs.includes("migrations") || dirs.includes("migration");
    },
  },
  // Build/infra files
  {
    role: "build",
    description: "Build, deploy, or infrastructure file",
    match: (name) => {
      const buildNames = [
        "Dockerfile",
        "docker-compose.yml",
        "docker-compose.yaml",
        "Makefile",
        "Jenkinsfile",
        "Taskfile.yml",
        "Taskfile.yaml",
        ".travis.yml",
        "azure-pipelines.yml",
      ];
      if (buildNames.includes(name)) return true;
      if (/^Dockerfile\..+/.test(name)) return true;
      return false;
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Identify significant files in a portal by name/path heuristics.
 *
 * @param fileList - Relative file paths from the portal root.
 * @param limit    - Maximum number of results to return.
 * @returns        Significant files sorted by role importance, capped at limit.
 */
export function identifyKeyFiles(
  fileList: string[],
  limit: number,
): IFileSignificance[] {
  const identified: IFileSignificance[] = [];
  const seen = new Set<string>();

  for (const relPath of fileList) {
    if (seen.has(relPath)) continue;
    const name = basename(relPath);
    for (const rule of RULES) {
      if (rule.match(name, relPath)) {
        seen.add(relPath);
        identified.push({
          path: relPath,
          role: rule.role,
          description: rule.description,
        });
        break; // first matching rule wins
      }
    }
  }

  // Sort by role priority
  identified.sort((a, b) => {
    const ai = ROLE_PRIORITY.indexOf(a.role);
    const bi = ROLE_PRIORITY.indexOf(b.role);
    return ai - bi;
  });

  return identified.slice(0, limit);
}
