/**
 * @module InstallPortalPolicyTest
 * @path packages/lint-policy/tests/install_portal_policy_test.ts
 * @description Builds the Exaix portal policy directory and lints seeds with the real Deno host offline.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/src/tools/install_portal_policy.ts]
 */

import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { installPortalPolicy, PORTAL_POLICY_CONFIG, PORTAL_POLICY_NAME } from "../src/tools/install_portal_policy.ts";

const CAST_SEED = "export const s = 1 as unknown as string;\n";
const POLICY_FILES = ["catalog.json", "deno.json", "manifest.json", "plugin.ts", "unslop_engine.js"];
const IGNORE_CODE = "unslop/no-forbidden-lint-ignore";
const CAST_CODE = "unslop/no-chained-type-assertions";

async function listNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) names.push(entry.name);
  return names.sort();
}

async function sha256(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Runs the real host on one seed and returns its diagnostic rule ids. */
async function lintSeed(policyDir: string, source: string): Promise<string[]> {
  const work = await Deno.makeTempDir({ prefix: "portal-policy-seed-" });
  try {
    const seed = join(work, "seed.ts");
    await Deno.writeTextFile(seed, source);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["lint", "--deny-import", "--config", join(policyDir, "deno.json"), "--rules-tags=", "--json", seed],
      cwd: work,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(result.code === 0 || result.code === 1, new TextDecoder().decode(result.stderr));
    const report = JSON.parse(new TextDecoder().decode(result.stdout)) as {
      diagnostics: { code: string | null }[];
    };
    return report.diagnostics.map((diagnostic) => diagnostic.code ?? "");
  } finally {
    await Deno.remove(work, { recursive: true });
  }
}

Deno.test("installed portal policy", async (test) => {
  const out = await Deno.makeTempDir({ prefix: "portal-policy-out-" });
  try {
    await installPortalPolicy({ out });
    const policyDir = join(out, PORTAL_POLICY_NAME);

    await test.step("installed-policy-manifest", async () => {
      assertEquals(await listNames(policyDir), POLICY_FILES);
      const manifest = JSON.parse(await Deno.readTextFile(join(policyDir, "manifest.json"))) as {
        format_version: number;
        plugin: string;
        packs: string[];
        engine: { package_version: string };
        files: Record<string, { sha256: string; bytes: number }>;
      };
      assertEquals(manifest.format_version, 1);
      assertEquals(manifest.plugin, "unslop");
      assertEquals(manifest.packs, ["typescript", "deno"]);
      assertMatch(manifest.engine.package_version, /^\d+\.\d+\.\d+/);
      assertEquals(
        Object.keys(manifest.files).sort(),
        POLICY_FILES.filter((name) => name !== "manifest.json"),
      );
      for (const [name, entry] of Object.entries(manifest.files)) {
        assertEquals(entry.sha256, await sha256(join(policyDir, name)), name);
        assertEquals(entry.bytes, (await Deno.stat(join(policyDir, name))).size, name);
      }
      assertEquals(JSON.parse(await Deno.readTextFile(join(policyDir, "deno.json"))), {
        lock: false,
        lint: { plugins: ["./plugin.ts"] },
      });

      const config = JSON.parse(await Deno.readTextFile(PORTAL_POLICY_CONFIG)) as {
        paths: { test: string[] };
        rules: Record<string, { level: string; options?: Record<string, unknown> }>;
      };
      const catalog = JSON.parse(await Deno.readTextFile(join(policyDir, "catalog.json"))) as {
        scopes: { test: string[] };
        rules: Record<string, { severity: string; options?: Record<string, unknown> }>;
      };
      assertEquals(catalog.scopes.test, config.paths.test);
      assertEquals(
        catalog.rules[IGNORE_CODE].options,
        config.rules[IGNORE_CODE].options,
      );
      assertEquals(catalog.rules[IGNORE_CODE].severity, config.rules[IGNORE_CODE].level);
      for (const id of ["unslop/require-deno-shebang", "unslop/require-script-usage"]) {
        assertEquals(catalog.rules[id].severity, "off", id);
      }

      const badOut = join(out, "bad");
      const badConfig = join(out, "bad.config.json");
      await Deno.writeTextFile(
        badConfig,
        JSON.stringify({ version: 2, plugin: "unslop", rules: { "unslop/nope": "error" } }),
      );
      await assertRejects(() => installPortalPolicy({ out: badOut, config: badConfig }));
      await assertRejects(
        () => Deno.stat(join(badOut, PORTAL_POLICY_NAME, "manifest.json")),
        Deno.errors.NotFound,
      );
    });

    await test.step("installed-policy-lints-offline", async () => {
      const codes = await lintSeed(policyDir, CAST_SEED);
      assert(codes.includes(CAST_CODE), codes.join(","));
    });

    await test.step("installed-policy-rejects-named-ignores", async () => {
      const namedFile = `// deno-lint-ignore-file ${CAST_CODE}\n${CAST_SEED}`;
      const namedLine = `// deno-lint-ignore ${CAST_CODE} -- typed upstream\n${CAST_SEED}`;
      for (const [name, source] of [["file", namedFile], ["line", namedLine]] as const) {
        const codes = await lintSeed(policyDir, source);
        assert(codes.includes(IGNORE_CODE), `${name}: ${codes.join(",")}`);
      }
    });

    await test.step("installed-policy-forbids-guard-ignores", async () => {
      const source = [
        `// deno-lint-ignore ${IGNORE_CODE} -- the guard rule itself\n`,
        `// deno-lint-ignore ${CAST_CODE} -- typed upstream\n`,
        CAST_SEED,
      ].join("");
      const codes = await lintSeed(policyDir, source);
      assert(codes.includes(IGNORE_CODE), codes.join(","));
    });
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});
