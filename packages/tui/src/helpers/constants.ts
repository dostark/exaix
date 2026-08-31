/**
 * @module Constants
 * @path packages/tui/src/helpers/constants.ts
 * @description Centralized constants for TUI display, layouts, icons, and system limits.
 * @architectural-layer Helpers
 * @related-files ["packages/tui/src/helpers/tree_view.ts", "packages/tui/src/helpers/colors.ts"]
 */
export const TUI_TREE_PAGINATION_LIMIT = 20;
export const TUI_TREE_RECENT_LIMIT = 10;
export const TUI_DETAIL_MAX_OVERVIEW_CHARS = 300;
export const TUI_DETAIL_MAX_SUMMARY_CHARS = 200;
export const TUI_DETAIL_DATE_LOCALE = "en-US";

export const TUI_PREFIX_PROJECT = "project:";
export const TUI_PREFIX_EXECUTION = "execution:";
export const TUI_PREFIX_PENDING = "pending:";

export const TUI_STATUS_MSG_CANCELLED = "Cancelled";
export const TUI_STATUS_MSG_ERROR_PREFIX = "Error: ";
export const TUI_STATUS_MSG_PROPOSAL_APPROVED = "Proposal approved";
export const TUI_STATUS_MSG_PROPOSAL_REJECTED = "Proposal rejected";
export const TUI_STATUS_MSG_BULK_APPROVE_COMPLETED = "Bulk approval completed";
export const TUI_STATUS_MSG_LEARNING_ADDED = "Learning added";
export const TUI_STATUS_MSG_PROMOTE_COMPLETED = "Promoted to global";
export const TUI_STATUS_MSG_READY = "Ready";

export const TUI_LABEL_GLOBAL_MEMORY = "Global Memory";
export const TUI_LABEL_PROJECTS = "Projects";
export const TUI_LABEL_EXECUTIONS = "Executions";
export const TUI_LABEL_PENDING = "Pending Proposals";
export const TUI_LABEL_REQUEST_DETAILS = "REQUEST DETAILS";

export const TUI_MSG_SELECT_ITEM = "Select an item to view details.";
export const TUI_MSG_PRESS_QUIT = "Press ESC or q to close";

export const TUI_MSG_PRESS_CLOSE_HELP = "\nPress ? or Esc to close help";
export const TUI_MSG_DASHBOARD_HEADER = "                         Exaix TUI Dashboard                               ";

// TUI Layout and Display Constants
export const TUI_LAYOUT_LABEL_WIDTH = 30;
export const TUI_LAYOUT_FULL_WIDTH = 80;
export const TUI_LAYOUT_MEDIUM_WIDTH = 60;
export const TUI_LAYOUT_DIALOG_WIDTH = 70;
export const TUI_DIALOG_DEFAULT_HEIGHT = 20;
export const TUI_DIALOG_INNER_PADDING = 4;
export const TUI_DASHBOARD_VIEW_PICKER_WIDTH = 34;
export const TUI_VIEW_PICKER_INNER_WIDTH = 36;
export const TUI_LAYOUT_PRESET_LIST_WIDTH = 38;
export const TUI_LAYOUT_VALUE_WIDTH = 50;
export const TUI_LAYOUT_DEFAULT_HEIGHT = 24;
export const TUI_LIMIT_PREVIEW_ITEMS = 10;
export const TUI_LIMIT_SEARCH_RESULTS = 20;
export const TUI_LIMIT_SHORT = 5;
export const TUI_LIMIT_MEDIUM = 10;
export const TUI_LIMIT_LONG = 15;
export const TUI_LIMIT_LOGS_MAX = 1000;
export const TUI_LIMIT_LOGS_DEFAULT = 500;
export const TUI_PREVIEW_SHORT = 40;
export const TUI_PREVIEW_MEDIUM = 60;
export const TUI_SPINNER_FRAMES = 10;
export const TUI_MAIN_PANE_ID = "main";

// TUI Focusable Element IDs
export const TUI_ELEMENT_ACTION_BUTTONS = "action-buttons";

// General System Limits and Thresholds

/** Narrow width for TUI minor panels and windows */
export const TUI_LAYOUT_NARROW_WIDTH = 50;

// TUI Portal Icons
export const TUI_ICON_PORTAL_ACTIVE = "🟢";
export const TUI_ICON_PORTAL_BROKEN = "🔴";
export const TUI_ICON_PORTAL_INACTIVE = "⚪";
export const TUI_ICON_FOLDER = "📂";
export const TUI_ICON_AGENT = "🤖";
export const TUI_ICON_BRAIN = "🧠";
export const TUI_ICON_SUCCESS = "✅";
export const TUI_ICON_FAILURE = "❌";
export const TUI_ICON_WARNING = "⚠️";
export const TUI_ICON_DEBUG = "🔍";
export const TUI_ICON_FATAL = "💀";

// TUI Priority Icons
export const TUI_PRIORITY_ICONS: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  normal: "⚪",
  low: "🔵",
  default: "⚪", // Fallback
};

// TUI Status Icons
export const TUI_STATUS_ICONS: Record<string, string> = {
  pending: "⏳",
  queued: "📋",
  running: "🔄",
  completed: "✅",
  failed: "💥",
  cancelled: "❌",
  active: "🟢",
  draft: "🟡",
  deprecated: "⚫",
};

// TUI Agent Status Icons
export const TUI_AGENT_STATUS_ICONS: Record<string, string> = {
  active: "🟢",
  inactive: "🟡",
  error: "🔴",
};

// TUI Agent Health Icons
export const TUI_AGENT_HEALTH_ICONS: Record<string, string> = {
  healthy: "✅",
  warning: "⚠️",
  critical: "❌",
};

// TUI Log Level Icons
export const TUI_LOG_LEVEL_ICONS: Record<string, string> = {
  info: "ℹ️",
  warn: "⚠️",
  error: "❌",
};

// TUI Source Icons
export const TUI_SOURCE_ICONS: Record<string, string> = {
  core: "📦",
  project: "📁",
  learned: "📚",
};

// TUI Skill Icon
export const TUI_SKILL_ICON = "🎯";

// TUI Portal Status Icons
export const TUI_PORTAL_ICONS = {
  active: TUI_ICON_PORTAL_ACTIVE,
  broken: TUI_ICON_PORTAL_BROKEN,
  inactive: TUI_ICON_PORTAL_INACTIVE,
  folder: TUI_ICON_FOLDER,
} as const;

// TUI Tree Icons
export const TUI_TREE_ICONS = {
  expanded: "▼",
  collapsed: "▶",
  leaf: "•",
  file: "📄",
  folder: "📁",
  folderOpen: "📂",
  root: "🏠",
  project: "📦",
  execution: "⚡",
  pattern: "🔷",
  decision: TUI_ICON_SUCCESS,
  learning: "💡",
  pending: "⏳",
  search: "🔍",
  global: "🌐",
  agent: "🤖",
  portal: "🚪",
  daemon: "👻",
  request: "📝",
  log: "📋",
} as const;

// TUI Default Log Icons
export const TUI_DEFAULT_ICONS: Record<string, string> = {
  info: TUI_ICON_SUCCESS,
  warn: TUI_ICON_WARNING,
  error: TUI_ICON_FAILURE,
  debug: TUI_ICON_DEBUG,
  fatal: TUI_ICON_FATAL,
};

// TUI Log Event Icons
export const TUI_LOG_ICONS: Record<string, string> = {
  "request_created": "📝",
  "request.created": "📝",
  "plan_approved": "✅",
  "plan.approved": "✅",
  "plan.rejected": "❌",
  "execution_started": "🚀",
  "execution.started": "🚀",
  "execution_completed": TUI_ICON_SUCCESS,
  "execution.completed": TUI_ICON_SUCCESS,
  "execution_failed": "💥",
  "execution.failed": "💥",
  "error": "⚠️",
  "default": "📋",
};

// TUI Daemon Status Icons
export const TUI_DAEMON_STATUS_ICONS: Record<string, string> = {
  running: "🟢",
  stopped: "🔴",
  error: "⚠️",
  unknown: "❓",
};

// TUI Dashboard Icons
export const TUI_DASHBOARD_ICONS = {
  views: {
    PortalManagerView: "🌀",
    PlanReviewerView: "📋",
    MonitorView: "📊",
    StructuredLogViewer: "🔍",
    DaemonControlView: "⚙️",
    AgentStatusView: "🤖",
    RequestManagerView: "📥",
    MemoryView: "💾",
    SkillsManagerView: "🎯",
  } as Record<string, string>,
  pane: {
    focused: "●",
    unfocused: "○",
    split: "│",
    horizontal: "─",
    corner: "┼",
  },
  notification: {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌",
    bell: "🔔",
    memory_update_pending: "📝",
    memory_approved: "✅",
    memory_rejected: "❌",
  },
  layout: {
    single: "□",
    vertical: "▯▯",
    horizontal: "▭▭",
    quad: "⊞",
    save: "💾",
    load: "📂",
    reset: "🔄",
  },
} as const;

// TUI Node Types
export const TUI_NODE_TYPE_AGENT = "agent";
export const TUI_NODE_TYPE_MODEL_GROUP = "model_group";
export const TUI_NODE_TYPE_STATUS_GROUP = "status_group";

// TUI View Labels
export const TUI_LABEL_CANCEL = "Cancel";
export const TUI_LABEL_PORTAL_MANAGER = "Portal Manager";

// TUI Separator Strings
export const TUI_SEPARATOR_ROW = "├────────────────────────────────────────┤";

// TUI Key Display Labels
export const TUI_KEY_LABEL_ENTER = "Enter";

// TUI Action Types
export const TUI_ACTION_SEARCH = "search";
