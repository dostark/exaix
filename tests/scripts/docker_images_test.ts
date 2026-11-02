/**
 * @module DockerImagesTest
 * @path tests/scripts/docker_images_test.ts
 * @description Verifies the docker image housekeeping: removal of a replaced untagged image after a build,
 *   the build-cache trim, and the build presets that the wrapper script and the deno tasks share.
 */

import { assertEquals } from "@std/assert";
import {
  buildReplacingImage,
  IMAGE_PRESETS,
  pruneStaleBuildCache,
  removeReplacedImage,
} from "../../scripts/docker_images.ts";

/** Records the docker side effects of the housekeeping and answers image ids from a script. */
function fakeDocker(ids: Array<string | undefined>, tagsOfOldImage = 0) {
  const removed: string[] = [];
  let lookups = 0;
  return {
    removed,
    seams: {
      imageId: (_image: string) => Promise.resolve(ids[Math.min(lookups++, ids.length - 1)]),
      imageTagCount: (_id: string) => Promise.resolve(tagsOfOldImage),
      removeImage: (id: string) => {
        removed.push(id);
        return Promise.resolve();
      },
    },
  };
}

Deno.test("removeReplacedImage removes an untagged replaced image and keeps every other case", async () => {
  const gone = fakeDocker(["sha256:new"]);
  await removeReplacedImage("sha256:old", "exaix-eval-jail", gone.seams);
  assertEquals(gone.removed, ["sha256:old"]);

  const tagged = fakeDocker(["sha256:new"], 2);
  await removeReplacedImage("sha256:old", "exaix-eval-jail", tagged.seams);
  assertEquals(tagged.removed, []);

  const unchanged = fakeDocker(["sha256:old"]);
  await removeReplacedImage("sha256:old", "exaix-eval-jail", unchanged.seams);
  assertEquals(unchanged.removed, []);

  const first = fakeDocker(["sha256:new"]);
  await removeReplacedImage(undefined, "exaix-eval-jail", first.seams);
  assertEquals(first.removed, []);
});

Deno.test("removeReplacedImage never fails when the old image is still in use", async () => {
  const docker = fakeDocker(["sha256:new"]);
  await removeReplacedImage("sha256:old", "exaix-eval-jail", {
    ...docker.seams,
    removeImage: () => Promise.reject(new Error("image is in use")),
  });
});

Deno.test("buildReplacingImage cleans up after a successful rebuild and returns the build exit code", async () => {
  const docker = fakeDocker(["sha256:old", "sha256:new"]);
  const code = await buildReplacingImage("exaix-eval-jail", () => Promise.resolve(0), docker.seams);
  assertEquals(code, 0);
  assertEquals(docker.removed, ["sha256:old"]);
});

Deno.test("buildReplacingImage keeps the old image when the build fails", async () => {
  const docker = fakeDocker(["sha256:old", "sha256:new"]);
  const code = await buildReplacingImage("exaix-eval-jail", () => Promise.resolve(3), docker.seams);
  assertEquals(code, 3);
  assertEquals(docker.removed, []);
});

Deno.test("pruneStaleBuildCache trims only old unused cache and tolerates failure", async () => {
  const seen: string[] = [];
  await pruneStaleBuildCache({
    dockerOnPath: () => true,
    prune: (maxAge: string) => {
      seen.push(maxAge);
      return Promise.resolve(0);
    },
  });
  assertEquals(seen, ["168h"]);
  await pruneStaleBuildCache({ dockerOnPath: () => true, prune: () => Promise.resolve(1) });
  await pruneStaleBuildCache({ dockerOnPath: () => false, prune: () => Promise.reject(new Error("must not run")) });
});

Deno.test("the build presets name the images that the repo builds and the deno tasks run them through the wrapper", async () => {
  assertEquals(Object.keys(IMAGE_PRESETS).sort(), ["eval-jail", "sandbox"]);
  assertEquals(IMAGE_PRESETS["eval-jail"].image, "exaix-eval-jail");
  assertEquals(IMAGE_PRESETS["sandbox"].image, "exaix-sandbox:dev");
  const tasks = JSON.parse(await Deno.readTextFile(new URL("../../deno.json", import.meta.url))).tasks;
  assertEquals(tasks["eval:jail:build"].includes("scripts/build_docker_image.ts eval-jail"), true);
  assertEquals(tasks["sandbox:build"].includes("scripts/build_docker_image.ts sandbox"), true);
});
