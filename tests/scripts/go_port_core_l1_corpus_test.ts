/**
 * @module GoPortCoreL1CorpusTest
 * @path tests/scripts/go_port_core_l1_corpus_test.ts
 * @description Exercises the core-l1 reference recorder. The Go checkout verifies the committed cases itself.
 * @architectural-layer Test
 */
import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { CORE_L1_REFERENCE } from "../../scripts/go_port/core_l1_exports.ts";
import {
  CORE_L1_CONFIG_CASES,
  recordConfigCases,
  writeCoreL1Reference,
} from "../../scripts/go_port/core_l1_reference.ts";

const VALID_IDS = ["config-explicit-root", "config-explicit-root-alternate"];
const INVALID_ID = "config-invalid-field";

/** A decoder that accepts four log levels and reports one issue category for any other value. */
const FAKE_SCHEMA = `const LEVELS = ["debug", "info", "warn", "error"];
export const ConfigSchema = {
  safeParse(input: any) {
    if (!LEVELS.includes(input?.system?.log_level)) {
      return { success: false, error: { issues: [{ path: ["system", "log_level"], code: "invalid_value", message: "bad" }] } };
    }
    return { success: true, data: input };
  },
};
`;

/** A service that reads the file it is given and resolves the root against the file directory. */
const FAKE_SERVICE = `import { ConfigSchema } from "../../../schemas/src/config.ts";
export class ConfigService {
  private readonly data: any;
  constructor(path: string) {
    const text = Deno.readTextFileSync(path);
    const root = /root = "([^"]*)"/.exec(text)?.[1] ?? "";
    const level = /log_level = "([^"]*)"/.exec(text)?.[1];
    const dir = path.slice(0, path.lastIndexOf("/"));
    const result = ConfigSchema.safeParse({ system: { root: dir + "/" + root, log_level: level } });
    if (!result.success) throw new Error("invalid configuration");
    this.data = result.data;
  }
  get() { return this.data; }
}
`;

/** A service that accepts every file, so a recorder must reject the case that should be invalid. */
const LENIENT_SERVICE = `export class ConfigService {
  private readonly text: string;
  constructor(path: string) { this.text = Deno.readTextFileSync(path); }
  get() {
    const level = /log_level = "([^"]*)"/.exec(this.text)?.[1];
    return { system: { root: "/x/workspace", log_level: level } };
  }
}
`;

async function fakeSnapshot(dir: string, service: string = FAKE_SERVICE): Promise<string> {
  const root = join(dir, "snapshot");
  const schemas = join(root, "packages", "schemas", "src");
  const config = join(root, "packages", "core", "src", "config");
  await Deno.mkdir(schemas, { recursive: true });
  await Deno.mkdir(config, { recursive: true });
  await Deno.writeTextFile(join(root, "deno.json"), "{}\n");
  await Deno.writeTextFile(join(root, "deno.lock"), '{"version":"5"}\n');
  await Deno.writeTextFile(join(schemas, "config.ts"), FAKE_SCHEMA);
  await Deno.writeTextFile(join(config, "service.ts"), service);
  return root;
}

interface IManifestCase {
  readonly id: string;
  readonly input_sha256: string;
  readonly observation_sha256: string;
}

interface IManifest {
  readonly schema_version: number;
  readonly reference_parent: string;
  readonly cases: readonly IManifestCase[];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readManifest(dir: string): Promise<IManifest> {
  return JSON.parse(await Deno.readTextFile(join(dir, "manifest.json")));
}

Deno.test("go-port-core-l1-corpus: records each case in its own temporary root and keeps relative roots", async () => {
  await withTempDir(async (dir) => {
    const snapshot = await fakeSnapshot(dir);
    const recorded = await recordConfigCases(snapshot);
    assertEquals(recorded.map((entry) => entry.id), CORE_L1_CONFIG_CASES.map((entry) => entry.id));
    const validRoots = recorded.filter((entry) => VALID_IDS.includes(entry.id)).map((entry) => entry.tempRoot);
    assertEquals(new Set(validRoots).size, VALID_IDS.length, "each valid case runs in a distinct temporary root");
    const byId = new Map(recorded.map((entry) => [entry.id, entry.observation]));
    assertEquals(byId.get("config-explicit-root")?.resolved_root, "workspace");
    assertEquals(byId.get("config-explicit-root-alternate")?.resolved_root, "nested/alternate");
    assertEquals(byId.get("config-explicit-root")?.log_level, "debug");
    assertEquals(byId.get("config-explicit-root-alternate")?.log_level, "warn");
    for (const entry of recorded) {
      const text = JSON.stringify(entry.observation);
      assert(!text.includes(entry.tempRoot), "an observation carries no host path");
    }
  });
});

Deno.test("go-port-core-l1-corpus: records the invalid case as an issue path and category without the authored value", async () => {
  await withTempDir(async (dir) => {
    const snapshot = await fakeSnapshot(dir);
    const recorded = await recordConfigCases(snapshot);
    const invalid = recorded.find((entry) => entry.id === INVALID_ID)?.observation;
    assertEquals(invalid?.outcome, "invalid");
    assertEquals(invalid?.issues, [{ path: "system.log_level", code: "invalid_value" }]);
    assertEquals(invalid?.log_level, undefined);
    assert(!JSON.stringify(invalid).includes("verbose"), "the rejected authored value is not recorded");
  });
});

Deno.test("go-port-core-l1-corpus: rejects a reference service that accepts the invalid case", async () => {
  await withTempDir(async (dir) => {
    const snapshot = await fakeSnapshot(dir, LENIENT_SERVICE);
    await assertRejects(() => recordConfigCases(snapshot), Error, INVALID_ID);
  });
});

Deno.test("go-port-core-l1-corpus: writes identical bytes on every run and a manifest that matches them", async () => {
  await withTempDir(async (dir) => {
    const snapshot = await fakeSnapshot(dir);
    const first = join(dir, "first");
    const second = join(dir, "second");
    await writeCoreL1Reference(snapshot, first);
    await writeCoreL1Reference(snapshot, second);
    assertEquals(
      await Deno.readTextFile(join(first, "manifest.json")),
      await Deno.readTextFile(join(second, "manifest.json")),
    );
    const manifest = await readManifest(first);
    assertEquals(manifest.reference_parent, CORE_L1_REFERENCE);
    assertEquals(manifest.cases.map((entry) => entry.id), CORE_L1_CONFIG_CASES.map((entry) => entry.id));
    for (const entry of manifest.cases) {
      const input = await Deno.readFile(join(first, entry.id, "exa.config.toml"));
      const observation = await Deno.readFile(join(first, entry.id, "observation.json"));
      assertEquals(entry.input_sha256, await sha256Hex(input));
      assertEquals(entry.observation_sha256, await sha256Hex(observation));
    }
  });
});

Deno.test("go-port-core-l1-corpus: authored log levels are constants that the observations must reproduce", () => {
  const levels = VALID_IDS.map((id) => CORE_L1_CONFIG_CASES.find((entry) => entry.id === id)?.logLevel);
  assertEquals(levels, ["debug", "warn"]);
  assertNotEquals(levels[0], levels[1]);
});
