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
/**
 * Extracts the widest `{...}` span from the input, isolating a JSON object candidate from any
 * surrounding prose or markdown fences BEFORE the other patterns run. This must run first: a
 * live LLM response commonly wraps its JSON in prose ("I appreciate the context... ```json\n{...}\n```")
 * whose own newlines and quoted words would otherwise be mangled by later string-level repairs
 * (e.g. escapeNewlinesInStrings) operating across content that isn't actually JSON yet.
 */
function extractJsonObjectSpan(input: string): string {
  const match = input.match(/\{[\s\S]*\}/);
  return match ? match[0] : input;
}

/**
 * Escapes a literal newline that occurs INSIDE a JSON string value. A single left-to-right scan
 * tracks whether the cursor is inside a string (honoring `\"` escapes), so a newline BETWEEN two
 * string tokens (the normal formatting of any multi-line, multi-key JSON object) is left alone —
 * unlike the previous /"[^"]*\n[^"]*"/g regex, which matched from one value's closing quote,
 * across the structural `,\n  ` between two keys, to the next key's opening quote, corrupting
 * virtually any well-formatted multi-line JSON.
 */
function escapeNewlinesInStrings(input: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of input) {
    if (inString && char === "\n") {
      result += "\\n";
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === '"') {
      inString = !inString;
    }
    result += char;
  }

  return result;
}

const JSON_REPAIR_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  repair: (input: string) => string;
}> = [
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
    pattern: /\n/,
    repair: escapeNewlinesInStrings,
  },
];

export function repairJSON(input: string): { repaired: string; appliedRepairs: string[] } {
  let repaired = input.trim();
  const appliedRepairs: string[] = [];

  const extracted = extractJsonObjectSpan(repaired);
  if (extracted !== repaired) {
    repaired = extracted;
    appliedRepairs.push("extract_json_object");
  }

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
