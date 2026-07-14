#!/usr/bin/env -S deno run -A
/**
 * @module CheckGodObjects
 * @path scripts/check_god_objects.ts
 * @description Scans all .ts classes for god object indicators — high method
 *   count, constructor parameter count, line count, and longest method.
 *   Reports candidates (advisory by default; use --fail to exit non-zero).
 *
 * Usage:
 *   deno run -A scripts/check_god_objects.ts
 *   deno run -A scripts/check_god_objects.ts --json   # machine-readable output
 *   deno run -A scripts/check_god_objects.ts --threshold 50  # min score to report
 *   deno run -A scripts/check_god_objects.ts --fail        # exit non-zero if candidates found
 */

// deno-lint-ignore no-import-prefix
import { Project, SyntaxKind } from "npm:ts-morph@24.0.0";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const MIN_CLASS_LINES = 200;
const DEFAULT_THRESHOLD = 60;

interface GodObjectCandidate {
  file: string;
  className: string;
  lineCount: number;
  methodCount: number;
  ctorParams: number;
  importCount: number;
  fieldCount: number;
  maxMethodLines: number;
  score: number;
}

async function walkDir(dir: string, files: string[]): Promise<void> {
  try {
    for await (const entry of Deno.readDir(dir)) {
      const fullPath = `${dir}/${entry.name}`;
      if (
        entry.isDirectory && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist" &&
        entry.name !== "coverage"
      ) {
        await walkDir(fullPath, files);
      } else if (entry.isFile && entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
  } catch { /* skip */ }
}

async function main(): Promise<void> {
  const useJson = Deno.args.includes("--json");
  const shouldFail = Deno.args.includes("--fail");
  const threshold = parseInt(
    Deno.args.find((a) => a.startsWith("--threshold="))?.split("=")[1] ?? String(DEFAULT_THRESHOLD),
  );

  // Collect files
  const files: string[] = [];
  for (const dir of ["packages", "apps", "tests", "scripts"]) {
    const fullPath = `${ROOT}/${dir}`;
    try {
      await walkDir(fullPath, files);
    } catch { /* skip */ }
  }

  const tsFiles = files.filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith("_test.ts") && !f.endsWith(".d.ts"),
  );

  const project = new Project({
    compilerOptions: { strict: true, noEmit: true },
    skipAddingFilesFromTsConfig: true,
  });

  for (const filePath of tsFiles) {
    try {
      const stat = await Deno.stat(filePath);
      if (stat.size < 2000) continue;
      project.addSourceFileAtPath(filePath);
    } catch { /* skip unparseable */ }
  }

  const candidates: GodObjectCandidate[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const classes = sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration);

    for (const classDecl of classes) {
      const lineCount = classDecl.getEndLineNumber() - classDecl.getStartLineNumber() + 1;
      if (lineCount < MIN_CLASS_LINES) continue;

      const methods = classDecl.getDescendantsOfKind(SyntaxKind.MethodDeclaration);
      const methodCount = methods.length;

      let constructorParamCount = 0;
      const ctors = classDecl.getDescendantsOfKind(SyntaxKind.Constructor);
      if (ctors.length > 0) {
        constructorParamCount = ctors[0].getParameters().length;
      }

      const fields = classDecl.getDescendantsOfKind(SyntaxKind.PropertyDeclaration);
      const fieldCount = fields.length;

      const importDecls = sourceFile.getDescendantsOfKind(SyntaxKind.ImportDeclaration);
      const importCount = importDecls.length;

      let maxMethodLines = 0;
      for (const method of methods) {
        const mLines = method.getEndLineNumber() - method.getStartLineNumber() + 1;
        maxMethodLines = Math.max(maxMethodLines, mLines);
      }

      const score = Math.round(
        (methodCount > 30 ? 30 : methodCount) * 1.5 +
          (constructorParamCount > 7 ? constructorParamCount * 3 : 0) +
          Math.max(0, (lineCount - 200) / 50) +
          Math.max(0, (maxMethodLines - 100) / 10) +
          Math.max(0, (importCount - 24) * 1.5) +
          Math.max(0, fieldCount - 3) * 0.8,
      );

      if (score >= threshold) {
        candidates.push({
          file: filePath.replace(ROOT + "/", ""),
          className: classDecl.getName() || "(anonymous)",
          lineCount,
          methodCount,
          ctorParams: constructorParamCount,
          importCount,
          fieldCount,
          maxMethodLines,
          score,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (useJson) {
    console.log(JSON.stringify({ candidates, total: candidates.length, threshold }, null, 2));
    if (shouldFail && candidates.length > 0) Deno.exit(1);
    return;
  }

  if (candidates.length === 0) {
    console.log("✅ No god object candidates found above threshold.");
    return;
  }

  console.log(`\n━━━ God Object Candidates (score ≥ ${threshold}) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log(
    "Score  Lines  Methods  CtorParams  MaxMethod  Imports  Fields  Class".padEnd(100),
  );
  console.log(
    "─────  ─────  ───────  ─────────  ─────────  ───────  ──────  ─────".padEnd(100),
  );

  for (const c of candidates) {
    const name = `${c.className.padEnd(22)} ${c.file}`;
    console.log(
      `${String(c.score).padStart(5)}  ${String(c.lineCount).padStart(5)}  ${String(c.methodCount).padStart(7)}  ${
        String(c.ctorParams).padStart(9)
      }  ${String(c.maxMethodLines).padStart(9)}  ${String(c.importCount).padStart(7)}  ${
        String(c.fieldCount).padStart(6)
      }  ${name}`,
    );
  }

  console.log(`\n📊 ${candidates.length} candidate(s) found. Threshold: ${threshold}.`);
  console.log("💡 Tip: Run with --threshold=0 to see all classes, or --json for machine output.\n");
  if (shouldFail) Deno.exit(1);
}

await main();
