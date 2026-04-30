/**
 * @module ViewRegistry
 * @path src/tui/dashboard/view_registry.ts
 * @description Central registry and initialization logic for all TUI views, facilitating service injection and focus management.
 * @architectural-layer TUI
 * @related-files ["src/tui/tui_dashboard.ts"]
 */

import { PortalManagerView } from "../portal_manager_view.ts";
import { PlanReviewerView } from "../plan_reviewer_view.ts";
import { MonitorView } from "../monitor_view.ts";
import { StructuredLogViewer } from "../structured_log_viewer.ts";
import { DaemonControlView } from "../daemon_control_view.ts";
import { AgentStatusView } from "../agent_status_view.ts";
import { RequestManagerView } from "../request_manager_view.ts";
import { MemoryView } from "../memory_view.ts";
import { SkillsManagerView } from "../skills_manager_view.ts";
import type { ITuiView } from "../tui_dashboard.ts";
import type { ILogService, IStructuredLogger } from "@exaix/core/types/i_log_service.ts";
import type { IJournalService } from "@exaix/core/types/i_journal_service.ts";
import type { IMemoryService } from "@exaix/core/types/i_memory_service.ts";
import {
  MockAgentService,
  MockDaemonService,
  MockLogService,
  MockMemoryService,
  MockPlanService,
  MockPortalService,
  MockRequestService,
  MockSkillsService,
  MockStructuredLogger,
  MockStructuredLoggerService,
} from "../tui_dashboard_mocks.ts";

import type { IDatabaseService } from "@exaix/core/types/i_database_service.ts";
import type { IAgentService, IPlanService, IPortalService, IRequestService, ISkillsService } from "@exaix/core/types";
import type { IDaemonService } from "@exaix/core/types/i_daemon_service.ts";
import { TUI_ELEMENT_ACTION_BUTTONS, TUI_MAIN_PANE_ID } from "../helpers/constants.ts";
import type { Config } from "@exaix/schemas/config.ts";

/**
 * Service bundle interface for TUI initialization
 */
export interface ITuiServiceBundle {
  portalService: IPortalService;
  planService: IPlanService;
  journalService: IJournalService;
  structuredLogger: IStructuredLogger;
  structuredLoggerService: ILogService;
  daemonService: IDaemonService;
  agentService: IAgentService;
  requestService: IRequestService;
  memoryService: IMemoryService;
  skillsService: ISkillsService;
}

export interface IDashboardViewOptions {
  testMode?: boolean;
  databaseService?: IDatabaseService;
  config?: Config;
  /** Pre-created service bundle (from core factory) */
  services?: ITuiServiceBundle;
}

export interface IDashboardServices {
  portalService: IPortalService;
  planService: IPlanService;
  logService: IJournalService | IDatabaseService;
  structuredLogger: IStructuredLogger;
  structuredLoggerService: ILogService;
  daemonService: IDaemonService;
  agentService: IAgentService;
  requestService: IRequestService;
  memoryService: IMemoryService;
  skillsService: ISkillsService;
}

export interface IDashboardViewsAndServices {
  views: ITuiView[];
  services: IDashboardServices;
}

/**
 * Initialize all views for the TUI dashboard.
 *
 * @param options - Dashboard initialization options
 * @returns Views and services for the dashboard
 *
 * @remarks
 * If `options.services` is provided, those services will be used directly.
 * Otherwise, mock services are created for test mode, or an error is thrown
 * for production mode (services should be created by the core factory).
 */
export function initDashboardViews(
  options: IDashboardViewOptions = {},
): IDashboardViewsAndServices {
  let portalService: IPortalService;
  let planService: IPlanService;
  let logService: IJournalService | IDatabaseService;
  let structuredLogger: IStructuredLogger;
  let structuredLoggerService: ILogService;
  let daemonService: IDaemonService;
  let agentService: IAgentService;
  let requestService: IRequestService;
  let memoryService: IMemoryService;
  let skillsService: ISkillsService;

  // Use provided services or create mocks for test mode
  if (options.services) {
    // Use pre-created services from core factory
    portalService = options.services.portalService;
    planService = options.services.planService;
    logService = options.services.journalService;
    structuredLogger = options.services.structuredLogger;
    structuredLoggerService = options.services.structuredLoggerService;
    daemonService = options.services.daemonService;
    agentService = options.services.agentService;
    requestService = options.services.requestService;
    memoryService = options.services.memoryService;
    skillsService = options.services.skillsService;
  } else if (options.testMode || !options.config || !options.databaseService) {
    // Test mode: use mock services
    portalService = new MockPortalService();
    planService = new MockPlanService();
    logService = options.databaseService || new MockLogService();
    structuredLogger = new MockStructuredLogger();
    structuredLoggerService = new MockStructuredLoggerService();
    daemonService = new MockDaemonService();
    agentService = new MockAgentService();
    requestService = new MockRequestService();
    memoryService = new MockMemoryService();
    skillsService = new MockSkillsService();
  } else {
    // Production mode without pre-created services: this should not happen
    // Services should be created by the core factory (src/services/tui_service_factory.ts)
    throw new Error(
      "Production mode requires pre-created services. " +
        "Use createTuiServices() from src/services/tui_service_factory.ts",
    );
  }

  const services: IDashboardServices = {
    portalService,
    planService,
    logService,
    structuredLogger,
    structuredLoggerService,
    daemonService,
    agentService,
    requestService,
    memoryService,
    skillsService,
  };

  const views = [
    Object.assign(new PortalManagerView(portalService), { name: "PortalManagerView" }),
    Object.assign(new PlanReviewerView(planService), { name: "PlanReviewerView" }),
    Object.assign(new MonitorView(logService as IJournalService), { name: "MonitorView" }),
    Object.assign(
      new StructuredLogViewer(structuredLoggerService, structuredLogger, {
        testMode: options.testMode,
      }),
      {
        name: "StructuredLogViewer",
      },
    ),
    Object.assign(new DaemonControlView(daemonService), { name: "DaemonControlView" }),
    Object.assign(new AgentStatusView(agentService), { name: "AgentStatusView" }),
    Object.assign(new RequestManagerView(requestService), { name: "RequestManagerView" }),
    Object.assign(
      new MemoryView(
        memoryService as IMemoryService,
      ),
      { name: "MemoryView" },
    ),
    Object.assign(new SkillsManagerView(skillsService), { name: "SkillsManagerView" }),
  ].map((view) => {
    const v = view as ITuiView;
    if (typeof v.getFocusableElements !== "function") {
      if (v.name === "PortalManagerView") {
        v.getFocusableElements = () => ["portal-list", TUI_ELEMENT_ACTION_BUTTONS, "status-bar"];
      } else {
        v.getFocusableElements = () => [TUI_MAIN_PANE_ID];
      }
    }
    return v;
  });

  return { views, services };
}
