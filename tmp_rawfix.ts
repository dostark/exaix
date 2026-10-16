import ts from "typescript";
import { walk } from "@std/fs";
import { relative } from "@std/path";

const REPO = Deno.cwd();
const ROOTS = ["packages", "apps", "exaix-team", "tests"];
const NS = "pathBuilders";
const SEG: Record<string, string> = {
  Workspace: "workspacePath",
  ".exa": "runtimePath",
  Memory: "memoryPath",
  Portals: "portalsPath",
  Blueprints: "blueprintsPath",
  Active: "activePath",
  Archive: "archivePath",
  Plans: "plansPath",
  Requests: "requestsPath",
  Rejected: "rejectedPath",
  Agents: "agentsPath",
  Flows: "flowsPath",
  Projects: "memoryProjectsPath",
  Execution: "memoryExecutionPath",
  Index: "memoryIndexPath",
  Pending: "memoryPendingPath",
  Tasks: "memoryTasksPath",
  Global: "memoryGlobalPath",
  Skills: "memorySkillsPath",
};
const ROOT_SEGMENTS = new Set(["Workspace", ".exa", "Memory", "Portals", "Blueprints"]);
const TOKEN = /^[A-Za-z.][A-Za-z0-9._-]*$/;

/** The known helper chain for a segment list, or null when it does not start at a root. */
function chain(segments: string[]): string[] | null {
  if (segments.length === 0 || !ROOT_SEGMENTS.has(segments[0])) return null;
  const helpers: string[] = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (!(segment in SEG)) break;
    if (segment === "Skills" && segments[index - 1] === "Blueprints") break;
    helpers.push(SEG[segment]);
  }
  return helpers.length === 0 ? null : helpers;
}

/** Build `h2(h1(base), tail)` from a helper chain, a base expression, and a trailing part. */
function build(helpers: string[], base: string, tail: string): string {
  let inner = base;
  for (const helper of helpers.slice(0, -1)) inner = `${NS}.${helper}(${inner})`;
  const outer = `${NS}.${helpers[helpers.length - 1]}`;
  if (tail.length === 0) return `${outer}(${inner})`;
  const argument = tail.includes("${") ? `\`${tail}\`` : JSON.stringify(tail);
  return `${outer}(${inner}, ${argument})`;
}

/** Split the text after a template interpolation into a known run and the remainder. */
function splitRun(text: string): { helpers: string[]; tail: string } | null {
  const parts = text.split("/");
  if (parts[0] !== "") return null;
  const segments: string[] = [];
  let index = 1;
  for (; index < parts.length; index++) {
    if (!TOKEN.test(parts[index]) || !(parts[index] in SEG)) break;
    if (parts[index] === "Skills" && segments[segments.length - 1] === "Blueprints") break;
    segments.push(parts[index]);
  }
  const helpers = chain(segments);
  if (!helpers) return null;
  return { helpers, tail: parts.slice(index).join("/") };
}

const TEMPLATE = /^`\$\{([^{}]*)\}([\s\S]*?)`$/;
const CONCAT = /([A-Za-z_$][A-Za-z0-9_$.]*) \+ "((?:\/[A-Za-z.][A-Za-z0-9._-]*)+)"/g;
const LITERAL = /^"((?:\/[A-Za-z.][A-Za-z0-9._-]*)+)"$/;

let files = 0;
let edits = 0;
for (const root of ROOTS) {
  for await (
    const entry of walk(root, {
      includeDirs: false,
      exts: [".ts"],
      skip: [/[/\\]node_modules[/\\]/, /[/\\]\.git[/\\]/, /[/\\]coverage[/\\]/, /[/\\]dist[/\\]/],
    })
  ) {
    const repoPath = relative(REPO, entry.path);
    const text = await Deno.readTextFile(entry.path);
    const source = ts.createSourceFile(repoPath, text, ts.ScriptTarget.Latest, true);
    const reps: Array<{ start: number; end: number; text: string }> = [];
    let used = false;

    const visit = (node: ts.Node): void => {
      const raw = node.getText(source);
      if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const match = TEMPLATE.exec(raw);
        if (match) {
          const split = splitRun(match[2]);
          if (split) {
            reps.push({
              start: node.getStart(source),
              end: node.getEnd(),
              text: build(split.helpers, match[1], split.tail),
            });
            used = true;
            return;
          }
        }
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        CONCAT.lastIndex = 0;
        const match = CONCAT.exec(raw);
        if (match) {
          const split = splitRun(match[2]);
          if (split) {
            reps.push({
              start: node.getStart(source),
              end: node.getEnd(),
              text: build(split.helpers, match[1], split.tail),
            });
            used = true;
            return;
          }
        }
      } else if (ts.isStringLiteral(node)) {
        const parent = node.parent;
        const isSpecifier = (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
          parent.moduleSpecifier === node;
        if (!isSpecifier && !/\s/.test(node.text)) {
          const match = LITERAL.exec(raw);
          if (match) {
            const split = splitRun(match[1]);
            if (split) {
              reps.push({
                start: node.getStart(source),
                end: node.getEnd(),
                text: build(split.helpers, '"/"', split.tail),
              });
              used = true;
              return;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (!used) continue;

    const outermost: typeof reps = [];
    for (const rep of reps.sort((a, b) => a.start - b.start || b.end - a.end)) {
      if (outermost.some((kept) => rep.start >= kept.start && rep.end <= kept.end)) continue;
      outermost.push(rep);
    }
    let out = text;
    for (const rep of outermost.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, rep.start) + rep.text + out.slice(rep.end);
    }
    const firstImport = out.search(/^import /m);
    const line = `import * as ${NS} from "@exaix/shared";\n`;
    out = firstImport === -1 ? out + "\n" + line : out.slice(0, firstImport) + line + out.slice(firstImport);
    await Deno.writeTextFile(entry.path, out);
    files++;
    edits += outermost.length;
  }
}
console.error(`FILES|${files}|EDITS|${edits}`);
