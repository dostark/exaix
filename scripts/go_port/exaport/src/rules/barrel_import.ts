#!/usr/bin/env -S deno run -A
/**
 * @module GoPortExaportBarrelImport
 * @path scripts/go_port/exaport/src/rules/barrel_import.ts
 * @description Reports imports of a package barrel instead of the declaring module.
 * Usage: imported by the exaport entry point.
 * @architectural-layer Tooling
 * @dependencies [typescript]
 */
import ts from "typescript";
import type { IFinding } from "./deno_api.ts";
import type { ISourceFile } from "../loader.ts";

/** Reports imports of a package barrel instead of the declaring module. */
export function barrelImportFindings(file: ISourceFile): IFinding[] {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
  );
  const findings: IFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (/^@exaix\/[^/]+$/.test(specifier)) {
        findings.push({
          rule: "barrel-import",
          file: file.path,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          message:
            `Import ${specifier} from the declaring submodule, not the package barrel.`,
          hazard: "mapping",
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
