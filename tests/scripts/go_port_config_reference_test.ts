/**
 * @module GoPortConfigReferenceTest
 * @path tests/scripts/go_port_config_reference_test.ts
 * @description Exercises the generator of the configuration reference documents that the Go schemas tests compare with the pinned decoder.
 * @architectural-layer Test
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { generateConfigReference, sortKeys, writeConfigReference } from "../../scripts/go_port/config_reference.ts";

/** A decoder with a few bounded leaves. The `mode` leaf has one valid value. */
const FAKE_CONFIG = `type Issue = { path: string[]; message: string };
function check(input: any): Issue[] {
  const issues: Issue[] = [];
  if (typeof input?.system?.root !== "string") issues.push({ path: ["system", "root"], message: "root" });
  const timeout = input?.limits?.timeout_ms;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 100) issues.push({ path: ["limits", "timeout_ms"], message: "range" });
  const ratio = input?.limits?.ratio;
  if (typeof ratio !== "number" || ratio < 0 || ratio > 1) issues.push({ path: ["limits", "ratio"], message: "ratio" });
  if (typeof input?.flags?.enabled !== "boolean") issues.push({ path: ["flags", "enabled"], message: "bool" });
  if (input?.mode !== "fixed") issues.push({ path: ["mode"], message: "mode" });
  if (input?.optional !== undefined && typeof input.optional.name !== "string") issues.push({ path: ["optional", "name"], message: "name" });
  return issues;
}
function withDefaults(input: any) {
  return { limits: { timeout_ms: 10, ratio: 0.5 }, flags: { enabled: false }, mode: "fixed", ...input,
    system: { root: input?.system?.root ?? "/cwd" } };
}
export const ConfigSchema = {
  parse(input: unknown) {
    const value = withDefaults(input);
    const issues = check(value);
    if (issues.length) throw new Error(JSON.stringify(issues));
    return value;
  },
  safeParse(input: unknown) {
    const value = withDefaults(input);
    const issues = check(value);
    return issues.length ? { success: false, error: { issues } } : { success: true, data: value };
  },
};
`;

interface IFakeConfig {
  limits: { timeout_ms: number };
  flags: { enabled: boolean };
  optional: { name: string };
  system: { root: string };
  mode: string;
}

async function fakeSnapshot(dir: string): Promise<string> {
  const root = join(dir, "snapshot");
  const src = join(root, "packages", "schemas", "src");
  await Deno.mkdir(src, { recursive: true });
  await Deno.writeTextFile(join(root, "deno.json"), "{}\n");
  await Deno.writeTextFile(join(root, "deno.lock"), '{"version":"5"}\n');
  await Deno.writeTextFile(join(src, "config.ts"), FAKE_CONFIG);
  return root;
}

Deno.test("go-port-config-reference: changes every leaf the decoder accepts and reports the rest", async () => {
  await withTempDir(async (dir) => {
    const root = await fakeSnapshot(dir);
    const generated = await generateConfigReference(root, { optional: { name: "start" } });
    const authored: IFakeConfig = JSON.parse(JSON.stringify(generated.authored));
    assertEquals(authored.limits.timeout_ms !== 10, true, "a bounded number takes another valid value");
    assertEquals(authored.flags.enabled, true, "a boolean flips");
    assertEquals(authored.optional.name, "startx", "a supplement leaf takes another value");
    assertEquals(authored.system.root, ".", "the root stays as written");
    assertEquals(authored.mode, "fixed");
    assertEquals(generated.unchanged, ["mode"]);
    const accepted = Object.fromEntries(generated.probes.map((probe) => [probe.path.join("."), probe.accepted]));
    assertEquals(accepted["limits.timeout_ms"], false, "an integer field rejects a fractional value");
    assertEquals(accepted["limits.ratio"], true, "a number field accepts a fractional value");
    assertEquals(generated.defaults.system, { root: "." });
    const reference: IFakeConfig = JSON.parse(JSON.stringify(generated.reference));
    assertEquals(reference.limits, authored.limits);
  });
});

Deno.test("go-port-config-reference: rejects a supplement that the decoder does not accept", async () => {
  await withTempDir(async (dir) => {
    const root = await fakeSnapshot(dir);
    await assertRejects(
      () => generateConfigReference(root, { optional: { name: 5 } }),
      Error,
      "the defaults with the supplement are invalid",
    );
  });
});

Deno.test("go-port-config-reference: writes the same bytes on every run, with sorted keys", async () => {
  await withTempDir(async (dir) => {
    const root = await fakeSnapshot(dir);
    const supplement = join(dir, "supplement.toml");
    await Deno.writeTextFile(supplement, '[optional]\nname = "start"\n');
    const target = join(dir, "out");
    await writeConfigReference(root, supplement, target);
    const first = await Deno.readTextFile(join(target, "reference.json"));
    await writeConfigReference(root, supplement, target);
    assertEquals(await Deno.readTextFile(join(target, "reference.json")), first);
    const document = JSON.parse(first);
    assertEquals(Object.keys(document), ["authored", "defaults", "referenceRevision"]);
    assertStringIncludes(await Deno.readTextFile(join(target, "authored.toml")), "[optional]");
    assertStringIncludes(await Deno.readTextFile(join(target, "fractions.json")), "limits");
  });
});

Deno.test("go-port-config-reference: sortKeys orders nested objects and keeps arrays", () => {
  assertEquals(
    JSON.stringify(sortKeys({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 0 } })),
    '{"a":{"c":0,"d":[{"y":2,"z":1}]},"b":1}',
  );
});
