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

For the complete keyboard shortcut reference (global keys, navigation, split views, view-specific keys, layout presets, and accessibility), see [`docs/TUI_Keyboard_Reference.md`](../../docs/TUI_Keyboard_Reference.md).

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

- [`docs/TUI_Keyboard_Reference.md`](../../docs/TUI_Keyboard_Reference.md) — Complete keyboard shortcut reference
- [@exaix/tui](../../packages/tui/) — Base TUI components and layout primitives
