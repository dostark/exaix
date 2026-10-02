/**
 * @module OverlayFile
 * @path packages/ai/src/bindings/overlay_file.ts
 * @description Reads one operator binding overlay file under the shared bounds: a regular file, never a symlink,
 *   at most BINDING_OVERLAY_MAX_BYTES, read through the handle that passed the check.
 * @architectural-layer AI
 * @dependencies [@exaix/core]
 * @related-files [apps/exactl/src/handlers/request_create_handler.ts, tests/scenario_framework/runner/binding_layers.ts]
 */

import { BINDING_OVERLAY_MAX_BYTES } from "@exaix/core";

/** Prefix of every refusal, matching the other overlay entry points. */
const OVERLAY_INVALID = "overlay_invalid";

function refuse(path: string, reason: string): Error {
  return new Error(`${OVERLAY_INVALID}: ${path} ${reason}`);
}

/** Read an operator overlay file as text. A symlink is refused before it is followed.
 *  The opened handle must be the checked file, and the read stops one byte past the ceiling. */
export async function readRegularOverlayFile(path: string): Promise<string> {
  let linkInfo: Deno.FileInfo;
  try {
    linkInfo = await Deno.lstat(path);
  } catch {
    throw refuse(path, "is not a regular file");
  }
  if (!linkInfo.isFile || linkInfo.isSymlink) throw refuse(path, "is not a regular file");
  if (linkInfo.size > BINDING_OVERLAY_MAX_BYTES) {
    throw refuse(path, `exceeds the ${BINDING_OVERLAY_MAX_BYTES}-byte ceiling`);
  }

  using file = await Deno.open(path, { read: true });
  const opened = await file.stat();
  if (!opened.isFile || opened.ino !== linkInfo.ino || opened.dev !== linkInfo.dev) {
    throw refuse(path, "changed while it was opened");
  }

  const buffer = new Uint8Array(BINDING_OVERLAY_MAX_BYTES + 1);
  let total = 0;
  while (total < buffer.length) {
    const read = await file.read(buffer.subarray(total));
    if (read === null) break;
    total += read;
  }
  if (total > BINDING_OVERLAY_MAX_BYTES) {
    throw refuse(path, `exceeds the ${BINDING_OVERLAY_MAX_BYTES}-byte ceiling`);
  }
  return new TextDecoder().decode(buffer.subarray(0, total));
}
