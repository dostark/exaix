#!/usr/bin/env -S deno run -A
/**
 * @module GoPortExaportTraverse
 * @path scripts/go_port/exaport/src/rules/traverse.ts
 * @description Walks a TypeScript source node tree and gives each node its source file.
 * Usage: imported by the exaport rules.
 * @architectural-layer Tooling
 * @dependencies [typescript]
 */
import ts from "typescript";
import type { ISourceFile } from "../loader.ts";

/** Visit every node in a source file with the source file for line lookup. */
export function traverse(
  file: ISourceFile,
  visit: (node: ts.Node, source: ts.SourceFile) => void,
): ts.SourceFile {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
  );
  const walk = (node: ts.Node): void => {
    visit(node, source);
    ts.forEachChild(node, walk);
  };
  walk(source);
  return source;
}
