/**
 * @module TuiEnums
 * @path src/types/enums.ts
 * @description UI-specific enum definitions exported by @exaix/tui.
 * @architectural-layer TUI
 */

export enum GroupingMode {
  IDENTITY = "identity",
  ACTION = "action",
  NONE = "none",
  STATUS = "status",
  PROJECT = "project",
}

export enum SplitDirection {
  VERTICAL = "vertical",
  HORIZONTAL = "horizontal",
}

export enum RequestGroupingMode {
  NONE = "none",
  STATUS = "status",
  PRIORITY = "priority",
  IDENTITY = "identity",
}

export enum DialogPurpose {
  SPLIT = "split",
  CHANGE = "change",
  NEW = "new",
}

export enum LayoutMode {
  SAVE = "save",
  LOAD = "load",
  DELETE = "delete",
}

export enum ResizeDirection {
  LEFT = "left",
  RIGHT = "right",
  UP = "up",
  DOWN = "down",
}

export enum ScrollDirection {
  UP = "up",
  DOWN = "down",
  TOP = "top",
  BOTTOM = "bottom",
}

export enum KeyModifier {
  CTRL = "ctrl",
  ALT = "alt",
  SHIFT = "shift",
  META = "meta",
}

export enum UIOutputFormat {
  TABLE = "table",
  JSON = "json",
  MARKDOWN = "md",
}

export enum SpinnerStyle {
  DOTS = "dots",
  BRAILLE = "braille",
  LINE = "line",
  ARC = "arc",
  BOUNCE = "bounce",
  PULSE = "pulse",
}

export enum TuiColorName {
  RED = "red",
  GREEN = "green",
  YELLOW = "yellow",
  BLUE = "blue",
  WHITE = "white",
  GRAY = "gray",
  MAGENTA = "magenta",
}

export enum TuiNodeType {
  ROOT = "root",
  SCOPE = "scope",
  PROJECT = "project",
  EXECUTION = "execution",
  PORTAL = "portal",
  LEARNING = "learning",
  PATTERN = "pattern",
  DECISION = "decision",
  IDENTITY = "identity",
  STATUS_GROUP = "status-group",
  MODEL_GROUP = "model-group",
  GROUP = "group",
  PLAN = "plan",
  ARTIFACT = "artifact",
}

export enum TuiGroupBy {
  NONE = "none",
  STATUS = "status",
  MODEL = "model",
}

export enum TuiIcon {
  IDENTITY = "🤖",
  LEARNING = "🎯",
  BRAIN = "🧠",
  SUCCESS = "✅",
  WARNING = "⚠️",
  CRITICAL = "❌",
  INFO = "ℹ️",
  BULLET = "•",
  PORTAL_ACTIVE = "🟢",
  PORTAL_BROKEN = "🔴",
  PORTAL_INACTIVE = "⚪",
  FOLDER = "📂",
}

export enum RequestDialogType {
  SEARCH = "search",
  FILTER_STATUS = "filter-status",
  FILTER_IDENTITY = "filter-identity",
  CREATE = "create",
  PRIORITY = "priority",
}

export enum TuiViewName {
  DASHBOARD = "TuiDashboard",
  PORTAL_MANAGER = "PortalManagerView",
  MONITOR = "MonitorView",
  PLAN_REVIEWER = "PlanReviewerView",
  DAEMON_CONTROL = "DaemonControlView",
  SKILLS_MANAGER = "SkillsManagerView",
  MEMORY_VIEW = "MemoryView",
  REQUEST_MANAGER = "RequestManagerView",
  AGENT_STATUS = "AgentStatusView",
  LOG_VIEWER = "LogViewer",
  STRUCTURED_LOG_VIEWER = "StructuredLogViewer",
}

export enum StatusIndicator {
  ACTIVE = "active",
  PENDING = "pending",
  COMPLETED = "completed",
  FAILED = "failed",
  APPROVED = "approved",
  REJECTED = "rejected",
  ARCHIVED = "archived",
  RUNNING = "running",
}

export enum LogGroupingMode {
  CORRELATION = "correlation",
  TRACE = "trace",
  IDENTITY = "identity",
  LEVEL = "level",
  TIME = "time",
  NONE = "none",
}

export enum SkillGroupingMode {
  SOURCE = "source",
  STATUS = "status",
  NONE = "none",
}

export enum GroupingField {
  SOURCE = "source",
  STATUS = "status",
  CATEGORY = "category",
  PRIORITY = "priority",
}

export enum DaemonKeyAction {
  START = "start",
  STOP = "stop",
  RESTART = "restart",
  VIEW_LOGS = "view-logs",
  VIEW_CONFIG = "view-config",
  REFRESH = "refresh",
  AUTO_REFRESH = "auto-refresh",
  HELP = "help",
  QUIT = "quit",
  CANCEL = "cancel",
}
