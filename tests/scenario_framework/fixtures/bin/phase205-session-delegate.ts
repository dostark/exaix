#!/usr/bin/env -S deno run -A
/**
 * @module GuardedChangeSessionDelegate
 * @path tests/scenario_framework/fixtures/bin/phase205-session-delegate.ts
 * @description Writes confined proof files and emits the Codex protocol for real session reconciliation.
 * @architectural-layer Test
 * @dependencies [@exaix/portal, @exaix/schemas]
 * @related-files [apps/daemon/src/headless_session_launcher.ts]
 */
import { dirname } from "@std/path";
import { PathResolver } from "@exaix/portal";
import { ConfigSchema } from "@exaix/schemas";

const PROOF_PATHS = ["src/proof.txt", "tests/proof_test.ts"];
const PROOF = "GUARDED IMPLEMENTATION PROOF\n";
const REGRESSION =
  'Deno.test("guarded proof", async () => {\n  const proof = await Deno.readTextFile(new URL("../src/proof.txt", import.meta.url));\n  if (proof !== "GUARDED IMPLEMENTATION PROOF\\n") throw new Error("Wrong proof");\n});\n';

/** Resolve both write paths before making any directory or file. */
export async function writeGuardedProof(root: string): Promise<void> {
  const config = ConfigSchema.parse({ system: { root }, portals: [{ alias: "guarded-fixture", target_path: root }] });
  const resolver = new PathResolver(config);
  const paths = await Promise.all(PROOF_PATHS.map((path) => resolver.resolve(`@guarded-fixture/${path}`)));
  for (const path of paths) await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(paths[0], PROOF);
  await Deno.writeTextFile(paths[1], REGRESSION);
}

if (import.meta.main && Deno.args.includes("--version")) {
  console.log("codex-fixture 1.0.0");
  Deno.exit(0);
}

if (import.meta.main) {
  if (!Deno.args.includes("workspace-write")) throw new Error("The fixture requires a hardened write launch");
  await writeGuardedProof(Deno.cwd());
  console.log(JSON.stringify({
    type: "item.completed",
    item: { id: "proof-write", type: "file_change", changes: PROOF_PATHS.map((path) => ({ path, kind: "add" })) },
  }));
  console.log(JSON.stringify({
    type: "item.completed",
    item: {
      id: "proof-summary",
      type: "agent_message",
      text: "GUARDED IMPLEMENTATION PROOF: wrote only src/proof.txt and tests/proof_test.ts in the resolved worktree.",
    },
  }));
}
