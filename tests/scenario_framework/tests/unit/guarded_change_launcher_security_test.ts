/**
 * @module GuardedChangeLauncherSecurityTest
 * @path tests/scenario_framework/tests/unit/guarded_change_launcher_security_test.ts
 * @description Verifies confined delegate writes and offline launcher cache without ambient secret forwarding.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/fixtures/bin/phase205-session-delegate.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { writeGuardedProof } from "../../fixtures/bin/phase205-session-delegate.ts";
import { sanitizeChildEnv } from "@exaix/session/supervised_launch.ts";
import { buildGuardedLauncher } from "../helpers/guarded_change_fixture.ts";

Deno.test("[security] guarded launcher restores its explicit offline cache without forwarding ambient secrets", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = join(root, "cache-probe.ts");
    const wrapper = join(root, "codex.ts");
    const cache = join(root, "cache's$(must-not-run)");
    await Deno.writeTextFile(
      fixture,
      'console.log(JSON.stringify({ cache: Deno.env.get("DENO_DIR"), secret: Deno.env.get("TEST_SECRET_KEY") }));',
    );
    await Deno.writeTextFile(
      wrapper,
      buildGuardedLauncher(
        Deno.execPath(),
        new URL("../../../../deno.json", import.meta.url).pathname,
        fixture,
        cache,
      ),
    );
    const child = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--no-config", wrapper],
      env: sanitizeChildEnv({}, { ...Deno.env.toObject(), TEST_SECRET_KEY: "must-not-forward" }),
      clearEnv: true,
    }).output();
    assertEquals(child.code, 0, new TextDecoder().decode(child.stderr));
    assertEquals(JSON.parse(new TextDecoder().decode(child.stdout)), { cache });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] guarded delegate rejects symlink escapes before either permitted write", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  try {
    await Deno.symlink(outside, join(root, "tests"));
    await assertRejects(() => writeGuardedProof(root), Error, "Access denied");
    assertEquals([...Deno.readDirSync(outside)], []);
    assertEquals([...Deno.readDirSync(root)].map((entry) => entry.name), ["tests"]);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});
