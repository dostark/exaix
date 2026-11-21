#!/usr/bin/env -S deno run -A
/**
 * @module GoPortExaportLoader
 * @path scripts/go_port/exaport/src/loader.ts
 * @description Loads TypeScript source files from a root without following symlinks.
 * Usage: imported by the exaport rules and converter.
 * @architectural-layer Tooling
 * @dependencies []
 */
/** Loads TypeScript files from a root without following symlinks. */
export interface ISourceFile {
  readonly path: string;
  readonly text: string;
}

async function walk(
  root: string,
  relative: string,
  files: ISourceFile[],
): Promise<void> {
  for await (const entry of Deno.readDir(`${root}/${relative}`)) {
    if (entry.isSymlink) continue;
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory) {
      await walk(root, path, files);
    } else if (entry.isFile && /\.(ts|tsx)$/.test(entry.name)) {
      files.push({ path, text: await Deno.readTextFile(`${root}/${path}`) });
    }
  }
}

/** Reads every TypeScript file under a root. */
export async function loadSources(root: string): Promise<ISourceFile[]> {
  const files: ISourceFile[] = [];
  await walk(root.replace(/\/$/, ""), "", files);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
