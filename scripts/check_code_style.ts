#!/usr/bin/env -S deno run -A
/**
 * @module CheckCodeStyle
 * @path scripts/check_code_style.ts
 * @description Scans all .ts and .tsx files for code style violations defined in CODE_STYLE.md.
 *
 * Usage:
 *   deno run -A scripts/check_code_style.ts [path]
 */

import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, normalize } from "@std/path";

const REPO_ROOT = normalize(join(dirname(fromFileUrl(import.meta.url)), ".."));
const EXCLUSION_DICT_PATH = join(dirname(fromFileUrl(import.meta.url)), "style_warning_exclusions.json");
let exclusionDict: Record<string, Record<string, { reason: string }>> = {};
try {
  exclusionDict = JSON.parse(Deno.readTextFileSync(EXCLUSION_DICT_PATH));
} catch {
  exclusionDict = {};
}

interface Rule {
  name: string;
  regex: RegExp;
  message: string;
  severity: "error" | "warn";
  pathFilter?: (path: string) => boolean;
}

interface ITestingShimExportInfo {
  alias: string;
  exportedNames: Set<string>;
}

interface IPublicPackageAlias {
  alias: string;
  entryPath: string;
  rootPath: string;
  packageRoot: string;
}

const ROOT_OWNED_PARENT_EXPORT_ALIASES = new Set([
  "@exaix/core/types",
]);

const RETIRED_ROOT_HEADER_RELATED_FILES = new Set([
  "src/services/core/db.ts",
]);

const RETIRED_ROOT_PACKAGE_IMPORT_PATHS = new Set([
  "src/services/core/db.ts",
  "src/services/tool/tool_validation_reporter.ts",
  "src/services/tool/cli_confirmation_interceptor.ts",
  "src/services/tool/notification_queue_confirmation_interceptor.ts",
  "src/services/tool/output_validator.ts",
  "src/services/tool/tool_reflector.ts",
  "src/services/tool/tool_registry.ts",
  "src/services/utils/json_repair.ts",
]);

function isPackageEntrypoint(path: string): boolean {
  return path.endsWith("/mod.ts") || path.endsWith("/index.ts");
}

function isPackageRootEntrypoint(path: string): boolean {
  return /^packages\/[^/]+\/(mod|index)\.ts$/.test(path);
}

function isSamePackageReExport(line: string): boolean {
  const match = line.match(/from\s+["']([^"']+)["']/);
  return !!match && match[1].startsWith("./");
}

function isTestingCompatibilityShim(path: string): boolean {
  return path.startsWith("tests/helpers/") || /^packages\/[^/]+\/tests\/helpers\//.test(path);
}

function parseHeaderRelatedFiles(headerText: string): string[] {
  const match = headerText.match(/@related-files\s*\[([\s\S]*?)\]/);
  if (!match) {
    return [];
  }

  return match[1].split(",")
    .map((entry) => entry.trim())
    .map((entry) => entry.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function parseNamedSymbols(clause: string): string[] {
  return clause.split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .map((symbol) => symbol.replace(/^type\s+/, ""))
    .map((symbol) => symbol.split(/\s+as\s+/)[0]?.trim() ?? "")
    .filter(Boolean);
}

function isRepoRelativeSpecifier(specifier: string): boolean {
  return !/^[a-z]+:/i.test(specifier) && !specifier.startsWith("//");
}

function discoverPackageTestingAliases(): Map<string, string> {
  const aliases = new Map<string, string>();
  const packagesDir = join(REPO_ROOT, "packages");

  try {
    for (const entry of Deno.readDirSync(packagesDir)) {
      if (!entry.isDirectory) continue;
      const testingDir = join(packagesDir, entry.name, "testing");
      try {
        const stat = Deno.statSync(testingDir);
        if (stat.isDirectory) {
          aliases.set(entry.name, `@exaix/${entry.name}/testing`);
        }
      } catch {
        // No public testing surface for this package.
      }
    }
  } catch {
    // Repository layout unavailable; keep alias map empty.
  }

  return aliases;
}

function discoverPublicPackageAliases(): IPublicPackageAlias[] {
  const aliases: IPublicPackageAlias[] = [];
  const denoJsonPath = join(REPO_ROOT, "deno.json");

  try {
    const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath)) as {
      imports?: Record<string, string>;
    };

    for (const [alias, mappedPath] of Object.entries(denoJson.imports ?? {})) {
      if (!alias.startsWith("@exaix/") || alias.endsWith("/")) {
        continue;
      }
      if (!isRepoRelativeSpecifier(mappedPath)) {
        continue;
      }

      const entryPath = normalize(mappedPath.replace(/^\.\//, ""));
      if (!entryPath.startsWith("packages/")) {
        continue;
      }

      const packageName = entryPath.split("/")[1];
      if (!packageName) {
        continue;
      }

      const packageRoot = normalize(join("packages", packageName));
      const rootPath = normalize(dirname(entryPath));
      aliases.push({ alias, entryPath, rootPath, packageRoot });
    }
  } catch {
    // Root import-map metadata unavailable; keep alias list empty.
  }

  return aliases.sort((a, b) => {
    if (b.alias.length !== a.alias.length) {
      return b.alias.length - a.alias.length;
    }

    return b.rootPath.length - a.rootPath.length;
  });
}

function findCanonicalPackageAlias(normalizedImport: string, importerRepoPath: string): IPublicPackageAlias | null {
  for (const aliasInfo of publicPackageAliases) {
    if (importerRepoPath.startsWith(`${aliasInfo.packageRoot}/`)) {
      continue;
    }

    if (normalizedImport === aliasInfo.entryPath) {
      return aliasInfo;
    }

    if (
      aliasInfo.rootPath !== aliasInfo.packageRoot &&
      normalizedImport.startsWith(`${aliasInfo.rootPath}/`)
    ) {
      return aliasInfo;
    }
  }

  return null;
}

function findCanonicalPackageAliasForSpecifier(importPath: string): IPublicPackageAlias | null {
  for (const aliasInfo of publicPackageAliases) {
    if (aliasInfo.rootPath === aliasInfo.packageRoot) {
      continue;
    }

    if (importPath.startsWith(`${aliasInfo.alias}/`)) {
      return aliasInfo;
    }
  }

  return null;
}

function findPromotedSubpackageAliasForParentEntrypoint(
  normalizedImport: string,
  importerRepoPath: string,
): IPublicPackageAlias | null {
  if (!isPackageRootEntrypoint(importerRepoPath)) {
    return null;
  }

  const packageRoot = importerRepoPath.split("/").slice(0, 2).join("/");
  for (const aliasInfo of publicPackageAliases) {
    if (
      aliasInfo.packageRoot !== packageRoot ||
      aliasInfo.rootPath === aliasInfo.packageRoot ||
      ROOT_OWNED_PARENT_EXPORT_ALIASES.has(aliasInfo.alias)
    ) {
      continue;
    }

    if (normalizedImport === aliasInfo.entryPath || normalizedImport.startsWith(`${aliasInfo.rootPath}/`)) {
      return aliasInfo;
    }
  }

  return null;
}

function discoverRootTestingShimExports(): Map<string, ITestingShimExportInfo> {
  const shimExports = new Map<string, ITestingShimExportInfo>();
  const helpersDir = join(REPO_ROOT, "tests", "helpers");
  const exportRegex = /export(?:\s+type)?\s*{([\s\S]*?)}\s*from\s*["'](@exaix\/[^"']+\/testing)["']/g;

  try {
    for (const entry of Deno.readDirSync(helpersDir)) {
      if (!entry.isFile || !entry.name.endsWith(".ts")) continue;

      const absolutePath = join(helpersDir, entry.name);
      const repoPath = `tests/helpers/${entry.name}`;
      const source = Deno.readTextFileSync(absolutePath);

      for (const match of source.matchAll(exportRegex)) {
        const alias = match[2];
        const exportedNames = parseNamedSymbols(match[1]);
        const existing = shimExports.get(repoPath) ?? { alias, exportedNames: new Set<string>() };
        existing.alias = alias;
        exportedNames.forEach((name) => existing.exportedNames.add(name));
        shimExports.set(repoPath, existing);
      }
    }
  } catch {
    // Root helper directory unavailable; keep shim map empty.
  }

  return shimExports;
}

function resolveRepoImportPath(importerRepoPath: string, importPath: string): string | null {
  if (importPath.startsWith(".")) {
    return normalize(join(dirname(importerRepoPath), importPath));
  }
  if (importPath.startsWith("packages/") || importPath.startsWith("tests/")) {
    return normalize(importPath);
  }

  return null;
}

function getPackageTestingAliasForTestImport(normalizedImport: string): { packageName: string; alias: string } | null {
  const match = normalizedImport.match(/^packages\/([^/]+)\/tests\//);
  if (!match) {
    return null;
  }

  const packageName = match[1];
  const alias = packageTestingAliases.get(packageName);
  if (!alias) {
    return null;
  }

  return { packageName, alias };
}

const packageTestingAliases = discoverPackageTestingAliases();
const rootTestingShimExports = discoverRootTestingShimExports();
const publicPackageAliases = discoverPublicPackageAliases();

const args = new Set(Deno.args);
const strictImports = args.has("--strict-imports");
const convertWarnings = args.has("--convert-warnings-to-errors");
const showAllWarnings = args.has("--show-all-warnings");

if (args.has("--help") || args.has("-h")) {
  console.log(`Exaix Code Style Checker

Usage:

  deno run scripts/check_code_style.ts [options] [paths...]

Options:
  --help, -h          Show this help message
  --strict-imports    Enable strict dynamic import checks (detects imports inside statements)

  --convert-warnings-to-errors  Convert all warnings to errors
  --show-all-warnings          Show all warnings, including those masked by exclusion comments

Description:
  Scans all .ts and .tsx files in the Exaix repository for code style violations
  defined in CODE_STYLE.md. Exits with code 1 if any errors are found.
  `);
  Deno.exit(0);
}

// Rules correspond to the code style guidelines in CODE_STYLE.md.  When a
// violation is found we print a human-friendly explanation; the script exits
// with a non-zero status if any errors were detected so it can be used in
// pre-commit hooks or CI.
const rules: Rule[] = [
  {
    name: "import-inside-statement",
    // Match lines that have 'import(' and start with whitespace (indented = nested)
    // AND ignore 'typeof import('
    regex: /^\s+.*(?<!typeof\s+)import\s*\(/,
    message:
      "Use of import() inside other statements (e.g., if, function, loop) is prohibited. All imports must be at the top level.",
    severity: "error" as const,
  },
  {
    name: "dynamic-import",
    // Match 'import(' but exclude 'typeof import('
    regex: /(?<!typeof\s+)\bimport\s*\(/,
    message:
      "Dynamic import statements (import(...)) are discouraged. If used, document the rationale in a comment above the import.",
    severity: convertWarnings || strictImports ? ("error" as const) : ("warn" as const),
  },
  {
    name: "inline-type-import",
    // Matches import("...").Something used as a type annotation, e.g.:
    //   Promise<import("./foo.ts").IFoo>
    //   : import("./bar.ts").Bar
    // Excludes `typeof import("...").Foo` which is the legitimate pattern for
    // typing the result of a dynamic import helper without a top-level import.
    regex: /(?<!typeof\s+)import\s*\(\s*["'][^"']+["']\s*\)\s*\.\s*\w/,
    message: 'Inline type imports (e.g. `import("./foo.ts").IFoo` inside a type annotation) are prohibited. ' +
      'Declare an explicit `import type { IFoo } from "./foo.ts"` at the top of the file.',
    severity: "error" as const,
  },
  {
    name: "test-inline-multiline-fixture",
    regex:
      /^\s*(?:const|let|var)\s+(?:markdown|yaml|json|input|payload|text|content)\s*=\s*(?:[A-Za-z_$][\w$]*\s*)?`[^`]*$/,
    message:
      "Avoid inline multiline structured text fixtures in test files. Move YAML, markdown, JSON, or other multi-line test inputs into a package-local fixture under tests/fixtures/ and load them from the test file.",
    severity: "warn" as const,
    pathFilter: (path: string) => path.includes("/tests/") || path.endsWith(".test.ts") || path.endsWith("_test.ts"),
  },
  {
    name: "explicit-any-array",
    regex: /:\s*any\[\]/,
    message: "Using 'any[]' as a type is forbidden; use a specific type instead.",
    severity: "error" as const,
  },
  {
    name: "explicit-unknown",
    // Catch ': unknown' but skip 'catch(e: unknown)'
    // Uses lookbehind for catch and matches various terminators
    regex: /(?<!catch\s*\(\s*[a-zA-Z_$]\w*\s*):\s*unknown\b(?!\s*\[)/,
    message: "Using 'unknown' as an explicit type is forbidden; name the shape with an interface or type alias.",
    severity: "error" as const,
  },
  {
    name: "explicit-unknown-array",
    regex: /:\s*unknown\[\]/,
    message: "Using 'unknown[]' as a type is forbidden; use a specific type instead.",
    severity: "error" as const,
  },
  {
    name: "unknown-type-alias",
    regex: /^\s*(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*=\s*unknown\s*;/,
    message:
      "Type aliases that rename raw 'unknown' are prohibited; define a real shape or narrow from 'unknown' where needed.",
    severity: "error" as const,
  },
  {
    name: "promise-response-alias",
    regex: /^\s*(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*=\s*(?:\([^\)]*\)\s*=>\s*)?Promise\s*<\s*Response\s*>\s*;/,
    message: "Type aliases that mask 'Promise<Response>' are prohibited; define a specific response type instead.",
    severity: "error" as const,
  },
  {
    name: "ts-suppression-pragmas",
    regex: /@ts-(?:ignore|expect-error|nocheck)/,
    message:
      "TypeScript suppression pragmas (e.g. @ts-ignore, @ts-expect-error, @ts-nocheck) are prohibited; fix the underlying type error instead.",
    severity: "error" as const,
  },
  {
    name: "deno-lint-no-explicit-any",
    regex: /\/\/\s*deno-lint-ignore\s+no-explicit-any/,
    message: "Using '// deno-lint-ignore no-explicit-any' is not allowed; address the typing issue explicitly.",
    severity: "error" as const,
  },
  {
    name: "explicit-any-cast",
    regex: /\bas\s+any\b/,
    message: "Casting to 'any' (e.g. 'foo as any') is forbidden.",
    severity: "error" as const,
    pathFilter: (path: string) => !path.includes("/tests/") && !path.endsWith(".test.ts") && !path.endsWith("_test.ts"),
  },
  {
    name: "typeof-cast",
    regex: /\bas\s+typeof\s+(?!globalThis\.fetch\b)([a-zA-Z_]\w*)\s+(?!\&)/,
    message:
      "Casting via 'as typeof <var>' is treated as an 'any' escape and is forbidden. Exceptions: 'as typeof globalThis.fetch' in tests, and intersection types like 'as typeof Deno & {...}'.",
    severity: "error" as const,
  },
  {
    name: "double-cast",
    regex: /as\s+unknown\s+as/,
    message: "Do not use double casting '... as unknown as ...'; use proper narrowing instead.",
    severity: "error" as const,
  },
  {
    name: "record-any",
    regex: /Record<\s*string\s*,\s*any\s*>/,
    message: "'Record<string, any>' is weak and prohibited; define a more specific type.",
    severity: "error" as const,
  },
  {
    name: "record-unknown",
    regex: /Record<\s*string\s*,\s*unknown\s*>/,
    message: "'Record<string, unknown>' is prohibited; define a specific interface or type alias instead.",
    severity: "error" as const,
  },
  {
    name: "index-signature-unknown",
    regex: /\{\s*\[\s*key\s*:\s*string\s*\]\s*:\s*unknown\s*\}/,
    message: "'{ [key: string]: unknown }' is prohibited; define a specific interface describing the expected shape.",
    severity: "error" as const,
  },
  {
    name: "promise-response-return",
    // Expanded to catch both arrow => Promise<Response> and : Promise<Response> method/function returns
    regex: /:\s*Promise\s*<\s*Response\s*>/,
    message:
      "'Promise<Response>' as return type is too weak; define a specific interface describing the expected response shape.",
    severity: "error" as const,
  },
  {
    name: "re-export-imported",
    regex: /^\s*export\s+.*from\s+['"]|^\s*export\s+\*\s+from/,
    message:
      "Re-exporting entities from other modules (e.g., 'export { ... } from ...' or 'export * from ...') is prohibited. Each module must only export entities it defines.",
    severity: "error" as const,
    pathFilter: (path: string) =>
      !path.endsWith("/mod.ts") &&
      !path.endsWith("/index.ts") &&
      !isTestingCompatibilityShim(path) &&
      path !== "src/services/core/db.ts",
  },
  {
    name: "package-entrypoint-root-src-reexport",
    regex: /from\s+['"](?:src\/|(\.\.\/)+src\/)/,
    message:
      "Package entrypoints must not re-export entities directly from repo 'src/*' paths. Use package-local public exports instead.",
    severity: "error" as const,
    pathFilter: (path: string) =>
      path.startsWith("packages/") && (path.endsWith("/mod.ts") || path.endsWith("/index.ts")),
  },
  {
    name: "magic-union-type",
    // Match inline union of string literals: "foo" | "bar"
    // Use word boundaries and double quotes to identify string literals
    // Skip lines that start with 'type ' (named type alias definitions are the
    // recommended solution, not a violation)
    regex: /^(?!\s*type\s+).*"\w+"\s*\|\s*"\w+"/,
    message:
      "Avoid magic string unions (e.g., '\"a\" | \"b\"'). Define a TypeScript 'enum' in src/enums.ts or use a shared named union type instead.",
    severity: "error" as const,
    pathFilter: (path: string) => !path.includes("/tests/") && !path.endsWith(".test.ts") && !path.endsWith("_test.ts"),
  },
];

let errorCount = 0;
let warnCount = 0;

function parseExclusionComment(line: string, ruleName: string): { code: string; rationale: string } | null {
  // Looks for: // style-exclude:CODE - rationale
  const match = line.match(new RegExp(`//\\s*style-exclude:([A-Z0-9_]+)\\s*-\\s*(.+)$`));
  if (match && exclusionDict[ruleName] && exclusionDict[ruleName][match[1]]) {
    return { code: match[1], rationale: match[2] };
  }
  return null;
}

function stripQuotedStringsAndComments(line: string): string {
  let result = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      result += " ";
      continue;
    }

    if (inSingleQuote) {
      if (char === "\\") {
        escaped = true;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      result += " ";
      continue;
    }

    if (inDoubleQuote) {
      if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      result += " ";
      continue;
    }

    if (inBacktick) {
      if (char === "\\") {
        escaped = true;
      } else if (char === "`") {
        inBacktick = false;
      }
      result += " ";
      continue;
    }

    if (char === "/" && line[i + 1] === "/") {
      break;
    }
    if (char === "'") {
      inSingleQuote = true;
      result += " ";
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      result += " ";
      continue;
    }
    if (char === "`") {
      inBacktick = true;
      result += " ";
      continue;
    }
    result += char;
  }

  return result;
}

async function checkFile(path: string) {
  const repoPath = path.startsWith(REPO_ROOT + "/") ? path.slice(REPO_ROOT.length + 1) : path;
  const text = await Deno.readTextFile(path);
  const lines = text.split(/\r?\n/);

  const templateLiteralLines = new Set<number>();
  let templateLiteralState = false;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const backtickCount = (line.replace(/\\`/g, "").match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) {
      templateLiteralState = !templateLiteralState;
    }
    if (templateLiteralState) {
      templateLiteralLines.add(idx + 1);
    }
  }

  let inMultiLineComment = false;
  let inMultiLineImport = false;
  let inTemplateLiteral = false;
  let inTypeDeclaration = false;
  let protectedBraceCount = 0;
  let functionalCodeLineNum = -1;
  let firstImportLineNum = -1;
  let lastImportLineNum = -1;
  let firstInterfaceLineNum = -1;
  let headerFound = false;
  let firstContentLineNum = -1;
  let paramDepth = 0;
  const importedNames = new Map<string, number>();
  let inParamList = false;
  let currentParamCount = 0;
  let paramListStartLine = -1;
  const importFollowingInterface = new Map<number, number>();
  const importFollowingFunctional = new Map<number, number>();

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Handle multi-line comments
    if (inMultiLineComment) {
      if (trimmed.includes("*/")) {
        inMultiLineComment = false;
        if (firstContentLineNum === -1 && idx < 10) {
          // If a comment starts near the top, consider it a potential header
          headerFound = true;
        }
      }
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (firstContentLineNum === -1 && idx < 5) headerFound = true;
      if (!trimmed.includes("*/")) inMultiLineComment = true;
      continue;
    }
    if (trimmed.startsWith("//")) {
      if (firstContentLineNum === -1 && idx < 5) headerFound = true;
      continue;
    }

    if (trimmed.startsWith("#!")) {
      continue;
    }

    if (firstContentLineNum === -1) firstContentLineNum = idx + 1;

    // Handle multi-line imports
    if (inMultiLineImport) {
      const names = trimmed.replace(/}.*/, "").split(",");
      names.forEach((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        const name = parts.pop()?.trim();
        if (name && name !== "from" && name !== "import") importedNames.set(name, idx + 1);
      });

      if (trimmed.includes("} from")) {
        inMultiLineImport = false;
        lastImportLineNum = idx + 1;
      }
      continue;
    }

    // Skip content inside protected blocks { ... } for types/interfaces/enums
    if (protectedBraceCount > 0) {
      const openers = (trimmed.match(/{/g) || []).length;
      const closers = (trimmed.match(/}/g) || []).length;
      protectedBraceCount += openers - closers;
      continue;
    }

    // Handle template literals (backticks)
    const backtickCount = (line.replace(/\\`/g, "").match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) {
      inTemplateLiteral = !inTemplateLiteral;
    }
    if (inTemplateLiteral) {
      templateLiteralLines.add(idx + 1);
      continue;
    }

    // Skip content inside multi-line type/interface/enum declarations
    if (inTypeDeclaration) {
      const openers = (trimmed.match(/{/g) || []).length;
      const closers = (trimmed.match(/}/g) || []).length;
      protectedBraceCount += openers - closers;
      if (
        protectedBraceCount === 0 &&
        (trimmed.endsWith(";") || (trimmed.endsWith("}") && !trimmed.includes("{")) || /^\s*}\s*;?\s*$/.test(line))
      ) {
        inTypeDeclaration = false;
      }
      continue;
    }
    const isImportStart = (/^\s*import\b/.test(line) && !/^\s*import(\.|\s*\()/.test(line)) ||
      /^\s*export\s+\*\s+from\b/.test(line) ||
      /^\s*export\s+{[^}]*}\s+from\b/.test(line) ||
      /^\s*export\s+type\s+{[^}]*}\s+from\b/.test(line);
    if (isImportStart || inMultiLineImport) {
      if (isImportStart) {
        if (firstImportLineNum === -1) firstImportLineNum = idx + 1;
        lastImportLineNum = idx + 1;

        // Extract names from single-line or start of multi-line import
        if (trimmed.startsWith("import")) {
          const namedMatch = trimmed.match(/{([^}]*)/);
          if (namedMatch) {
            namedMatch[1].replace(/}.*/, "").split(",").forEach((n) => {
              const parts = n.trim().split(/\s+as\s+/);
              const name = parts.pop()?.trim();
              const isCompatShim = path.endsWith("/src/parsers/markdown.ts");
              if (!isCompatShim && parts.length > 0 && /^I[A-Z]/.test(parts[0].trim())) {
                console.log(
                  `ERROR [no-interface-rename-on-import] ${path}:${idx + 1} – Renaming interface '${
                    parts[0].trim()
                  }' to '${name}' is prohibited. Use the original name.`,
                );
                errorCount++;
              }
              if (name && name !== "from" && name !== "import") importedNames.set(name, idx + 1);
            });
          }
          // Default or Namespace import
          const defaultMatch = trimmed.match(/^import\s+([\w$]+)[,\s]/);
          if (defaultMatch && defaultMatch[1] !== "type" && defaultMatch[1] !== "*") {
            importedNames.set(defaultMatch[1], idx + 1);
          }
          const namespaceMatch = trimmed.match(/import\s+\*\s+as\s+([\w$]+)/);
          if (namespaceMatch) importedNames.set(namespaceMatch[1], idx + 1);
        }

        if (trimmed.includes("{") && !trimmed.includes("} from")) {
          inMultiLineImport = true;
        }
      }

      const relativePath = path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path;
      if (relativePath.startsWith("packages/")) {
        const importMatch = line.match(/from\s+["']([^"']+)["']/) || line.match(/^\s*import\s+["']([^"']+)["']/);
        const importPath = importMatch?.[1];

        if (importPath && importPath.startsWith("..")) {
          const normalizedImport = normalize(join(dirname(relativePath), importPath));
          const packageRoot = relativePath.split("/").slice(0, 2).join("/");
          const isTestFile = relativePath.includes("/tests/");

          if (normalizedImport.startsWith("src/")) {
            // Allow bridge zone: packages/mcp/server/ is a concrete wiring layer
            if (relativePath.startsWith("packages/mcp/server/")) {
              // Bridge zone — skip
            } else {
              const label = isTestFile
                ? `Package tests under '${packageRoot}/tests/'`
                : `Package module '${packageRoot}'`;
              console.log(
                `ERROR [package-boundary] ${relativePath}:${
                  idx + 1
                } – ${label} must not import from the root src/ directory: '${importPath}'. Use @exaix/ package aliases instead.`,
              );
              errorCount++;
            }
          } else if (normalizedImport.startsWith("tests/")) {
            if (isTestFile) {
              console.log(
                `ERROR [package-boundary] ${relativePath}:${
                  idx + 1
                } – Package tests under '${packageRoot}/tests/' must not import test fixtures from the root tests/ directory: '${importPath}'.`,
              );
              errorCount++;
            }
          } else if (normalizedImport.startsWith("packages/") && !normalizedImport.startsWith(`${packageRoot}/`)) {
            const label = isTestFile
              ? `Package tests under '${packageRoot}/tests/'`
              : `Package module '${packageRoot}'`;
            console.log(
              `ERROR [package-boundary] ${relativePath}:${
                idx + 1
              } – ${label} must not import code from another package ('${importPath}').`,
            );
            errorCount++;
          }
        }
      }

      const importMatch = line.match(/from\s+["']([^"']+)["']/) || line.match(/^\s*import\s+["']([^"']+)["']/);
      const importPath = importMatch?.[1];
      if (importPath) {
        const normalizedImport = resolveRepoImportPath(relativePath, importPath);
        if (normalizedImport) {
          if (/^\s*export\b/.test(line) && isPackageRootEntrypoint(relativePath)) {
            const promotedSubpackageAlias = findPromotedSubpackageAliasForParentEntrypoint(
              normalizedImport,
              relativePath,
            );

            if (promotedSubpackageAlias) {
              console.log(
                `ERROR [package-subpath-promotion] ${relativePath}:${
                  idx + 1
                } – Parent package entrypoints must not re-export canonical subpackage surfaces. Export this API from '${promotedSubpackageAlias.alias}' instead of promoting '${importPath}' through '${relativePath}'.`,
              );
              errorCount++;
            }
          }

          const testingImportInfo = getPackageTestingAliasForTestImport(normalizedImport);
          if (testingImportInfo) {
            const owningPackageTestsRoot = `packages/${testingImportInfo.packageName}/tests/`;
            const isOwnPackageTestImport = relativePath.startsWith(owningPackageTestsRoot);
            if (!isOwnPackageTestImport) {
              console.log(
                `ERROR [package-testing-import] ${relativePath}:${
                  idx + 1
                } – Import package-specific test support from '${testingImportInfo.alias}' instead of deep-importing '${importPath}' from '${owningPackageTestsRoot}'.`,
              );
              errorCount++;
            }
          }

          const canonicalAliasInfo = findCanonicalPackageAlias(normalizedImport, relativePath);
          if (canonicalAliasInfo) {
            console.log(
              `ERROR [package-canonical-import] ${relativePath}:${
                idx + 1
              } – Import from '${canonicalAliasInfo.alias}' instead of deep-importing the package-owned path '${importPath}'.`,
            );
            errorCount++;
          }
        }

        const canonicalSpecifierAliasInfo = findCanonicalPackageAliasForSpecifier(importPath);
        if (canonicalSpecifierAliasInfo) {
          console.log(
            `ERROR [package-canonical-import] ${relativePath}:${
              idx + 1
            } – Import from '${canonicalSpecifierAliasInfo.alias}' instead of deep-importing the canonical package subpath '${importPath}'.`,
          );
          errorCount++;
        }
      }

      if (relativePath.startsWith("packages/")) {
        const importMatch = line.match(/from\s+["']([^"']+)["']/) || line.match(/^\s*import\s+["']([^"']+)["']/);
        const importPath = importMatch?.[1];

        if (importPath) {
          let normalizedImport: string | null = null;
          if (importPath.startsWith(".")) {
            normalizedImport = normalize(join(dirname(relativePath), importPath));
          } else if (importPath.startsWith("src/")) {
            normalizedImport = normalize(importPath);
          }

          const packageRoot = relativePath.split("/").slice(0, 2).join("/");
          const isRetiredRootImport = normalizedImport !== null &&
            RETIRED_ROOT_PACKAGE_IMPORT_PATHS.has(normalizedImport);
          if (isRetiredRootImport) {
            console.log(
              `ERROR [package-src-boundary] ${relativePath}:${
                idx + 1
              } – Package-owned modules under '${packageRoot}/' must not import retired root implementation paths like '${normalizedImport}'. Use the package-owned source of truth instead.`,
            );
            errorCount++;
          }
        }
      }

      if (inMultiLineImport && trimmed.includes("} from")) {
        inMultiLineImport = false;
      }

      if (firstInterfaceLineNum !== -1) {
        // Collect violations but don't print immediately to avoid flooding mod.ts-style files
        importFollowingInterface.set(idx + 1, firstInterfaceLineNum);
      }

      if (functionalCodeLineNum !== -1) {
        importFollowingFunctional.set(idx + 1, functionalCodeLineNum);
      }
      continue;
    }
    // Check for re-exporting imported names: export { Foo, Bar as Baz } or export type { ... }
    const namedExportMatch = line.match(/^\s*export\s+(type\s+)?{([^}]*)}\s*;?\s*$/);
    if (namedExportMatch && !path.endsWith("/mod.ts") && !path.endsWith("/index.ts")) {
      const exports = namedExportMatch[2].split(",");
      exports.forEach((e) => {
        const parts = e.trim().split(/\s+as\s+/);
        const name = parts[0].trim();
        if (importedNames.has(name)) {
          const importLine = importedNames.get(name)!;
          const isImmediate = importLine === idx; // idx is 0-indexed current line, importLine is 1-indexed import line
          const message = isImmediate
            ? `Improper re-export of '${name}' on the next line after its import. Combine into 'export ${
              namedExportMatch[1] || ""
            }{ ... } from ...' or define it locally.`
            : `Exporting imported entity '${name}' (imported on line ${importLine}) is prohibited. Define it locally or export it from its origin.`;

          console.log(
            `ERROR [re-export-imported] ${path}:${idx + 1} – ${message}`,
          );
          errorCount++;
        }
      });

      if (!trimmed.includes("=") && (trimmed.endsWith(";") || trimmed.endsWith("}"))) {
        continue;
      }
    }

    const isTypeStart = /^\s*((export|declare)\s+)?(type|interface|enum)\b/.test(line) ||
      /^\s*declare\s+(const|let|var|function|class)\b/.test(line);
    if (isTypeStart) {
      if (firstInterfaceLineNum === -1) firstInterfaceLineNum = idx + 1;

      const openers = (trimmed.match(/{/g) || []).length;
      const closers = (trimmed.match(/}/g) || []).length;
      protectedBraceCount += openers - closers;

      if (functionalCodeLineNum !== -1) {
        if (/^\s*export\s+interface\b/.test(line)) {
          console.log(
            `ERROR [exported-interface-placement] ${path}:${
              idx + 1
            } – Exported interfaces must be at the top, preceding functional code (functional code started at line ${functionalCodeLineNum}).`,
          );
          errorCount++;
        }
      }

      if (protectedBraceCount > 0 || (!trimmed.endsWith(";") && !trimmed.endsWith("}"))) {
        inTypeDeclaration = true;
      }

      // Check: Exported interfaces must start with 'I'
      const interfaceMatch = line.match(/^\s*export\s+interface\s+([A-Za-z0-9_$]+)/);
      if (interfaceMatch) {
        const interfaceName = interfaceMatch[1];
        if (
          !interfaceName.startsWith("I") ||
          (interfaceName.length > 1 && interfaceName[1] !== interfaceName[1].toUpperCase())
        ) {
          console.log(
            `ERROR [exported-interface-naming] ${path}:${
              idx + 1
            } – Exported interface '${interfaceName}' must start with a capital 'I' (e.g., I${interfaceName}).`,
          );
          errorCount++;
        }
      }
      continue;
    }

    // If we're here, it's functional code
    // Handle parameter counting for 8+ parameters
    if (inParamList) {
      const closingIdx = line.indexOf(")");
      const content = closingIdx !== -1 ? line.substring(0, closingIdx) : line;

      // Count commas that aren't inside nested < > or { } (to skip generics/object types)
      for (const char of content) {
        if (char === "<" || char === "{") paramDepth++;
        if (char === ">" || char === "}") paramDepth--;
        if (char === "," && paramDepth === 0) currentParamCount++;
      }

      if (closingIdx !== -1) {
        if (currentParamCount >= 7) {
          console.log(
            `ERROR [max-params] ${path}:${paramListStartLine} – Methods and functions must not exceed 7 parameters (found ${
              currentParamCount + 1
            }). Refactor to use a parameter object.`,
          );
          errorCount++;
        }
        inParamList = false;
      }
      continue;
    }

    if (
      (trimmed.includes("function ") || trimmed.includes("constructor") ||
        (/\b(private|public|protected|async|static|readonly)\b.*\(/.test(trimmed))) &&
      !inParamList && !inTypeDeclaration && !inMultiLineComment && !inMultiLineImport && !trimmed.startsWith("import")
    ) {
      const openingIdx = line.indexOf("(");
      if (openingIdx !== -1) {
        inParamList = true;
        paramListStartLine = idx + 1;
        currentParamCount = 0;
        paramDepth = 0; // Initialize when starting

        const closingIdx = line.indexOf(")", openingIdx);
        const content = closingIdx !== -1 ? line.substring(openingIdx + 1, closingIdx) : line.substring(openingIdx + 1);

        for (const char of content) {
          if (char === "<" || char === "{") paramDepth++;
          if (char === ">" || char === "}") paramDepth--;
          if (char === "," && paramDepth === 0) currentParamCount++;
        }

        if (closingIdx !== -1) {
          if (currentParamCount >= 7) {
            console.log(
              `ERROR [max-params] ${path}:${paramListStartLine} – Methods and functions must not exceed 7 parameters (found ${
                currentParamCount + 1
              }). Refactor to use a parameter object.`,
            );
            errorCount++;
          }
          inParamList = false;
        }
        if (inParamList) continue;
      }
    }

    if (functionalCodeLineNum === -1 && protectedBraceCount === 0) {
      functionalCodeLineNum = idx + 1;
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    if (templateLiteralLines.has(idx + 1)) {
      continue;
    }

    const line = lines[idx];
    const namedImportMatch = line.match(/^\s*import(?:\s+type)?\s*{([^}]*)}\s*from\s+["']([^"']+)["'];?/);
    if (!namedImportMatch) {
      continue;
    }

    const importClause = namedImportMatch[1];
    const importPath = namedImportMatch[2];
    const normalizedImport = resolveRepoImportPath(repoPath, importPath);
    if (!normalizedImport) {
      continue;
    }

    const shimInfo = rootTestingShimExports.get(normalizedImport);
    if (!shimInfo) {
      continue;
    }

    const importedSymbols = parseNamedSymbols(importClause);
    const offendingSymbols = importedSymbols.filter((symbol) => shimInfo.exportedNames.has(symbol));
    if (offendingSymbols.length === 0) {
      continue;
    }

    console.log(
      `ERROR [package-testing-import] ${repoPath}:${idx + 1} – Import ${
        offendingSymbols.join(", ")
      } from '${shimInfo.alias}' instead of routing package-owned test support through '${importPath}'.`,
    );
    errorCount++;
  }

  // Check: Header placement
  if (!headerFound) {
    const severity = convertWarnings ? "ERROR" : "WARN";
    console.log(
      `${severity} [module-header] ${path}:1 – Modules should start with a descriptive header comment.`,
    );
    if (convertWarnings) errorCount++;
    else warnCount++;
  } else if (!path.includes("/tests/")) {
    // Basic verification of header tags for ALL production and utility files
    const headerLines = lines.slice(0, 15).join("\n");
    const tags = ["@module", "@path", "@description"];
    for (const tag of tags) {
      if (!headerLines.includes(tag)) {
        console.log(`ERROR [module-header-tag] ${path}:1 – Header is missing mandatory '${tag}' tag.`);
        errorCount++;
      }
    }

    if (repoPath.startsWith("packages/")) {
      for (const relatedFile of parseHeaderRelatedFiles(headerLines)) {
        if (!RETIRED_ROOT_HEADER_RELATED_FILES.has(relatedFile)) {
          continue;
        }

        console.log(
          `ERROR [package-related-files-boundary] ${path}:1 – Package-owned module headers must not reference retired root compatibility paths in '@related-files': '${relatedFile}'. Point to the package-owned source-of-truth module instead.`,
        );
        errorCount++;
      }
    }

    // Special checks for maintenance scripts in the top-level scripts/ directory
    if (path.includes("/scripts/") && !path.includes("/tests/")) {
      if (!lines[0].startsWith("#!/usr/bin/env -S deno run -A")) {
        console.log(
          `ERROR [script-shebang] ${path}:1 – Maintenance scripts must start with '#!/usr/bin/env -S deno run -A'.`,
        );
        errorCount++;
      }
      if (!headerLines.includes("Usage:")) {
        console.log(
          `ERROR [script-usage] ${path}:1 – Maintenance scripts must include a 'Usage:' section in the header.`,
        );
        errorCount++;
      }
      const fileName = path.split("/").pop() || "";
      if (fileName.startsWith("debug_") || fileName.startsWith("tmp_")) {
        console.log(
          `ERROR [script-placement] ${path}:1 – Debug or temporary scripts must be located outside the 'scripts/' directory.`,
        );
        errorCount++;
      }
    }
  }
  // Check order: Interfaces/Types after all Imports
  if (firstImportLineNum !== -1 && firstInterfaceLineNum !== -1 && firstInterfaceLineNum < lastImportLineNum) {
    console.log(
      `ERROR [import-placement] ${path}:${firstInterfaceLineNum} – Interface/type definitions must follow all imports (last import at line ${lastImportLineNum}).`,
    );
    errorCount++;
  } else if (importFollowingInterface.size > 0) {
    // If not flagged above, report the first misplaced import
    const line = Array.from(importFollowingInterface.keys())[0];
    const started = importFollowingInterface.get(line);
    console.log(
      `ERROR [import-placement] ${path}:${line} – Imports must precede all interface/type definitions (interface started at line ${started}).`,
    );
    errorCount++;
  }

  if (importFollowingFunctional.size > 0) {
    const line = Array.from(importFollowingFunctional.keys())[0];
    const started = importFollowingFunctional.get(line);
    console.log(
      `ERROR [import-placement] ${path}:${line} – Imports must be at the top, preceding functional code (functional code started at line ${started}).`,
    );
    errorCount++;
  }

  // TUI Boundary Isolation Checks - implemented during main loop for efficiency
  const isTuiFile = path.includes("/src/tui/");
  const isCliBoundaryFile = path.includes("/src/cli/commands/") ||
    path.includes("/src/cli/handlers/") ||
    path.includes("/src/cli/formatters/") ||
    path.includes("/src/cli/command_builders/");
  const isCliFile = path.includes("/src/cli/") || path.includes("/tests/cli/");
  const tuiSegments = path.split("/src/tui/")[1]?.split("/").filter(Boolean) || [];
  const tuiDepth = tuiSegments.length - 1;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (isTuiFile) {
      if (line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+cli\//)) {
        console.log(
          `ERROR [tui-boundary-cli] ${path}:${idx + 1} – TUI modules must not import from 'src/cli/'.`,
        );
        errorCount++;
      }
      if (line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+services\/(?!adapters\/|tui_service_factory\.ts)/)) {
        console.log(
          `ERROR [tui-boundary-services] ${path}:${idx + 1} – TUI modules must not import from 'src/services/'.`,
        );
        errorCount++;
      }
      if (line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+config\//)) {
        console.log(
          `ERROR [tui-boundary-config] ${path}:${idx + 1} – TUI modules must not import from 'src/config/'.`,
        );
        errorCount++;
      }
      const helperMatch = line.match(/import\b.*?\bfrom\s+["']((\.\.\/)+)helpers\//);
      if (helperMatch) {
        const dotCount = (helperMatch[1].match(/\.\.\//g) || []).length;
        if (dotCount > tuiDepth) {
          console.log(
            `ERROR [tui-boundary-helpers] ${path}:${idx + 1} – TUI modules must not import from 'src/helpers/'.`,
          );
          errorCount++;
        }
      }
    } else if (!path.includes("/tests/tui/")) {
      if (line.match(/import\b.*?\bfrom\s+["'].*?tui\/helpers\//)) {
        console.log(
          `ERROR [core-boundary-tui-helpers] ${path}:${
            idx + 1
          } – Non-TUI modules must not import from 'src/tui/helpers/'.`,
        );
        errorCount++;
      }
    }

    if (isCliBoundaryFile) {
      if (line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+services\/(?!adapters\/)/)) {
        console.log(
          `ERROR [cli-boundary-services] ${path}:${
            idx + 1
          } – CLI command/handler/formatter/builder modules must not import from 'src/services/' except 'src/services/adapters/'.`,
        );
        errorCount++;
      }

      if (line.match(/import\b.*?\bfrom\s+["'](?:\.\.\/)+config\/service(?:\.ts)?["']/)) {
        console.log(
          `ERROR [cli-boundary-config] ${path}:${
            idx + 1
          } – CLI command/handler/formatter/builder modules must not import from 'src/config/service.ts'.`,
        );
        errorCount++;
      }
    }

    if (!isCliFile) {
      if (line.match(/import\b.*?\bfrom\s+["'].*?src\/cli\/helpers\//)) {
        console.log(
          `ERROR [core-boundary-cli-helpers] ${path}:${
            idx + 1
          } – Non-CLI modules must not import from 'src/cli/helpers/'.`,
        );
        errorCount++;
      }
    }
  }

  // Package Module Purity — CODE_STYLE.md §13
  // Detect runtime infrastructure usage inside package src/ files.
  // Exemptions: packages/core/ (defines these entities) and packages/mcp/server/ (bridge zone).
  const packageSrcPurityMatch = repoPath.match(/^packages\/([^/]+)\/src\//);
  if (packageSrcPurityMatch && packageSrcPurityMatch[1] !== "core" && !repoPath.startsWith("packages/mcp/server/")) {
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("//") || trimmedLine.startsWith("*") || trimmedLine.startsWith("/*")) {
        continue;
      }

      if (line.match(/\bnew\s+EventLogger\s*\(/)) {
        console.log(
          `ERROR [package-instantiates-event-logger] ${repoPath}:${
            idx + 1
          } – Package source modules must not instantiate EventLogger. Accept IEventLogger as an optional constructor parameter injected by the service layer.`,
        );
        errorCount++;
      }

      if (
        trimmedLine.startsWith("import") &&
        trimmedLine.match(/\bEventLogger\b/) &&
        trimmedLine.match(/from\s+["']@exaix\/core/)
      ) {
        const prefix = convertWarnings ? "ERROR" : "WARN";
        console.log(
          `${prefix} [package-concrete-logger-type] ${repoPath}:${
            idx + 1
          } – Package source modules should import IEventLogger (the interface) instead of the concrete EventLogger class. Decouples the package from the runtime logger implementation.`,
        );
        if (convertWarnings) errorCount++;
        else warnCount++;
      }

      const isConfigReaderImport = trimmedLine.startsWith("import") &&
        (trimmedLine.includes("getValidatedEnvOverrides") || trimmedLine.includes("ConfigService")) &&
        trimmedLine.includes("@exaix/core");
      const isConfigReaderUsage = !trimmedLine.startsWith("import") &&
        (line.match(/\bgetValidatedEnvOverrides\s*\(/) !== null || line.match(/\bnew\s+ConfigService\s*\(/) !== null);
      if (isConfigReaderImport || isConfigReaderUsage) {
        const prefix = convertWarnings ? "ERROR" : "WARN";
        console.log(
          `${prefix} [package-uses-config-reader] ${repoPath}:${
            idx + 1
          } – Package source modules must not call getValidatedEnvOverrides() or instantiate ConfigService. Receive a Config value as a constructor parameter instead.`,
        );
        if (convertWarnings) errorCount++;
        else warnCount++;
      }
    }
  }

  const multilineFixtureExemptLines = new Set<number>();
  const multilineFixtureWarnLines = new Set<number>();
  const fixtureStartRegex = /^\s*(?:const|let|var)\s+(?:markdown|yaml|json|input|payload|text|content)\s*=\s*`/;
  const anyTemplateStartRegex = /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*`/;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (anyTemplateStartRegex.test(line) && !/`[^`]*`/.test(line)) {
      let containsInterpolation = false;
      let lineCount = 0;
      let closed = false;
      let firstNonEmptyLine: string | null = null;
      const openingBacktickIndex = line.indexOf("`");
      const openingText = line.slice(openingBacktickIndex + 1);
      if (openingText.trim().length > 0) {
        if (openingText.includes("${")) {
          containsInterpolation = true;
        }
        lineCount++;
        firstNonEmptyLine = openingText.trim();
      }

      for (let j = idx + 1; j < lines.length; j++) {
        if (lines[j].includes("${")) {
          containsInterpolation = true;
        }
        if (firstNonEmptyLine === null && lines[j].trim().length > 0) {
          firstNonEmptyLine = lines[j].trim();
        }
        const backtickIndex = lines[j].indexOf("`");
        if (backtickIndex !== -1) {
          if (lines[j].slice(0, backtickIndex).trim().length > 0) {
            lineCount++;
          }
          closed = true;
          break;
        }
        lineCount++;
      }

      const shouldWarn = closed &&
        !containsInterpolation &&
        lineCount >= 7 &&
        firstNonEmptyLine !== null &&
        (firstNonEmptyLine.startsWith("---") || firstNonEmptyLine.startsWith("#"));

      if (fixtureStartRegex.test(line)) {
        if (!closed || containsInterpolation || lineCount < 7) {
          multilineFixtureExemptLines.add(idx + 1);
        }
      } else if (shouldWarn) {
        multilineFixtureWarnLines.add(idx + 1);
      }
    }
  }

  rules.forEach((rule) => {
    // Skip rule if path does not match rule's pathFilter
    if (rule.pathFilter && !rule.pathFilter(repoPath)) {
      return;
    }

    lines.forEach((line, idx) => {
      if (templateLiteralLines.has(idx + 1) && rule.name !== "test-inline-multiline-fixture") {
        return;
      }
      const lineToTest = ["explicit-unknown", "explicit-unknown-array", "index-signature-unknown"].includes(rule.name)
        ? stripQuotedStringsAndComments(line)
        : line;
      let masked = false;
      let exclusionCode = null;
      let exclusionRationale = null;
      // For warnings only, check for exclusion comment above
      if (
        rule.severity === "warn" &&
        (rule.regex.test(lineToTest) ||
          (rule.name === "test-inline-multiline-fixture" && multilineFixtureWarnLines.has(idx + 1)))
      ) {
        // Look for exclusion comment above
        const prevLine = idx > 0 ? lines[idx - 1].trim() : "";
        const exclusion = parseExclusionComment(prevLine, rule.name);
        if (exclusion) {
          masked = true;
          exclusionCode = exclusion.code;
          exclusionRationale = exclusion.rationale;
        }
      }
      if (rule.name === "test-inline-multiline-fixture") {
        if (multilineFixtureExemptLines.has(idx + 1)) {
          return;
        }
        if (multilineFixtureWarnLines.has(idx + 1)) {
          const location = `${path}:${idx + 1}`;
          const actualSeverity = convertWarnings ? "error" : rule.severity;
          const prefix = actualSeverity === "error" ? "ERROR" : "WARN";
          if (!masked || showAllWarnings) {
            let msg = `${prefix} [${rule.name}] ${location} – ${rule.message}`;
            if (exclusionDict[rule.name]) {
              msg += `\n  Possible exclusion codes: ${Object.keys(exclusionDict[rule.name]).join(", ")}`;
            }
            if (masked) {
              msg += `\n  (masked by style-exclude:${exclusionCode} – ${exclusionRationale})`;
            }
            console.log(msg);
          }
          if (!masked) {
            if (actualSeverity === "error") errorCount++;
            else warnCount++;
          }
          return;
        }
      }
      if (rule.regex.test(lineToTest)) {
        if (rule.name === "re-export-imported" && isPackageEntrypoint(path) && isSamePackageReExport(lineToTest)) {
          return;
        }
        if (rule.severity === "warn") {
          // Check for exclusion comment above
          if (masked && !showAllWarnings) {
            return;
          }
        }
        if (rule.name === "dynamic-import") {
          // Look at the line above for a rationale comment or exclusion
          const prevLine = idx > 0 ? lines[idx - 1].trim() : "";
          const exclusion = parseExclusionComment(prevLine, rule.name);
          if (exclusion && !showAllWarnings) {
            return;
          }
        }
        const location = `${path}:${idx + 1}`;
        const actualSeverity = convertWarnings ? "error" : rule.severity;
        const prefix = actualSeverity === "error" ? "ERROR" : "WARN";
        let msg = `${prefix} [${rule.name}] ${location} – ${rule.message}`;
        if (rule.severity === "warn" && exclusionDict[rule.name]) {
          msg += `\n  Possible exclusion codes: ${Object.keys(exclusionDict[rule.name]).join(", ")}`;
        }
        if (masked) {
          msg += `\n  (masked by style-exclude:${exclusionCode} – ${exclusionRationale})`;
        }
        console.log(msg);
        if (!masked) {
          if (actualSeverity === "error") errorCount++;
          else warnCount++;
        }
      }
    });
  });
}

async function main() {
  // Request read permission for the repo root if not already granted
  await Deno.permissions.request({ name: "read", path: REPO_ROOT });

  const manualPaths = Deno.args.filter((arg) => !arg.startsWith("-"));
  if (manualPaths.length > 0) {
    for (const p of manualPaths) {
      const fullPath = p.startsWith("/") ? p : join(Deno.cwd(), p);
      try {
        const stat = await Deno.stat(fullPath);
        if (stat.isFile) {
          await checkFile(fullPath);
        } else {
          for await (
            const entry of walk(fullPath, {
              includeDirs: false,
              exts: [".ts", ".tsx"],
              followSymlinks: false,
              skip: [/^\.git$/, /^node_modules$/, /check_code_style\.ts$/],
            })
          ) {
            await checkFile(entry.path);
          }
        }
      } catch (e) {
        console.error(`Error checking path ${p}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    for await (
      const entry of walk(REPO_ROOT, {
        includeDirs: false,
        exts: [".ts", ".tsx"],
        followSymlinks: false,
        skip: [/^\.git$/, /^node_modules$/, /check_code_style\.ts$/],
      })
    ) {
      // skip generated code or scripts if necessary
      if (
        entry.path.includes("/dist/") ||
        entry.path.includes("/coverage/") ||
        entry.path.includes("/.copilot/")
      ) {
        continue;
      }
      if (!entry.isFile) {
        continue;
      }
      await checkFile(entry.path);
    }
  }

  console.log(`\nstyle check completed: ${errorCount} error(s), ${warnCount} warning(s)`);
  if (errorCount > 0) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
