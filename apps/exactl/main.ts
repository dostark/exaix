/**
 * @module ExaCtlApp
 * @path apps/exactl/main.ts
 * @description Thin entry point for the Exaix CLI executable. Imports and runs the main
 * exactl command dispatcher.
 * @architectural-layer Application
 * @related-files ["apps/exactl/src/exactl.ts", "apps/exactl/src/init.ts"]
 */

import { run } from "./src/exactl.ts";

if (import.meta.main) {
  await run();
}
