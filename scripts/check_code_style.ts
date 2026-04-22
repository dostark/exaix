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

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

interface Rule {
  name: string;
  regex: RegExp;
  message: string;
  severity: "error" | "warn";
  pathFilter?: (path: string) => boolean;
}

const args = new Set(Deno.args);
const strictImports = args.has("--strict-imports");
const convertWarnings = args.has("--convert-warnings-to-errors");

if (args.has("--help") || args.has("-h")) {
  console.log(`Exaix Code Style Checker

Usage:
  deno run scripts/check_code_style.ts [options] [paths...]

Options:
  --help, -h          Show this help message
  --strict-imports    Enable strict dynamic import checks (detects imports inside statements)
  --convert-warnings-to-errors  Convert all warnings to errors

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
  // Dynamic import checks are only enabled if --strict-imports is passed
  ...(strictImports
    ? [
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
        severity: convertWarnings ? ("error" as const) : ("warn" as const),
      },
    ]
    : []),
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
    name: "explicit-unknown-array",
    regex: /:\s*unknown\[\]/,
    message: "Using 'unknown[]' as a type is forbidden; use a specific type instead.",
    severity: "error" as const,
  },
  {
    name: "explicit-any-array",
    regex: /:\s*any\[\]/,
    message: "Using 'any[]' as a type is forbidden; use a specific type instead.",
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
    name: "promise-response-return",
    regex: /:\s*Promise\s*<\s*Response\s*>\s*=>/,
    message:
      "'Promise<Response>' as return type in arrow functions is weak typing; define a specific return type interface instead.",
    severity: "error" as const,
  },
  {
    name: "re-export-imported",
    regex: /^\s*export\s+.*from\s+['"]|^\s*export\s+\*\s+from/,
    message:
      "Re-exporting entities from other modules (e.g., 'export { ... } from ...' or 'export * from ...') is prohibited. Each module must only export entities it defines.",
    severity: "error" as const,
    pathFilter: (path: string) => !path.endsWith("/mod.ts") && !path.endsWith("/index.ts"),
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

async function checkFile(path: string) {
  const text = await Deno.readTextFile(path);
  const lines = text.split(/\r?\n/);

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
  const importedNames = new Map<string, number>();
  let inParamList = false;
  let currentParamCount = 0;
  let paramListStartLine = -1;
  let paramDepth = 0;

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
    if (inTemplateLiteral) continue;

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

    const isImportStart = /^\s*import\b/.test(line) || /^\s*export\s+{[^}]*}\s+from\b/.test(line);
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

        const relativePath = path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path;
        if (relativePath.startsWith("packages/") && relativePath.includes("/tests/")) {
          const importMatch = line.match(/from\s+["']([^"']+)["']/) || line.match(/^\s*import\s+["']([^"']+)["']/);
          const importPath = importMatch?.[1];

          if (importPath && importPath.startsWith("..")) {
            const normalizedImport = normalize(join(dirname(relativePath), importPath));
            const packageRoot = relativePath.split("/").slice(0, 2).join("/");

            if (normalizedImport.startsWith("tests/")) {
              console.log(
                `ERROR [package-test-boundary] ${relativePath}:${idx + 1} – Package tests under '${packageRoot}/tests/' must not import test fixtures from the root tests/ directory: '${importPath}'.`,
              );
              errorCount++;
            } else if (normalizedImport.startsWith("packages/") && !normalizedImport.startsWith(`${packageRoot}/`)) {
              console.log(
                `ERROR [package-test-boundary] ${relativePath}:${idx + 1} – Package tests under '${packageRoot}/tests/' must not import code from another package ('${importPath}').`,
              );
              errorCount++;
            }
          }
        }

      }

      if (trimmed.includes("{") && !trimmed.includes("} from")) {
        inMultiLineImport = true;
      }

      if (firstInterfaceLineNum !== -1) {
        console.log(
          `ERROR [import-placement] ${path}:${
            idx + 1
          } – Imports must precede all interface/type definitions (interface started at line ${firstInterfaceLineNum}).`,
        );
        errorCount++;
      }

      if (functionalCodeLineNum !== -1) {
        console.log(
          `ERROR [import-placement] ${path}:${
            idx + 1
          } – Imports must be at the top, preceding functional code (functional code started at line ${functionalCodeLineNum}).`,
        );
        errorCount++;
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

  rules.forEach((rule) => {
    // Skip rule if path does not match rule's pathFilter
    if (rule.pathFilter && !rule.pathFilter(path)) {
      return;
    }

    lines.forEach((line, idx) => {
      if (rule.regex.test(line)) {
        const location = `${path}:${idx + 1}`;
        const actualSeverity = convertWarnings ? "error" : rule.severity;
        const prefix = actualSeverity === "error" ? "ERROR" : "WARN";
        console.log(`${prefix} [${rule.name}] ${location} – ${rule.message}`);
        if (actualSeverity === "error") {
          errorCount++;
        } else {
          warnCount++;
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
