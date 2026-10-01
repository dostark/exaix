/**
 * @module BindingCutoverOps
 * @path tests/scenario_framework/scripts/binding_cutover_ops.ts
 * @description Performs named sandbox setup operations for the flow binding cutover scenario.
 * @architectural-layer Test
 * @dependencies [@std/path]
 * @related-files [tests/scenario_framework/scenarios/agent_flows/flow-step-model-bindings.yaml]
 */

import { join } from "@std/path";

const CONFIG_NAME = "exa.config.toml";
const BINDING_SELECTOR = '"flow:binding-split/step:explore-*"';
const SERVICE_FIXTURE = "compat-fixture";
const SERVICE_MOCK = "mock";
const FIXTURE_BINDING = `${BINDING_SELECTOR} = { service = "compat-fixture", model = "openai/compat-fixture-v1" }`;
const MOCK_BINDING = `${BINDING_SELECTOR} = { service = "mock", model = "mock/mock-model" }`;
const LOCK_SUFFIX = ".lock.json";

/** Atomically change only the cutover fixture's explore selector in the live daemon config. */
export async function setExploreService(root: string, service: string): Promise<void> {
  if (service !== SERVICE_FIXTURE && service !== SERVICE_MOCK) throw new Error("Unsupported service");
  const realRoot = await Deno.realPath(root);
  const configPath = join(realRoot, CONFIG_NAME);
  const info = await Deno.lstat(configPath);
  if (!info.isFile || info.isSymlink) throw new Error("Config is not a regular file");
  const text = await Deno.readTextFile(configPath);
  const lines = text.split("\n");
  const indices = lines.flatMap((line, index) => line.startsWith(`${BINDING_SELECTOR} = `) ? [index] : []);
  if (indices.length !== 1) throw new Error("Explore binding is missing or ambiguous");
  lines[indices[0]] = service === SERVICE_MOCK ? MOCK_BINDING : FIXTURE_BINDING;
  const tempPath = join(realRoot, `.config-cutover-${crypto.randomUUID()}.tmp`);
  try {
    await Deno.writeTextFile(tempPath, lines.join("\n"));
    await Deno.rename(tempPath, configPath);
  } finally {
    await Deno.remove(tempPath).catch(() => {});
  }
}

/** Save the most recently written run lock at a stable path for --locked replay. */
export async function saveLatestLock(root: string): Promise<void> {
  const realRoot = await Deno.realPath(root);
  const runtimeDir = join(realRoot, ".exa");
  const lockDir = join(runtimeDir, "bindings");
  const locks: Array<{ path: string; modified: number }> = [];
  for await (const entry of Deno.readDir(lockDir)) {
    if (!entry.name.endsWith(LOCK_SUFFIX) || !entry.isFile) continue;
    const path = join(lockDir, entry.name);
    const info = await Deno.lstat(path);
    if (!info.isFile || info.isSymlink) continue;
    locks.push({ path, modified: info.mtime?.getTime() ?? 0 });
  }
  locks.sort((a, b) => b.modified - a.modified || b.path.localeCompare(a.path));
  if (locks.length === 0) throw new Error("No binding lock is available");
  const destination = join(runtimeDir, "fifth.lock.json");
  const existing = await Deno.lstat(destination).catch(() => undefined);
  if (existing) throw new Error("Replay lock destination already exists");
  await Deno.copyFile(locks[0].path, destination);
}

if (import.meta.main) {
  const [operation, service] = Deno.args;
  if (operation === "set-explore" && service) await setExploreService(Deno.cwd(), service);
  else if (operation === "save-fifth-lock" && service === undefined) await saveLatestLock(Deno.cwd());
  else throw new Error("Unsupported cutover operation");
}
