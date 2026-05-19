/**
 * @module Daemon
 * @path @exaix/core/types
 * @description Module for Daemon.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types]
 */

export interface IDaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: string;
  version: string;
  workspace_schema_version: string;
}
