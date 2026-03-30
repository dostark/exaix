/**
 * @module JSONRepair
 * @path src/services/json_repair.ts
 * @description Provides comprehensive repair patterns for common LLM JSON output errors.
 *
 * Features:
 * - Regex-based extraction of JSON from markdown blocks
 * - Fixes for common syntax errors (trailing commas, unquoted keys)
 * - Support for multi-line string normalization
 *
 * @architectural-layer Services
 * @dependencies []
 * @related-files [src/services/output_validator.ts, src/services/plan_adapter.ts]
 */
const JSON_REPAIR_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  repair: (input: string) => string;
}> = [
  {
    // Remove markdown code blocks
    name: "markdown_code_block",
    pattern: /^```(?:json)?\s*([\s\S]*?)\s*```$/,
    repair: (input) => input.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1"),
  },
  {
    // Remove trailing commas in objects
    name: "trailing_comma_object",
    pattern: /,(\s*})/g,
    repair: (input) => input.replace(/,(\s*})/g, "$1"),
  },
  {
    // Remove trailing commas in arrays
    name: "trailing_comma_array",
    pattern: /,(\s*])/g,
    repair: (input) => input.replace(/,(\s*])/g, "$1"),
  },
  {
    // Fix single quotes to double quotes
    name: "single_quotes",
    pattern: /'([^']*)'(?=\s*:)/g,
    repair: (input) => input.replace(/'([^']*)'(?=\s*:)/g, '"$1"'),
  },
  {
    // Fix unquoted keys
    name: "unquoted_keys",
    pattern: /(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
    repair: (input) => input.replace(/(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":'),
  },
  {
    // Remove comments (// style)
    name: "line_comments",
    pattern: /\/\/[^\n]*/g,
    repair: (input) => input.replace(/\/\/[^\n]*/g, ""),
  },
  {
    // Remove comments (/* */ style)
    name: "block_comments",
    pattern: /\/\*[\s\S]*?\*\//g,
    repair: (input) => input.replace(/\/\*[\s\S]*?\*\//g, ""),
  },
  {
    // Fix escaped quotes in strings
    name: "escaped_quotes",
    pattern: /\\'/g,
    repair: (input) => input.replace(/\\'/g, "'"),
  },
  {
    // Remove newlines inside strings (common LLM error)
    name: "newlines_in_strings",
    pattern: /"[^"]*\n[^"]*"/g,
    repair: (input) => {
      // This is complex - only apply if simple case
      return input.replace(/"([^"]*)\n([^"]*)"/g, (_, p1, p2) => {
        return `"${p1}\\n${p2}"`;
      });
    },
  },
  {
    // Extract JSON object from surrounding text
    name: "extract_json_object",
    pattern: /\{[\s\S]*\}/,
    repair: (input) => {
      const match = input.match(/\{[\s\S]*\}/);
      return match ? match[0] : input;
    },
  },
];

/**
 * Attempt to repair common JSON errors
 */
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
