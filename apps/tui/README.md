# Exaix TUI App

Terminal User Interface dashboard for Exaix operations.

## Role

The TUI provides an interactive dashboard for monitoring and managing Exaix — tracking daemon status, reviewing plans, browsing portal memory, monitoring agent activity, and managing requests — all from the terminal.

## Views

| View          | Default behavior  |
| ------------- | ----------------- |
| Portals       | Scrollable list   |
| Requests      | Scrollable list   |
| Plans         | Detail view       |
| Reviews       | Side-by-side diff |
| Logs          | Tail-follow       |
| Daemon Status | Live indicators   |
| Agents        | Active sessions   |
| Notifications | Bell icon + count |

## Keyboard Shortcuts

### Global Keys

| Key         | Action               |
| ----------- | -------------------- |
| `Tab`       | Next pane/view       |
| `Shift+Tab` | Previous pane/view   |
| `1`-`7`     | Jump to pane         |
| `?` / `F1`  | Show help overlay    |
| `R`         | Refresh view         |
| `n`         | Toggle notifications |
| `q` / `Esc` | Quit dashboard       |

### Navigation

| Key       | Action        |
| --------- | ------------- |
| `↑` / `k` | Move up       |
| `↓` / `j` | Move down     |
| `←` / `h` | Collapse/back |
| `→` / `l` | Expand/enter  |
| `Enter`   | Select        |
| `Space`   | Toggle        |

### Split View / Panes

| Key   | Action           |
| ----- | ---------------- |
| `v`   | Split vertical   |
| `h`   | Split horizontal |
| `c`   | Close pane       |
| `z`   | Maximize/restore |
| `Tab` | Next pane        |
| `d`   | Default layout   |

## Architecture

- **Entry point:** `exactl dashboard` → `apps/exactl/src/commands/dashboard_commands.ts` → this app (via subprocess)
- **7 integrated views:** Portal Manager, Plan Reviewer, Monitor, Daemon Control, Agent Status, Request Manager, Memory View
- **Raw mode:** `tryEnableRawMode()` / `tryDisableRawMode()` for interactive input; falls back to line-based input when unavailable

### View Integration

Each view extends `TuiSessionBase` and implements:

- `render()` — View-specific rendering
- `handleKey(key: string)` — Keyboard input handling
- `getFocusableElements()` — List of focusable UI elements

## Testing Strategy

- **Unit tests:** Mock services for isolated view testing
- **Integration tests:** Full dashboard lifecycle with test mode
- **Sanitizer safety:** Test mode skips timers to prevent leaks

## Accessibility

```toml
[tui]
high_contrast = false
screen_reader = false
theme = "dark"  # "dark", "light", or "system"
```

## See Also

- [@exaix/tui](../../packages/tui/) — Base TUI components and layout primitives
