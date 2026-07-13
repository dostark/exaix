#!/usr/bin/env -S deno run -A
/**
 * @module CheckMdPaths
 * @path scripts/check_md_paths.ts
 * @description Stale-path gate for markdown docs — flags filesystem path references
 *   that no longer resolve. See the block comment below the header for the full
 *   resolution rules, extracted reference forms, and --fix semantics.
 *
 * Usage:
 *   deno run --allow-read scripts/check_md_paths.ts [root] [--parent-only] [--staged]
 *   deno run --allow-read --allow-write scripts/check_md_paths.ts [root] --fix
 * @architectural-layer Script
 * @dependencies [@std/fs, @std/path]
 * @related-files [scripts/validate_doc_links.ts, tests/scripts/check_md_paths_test.ts]
 */

/*
 * Each candidate path is validated MD-relative first (relative to the markdown
 * file's own directory) then repo-root as a fallback, so both relative links
 * (`../x.md`) and repo-root-style references (`packages/core/x.ts`) are honoured.
 * Three reference forms are extracted: markdown links `[text](path)`, backticked
 * code paths `` `path/x.ts` ``, and bare path-like tokens in prose. External URLs,
 * anchors, and mailto: are ignored, and fenced code blocks are skipped.
 *
 * With `--fix`, a reference is rewritten ONLY when it is a navigational LINK (a
 * markdown link target or a `./`/`../` relative path) AND its basename resolves to
 * exactly one location in the repo. Bare-prose/backtick example paths and ambiguous
 * or zero-match references are reported but never auto-rewritten.
 *
 * A second (style) facet flags a path that appears un-backticked and un-linked in
 * PROSE yet resolves to a real file — it should be wrapped in backticks; `--fix`
 * wraps those. This facet exempts YAML frontmatter, the trailing `exaix:` skill
 * envelope, HTML comments, fenced code blocks, and unfenced shell-command lines
 * (where wrapping would break the command). Only resolvable bare paths are flagged,
 * so illustrative/placeholder example paths are never nagged.
 *
 * `--staged` restricts enforcement to git-staged markdown (the pre-commit ratchet);
 * repo-wide runs cover the full tree including submodules.
 */

import { walk } from "@std/fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "@std/path";

/** A markdown path reference that failed to resolve. */
export interface IMdPathViolation {
  /** Repo-relative path of the markdown file containing the reference. */
  file: string;
  /** 1-based line number of the reference. */
  line: number;
  /** The exact reference string as written in the doc. */
  reference: string;
  /** Repo-relative (or MD-relative, for links) path the basename resolves to — if unique. */
  suggestion?: string;
  /**
   * True when the reference is a navigational LINK (a markdown `[text](path)` target
   * or a `./`/`../` relative path). Only link-style refs are eligible for --fix, since
   * bare-prose/backtick example paths are frequently illustrative placeholders whose
   * single-basename match is not a reliable rename target.
   */
  isLink: boolean;
}

/** A bare (un-backticked, un-linked) prose path that resolves to a real file. */
export interface IMdStyleViolation {
  /** Repo-relative path of the markdown file containing the reference. */
  file: string;
  /** 1-based line number of the reference. */
  line: number;
  /** The bare path token as written in prose (to be wrapped in backticks). */
  reference: string;
}

export interface IMdPathResult {
  ok: boolean;
  /** Path references that do not resolve (broken links / stale paths). */
  violations: IMdPathViolation[];
  /** Resolvable bare prose paths that should be wrapped in backticks (style facet). */
  styleViolations: IMdStyleViolation[];
}

export interface ICheckOptions {
  /** Skip the exaix-dev-docs submodule (used by the parent-repo pre-commit gate). */
  parentOnly?: boolean;
  /**
   * Restrict violations to this set of repo-relative markdown files. Used by the
   * pre-commit "ratchet" so only staged/changed docs block; pre-existing drift in
   * untouched files is not enforced. The basename index still spans the whole repo.
   */
  onlyFiles?: Set<string>;
}

/** Directories never worth scanning or indexing. */
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "coverage",
  "dist",
  "build",
  ".copilot/chunks",
  ".copilot/embeddings",
]);

/** Extensions we treat as "referable repo files" for backtick/bare-path detection. */
const REFERABLE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".md",
  ".json",
  ".jsonc",
  ".toml",
  ".yaml",
  ".yml",
  ".sh",
]);

function hasReferableExt(p: string): boolean {
  const dot = p.lastIndexOf(".");
  if (dot < 0) return false;
  // Strip a trailing #anchor before checking.
  const ext = p.slice(dot).split("#")[0].toLowerCase();
  return REFERABLE_EXTS.has(ext);
}

function isExternalOrAnchor(ref: string): boolean {
  return (
    ref.startsWith("http://") ||
    ref.startsWith("https://") ||
    ref.startsWith("mailto:") ||
    ref.startsWith("#") ||
    ref.startsWith("<") // angle-bracket autolinks / placeholders like <path>
  );
}

/** Strip a trailing `#anchor` and surrounding whitespace from a link target. */
function cleanTarget(ref: string): string {
  return ref.trim().split("#")[0].split(" ")[0];
}

/** Absolute/system/example roots that are never repo references. */
const NON_REPO_PREFIXES = ["/tmp/", "/var/", "/etc/", "/usr/", "~/", "$", "C:", "\\"];
/** Example project stems used in prompts/tutorials — not real repo files. */
const EXAMPLE_STEMS = ["sample-project", "my-project", "your-project", "example-project"];

/** True when a token looks like an intra-repo relative/root path (not a bare word). */
function looksLikeRepoPath(token: string): boolean {
  if (!token.includes("/")) return false; // must be a path, not a bare filename word
  if (isExternalOrAnchor(token)) return false;
  if (token.startsWith("@")) return false; // package import specifier (e.g. @exaix/core/x.ts), not a fs path
  if (token.includes("{") || token.includes("<") || token.includes("*")) return false; // templates/globs
  if (token.includes("[") || token.includes("]")) return false; // placeholder like scripts/[filename].ts
  if (NON_REPO_PREFIXES.some((p) => token.startsWith(p))) return false; // absolute/system/example roots
  if (EXAMPLE_STEMS.some((s) => token.includes(s))) return false; // tutorial placeholders
  return hasReferableExt(token);
}

/**
 * True when a line looks like an (unfenced) shell command, where a bare path is part
 * of the command and must NOT be flagged/wrapped — backticks would change its meaning
 * (in shells backticks are command substitution) and break copy-paste.
 */
function looksLikeShellCommandLine(line: string): boolean {
  const t = line.trim();
  return (
    /(^|\s)(cat|ls|cd|cp|mv|rm|deno|npx|npm|node|git|jq|grep|rg|fd|find|sed|awk|echo|curl|chmod|mkdir|source)\s/.test(
      " " + t,
    ) ||
    t.includes("|") || // pipe
    t.includes("&&") || // command chaining
    t.startsWith("$") || // prompt
    t.startsWith("#") // shell comment / heading-ish command comment
  );
}

/** Pull path-like tokens out of a backtick span, which may be a whole command line. */
function pathTokensFromSpan(span: string): string[] {
  const tokens: string[] = [];
  for (const t of span.split(/\s+/)) {
    const cleaned = t.replace(/[.,;:)"']+$/, "");
    if (looksLikeRepoPath(cleaned)) tokens.push(cleaned);
  }
  return tokens;
}

/**
 * Markdown files that are NOT documentation cross-references and must be skipped:
 * scenario-framework request fixtures are agent task PROMPTS that legitimately name
 * files which may not exist in this repo.
 */
function isNonDocMarkdown(relPath: string): boolean {
  return (
    relPath.includes("scenario_framework/fixtures/") ||
    relPath.includes("/fixtures/requests/") ||
    relPath.includes("Workspace/Requests/")
  );
}

interface IExtractedRef {
  ref: string;
  line: number;
  /** A markdown-link target or a `./`/`../` relative path (fixable); else false. */
  isLink: boolean;
  /** A path token that appears un-backticked, un-linked in prose (backtick-facet input). */
  isBareProse: boolean;
}

/** Extract candidate references (with line numbers) from one markdown file's text. */
function extractReferences(text: string): IExtractedRef[] {
  const out: IExtractedRef[] = [];
  const lines = text.split("\n");
  // Fence tracking, CommonMark-style: an OPENING fence may carry an info string
  // (language), e.g. ```bash; a CLOSING fence must be the marker alone (only the
  // fence chars + optional whitespace). This is robust against the repo's malformed
  // ```text "closers" that would otherwise invert a naive open/close toggle counter.
  let fenceMarker = ""; // "" when outside a fence; otherwise the exact ``` / ~~~ run.
  // YAML frontmatter: a leading `---` opens it, the next `---` closes it. Its keys
  // (description, links, @path…) legitimately hold paths but are not rendered prose.
  let inFrontmatter = lines[0]?.trim() === "---";
  let inHtmlComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inFrontmatter) {
      if (i > 0 && line.trim() === "---") inFrontmatter = false;
      continue; // frontmatter carries no rendered references
    }

    // Trailing metadata block: a `---` opening a section whose first content line is
    // `exaix:` (the .copilot/skills SKILL.md envelope) is structured YAML, not prose —
    // its paths are validated by check:skill-envelopes, so skip to EOF.
    if (line.trim() === "---" && lines[i + 1]?.trim() === "exaix:") break;

    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMarker) {
      // Inside a fence: it closes only on a line that is exactly the marker
      // (same fence char, length ≥ opener) with nothing after it but whitespace.
      if (fence && fence[1][0] === fenceMarker[0] && fence[1].length >= fenceMarker.length && fence[2].trim() === "") {
        fenceMarker = "";
      }
      continue; // fenced body (and the fence lines) carry no references
    }
    if (fence) {
      // Opening fence (may have an info string / language after the marker).
      fenceMarker = fence[1];
      continue;
    }

    // HTML comments (`<!-- ... -->`, possibly multi-line) are not rendered prose.
    let commentStripped = line;
    if (inHtmlComment) {
      const end = line.indexOf("-->");
      if (end < 0) continue; // still inside the comment
      inHtmlComment = false;
      commentStripped = line.slice(end + 3);
    }
    // Strip inline `<!-- ... -->` and open an unterminated one.
    commentStripped = commentStripped.replace(/<!--[\s\S]*?-->/g, " ");
    if (/<!--/.test(commentStripped)) {
      commentStripped = commentStripped.replace(/<!--.*$/, " ");
      inHtmlComment = true;
    }

    const seen = new Set<string>();
    const add = (ref: string, isLink: boolean, isBareProse = false) => {
      if (seen.has(ref)) return;
      seen.add(ref);
      out.push({ ref, line: i + 1, isLink, isBareProse });
    };

    // 1) Markdown links: [text](target) — always link-style.
    for (const m of commentStripped.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = cleanTarget(m[1]);
      if (!target || isExternalOrAnchor(target) || target.startsWith("@")) continue;
      add(target, true);
    }

    // 2) Backticked code spans: may be a bare path OR a whole command line —
    // extract every path-like token within the span. A `./`/`../` token is link-style.
    for (const m of commentStripped.matchAll(/`([^`]+)`/g)) {
      for (const token of pathTokensFromSpan(m[1])) {
        add(token, isRelativeReference(token));
      }
    }

    // 3) Bare prose paths: unquoted, un-linked path-like tokens. These feed the
    // backtick facet (resolvable ⇒ "wrap in backticks") and are only fixable as
    // navigational refs when they are `./`/`../` relative links. Lines that look like
    // an unfenced shell command are skipped: wrapping a path there would break the
    // command (backticks = command substitution).
    const isShellLine = looksLikeShellCommandLine(commentStripped);
    const stripped = commentStripped
      .replace(/`[^`]+`/g, " ")
      .replace(/\[[^\]]*\]\([^)]+\)/g, " ");
    for (const m of stripped.matchAll(/(?:^|[\s(])((?:\.\.?\/)?[A-Za-z0-9_.\-]+\/[A-Za-z0-9_./\-]+)/g)) {
      const token = m[1].replace(/[.,;:)]+$/, "");
      if (!looksLikeRepoPath(token)) continue;
      // Still record it as a (report-only) reference for stale-path detection, but
      // do NOT mark it as a bare-prose backtick candidate when on a shell-command line.
      add(token, isRelativeReference(token), !isShellLine);
    }
  }
  return out;
}

/** Drop a trailing `#anchor` from a path reference (the file part is what resolves). */
function stripAnchor(ref: string): string {
  const hash = ref.indexOf("#");
  return hash < 0 ? ref : ref.slice(0, hash);
}

/** Resolve a reference MD-relative first, then repo-root. Returns true if it exists. */
function referenceResolves(root: string, mdFileAbs: string, refWithAnchor: string): boolean {
  const ref = stripAnchor(refWithAnchor);
  if (ref === "") return true; // pure `#anchor` (same-file) — handled/skipped upstream
  const candidates = isAbsolute(ref) ? [ref] : [resolve(dirname(mdFileAbs), ref), resolve(root, ref)];
  for (const c of candidates) {
    try {
      Deno.statSync(c);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

/** Build a basename → [repo-relative path] index for auto-fix suggestions. */
async function buildBasenameIndex(root: string): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  for await (
    const entry of walk(root, {
      includeDirs: false,
      followSymlinks: false,
      skip: [...IGNORE_DIRS].map((d) => new RegExp(`(^|/)${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|$)`)),
    })
  ) {
    const rel = relative(root, entry.path).replaceAll("\\", "/");
    const base = basename(entry.path);
    const list = index.get(base) ?? [];
    list.push(rel);
    index.set(base, list);
  }
  return index;
}

/** A reference written relative to its own doc (`./x`, `../x`) vs. repo-root-style. */
function isRelativeReference(ref: string): boolean {
  return ref.startsWith("./") || ref.startsWith("../");
}

/**
 * Compute the single unambiguous replacement path for a stale reference, if any.
 * The suggestion preserves the reference's STYLE: a relative link (`../x`) is
 * suggested relative to the MD file's own directory (so the link still renders
 * correctly), while a repo-root-style reference stays repo-root-relative.
 */
function suggestFor(
  ref: string,
  mdFileRel: string,
  index: Map<string, string[]>,
): string | undefined {
  const matches = index.get(basename(stripAnchor(ref)));
  if (!matches || matches.length !== 1) return undefined;
  const onlyRepoRel = matches[0]; // repo-relative path of the real file
  // Do NOT suggest an edition-crossing rewrite: a Solo `packages/...` reference must
  // not be auto-rewritten to a Team `packages-team/...` path (and vice-versa). Those
  // may be intentional edition-composed references; leave them for human review.
  const refTeam = ref.startsWith("packages-team/");
  const onlyTeam = onlyRepoRel.startsWith("packages-team/");
  if (refTeam !== onlyTeam) return undefined;

  if (!isRelativeReference(ref)) return onlyRepoRel;
  // Relative link: express the target relative to the MD file's own directory.
  const mdDir = dirname(mdFileRel);
  let rel = relative(mdDir, onlyRepoRel).replaceAll("\\", "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/** Repo-relative paths of markdown files currently staged for commit (added/modified). */
async function stagedMarkdownFiles(root: string): Promise<Set<string>> {
  const cmd = new Deno.Command("git", {
    args: ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    cwd: resolve(root),
    stdout: "piped",
    stderr: "null",
  });
  const { stdout } = await cmd.output();
  const files = new TextDecoder().decode(stdout).split("\n").map((l) => l.trim())
    .filter((l) => l.endsWith(".md"));
  return new Set(files);
}

/** Scan all markdown files under `root` and report unresolved path references. */
export async function checkMdPaths(root: string, options: ICheckOptions = {}): Promise<IMdPathResult> {
  const absRoot = resolve(root);
  const index = await buildBasenameIndex(absRoot);
  const violations: IMdPathViolation[] = [];
  const styleViolations: IMdStyleViolation[] = [];

  for await (
    const entry of walk(absRoot, {
      exts: [".md"],
      includeDirs: false,
      followSymlinks: false,
      skip: [...IGNORE_DIRS].map((d) => new RegExp(`(^|/)${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|$)`)),
    })
  ) {
    const rel = relative(absRoot, entry.path).replaceAll("\\", "/");
    if (isNonDocMarkdown(rel)) continue;
    if (options.parentOnly && rel.startsWith("exaix-dev-docs/")) continue;
    if (options.onlyFiles && !options.onlyFiles.has(rel)) continue;
    const text = await Deno.readTextFile(entry.path);
    for (const { ref, line, isLink, isBareProse } of extractReferences(text)) {
      const resolves = referenceResolves(absRoot, entry.path, ref);
      if (!resolves) {
        violations.push({ file: rel, line, reference: ref, isLink, suggestion: suggestFor(ref, rel, index) });
        continue;
      }
      // Resolvable + bare-in-prose ⇒ style nag: it should be wrapped in backticks.
      if (isBareProse) styleViolations.push({ file: rel, line, reference: ref });
    }
  }
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  styleViolations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { ok: violations.length === 0 && styleViolations.length === 0, violations, styleViolations };
}

/**
 * Wrap each resolvable bare prose path in backticks. Returns the number wrapped.
 * Only touches the exact bare-token occurrence (not already-backticked or linked
 * ones, which are never emitted as style violations).
 */
export async function applyBacktickFix(root: string, styleViolations: IMdStyleViolation[]): Promise<number> {
  const absRoot = resolve(root);
  const byFile = new Map<string, IMdStyleViolation[]>();
  for (const v of styleViolations) {
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }

  let wrapped = 0;
  for (const [file, vs] of byFile) {
    const abs = join(absRoot, file);
    let text = await Deno.readTextFile(abs);
    // Longest-first so a path that is a prefix of another isn't half-wrapped.
    const uniqueRefs = [...new Set(vs.map((v) => v.reference))].sort((a, b) => b.length - a.length);
    for (const ref of uniqueRefs) {
      const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match the bare token only when NOT already inside backticks or a link target:
      // require a boundary that is not a backtick, `(`, `/`, or path char on either side.
      const re = new RegExp(`(?<![\`(A-Za-z0-9_./\\-])${escaped}(?![\`A-Za-z0-9_./\\-])`, "g");
      const before = text;
      text = text.replace(re, `\`${ref}\``);
      if (text !== before) wrapped++;
    }
    await Deno.writeTextFile(abs, text);
  }
  return wrapped;
}

/**
 * Rewrite each violation that has an unambiguous single-match suggestion.
 * Returns the number of references rewritten.
 */
export async function applyFix(root: string, violations: IMdPathViolation[]): Promise<number> {
  const absRoot = resolve(root);
  // Group by file so each file is read/written once. Only LINK-style refs with an
  // unambiguous suggestion are eligible — bare-prose/backtick example paths are left
  // untouched (their single-basename match is not a reliable rename target).
  const byFile = new Map<string, IMdPathViolation[]>();
  for (const v of violations) {
    if (!v.suggestion || !v.isLink) continue;
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }

  let fixed = 0;
  for (const [file, vs] of byFile) {
    const abs = join(absRoot, file);
    let text = await Deno.readTextFile(abs);
    for (const v of vs) {
      if (!v.suggestion) continue;
      // Replace the reference token as a whole; guard with delimiters so we don't
      // rewrite a substring of a longer path.
      const before = text;
      text = replaceWholePath(text, v.reference, v.suggestion);
      if (text !== before) fixed++;
    }
    await Deno.writeTextFile(abs, text);
  }
  return fixed;
}

/** Replace occurrences of `from` with `to` only when `from` is a whole path token. */
function replaceWholePath(text: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A whole-path occurrence is not preceded/followed by a path-continuation char.
  const re = new RegExp(`(?<![A-Za-z0-9_./\\-])${escaped}(?![A-Za-z0-9_./\\-])`, "g");
  return text.replace(re, to);
}

function formatViolation(v: IMdPathViolation): string {
  const suffix = v.suggestion ? ` → did you mean ${v.suggestion}?` : " (no unambiguous match)";
  return `  ${v.file}:${v.line}  ${v.reference}${suffix}`;
}

function reportViolations(r: IMdPathResult): void {
  if (r.violations.length > 0) {
    console.error(`❌ ${r.violations.length} stale markdown path reference(s):`);
    for (const v of r.violations) console.error(formatViolation(v));
  }
  if (r.styleViolations.length > 0) {
    console.error(`\n❌ ${r.styleViolations.length} bare path(s) in prose that should be backticked:`);
    for (const v of r.styleViolations) console.error(`  ${v.file}:${v.line}  ${v.reference}`);
  }
  console.error(`\nRun with --fix to rewrite unambiguous renames and wrap bare prose paths in backticks.`);
}

if (import.meta.main) {
  const args = [...Deno.args];
  const fix = args.includes("--fix");
  const parentOnly = args.includes("--parent-only");
  const staged = args.includes("--staged");
  const root = args.find((a) => !a.startsWith("--")) ?? ".";

  const onlyFiles = staged ? await stagedMarkdownFiles(root) : undefined;
  if (staged && onlyFiles!.size === 0) {
    console.log("✅ Markdown path check: no staged markdown files.");
    Deno.exit(0);
  }

  const opts: ICheckOptions = { parentOnly, onlyFiles };
  const result = await checkMdPaths(root, opts);

  if (result.ok) {
    console.log("✅ Markdown path check: all path references resolve and bare prose paths are backticked.");
    Deno.exit(0);
  }

  if (fix) {
    const fixed = await applyFix(root, result.violations);
    const wrapped = await applyBacktickFix(root, result.styleViolations);
    const rechecked = await checkMdPaths(root, opts);
    console.log(`🔧 Rewrote ${fixed} stale path(s); wrapped ${wrapped} bare prose path(s) in backticks.`);
    if (rechecked.ok) {
      console.log("✅ All path references resolve and bare prose paths are backticked after --fix.");
      Deno.exit(0);
    }
    console.error(
      `\n❌ ${rechecked.violations.length} stale + ${rechecked.styleViolations.length} bare-path issue(s) remain:`,
    );
    reportViolations(rechecked);
    Deno.exit(1);
  }

  reportViolations(result);
  Deno.exit(1);
}
