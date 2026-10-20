/**
 * @module CommentRulesCorpus
 * @path packages/lint-policy/tests/fixtures/port/comment_rules_corpus.ts
 * @description Named source cases for the comment, parameter, fixture, header, and file-name rules, with the paths they pretend to live at.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [packages/lint-policy/tests/comment_rules_parity_test.ts]
 */

export interface ICommentRulesCase {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

const PROD = "packages/x/src/a.ts";
const TEST = "packages/x/tests/a_test.ts";
const SCRIPT = "scripts/tool.ts";
const HEADER = "/**\n * @module M\n * @path packages/x/src/a.ts\n * @description A module.\n */\n";
const CODE = "export const first = 1;\n";
const EIGHT = "a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number";

function inModule(...comment: string[]): string {
  return `${HEADER}${CODE}${comment.join("\n")}\nexport const second = 2;\n`;
}

const NINE_LINES = "a: 1\nb: 2\nc: 3\nd: 4\ne: 5\nf: 6\ng: 7\nh: 8";

export const COMMENT_RULES_CORPUS: readonly ICommentRulesCase[] = [
  // long-comment
  { name: "header of many lines", path: PROD, text: `${HEADER}${CODE}` },
  {
    name: "leading comment run before the first statement",
    path: PROD,
    text: `// one\n// two\n// three\n// four\n${CODE}`,
  },
  { name: "in-module run of four lines", path: PROD, text: inModule("// one", "// two", "// three", "// four") },
  { name: "in-module run of three lines", path: PROD, text: inModule("// one", "// two", "// three") },
  {
    name: "in-module block comment of five lines",
    path: PROD,
    text: inModule("/**", " * one", " * two", " * three", " */"),
  },
  { name: "single-line block comment", path: PROD, text: inModule("/* one */") },
  {
    name: "runs split by a blank line",
    path: PROD,
    text: inModule("// one", "// two", "// three", "", "// four", "// five"),
  },
  {
    name: "trailing comment on a code line",
    path: PROD,
    text: `${HEADER}${CODE}const t = 1; // one\n// two\n// three\n// four\n`,
  },
  {
    name: "comment-like text in a template literal",
    path: PROD,
    text: `${HEADER}export const t = \`\n// one\n// two\n// three\n// four\n\`;\n`,
  },
  { name: "comment-like text in a string", path: PROD, text: `${HEADER}export const t = "// one // two";\n` },
  // ephemeral-comment
  { name: "date in the header", path: PROD, text: `// 2026-10-20\n${CODE}` },
  { name: "date in a trailing comment", path: PROD, text: `${HEADER}export const t = 1; // 2026-10-20\n` },
  { name: "date in an in-module comment", path: PROD, text: inModule("// done on 2026-10-20") },
  { name: "month-name date", path: PROD, text: inModule("// done on October 20, 2026") },
  { name: "quarter date", path: PROD, text: inModule("// planned for Q3 2026") },
  { name: "phase number in an in-module comment", path: PROD, text: inModule("// added in phase 12") },
  { name: "phase number in the header", path: PROD, text: `// added in phase 12\n${CODE}` },
  { name: "step number in an in-module comment", path: PROD, text: inModule("// see step 3") },
  { name: "gap identifier in an in-module comment", path: PROD, text: inModule("// resolves GAP-4") },
  { name: "pre-gap reference", path: PROD, text: inModule("// the pre-gap analysis said so") },
  { name: "section sign", path: PROD, text: inModule("// see §3") },
  { name: "narration of an attempt", path: PROD, text: inModule("// we tried a loop first") },
  { name: "what did not work", path: PROD, text: inModule("// a map did not work here") },
  { name: "date and phase in one comment", path: PROD, text: inModule("// phase 3 on 2026-10-20") },
  { name: "plain in-module comment", path: PROD, text: inModule("// a plain note") },
  // decorative-comment
  { name: "separator of equal signs", path: PROD, text: inModule("// ==========") },
  { name: "separator of dashes in a block comment", path: PROD, text: inModule("/*", " * ------", " */") },
  { name: "text wrapped in dashes", path: PROD, text: inModule("// -- title ----") },
  { name: "strict equality in prose", path: PROD, text: inModule("// a === b holds") },
  { name: "separator in the header", path: PROD, text: `// ==========\n${CODE}` },
  // max-params
  { name: "function with eight parameters", path: PROD, text: `export function f(${EIGHT}): void {}\n` },
  {
    name: "function with eight parameters over lines",
    path: PROD,
    text: `export function f(\n  ${EIGHT.replaceAll(", ", ",\n  ")},\n): void {}\n`,
  },
  {
    name: "function with seven parameters",
    path: PROD,
    text: `export function f(${EIGHT.slice(0, EIGHT.lastIndexOf(","))}): void {}\n`,
  },
  { name: "arrow with eight parameters", path: PROD, text: `export const f = (${EIGHT}): void => {};\n` },
  {
    name: "method with a modifier and eight parameters",
    path: PROD,
    text: `export class C {\n  public method(${EIGHT}): void {}\n}\n`,
  },
  { name: "constructor with eight parameters", path: PROD, text: `export class C {\n  constructor(${EIGHT}) {}\n}\n` },
  {
    name: "interface method with eight parameters",
    path: PROD,
    text: `export interface I {\n  method(${EIGHT}): void;\n}\n`,
  },
  {
    name: "function with commas inside a generic and an object type",
    path: PROD,
    text:
      "export function f(a: Map<string, number>, b: { x: number; y: number }, c: Array<[string, number]>): void {}\n",
  },
  // test-inline-multiline-fixture
  { name: "named template of nine lines", path: TEST, text: `const yaml = \`\n${NINE_LINES}\n\`;\n` },
  { name: "named template of six lines", path: TEST, text: "const yaml = `\na: 1\nb: 2\nc: 3\nd: 4\ne: 5\nf: 6\n`;\n" },
  { name: "tagged named template", path: TEST, text: `const json = dedent\`\n${NINE_LINES}\n\`;\n` },
  { name: "named template with an interpolation", path: TEST, text: `const yaml = \`\n${NINE_LINES}\n\${x}\n\`;\n` },
  { name: "unnamed plain template", path: TEST, text: `const other = \`\n${NINE_LINES}\n\`;\n` },
  { name: "document fixture under any name", path: TEST, text: "const anything = `\n[section]\nkey = 1\n`;\n" },
  { name: "front matter fixture under any name", path: TEST, text: `const doc = \`\n---\n${NINE_LINES}\n\`;\n` },
  { name: "named template in a production file", path: PROD, text: `const yaml = \`\n${NINE_LINES}\n\`;\n` },
  { name: "single-line template", path: TEST, text: "const yaml = `a: 1`;\n" },
  { name: "exported named template", path: TEST, text: `export const yaml = \`\n${NINE_LINES}\n\`;\n` },
  // module-header
  { name: "file without a header", path: PROD, text: CODE },
  { name: "file with a block header", path: PROD, text: `${HEADER}${CODE}` },
  { name: "file with a header below a shebang", path: PROD, text: `#!/usr/bin/env -S deno run\n${HEADER}${CODE}` },
  { name: "file with a header on line seven", path: PROD, text: `\n\n\n\n\n\n// header\n${CODE}` },
  { name: "file with only a late comment", path: PROD, text: `${CODE}// late note\n` },
  { name: "empty file", path: PROD, text: "" },
  // script-usage
  {
    name: "script with a usage section",
    path: SCRIPT,
    text:
      `/**\n * @module S\n * @path scripts/tool.ts\n * @description A tool.\n *\n * Usage:\n *   deno run -A scripts/tool.ts\n */\n${CODE}`,
  },
  {
    name: "script without a usage section",
    path: SCRIPT,
    text: `/**\n * @module S\n * @path scripts/tool.ts\n * @description A tool.\n */\n${CODE}`,
  },
  { name: "script without a header", path: SCRIPT, text: CODE },
  { name: "source file without a usage section", path: PROD, text: `${HEADER}${CODE}` },
  // ephemeral-filename
  { name: "test file named after a phase", path: "packages/x/tests/phase12_flow_test.ts", text: `${HEADER}${CODE}` },
  {
    name: "test file with a phase in the middle",
    path: "packages/x/tests/flow_phase_3_test.ts",
    text: `${HEADER}${CODE}`,
  },
  { name: "test file with a plain phase word", path: "packages/x/tests/phase_test.ts", text: `${HEADER}${CODE}` },
  { name: "source file named after a phase", path: "packages/x/src/phase12.ts", text: `${HEADER}${CODE}` },
  // negative cases carried over from the former script tests
  {
    name: "date-shaped text outside comments",
    path: PROD,
    text:
      `${HEADER}export const releaseDate = "2026-08-31";\nexport const releaseNote = \`// Released on 2026-08-31.\`;\n`,
  },
  {
    name: "natural language use of the word gap",
    path: PROD,
    text: `${HEADER}export function run(): number {\n  // Check the price gap between models.\n  return 1;\n}\n`,
  },
  {
    name: "short parenthetical dash in a plain comment",
    path: PROD,
    text: `${HEADER}export function run(): number {\n  // Helpers -- kept short on purpose.\n  return 1;\n}\n`,
  },
  {
    name: "triple-equals echo of a code comparison",
    path: PROD,
    text:
      `${HEADER}export function run(): number {\n  // No migration records (inputHash === "") — only real execution records\n  return 1;\n}\n`,
  },
  {
    name: "markdown heading example in a comment",
    path: PROD,
    text:
      `${HEADER}export function run(): number {\n  // Extract ATX headings (\`#\` … \`######\`) from markdown text.\n  return 1;\n}\n`,
  },
  {
    name: "named template that holds escaped backticks",
    path: TEST,
    text:
      "const markdown = `\n# Title\n\n## Code Section\n\n\\`\\`\\`typescript\nconst a = 1;\n\\`\\`\\`\n\n- item\n`;\n",
  },
];
