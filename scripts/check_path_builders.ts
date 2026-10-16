#!/usr/bin/env -S deno run -A
/**
 * @module CheckPathBuilders
 * @path scripts/check_path_builders.ts
 * @description Reports a module that owns the Exaix workspace layout instead of the shared
 *   helpers. It covers four shapes: a join of a default constant, a root segment spelled in a
 *   literal, a config entry that restates a default, and a `paths.<key>` assignment that does.
 *
 *   Usage: deno task check:path-builders
 * @architectural-layer Script
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [packages/shared/src/paths.ts, CODE_STYLE.md]
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import {
  DEFAULT_ACTIVE_PATH,
  DEFAULT_AGENTS_PATH,
  DEFAULT_ARCHIVE_PATH,
  DEFAULT_BLUEPRINTS_PATH,
  DEFAULT_FLOWS_DIR,
  DEFAULT_MEMORY_EXECUTION_DIR,
  DEFAULT_MEMORY_GLOBAL_DIR,
  DEFAULT_MEMORY_INDEX_DIR,
  DEFAULT_MEMORY_PATH,
  DEFAULT_MEMORY_PENDING_DIR,
  DEFAULT_MEMORY_PROJECTS_DIR,
  DEFAULT_MEMORY_SKILLS_DIR,
  DEFAULT_MEMORY_TASKS_DIR,
  DEFAULT_PLANS_PATH,
  DEFAULT_PORTALS_PATH,
  DEFAULT_REJECTED_PATH,
  DEFAULT_REQUESTS_PATH,
  DEFAULT_RUNTIME_PATH,
  DEFAULT_WORKSPACE_PATH,
} from "@exaix/shared";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const ROOTS = ["packages", "apps", "exaix-team", "tests"];
const PATH_CONSTANT = /^DEFAULT_[A-Z0-9_]*_PATH$/;
const JOIN_CALLS = new Set(["join", "resolve", "normalize", "relative"]);
const EXCLUDE_MARKER = "path-builder-exclude";
/** The root segments that the helpers own. A literal run must start with one of them. */
const ROOT_SEGMENTS = new Set(["Workspace", ".exa", "Memory", "Portals", "Blueprints"]);
/** Blueprint subdirectories that no memory constant owns, so a literal may name them. */
const BLUEPRINTS_SUBDIRS = new Set(["Skills"]);
/** A path run anchored by a separator or by the end of a template interpolation. */
const RAW_RUN = /[/}]([A-Za-z.][A-Za-z0-9._]*(?:\/[A-Za-z.][A-Za-z0-9._]*)*)/g;
/** The default each `[paths]` key resolves to when a config omits it. */
const PATH_DEFAULTS: Record<string, string> = {
  workspace: DEFAULT_WORKSPACE_PATH,
  runtime: DEFAULT_RUNTIME_PATH,
  memory: DEFAULT_MEMORY_PATH,
  portals: DEFAULT_PORTALS_PATH,
  blueprints: DEFAULT_BLUEPRINTS_PATH,
  active: DEFAULT_ACTIVE_PATH,
  archive: DEFAULT_ARCHIVE_PATH,
  plans: DEFAULT_PLANS_PATH,
  requests: DEFAULT_REQUESTS_PATH,
  rejected: DEFAULT_REJECTED_PATH,
  agents: DEFAULT_AGENTS_PATH,
  flows: DEFAULT_FLOWS_DIR,
  memoryProjects: DEFAULT_MEMORY_PROJECTS_DIR,
  memoryExecution: DEFAULT_MEMORY_EXECUTION_DIR,
  memoryIndex: DEFAULT_MEMORY_INDEX_DIR,
  memorySkills: DEFAULT_MEMORY_SKILLS_DIR,
  memoryPending: DEFAULT_MEMORY_PENDING_DIR,
  memoryTasks: DEFAULT_MEMORY_TASKS_DIR,
  memoryGlobal: DEFAULT_MEMORY_GLOBAL_DIR,
};
/** The shared constants that a test may interpolate into a config value. */
const PLACEHOLDERS: Record<string, string> = {
  DEFAULT_WORKSPACE_PATH,
  DEFAULT_RUNTIME_PATH,
  DEFAULT_MEMORY_PATH,
  DEFAULT_PORTALS_PATH,
  DEFAULT_BLUEPRINTS_PATH,
  DEFAULT_ACTIVE_PATH,
  DEFAULT_ARCHIVE_PATH,
  DEFAULT_PLANS_PATH,
  DEFAULT_REQUESTS_PATH,
  DEFAULT_REJECTED_PATH,
  DEFAULT_AGENTS_PATH,
  DEFAULT_FLOWS_DIR,
  DEFAULT_MEMORY_PROJECTS_DIR,
  DEFAULT_MEMORY_EXECUTION_DIR,
  DEFAULT_MEMORY_INDEX_DIR,
  DEFAULT_MEMORY_SKILLS_DIR,
  DEFAULT_MEMORY_PENDING_DIR,
  DEFAULT_MEMORY_TASKS_DIR,
  DEFAULT_MEMORY_GLOBAL_DIR,
};
const TOML_ENTRY = /^\s*(\w+)\s*=\s*(.+?)\s*$/;
const TOML_PATHS_HEADER = /^\s*\[paths\]\s*$/;
const TOML_SECTION = /^\s*\[[^\]]+\]\s*$/;
const PATHS_ASSIGNMENT = /\.paths\.(\w+)\s*=\s*"([^"]*)"/;
/** The helper module and the tables that legitimately compose the defaults. */
const DEFINITION_SITES = [
  "packages/shared/src/paths.ts",
  "packages/shared/src/constants.ts",
];
/** A TOML section header, which marks a whole config document inside a literal. */
const TOML_DOCUMENT = /^\s*\[(?:system|paths)\]\s*$/m;
/**
 * Test files that still embed a config document, with the reason each one is allowed to.
 * A test reads a fixture from `fixtures/configs` instead, so the config is data, not code.
 */
const INLINE_CONFIG_ALLOW: Record<string, string> = {
  "apps/exactl/tests/cli_fallback_regression_test.ts": "fixture extraction pending",
  "apps/exactl/tests/request_create_dry_run_context_test.ts": "fixture extraction pending",
  "exaix-team/apps/mcp-server/tests/mcp_git_factory_test.ts": "fixture extraction pending",
  "exaix-team/apps/mcp-server/tests/server_context_test.ts": "fixture extraction pending",
  "tests/scenario_framework/tests/unit/provider_live_evidence_test.ts": "fixture extraction pending",
  "tests/scenario_framework/tests/unit/sandbox_cleanup_test.ts": "fixture extraction pending",
  "apps/daemon/tests/deploy_workspace_test.ts": "fixture extraction pending",
  "apps/exactl/tests/commands/skill_commands_cli_test.ts": "fixture extraction pending",
  "apps/exactl/tests/daemon_config_reload_test.ts": "fixture extraction pending",
  "apps/exactl/tests/exactl_module_import_regression_test.ts": "fixture extraction pending",
  "apps/exactl/tests/helpers/test_utils.ts": "shared config builder",
  "apps/exactl/tests/inspect_dispatch_test.ts": "fixture extraction pending",
  "apps/exactl/tests/model_commands_test.ts": "fixture extraction pending",
  "apps/exactl/tests/scaffold_test.ts": "fixture extraction pending",
  "packages/core/tests/config/config_service_generation_test.ts": "fixture extraction pending",
  "packages/execution/tests/agent_composer_react_strategy_test.ts": "fixture extraction pending",
  "packages/execution/tests/agent_runner_planning_tools_test.ts": "fixture extraction pending",
  "packages/flow/tests/agent_composer_adapter_namespace_prompt_test.ts": "fixture extraction pending",
  "packages/schemas/tests/config_aci_docs_test.ts": "fixture extraction pending",
  "packages/schemas/tests/config_flow_namespace_prompt_test.ts": "fixture extraction pending",
  "packages/storage-sqlite/tests/test_mode_schema_test.ts": "fixture extraction pending",
  "packages/testing/src/helpers/config.ts": "shared config builder",
  "packages/testing/src/helpers/init_db.ts": "shared config builder",
  "tests/config/config_security_test.ts": "crafts a parser fixture inline on purpose",
  "tests/config/config_test.ts": "crafts a parser fixture inline on purpose",
  "tests/integration/agent_runner_daemon_cutover_test.ts": "fixture extraction pending",
  "tests/integration/dogfood_e2e_test.ts": "fixture extraction pending",
  "tests/integration/dogfood_net_resolver_test.ts": "fixture extraction pending",
  "tests/scenario_framework/tests/helpers/advanced_flow_case.ts": "shared config builder",
  "tests/scenario_framework/tests/helpers/legacy_flow_case.ts": "shared config builder",
  "tests/scenario_framework/tests/unit/cell_config_sentinel_test.ts": "fixture extraction pending",
  "tests/scenario_framework/tests/unit/judge_bindings_test.ts": "fixture extraction pending",
  "tests/scenario_framework/tests/unit/materialize_cell_config_test.ts": "fixture extraction pending",
  "tests/scenario_framework/tests/unit/portal_mount_verification_test.ts": "fixture extraction pending",
  "tests/scenario_framework/tests/unit/workspace_config_overrides_test.ts": "fixture extraction pending",
};

interface IViolation {
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

/** The called name for an identifier or a property access, or null. */
function calleeName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

function isPathConstant(node: ts.Expression): string | null {
  return ts.isIdentifier(node) && PATH_CONSTANT.test(node.text) ? node.text : null;
}

/** True when the literal starts a root segment run, such as `/Portals/...` or `}/Memory/...`. */
function rawRunStart(run: string): string | null {
  const segments = run.split("/");
  const first = segments[0];
  if (!ROOT_SEGMENTS.has(first)) return null;
  if (first === "Blueprints" && BLUEPRINTS_SUBDIRS.has(segments[1])) return null;
  return first;
}

/** The literal value of a config entry, or null when it holds an unknown interpolation. */
function entryValue(raw: string): string | null {
  const quoted = raw.match(/^"([^"]*)"$/);
  const value = quoted ? quoted[1] : raw.replace(/^"/, "").replace(/"$/, "");
  if (!value.includes("${")) return value;
  let resolved = value;
  for (const [name, replacement] of Object.entries(PLACEHOLDERS)) {
    resolved = resolved.replaceAll("${" + name + "}", replacement);
  }
  resolved = resolved.replace(
    /\$\{JSON\.stringify\(ExaPathDefaults\.(\w+)\)\}/g,
    (_m, key) => PATH_DEFAULTS[key] ?? _m,
  );
  resolved = resolved.replace(/\$\{ExaPathDefaults\.(\w+)\}/g, (_m, key) => PATH_DEFAULTS[key] ?? _m);
  return resolved.includes("${") ? null : resolved;
}

/** True when a `[paths]` value repeats the default that the schema would apply anyway. */
function restatesDefault(key: string, raw: string): boolean {
  const value = entryValue(raw);
  if (value === null) return false;
  const direct = PATH_DEFAULTS[key];
  if (direct === undefined) return false;
  return direct === value || (value.startsWith("./") && direct === value.slice(2));
}

/** A `[paths]` block inside a string or template literal, which repeats the schema defaults. */
function scanEmbeddedToml(node: ts.Node, raw: string, repoPath: string, add: AddFn): void {
  const startLine = node.getStart().valueOf();
  void startLine;
  const lines = raw.split(/\\n|\n/);
  let inPaths = false;
  for (const line of lines) {
    if (TOML_SECTION.test(line)) {
      inPaths = TOML_PATHS_HEADER.test(line);
      continue;
    }
    if (!inPaths || line.trim().startsWith("#")) continue;
    const match = TOML_ENTRY.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (!restatesDefault(key, value)) continue;
    add(node, `embedded ${key} = ${value} restates the default`);
  }
}

type AddFn = (node: ts.Node, detail: string, lineOffset?: number) => void;

/** True when the file holds tests. */
function isTestPath(repoPath: string): boolean {
  return repoPath.includes("/tests/") || repoPath.endsWith("_test.ts");
}

/** Every literal in the file that holds a whole TOML config document. */
function configDocumentNodes(source: ts.SourceFile): ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const raw = node.getText(source).slice(1, -1).replaceAll("\\n", "\n");
      if (TOML_DOCUMENT.test(raw)) nodes.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return nodes;
}

function scanFile(repoPath: string, text: string): IViolation[] {
  const source = ts.createSourceFile(repoPath, text, ts.ScriptTarget.Latest, true);
  const lines = text.split("\n");
  const violations: IViolation[] = [];
  const add: AddFn = (node, detail, lineOffset = 0): void => {
    const startLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    const line = startLine + lineOffset + 1;
    if (lines[line - 1]?.includes(EXCLUDE_MARKER)) return;
    if (line > 1 && lines[line - 2]?.includes(EXCLUDE_MARKER)) return;
    violations.push({ file: repoPath, line, detail });
  };
  const scanRaw = (node: ts.Node, raw: string): void => {
    for (const match of raw.matchAll(RAW_RUN)) {
      const start = rawRunStart(match[1]);
      if (start) add(node, `literal run "/${match[1]}"`);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && JOIN_CALLS.has(name)) {
        for (const argument of node.arguments) {
          const constant = isPathConstant(argument);
          if (constant) add(node, `${name}(..., ${constant}, ...)`);
        }
      }
    } else if (ts.isStringLiteral(node)) {
      const parent = node.parent;
      const isSpecifier = (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
        parent.moduleSpecifier === node;
      if (!isSpecifier && !/\s/.test(node.text)) {
        scanRaw(node, node.text);
        scanEmbeddedToml(node, node.getText(source).slice(1, -1), repoPath, add);
      }
    } else if (ts.isTemplateExpression(node)) {
      scanEmbeddedToml(node, node.getText(source).slice(1, -1), repoPath, add);
      for (const span of node.templateSpans) {
        const raw = span.literal.getText(source);
        if (!/\s/.test(raw)) scanRaw(span.literal, raw);
      }
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!/\s/.test(node.text)) scanRaw(node, node.text);
      scanEmbeddedToml(node, node.text, repoPath, add);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (isTestPath(repoPath) && !(repoPath in INLINE_CONFIG_ALLOW)) {
    for (const node of configDocumentNodes(source)) {
      violations.push({
        file: repoPath,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        detail: "embeds a whole config document. Read a fixture from fixtures/configs instead.",
      });
    }
  }
  for (let index = 0; index < lines.length; index++) {
    const match = PATHS_ASSIGNMENT.exec(lines[index]);
    if (!match) continue;
    if (!restatesDefault(match[1], `"${match[2]}"`)) continue;
    if (lines[index].includes(EXCLUDE_MARKER)) continue;
    violations.push({
      file: repoPath,
      line: index + 1,
      detail: `paths.${match[1]} = "${match[2]}" restates the default`,
    });
  }
  return violations;
}

/** A `[paths]` entry in a shipped config that restates the schema default. */
function scanToml(repoPath: string, text: string): IViolation[] {
  const violations: IViolation[] = [];
  const lines = text.split("\n");
  let inPaths = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (TOML_SECTION.test(line)) {
      inPaths = TOML_PATHS_HEADER.test(line);
      continue;
    }
    if (!inPaths || line.trim().startsWith("#")) continue;
    const match = /^\s*(\w+)\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (!restatesDefault(key, `"${value}"`)) continue;
    violations.push({ file: repoPath, line: index + 1, detail: `${key} = "${value}" restates the default` });
  }
  return violations;
}

/** Every violation in the repository. */
export async function findPathBuilderViolations(): Promise<IViolation[]> {
  const violations: IViolation[] = [];
  for (const root of ROOTS) {
    for await (
      const entry of walk(join(REPO_ROOT, root), {
        includeDirs: false,
        exts: [".ts", ".tsx"],
        skip: [/[/\\]node_modules[/\\]/, /[/\\]\.git[/\\]/, /[/\\]coverage[/\\]/, /[/\\]dist[/\\]/],
      })
    ) {
      const repoPath = relative(REPO_ROOT, entry.path);
      const text = await Deno.readTextFile(entry.path);
      if (DEFINITION_SITES.includes(repoPath) || /export const ExaPathDefaults\b/.test(text)) continue;
      violations.push(...scanFile(repoPath, text));
    }
  }
  for await (
    const entry of walk(join(REPO_ROOT, "configs"), {
      includeDirs: false,
      exts: [".toml"],
      skip: [/[/\\]node_modules[/\\]/],
    })
  ) {
    const repoPath = relative(REPO_ROOT, entry.path);
    violations.push(...scanToml(repoPath, await Deno.readTextFile(entry.path)));
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (import.meta.main) {
  const violations = await findPathBuilderViolations();
  if (violations.length === 0) {
    console.log("✅ No module builds an Exaix workspace path on its own.");
  } else {
    console.error(`❌ ${violations.length} path-builder violation(s) — use the @exaix/shared helpers:\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}  ${violation.detail}`);
    }
    console.error(
      `\nBuild the path with the matching helper from @exaix/shared (see CODE_STYLE.md#exaix-path-construction).`,
    );
    Deno.exit(1);
  }
}
