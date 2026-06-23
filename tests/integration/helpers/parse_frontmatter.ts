/**
 * @module ParseFrontmatter
 * @path tests/integration/helpers/parse_frontmatter.ts
 * @description Shared YAML frontmatter parser for integration tests.
 *   Extracts key-value pairs, arrays, booleans, and integers from markdown frontmatter.
 * @architectural-layer Testing
 * @dependencies []
 * @related-files [tests/integration/plan_to_requests_test.ts]
 */

export function parseFrontmatter(
  content: string,
): Record<string, string | number | boolean | string[]> {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const yamlLines = frontmatterMatch ? frontmatterMatch[1] : "";
  const parsed: Record<string, string | number | boolean | string[]> = {};

  for (const line of yamlLines.split("\n")) {
    const kvMatch = line.match(/^\s*(\w+):\s*(.+)/);
    if (kvMatch) {
      const val = kvMatch[2].trim();
      if (val === "true") parsed[kvMatch[1]] = true;
      else if (val === "false") parsed[kvMatch[1]] = false;
      else if (/^\d+$/.test(val)) parsed[kvMatch[1]] = parseInt(val, 10);
      else if (val.startsWith('"') && val.endsWith('"')) parsed[kvMatch[1]] = val.slice(1, -1);
      else parsed[kvMatch[1]] = val;
    }

    const arrMatch = line.match(/^\s+(\w+):\s*$/);
    if (arrMatch) {
      parsed[arrMatch[1]] = [];
    }

    const itemMatch = line.match(/^\s+-\s+(.+)/);
    if (itemMatch) {
      const lastKey = Object.keys(parsed).pop()!;
      if (Array.isArray(parsed[lastKey])) {
        (parsed[lastKey] as string[]).push(itemMatch[1].trim());
      }
    }
  }

  return parsed;
}
