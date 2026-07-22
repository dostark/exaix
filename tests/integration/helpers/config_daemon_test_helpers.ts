/**
 * @module ConfigDaemonTestHelpers
 * @path tests/integration/helpers/config_daemon_test_helpers.ts
 * @description Shared helpers for config daemon boot/integrity integration tests.
 */

import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";

export async function hasJournalEvent(configPath: string, action: string): Promise<boolean> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const rows = await db.preparedAll<{ n: number }>(
      "SELECT COUNT(*) AS n FROM activity WHERE action_type = ?",
      [action],
    );
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await db.close();
  }
}
