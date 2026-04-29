/**
 * @module Daemon
 * @path src/shared/types/daemon.ts
 * @description Module for Daemon.
 * @architectural-layer Shared
 * @related-files [src/shared/interfaces/i_daemon_service.ts]
 */

export interface IDaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: string;
  version: string;
  workspace_schema_version: string;
}
