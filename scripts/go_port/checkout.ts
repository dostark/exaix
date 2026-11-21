#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCheckout
 * @path scripts/go_port/checkout.ts
 * @description Resolves the Go checkout at the parent index revision.
 * Usage: imported by the cost pilot and Go-dependent tests.
 */

import { join } from "@std/path";
import { readGit } from "../plan_git.ts";

/** Optional tests can skip a missing or empty checkout. Broken checkouts fail in both modes. */
export async function goCheckout(parent: string, required: boolean): Promise<string | undefined> {
  const root = join(parent, "exaix-go");
  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(root));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    entries = [];
  }
  if (!entries.length) {
    if (required) throw new Error("Initialize the required exaix-go submodule");
    return undefined;
  }
  const link = await readGit(["ls-files", "--stage", "--", "exaix-go"], parent);
  const head = await readGit(["rev-parse", "HEAD"], root);
  if (
    link !== `160000 ${head} 0\texaix-go` ||
    await readGit(["rev-parse", "--show-toplevel"], root) !== await Deno.realPath(root)
  ) {
    throw new Error("exaix-go does not match the parent gitlink");
  }
  const missing = await readGit(["diff", "HEAD", "--no-renames", "--diff-filter=D", "--name-only", "-z"], root);
  const sparse = (await readGit(["ls-files", "-t", "-z"], root)).split("\0").some((file) => file.startsWith("S "));
  if (missing || sparse) throw new Error("Incomplete exaix-go checkout");
  return root;
}
