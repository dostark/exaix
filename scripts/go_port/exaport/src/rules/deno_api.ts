#!/usr/bin/env -S deno run -A
/**
 * @module GoPortExaportDenoApi
 * @path scripts/go_port/exaport/src/rules/deno_api.ts
 * @description Reports direct Deno API calls that the platform seam must replace.
 * Usage: imported by the exaport entry point.
 * @architectural-layer Tooling
 * @dependencies [typescript]
 */
import ts from "typescript";
import type { ISourceFile } from "../loader.ts";
import { traverse } from "./traverse.ts";

/** One readiness finding. */
export interface IFinding {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly hazard: string;
}

/** Reports direct Deno API calls that the platform seam must replace. */
export function denoApiFindings(file: ISourceFile): IFinding[] {
  const findings: IFinding[] = [];
  traverse(file, (node, source) => {
    if (
      ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === "Deno"
    ) {
      findings.push({
        rule: "deno-api",
        file: file.path,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        message: "Direct Deno API call; route it through the platform seam.",
        hazard: "platform",
      });
    }
  });
  return findings;
}
