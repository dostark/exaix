/**
 * @module validate_doc_links
 * @path scripts/validate_doc_links.ts
 * @description Validates that symbol-based links in Markdown files point to existing symbols in source files.
 */

import { join, resolve } from "@std/path";

const ROOT_DOCS = [
  "README.md",
  "ARCHITECTURE.md",
  "CODE_STYLE.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "TOOLS.md",
];

async function validateSymbol(filePath: string, symbol: string): Promise<boolean> {
  try {
    const content = await Deno.readTextFile(resolve(Deno.cwd(), filePath));

    // Support class, function, interface, enum, type, or @region/@module
    if (symbol.startsWith("@region")) {
      const regionName = symbol.split(" ")[1];
      return content.includes(`@region ${regionName}`);
    }

    if (symbol.startsWith("@module")) {
      const moduleName = symbol.split(" ")[1];
      return content.includes(`@module ${moduleName}`);
    }

    // Rough check for the symbol name as a word
    const symbolRegex = new RegExp(`\\b(class|function|interface|enum|type|const|let|var|@module)\\s+${symbol}\\b`);
    return symbolRegex.test(content) || content.includes(`export class ${symbol}`) ||
      content.includes(`export interface ${symbol}`) || content.includes(`* @module ${symbol}`);
  } catch (_err) {
    return false;
  }
}

async function main() {
  const cwd = Deno.cwd();
  console.log("🔍 Validating Documentation Symbol Links...");

  let totalErrors = 0;

  for (const docFile of ROOT_DOCS) {
    const content = await Deno.readTextFile(join(cwd, docFile));

    // Match:
    // 1. [text](src/file.ts:Symbol)
    // 2. "src/file.ts:Symbol"
    const patterns = [
      /\[.*?\]\(((?:src|tests|docs|scripts)\/.*?\.ts)(?::(.*?))?\)/g,
      /["']((?:src|tests|docs|scripts)\/.*?\.ts)(?::(.*?))?["']/g,
    ];

    for (const pattern of patterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const filePath = match[1];
        const symbol = match[2];

        if (!symbol) {
          // Standard file link, just check if file exists
          try {
            await Deno.stat(join(cwd, filePath));
          } catch (_err) {
            console.error(`❌ [${docFile}]: Broken file link -> ${filePath}`);
            totalErrors++;
          }
          continue;
        }

        const isValid = await validateSymbol(filePath, symbol);
        if (!isValid) {
          console.error(`❌ [${docFile}]: Broken symbol link -> ${filePath}:${symbol}`);
          totalErrors++;
        }
      }
    }
  }

  if (totalErrors > 0) {
    console.error(`\nFound ${totalErrors} broken documentation links.`);
    Deno.exit(1);
  } else {
    console.log("\n✅ All documentation symbol links are valid!");
  }
}

if (import.meta.main) {
  main();
}
