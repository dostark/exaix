/**
 * @module JSONRepair
 * @path packages/core/src/func/json_repair.ts
 * @description Provides comprehensive repair patterns for common LLM JSON output errors.
 *
 * Features:
 * - Regex-based extraction of JSON from markdown blocks
 * - Fixes for common syntax errors (trailing commas, unquoted keys)
 * - Support for multi-line string normalization
 *
 * @architectural-layer Core
 * @related-files ["packages/tool-runtime/src/output_validator.ts"]
 */
const JSON_REPAIR_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  repair: (input: string) => string;
}> = [
  {
    name: "markdown_code_block",
    pattern: /^```(?:json)?\s*([\s\S]*?)\s*```$/,
    repair: (input) => input.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1"),
  },
  {
    name: "trailing_comma_object",
    pattern: /,(\s*})/g,
    repair: (input) => input.replace(/,(\s*})/g, "$1"),
  },
  {
    name: "trailing_comma_array",
    pattern: /,(\s*])/g,
    repair: (input) => input.replace(/,(\s*])/g, "$1"),
  },
  {
    name: "single_quotes",
    pattern: /'([^']*)'(?=\s*:)/g,
    repair: (input) => input.replace(/'([^']*)'(?=\s*:)/g, '"$1"'),
  },
  {
    name: "unquoted_keys",
    pattern: /(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
    repair: (input) => input.replace(/(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":'),
  },
  {
    name: "line_comments",
    pattern: /\/\/[^\n]*/g,
    repair: (input) => input.replace(/\/\/[^\n]*/g, ""),
  },
  {
    name: "block_comments",
    pattern: /\/\*[\s\S]*?\*\//g,
    repair: (input) => input.replace(/\/\*[\s\S]*?\*\//g, ""),
  },
  {
    name: "escaped_quotes",
    pattern: /\\'/g,
    repair: (input) => input.replace(/\\'/g, "'"),
  },
  {
    name: "newlines_in_strings",
    pattern: /"[^"]*\n[^"]*"/g,
    repair: (input) => {
      return input.replace(/"([^"]*)\n([^"]*)"/g, (_, p1, p2) => {
        return `"${p1}\\n${p2}"`;
      });
    },
  },
  {
    name: "extract_json_object",
    pattern: /\{[\s\S]*\}/,
    repair: (input) => {
      const match = input.match(/\{[\s\S]*\}/);
      return match ? match[0] : input;
    },
  },
];

export function repairJSON(input: string): { repaired: string; appliedRepairs: string[] } {
  let repaired = input.trim();
  const appliedRepairs: string[] = [];

  for (const { name, pattern, repair } of JSON_REPAIR_PATTERNS) {
    if (pattern.test(repaired)) {
      const before = repaired;
      repaired = repair(repaired);
      if (before !== repaired) {
        appliedRepairs.push(name);
      }
    }
  }

  return { repaired, appliedRepairs };
}
