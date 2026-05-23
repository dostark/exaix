/**
 * @module McpCommands
 * @path apps/exactl/src/commands/mcp_commands.ts
 * @description Provides CLI commands for starting the MCP server by delegating
 * to the standalone apps/mcp-server/main.ts entry point.
 * @architectural-layer CLI
 * @related-files ["apps/mcp-server/main.ts", "packages/mcp/server/server.ts"]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { STDIO_INHERIT } from "./constants.ts";

export class McpCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  protected async runDenoCommand(args: string[]): Promise<void> {
    const cmd = new Deno.Command("deno", {
      args,
      stdin: STDIO_INHERIT,
      stdout: STDIO_INHERIT,
      stderr: STDIO_INHERIT,
    });

    const child = cmd.spawn();
    const status = await child.status;

    if (!status.success) {
      throw new Error(`MCP server exited with code ${status.code}`);
    }
  }

  async start(options: { sse?: boolean; port?: number }): Promise<void> {
    const args = ["run", "--allow-all", "apps/mcp-server/main.ts"];

    if (options.sse) {
      args.push("--transport", "sse");
      if (options.port) {
        args.push("--port", String(options.port));
      }
    } else {
      args.push("--transport", "stdio");
    }

    await this.runDenoCommand(args);
  }
}
