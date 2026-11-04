/**
 * @module ExaCtlRuntime
 * @path apps/exactl/src/exactl_runtime.ts
 * @description The shared services and command objects that the exactl command builders read.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/command_builders/request_command.ts]
 */

import type { Command } from "@cliffy/command";
import type { PlanCommands } from "./commands/plan_commands.ts";
import type { RequestCommands } from "./commands/request_commands.ts";
import type { ReviewCommands } from "./commands/review_commands.ts";
import type { GitCommands } from "./commands/git_commands.ts";
import type { DaemonCommands } from "./commands/daemon_commands.ts";
import type { ConfigCommands } from "./commands/config_commands.ts";
import type { PortalCommands } from "./commands/portal_commands.ts";
import type { BlueprintCommands } from "./commands/blueprint_commands.ts";
import type { FlowCommands } from "./commands/flow_commands.ts";
import type { DashboardCommands } from "./commands/dashboard_commands.ts";
import type { MemoryCommands } from "./commands/memory_commands.ts";
import type { ModelCommands } from "./commands/model_commands.ts";
import type { RoutingCommands } from "./commands/routing_commands.ts";
import type { WaitStateCommands } from "./commands/wait_state_commands.ts";
import type { IServiceContext } from "./init.ts";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import type { EvalCommands } from "./commands/eval_commands.ts";

export interface IExaCtlRuntime {
  readonly context: ICliApplicationContext;
  readonly fullContext: ICliApplicationContext;
  readonly provider: IServiceContext["provider"];
  readonly display: IServiceContext["display"];
  readonly config: ReturnType<IServiceContext["config"]["getAll"]>;
  readonly requestCommands: RequestCommands;
  readonly planCommands: PlanCommands;
  readonly reviewCommands: ReviewCommands;
  readonly gitCommands: GitCommands;
  readonly daemonCommands: DaemonCommands;
  readonly configCommands: ConfigCommands;
  readonly portalCommands: PortalCommands;
  readonly blueprintCommands: BlueprintCommands;
  readonly routingCommands: RoutingCommands;
  readonly flowCommands: FlowCommands;
  readonly dashboardCommands: DashboardCommands;
  readonly memoryCommands: MemoryCommands;
  readonly memorySkillCommand: Command;
  readonly waitStateCommands: WaitStateCommands;
  readonly evalCommands: EvalCommands;
  readonly modelCommands: ModelCommands;
}
