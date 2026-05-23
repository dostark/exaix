/**
 * @module TuiApp
 * @path apps/tui/main.ts
 * @description Thin entry point for the Exaix TUI dashboard executable.
 * @architectural-layer Application
 * @related-files ["apps/tui/src/tui_dashboard.ts"]
 */

import { launchTuiDashboard } from "./src/tui_dashboard.ts";

if (import.meta.main) {
  await launchTuiDashboard();
}
